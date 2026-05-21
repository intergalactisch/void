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
const KEYLESS_CODEX_UNSUPPORTED_MESSAGE: &str =
    "This Codex CLI version requires API-key authentication, which Void does not support. Install or log in to a keyless Codex CLI and try again.";

/// Result of checking CLI availability
#[derive(Serialize)]
pub struct CLIAvailability {
    pub claude: bool,
    pub codex: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_flavor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_path: Option<String>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CodexCliFlavor {
    Exec,
    Legacy,
    ApiKeyOnly,
}

impl CodexCliFlavor {
    fn as_str(self) -> &'static str {
        match self {
            CodexCliFlavor::Exec => "exec",
            CodexCliFlavor::Legacy => "legacy",
            CodexCliFlavor::ApiKeyOnly => "api-key-only",
        }
    }
}

#[derive(Debug)]
struct CodexCliInfo {
    flavor: CodexCliFlavor,
    version: Option<String>,
    path: String,
}

#[derive(Debug)]
struct SimpleCliInfo {
    version: Option<String>,
    path: String,
}

struct BuiltCodexPrompt {
    args: Vec<String>,
    final_output_path: Option<std::path::PathBuf>,
}

trait CodexPromptStrategy: Send + Sync {
    fn build(
        &self,
        full_prompt: String,
        reasoning_effort: &str,
        use_native_web: bool,
        request_id: &Option<String>,
    ) -> BuiltCodexPrompt;
}

struct CodexExecStrategy;
struct CodexLegacyStrategy;

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

    // Herd's bundled nvm location (common on macOS PHP/Laravel setups)
    let herd_nvm_dir = home.join("Library/Application Support/Herd/config/nvm/versions/node");
    if herd_nvm_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&herd_nvm_dir) {
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

fn cli_paths(name: &str) -> Vec<String> {
    let path = expanded_path();
    let output = StdCommand::new("which")
        .arg("-a")
        .arg(name)
        .env("PATH", &path)
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    let mut paths = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let candidate = line.trim();
        if !candidate.is_empty() && !paths.iter().any(|path| path == candidate) {
            paths.push(candidate.to_string());
        }
    }
    paths
}

fn cli_output(name: &str, args: &[&str]) -> Option<String> {
    let path = expanded_path();
    StdCommand::new(name)
        .args(args)
        .env("PATH", &path)
        .stdin(Stdio::null())
        .output()
        .ok()
        .map(|output| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        })
}

fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn looks_like_codex_exec_help(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("--output-last-message")
        || lower.contains("--skip-git-repo-check")
        || (lower.contains("usage") && lower.contains("codex exec"))
}

fn looks_like_codex_legacy_help(text: &str) -> bool {
    let lower = text.to_lowercase();
    (lower.contains("--quiet") || lower.contains("-q,"))
        && lower.contains("<prompt>")
        && !looks_like_codex_exec_help(text)
}

fn looks_like_codex_api_key_only_help(text: &str) -> bool {
    let lower = text.to_lowercase();
    (lower.contains("provider to use for completions") && lower.contains("default: openai"))
        || lower.contains("openai_api_key")
        || lower.contains("missing openai api key")
        || lower.contains("platform.openai.com/account/api-keys")
}

fn contains_api_key_guidance(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("openai_api_key")
        || lower.contains("missing openai api key")
        || lower.contains("set the environment variable")
        || lower.contains("platform.openai.com/account/api-keys")
        || lower.contains("api-keys")
}

fn sanitize_cli_error(text: &str) -> String {
    if contains_api_key_guidance(text) {
        KEYLESS_CODEX_UNSUPPORTED_MESSAGE.to_string()
    } else {
        text.to_string()
    }
}

fn sanitize_cli_result(mut result: CLIAIResult) -> CLIAIResult {
    if result.exit_code != 0 {
        result.stdout = sanitize_cli_error(&result.stdout);
        result.stderr = sanitize_cli_error(&result.stderr);
        result.final_message = result
            .final_message
            .map(|message| sanitize_cli_error(&message));
    }
    result
}

fn codex_flavor_from_help(exec_help: &str, root_help: &str) -> CodexCliFlavor {
    if looks_like_codex_exec_help(exec_help) {
        return CodexCliFlavor::Exec;
    }

    if looks_like_codex_api_key_only_help(root_help) || looks_like_codex_api_key_only_help(exec_help)
    {
        return CodexCliFlavor::ApiKeyOnly;
    }

    if looks_like_codex_legacy_help(root_help) || looks_like_codex_legacy_help(exec_help) {
        return CodexCliFlavor::Legacy;
    }

    let root_lower = root_help.to_lowercase();
    if root_lower.contains("exec") {
        CodexCliFlavor::Exec
    } else {
        CodexCliFlavor::Legacy
    }
}

