use crate::commands::files::validate_path;
use crate::error::VoidError;
use serde::Serialize;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;

/// Maximum number of extra context files the frontend may attach to a single
/// CLI invocation. Protects against a runaway tool result asking us to read
/// thousands of files into one prompt.
const MAX_FILE_PATHS: usize = 32;

/// Combined cap on bytes read across the primary file plus all extra context
/// files. Each individual file must also fit under `MAX_PER_FILE_BYTES`.
const MAX_TOTAL_CONTEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PER_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Result of checking CLI availability
#[derive(Serialize)]
pub struct CLIAvailability {
    pub claude: bool,
    pub codex: bool,
}

/// Result of a CLI AI invocation
#[derive(Serialize)]
pub struct CLIAIResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
    /// Final assistant message captured via `--output-last-message` (codex).
    /// When present, callers should prefer this over re-parsing stdout.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_message: Option<String>,
}

/// Live stdout/stderr line emitted while a prompt CLI is running.
#[derive(Clone, Serialize)]
pub struct CLIPromptProgressEvent {
    pub request_id: String,
    pub stream: String,
    pub line: String,
    pub sequence: u64,
}

/// Expand PATH to include common Node.js manager paths (nvm, fnm, volta)
pub fn expanded_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.to_string_lossy();
    let current_path = std::env::var("PATH").unwrap_or_default();

    let mut extra: Vec<String> = Vec::new();

    // nvm: find latest installed node version
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.path().join("bin").to_string_lossy().to_string())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                extra.push(latest.clone());
            }
        }
    }

    // fnm
    let fnm_bin = format!("{home_str}/.fnm/aliases/default/bin");
    if std::path::Path::new(&fnm_bin).is_dir() {
        extra.push(fnm_bin);
    }

    // volta
    let volta_bin = format!("{home_str}/.volta/bin");
    if std::path::Path::new(&volta_bin).is_dir() {
        extra.push(volta_bin);
    }

    extra.push(format!("{home_str}/.local/bin"));
    extra.push("/usr/local/bin".to_string());
    extra.push("/opt/homebrew/bin".to_string());
    extra.push(current_path);

    extra.join(":")
}