fn detect_codex_cli() -> Option<CodexCliInfo> {
    let candidates = cli_paths("codex");
    if candidates.is_empty() {
        return None;
    }

    let mut api_key_only: Option<CodexCliInfo> = None;

    for candidate in candidates {
        let root_help = cli_output(&candidate, &["--help"]).unwrap_or_default();
        let version =
            cli_output(&candidate, &["--version"]).and_then(|text| first_non_empty_line(&text));
        let flavor = if looks_like_codex_legacy_help(&root_help) {
            if looks_like_codex_api_key_only_help(&root_help) {
                CodexCliFlavor::ApiKeyOnly
            } else {
                CodexCliFlavor::Legacy
            }
        } else {
            let exec_help = cli_output(&candidate, &["exec", "--help"]).unwrap_or_default();
            codex_flavor_from_help(&exec_help, &root_help)
        };

        let info = CodexCliInfo {
            flavor,
            version,
            path: candidate,
        };

        match flavor {
            CodexCliFlavor::Exec | CodexCliFlavor::Legacy => return Some(info),
            CodexCliFlavor::ApiKeyOnly => {
                if api_key_only.is_none() {
                    api_key_only = Some(info);
                }
            }
        }
    }

    api_key_only
}

fn detect_simple_cli(name: &str) -> Option<SimpleCliInfo> {
    let path = cli_paths(name).into_iter().next()?;
    let version = cli_output(&path, &["--version"]).and_then(|text| first_non_empty_line(&text));
    Some(SimpleCliInfo { version, path })
}

impl CodexPromptStrategy for CodexExecStrategy {
    fn build(
        &self,
        full_prompt: String,
        reasoning_effort: &str,
        use_native_web: bool,
        request_id: &Option<String>,
    ) -> BuiltCodexPrompt {
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

        BuiltCodexPrompt {
            args,
            final_output_path: Some(output_path),
        }
    }
}

impl CodexPromptStrategy for CodexLegacyStrategy {
    fn build(
        &self,
        full_prompt: String,
        _reasoning_effort: &str,
        _use_native_web: bool,
        _request_id: &Option<String>,
    ) -> BuiltCodexPrompt {
        BuiltCodexPrompt {
            args: vec!["-q".to_string(), full_prompt],
            final_output_path: None,
        }
    }
}