/// Check which CLI exists by running `which`
fn cli_exists(name: &str) -> bool {
    let path = expanded_path();
    StdCommand::new("which")
        .arg(name)
        .env("PATH", &path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn truncate_progress_line(line: &str) -> String {
    const MAX_CHARS: usize = 4_000;
    let mut chars = line.chars();
    let truncated: String = chars.by_ref().take(MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn emit_progress(
    app_handle: &AppHandle,
    request_id: &Option<String>,
    stream: &str,
    line: &str,
    sequence: &Arc<AtomicU64>,
) {
    let Some(request_id) = request_id else {
        return;
    };

    if line.trim().is_empty() {
        return;
    }

    let _ = app_handle.emit(
        "cli:prompt:progress",
        CLIPromptProgressEvent {
            request_id: request_id.clone(),
            stream: stream.to_string(),
            line: truncate_progress_line(line),
            sequence: sequence.fetch_add(1, Ordering::Relaxed),
        },
    );
}

async fn read_stream<R>(
    reader: R,
    app_handle: AppHandle,
    request_id: Option<String>,
    stream: &'static str,
    sequence: Arc<AtomicU64>,
) -> String
where
    R: AsyncRead + Unpin,
{
    let mut output = String::new();
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        emit_progress(&app_handle, &request_id, stream, &line, &sequence);
        output.push_str(&line);
        output.push('\n');
    }

    output
}

#[allow(clippy::too_many_arguments)]
async fn run_cli_once(
    app_handle: AppHandle,
    request_id: Option<String>,
    cli: &str,
    path_env: &str,
    args: Vec<String>,
    working_directory: Option<String>,
    timeout: std::time::Duration,
    final_output_path: Option<std::path::PathBuf>,
) -> CLIAIResult {
    let mut cmd = Command::new(cli);
    cmd.env("PATH", path_env);

    if let Some(ref cwd) = working_directory {
        cmd.current_dir(cwd);
    }

    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return CLIAIResult {
                stdout: String::new(),
                stderr: format!("Failed to run {cli}: {e}"),
                exit_code: -1,
                timed_out: false,
                final_message: None,
            };
        }
    };

    let sequence = Arc::new(AtomicU64::new(0));

    let stdout_task = child.stdout.take().map(|stdout| {
        tokio::spawn(read_stream(
            stdout,
            app_handle.clone(),
            request_id.clone(),
            "stdout",
            sequence.clone(),
        ))
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        tokio::spawn(read_stream(
            stderr,
            app_handle.clone(),
            request_id.clone(),
            "stderr",
            sequence.clone(),
        ))
    });

    let wait_result = tokio::time::timeout(timeout, child.wait()).await;
    let mut timed_out = false;

    let exit_code = match wait_result {
        Ok(Ok(status)) => status.code().unwrap_or(-1),
        Ok(Err(_)) => -1,
        Err(_) => {
            timed_out = true;
            let _ = child.kill().await;
            let _ = child.wait().await;
            -1
        }
    };

    let stdout = match stdout_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };

    let final_message = if let Some(path) = final_output_path {
        let contents = tokio::fs::read_to_string(&path).await.ok();
        let _ = tokio::fs::remove_file(path).await;
        contents.and_then(|text| {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    } else {
        None
    };

    CLIAIResult {
        stdout,
        stderr,
        exit_code,
        timed_out,
        final_message,
    }
}

/// Check which AI CLIs are available on the system
#[tauri::command]
pub async fn check_cli_available() -> Result<CLIAvailability, VoidError> {
    let result = tokio::task::spawn_blocking(|| CLIAvailability {
        claude: cli_exists("claude"),
        codex: cli_exists("codex"),
    })
    .await
    .map_err(|e| VoidError::CLIExecution(format!("Failed to check CLI: {e}")))?;

    Ok(result)
}

/// Run an AI CLI against a markdown file.
///
/// For Claude CLI: `claude --print -p "prompt" file_path`
/// For Codex CLI: `codex exec -c model_reasoning_effort="<effort>" "prompt"`
///
/// Supports optional working_directory and file_paths for multi-file context.
///
/// Timeout: 5 minutes (300 seconds)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_cli_prompt(
    app_handle: AppHandle,
    cli: String,
    prompt: String,
    file_path: Option<String>,
    working_directory: Option<String>,
    file_paths: Option<Vec<String>>,
    system_prompt: Option<String>,
    reasoning_effort: Option<String>,
    web_access: Option<String>,
    request_id: Option<String>,
) -> Result<CLIAIResult, VoidError> {
    if cli != "claude" && cli != "codex" {
        return Err(VoidError::CLIExecution(format!(
            "Unsupported CLI: {cli}. Only 'claude' and 'codex' are supported."
        )));
    }

    // Validate every path the frontend hands us. A malicious AI tool result
    // could otherwise persuade us to point the CLI at ~/.ssh/id_rsa.
    let validated_file_path = match file_path.as_deref() {
        Some(fp) => Some(validate_path(fp)?),
        None => None,
    };
    let validated_working_directory = match working_directory.as_deref() {
        Some(cwd) => Some(validate_path(cwd)?),
        None => None,
    };
    let validated_file_paths: Vec<std::path::PathBuf> = match file_paths {
        Some(paths) => {
            if paths.len() > MAX_FILE_PATHS {
                return Err(VoidError::CLIExecution(format!(
                    "file_paths exceeds {MAX_FILE_PATHS}-entry limit"
                )));
            }
            let mut out = Vec::with_capacity(paths.len());
            for p in paths {
                out.push(validate_path(&p)?);
            }
            out
        }
        None => Vec::new(),
    };

    if let Some(ref fp) = validated_file_path {
        if tokio::fs::metadata(fp).await.is_err() {
            return Err(VoidError::FileRead {
                path: fp.to_string_lossy().to_string(),
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "File not found"),
            });
        }
    }

    let path_env = expanded_path();
    let timeout = std::time::Duration::from_secs(300);
    let reasoning_effort = reasoning_effort
        .filter(|effort| {
            matches!(
                effort.as_str(),
                "minimal" | "low" | "medium" | "high" | "xhigh"
            )
        })
        .unwrap_or_else(|| "medium".to_string());
    let use_native_web = web_access.as_deref() == Some("native");

    let mut total_context_bytes: usize = 0;

    // Read the primary file content if a file path was provided. Use tokio::fs
    // so we don't block the runtime's worker thread for the whole prompt.
    let file_content = match validated_file_path.as_ref() {
        Some(fp) => {
            let meta = tokio::fs::metadata(fp).await.map_err(|e| VoidError::FileRead {
                path: fp.to_string_lossy().to_string(),
                source: e,
            })?;
            if meta.len() > MAX_PER_FILE_BYTES {
                return Err(VoidError::FileRead {
                    path: fp.to_string_lossy().to_string(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!("File exceeds {MAX_PER_FILE_BYTES}-byte CLI context limit"),
                    ),
                });
            }
            let content =
                tokio::fs::read_to_string(fp)
                    .await
                    .map_err(|e| VoidError::FileRead {
                        path: fp.to_string_lossy().to_string(),
                        source: e,
                    })?;
            total_context_bytes = total_context_bytes.saturating_add(content.len());
            Some(content)
        }
        None => None,
    };

    // Read additional file contents if provided. We use the validated absolute
    // path for IO and for the on-prompt label so the CLI receives a consistent
    // reference; the original frontend strings (which may have contained ~ or
    // relative segments) are not exposed in the prompt body.
    let mut extra_context = String::new();
    for vp in &validated_file_paths {
        if let Ok(meta) = tokio::fs::metadata(vp).await {
            if meta.len() > MAX_PER_FILE_BYTES {
                continue;
            }
        } else {
            continue;
        }
        let label = vp.to_string_lossy().to_string();
        if let Ok(content) = tokio::fs::read_to_string(vp).await {
            let added_len = content.len().saturating_add(label.len()).saturating_add(32);
            if total_context_bytes.saturating_add(added_len) > MAX_TOTAL_CONTEXT_BYTES {
                break;
            }
            total_context_bytes = total_context_bytes.saturating_add(added_len);
            extra_context.push_str(&format!("\n\n--- File: `{}` ---\n\n{}", label, content));
        }
    }
    let working_directory = validated_working_directory
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());
    let file_path = validated_file_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    // Build the base prompt — include file context only when a file is provided
    let base_prompt = match (&file_path, &file_content) {
        (Some(fp), Some(content)) if extra_context.is_empty() => {
            format!(
                "Here is the content of the file `{}`:\n\n{}\n\n---\n\n{}",
                fp, content, prompt
            )
        }
        (Some(fp), Some(content)) => {
            format!(
                "Here is the content of the file `{}`:\n\n{}{}\n\n---\n\n{}",
                fp, content, extra_context, prompt
            )
        }
        _ if !extra_context.is_empty() => {
            format!("{}\n\n---\n\n{}", extra_context.trim_start(), prompt)
        }
        _ => prompt.clone(),
    };

    // Prepend system prompt if provided
    let full_prompt = match &system_prompt {
        Some(sp) => format!("{}\n\n---\n\n{}", sp, base_prompt),
        None => base_prompt,
    };

    let result = match cli.as_str() {
        "claude" => {
            let mut args = vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--include-partial-messages".to_string(),
            ];
            if use_native_web {
                args.push("--allowedTools".to_string());
                args.push("WebSearch,WebFetch".to_string());
            }
            args.push(full_prompt.clone());
            let result = run_cli_once(
                app_handle.clone(),
                request_id.clone(),
                &cli,
                &path_env,
                args,
                working_directory.clone(),
                timeout,
                None,
            )
            .await;

            let unsupported_stream = result.exit_code != 0
                && result.stdout.trim().is_empty()
                && (result.stderr.contains("output-format")
                    || result.stderr.contains("include-partial")
                    || result.stderr.to_lowercase().contains("unknown option"));

            if unsupported_stream {
                emit_progress(
                    &app_handle,
                    &request_id,
                    "stderr",
                    "Claude stream output is unavailable; retrying in text mode.",
                    &Arc::new(AtomicU64::new(0)),
                );
                run_cli_once(
                    app_handle,
                    request_id,
                    &cli,
                    &path_env,
                    {
                        let mut text_args = vec!["-p".to_string()];
                        if use_native_web {
                            text_args.push("--allowedTools".to_string());
                            text_args.push("WebSearch,WebFetch".to_string());
                        }
                        text_args.push(full_prompt);
                        text_args
                    },
                    working_directory,
                    timeout,
                    None,
                )
                .await
            } else {
                result
            }
        }
        "codex" => {
            let reasoning_config = format!("model_reasoning_effort=\"{}\"", reasoning_effort);
            let output_path = std::env::temp_dir().join(format!(
                "void-codex-last-message-{}.txt",
                request_id
                    .clone()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
            ));

            let mut args = Vec::new();
            if use_native_web {
                args.push("--search".to_string());
            }
            args.extend(vec![
                "exec".to_string(),
                "-c".to_string(),
                reasoning_config,
                "--skip-git-repo-check".to_string(),
                "--json".to_string(),
                "--output-last-message".to_string(),
                output_path.to_string_lossy().to_string(),
                full_prompt,
            ]);

            run_cli_once(
                app_handle,
                request_id,
                &cli,
                &path_env,
                args,
                working_directory,
                timeout,
                Some(output_path),
            )
            .await
        }
        _ => unreachable!(),
    };

    if result.timed_out {
        Ok(CLIAIResult {
            stdout: String::new(),
            stderr: "CLI process timed out after 5 minutes".to_string(),
            exit_code: -1,
            timed_out: true,
            final_message: None,
        })
    } else {
        Ok(result)
    }
}