fn codex_strategy_for(flavor: CodexCliFlavor) -> Box<dyn CodexPromptStrategy> {
    match flavor {
        CodexCliFlavor::Exec => Box::new(CodexExecStrategy),
        CodexCliFlavor::Legacy => Box::new(CodexLegacyStrategy),
        CodexCliFlavor::ApiKeyOnly => unreachable!("api-key-only Codex cannot build prompt args"),
    }
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

async fn await_stream_task(
    mut task: tokio::task::JoinHandle<String>,
    drain_timeout: std::time::Duration,
) -> String {
    tokio::select! {
        result = &mut task => result.unwrap_or_default(),
        _ = tokio::time::sleep(drain_timeout) => {
            task.abort();
            String::new()
        }
    }
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
    cmd.stdin(Stdio::null());
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

    let drain_timeout = std::time::Duration::from_secs(5);
    let stdout = match stdout_task {
        Some(task) => await_stream_task(task, drain_timeout).await,
        None => String::new(),
    };
    let stderr = match stderr_task {
        Some(task) => await_stream_task(task, drain_timeout).await,
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
    let result = tokio::task::spawn_blocking(|| {
        let claude_info = detect_simple_cli("claude");
        let codex_info = detect_codex_cli();
        CLIAvailability {
            claude: claude_info.is_some(),
            codex: codex_info.is_some(),
            claude_path: claude_info.as_ref().map(|info| info.path.clone()),
            claude_version: claude_info.and_then(|info| info.version),
            codex_flavor: codex_info
                .as_ref()
                .map(|info| info.flavor.as_str().to_string()),
            codex_version: codex_info.as_ref().and_then(|info| info.version.clone()),
            codex_path: codex_info.map(|info| info.path),
        }
    })
    .await
    .map_err(|e| VoidError::CLIExecution(format!("Failed to check CLI: {e}")))?;

    Ok(result)
}

/// Run an AI CLI against a markdown file.
///
/// For Claude CLI: `claude --print -p "prompt" file_path`
/// For Codex CLI: newer builds use `codex exec`; older builds use `codex -q`.
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
            let meta = tokio::fs::metadata(fp)
                .await
                .map_err(|e| VoidError::FileRead {
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
            let content = tokio::fs::read_to_string(fp)
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
            let codex_info = tokio::task::spawn_blocking(detect_codex_cli)
                .await
                .unwrap_or(None);
            let codex_flavor = codex_info
                .as_ref()
                .map(|info| info.flavor)
                .unwrap_or(CodexCliFlavor::Exec);
            let codex_binary = codex_info
                .as_ref()
                .map(|info| info.path.as_str())
                .unwrap_or(&cli);

            if codex_flavor == CodexCliFlavor::ApiKeyOnly {
                return Ok(CLIAIResult {
                    stdout: String::new(),
                    stderr: KEYLESS_CODEX_UNSUPPORTED_MESSAGE.to_string(),
                    exit_code: -1,
                    timed_out: false,
                    final_message: None,
                });
            }

            if use_native_web && codex_flavor == CodexCliFlavor::Legacy {
                emit_progress(
                    &app_handle,
                    &request_id,
                    "stderr",
                    "Codex native web search is unavailable in this CLI version; continuing without it.",
                    &Arc::new(AtomicU64::new(0)),
                );
            }

            let built_prompt = {
                let strategy = codex_strategy_for(codex_flavor);
                strategy.build(full_prompt, &reasoning_effort, use_native_web, &request_id)
            };

            run_cli_once(
                app_handle,
                request_id,
                codex_binary,
                &path_env,
                built_prompt.args,
                working_directory,
                timeout,
                built_prompt.final_output_path,
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
        Ok(sanitize_cli_result(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_new_codex_exec_contract_from_exec_help() {
        let exec_help = "Usage: codex exec [OPTIONS] [PROMPT]\n  --output-last-message <FILE>\n  --skip-git-repo-check";

        assert_eq!(codex_flavor_from_help(exec_help, ""), CodexCliFlavor::Exec);
    }

    #[test]
    fn detects_legacy_codex_prompt_contract_from_quiet_help() {
        let legacy_help =
            "Usage\n  $ codex [options] <prompt>\n\nOptions\n  -q, --quiet  Non-interactive mode";

        assert_eq!(
            codex_flavor_from_help("", legacy_help),
            CodexCliFlavor::Legacy
        );
    }

    #[test]
    fn detects_api_key_only_codex_prompt_contract_from_openai_provider_help() {
        let api_key_help = "Usage\n  $ codex [options] <prompt>\n\nOptions\n  -p, --provider <provider> Provider to use for completions (default: openai)\n  -q, --quiet Non-interactive mode";

        assert_eq!(
            codex_flavor_from_help("", api_key_help),
            CodexCliFlavor::ApiKeyOnly
        );
    }

    #[test]
    fn codex_exec_strategy_builds_output_file_contract() {
        let strategy = CodexExecStrategy;
        let request_id = Some("request-123".to_string());

        let built = strategy.build("Rewrite this".to_string(), "high", true, &request_id);

        assert_eq!(built.args[0], "--search");
        assert!(built.args.contains(&"exec".to_string()));
        assert!(built
            .args
            .contains(&"model_reasoning_effort=\"high\"".to_string()));
        assert!(built.args.contains(&"--json".to_string()));
        assert!(built.args.contains(&"--output-last-message".to_string()));
        assert!(built.final_output_path.is_some());
        assert_eq!(built.args.last().map(String::as_str), Some("Rewrite this"));
    }

    #[test]
    fn codex_legacy_strategy_builds_quiet_prompt_contract() {
        let strategy = CodexLegacyStrategy;

        let built = strategy.build("Rewrite this".to_string(), "high", true, &None);

        assert_eq!(
            built.args,
            vec!["-q".to_string(), "Rewrite this".to_string()]
        );
        assert!(built.final_output_path.is_none());
    }

    #[test]
    fn codex_api_key_only_contract_does_not_build_prompt_args() {
        let result = std::panic::catch_unwind(|| codex_strategy_for(CodexCliFlavor::ApiKeyOnly));

        assert!(result.is_err());
    }

    #[test]
    fn codex_sanitizes_openai_api_key_guidance() {
        let sanitized = sanitize_cli_error(
            "Missing openai API key. Set the environment variable OPENAI_API_KEY and visit https://platform.openai.com/account/api-keys",
        );

        assert_eq!(sanitized, KEYLESS_CODEX_UNSUPPORTED_MESSAGE);
    }

    #[test]
    fn expanded_path_includes_herd_nvm_before_homebrew() {
        let path = expanded_path();
        let herd_index = path.find("Library/Application Support/Herd/config/nvm");
        let homebrew_index = path.find("/opt/homebrew/bin");

        if let (Some(herd_index), Some(homebrew_index)) = (herd_index, homebrew_index) {
            assert!(herd_index < homebrew_index);
        }
    }
}
