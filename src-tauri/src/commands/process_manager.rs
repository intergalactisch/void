use crate::commands::cli_ai::expanded_path;
use crate::commands::files::validate_path;
use crate::error::VoidError;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Mutex;

/// Registry of active CLI processes.
pub struct ProcessRegistry {
    processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
}

struct ProcessHandle {
    process_id: String,
    operation_id: String,
    child: Arc<Mutex<Option<tokio::process::Child>>>,
    cancelled: Arc<AtomicBool>,
    started_at: std::time::Instant,
}

#[derive(Clone, Serialize)]
pub struct SpawnResult {
    pub process_id: String,
}

#[derive(Clone, Serialize)]
pub struct ProcessInfo {
    pub process_id: String,
    pub operation_id: String,
    pub started_at_ms: u64,
}

#[derive(Clone, Serialize)]
struct ProcessStartedEvent {
    process_id: String,
    operation_id: String,
}

#[derive(Clone, Serialize)]
struct ProcessCompletedEvent {
    process_id: String,
    operation_id: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Clone, Serialize)]
struct ProcessFailedEvent {
    process_id: String,
    operation_id: String,
    error: String,
}

#[derive(Clone, Serialize)]
struct ProcessCancelledEvent {
    process_id: String,
    operation_id: String,
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Binaries the frontend is allowed to spawn. Anything else is rejected
/// because the frontend can be coerced into running arbitrary commands by
/// a malicious tool result or stored note.
const ALLOWED_BINARIES: &[&str] = &["claude", "codex"];

/// Cap how many concurrent CLI processes the frontend can spin up. Past this
/// point we refuse so a prompt-injection loop can't fork-bomb the user's box.
const MAX_CONCURRENT_PROCESSES: usize = 8;

/// Hard upper bound on per-process timeout. The frontend asks for one but we
/// refuse to honour anything wildly larger — a stuck-forever child is just an
/// FD leak in slow motion.
const MAX_PROCESS_TIMEOUT_MS: u64 = 30 * 60 * 1000;

fn validate_binary(binary: &str) -> Result<(), VoidError> {
    if !ALLOWED_BINARIES.contains(&binary) {
        return Err(VoidError::CLIExecution(format!(
            "Binary not allowed: {binary}. Allowed: {}",
            ALLOWED_BINARIES.join(", ")
        )));
    }
    Ok(())
}

/// Drop any args that obviously try to flip a CLI into a different mode. We
/// allow both Claude and Codex to receive their normal flag surface, but we
/// reject the few generic escape hatches that would let a malicious tool
/// result tell the binary to execute a different program or read sensitive
/// system files outside the notes sandbox.
fn validate_arg(arg: &str) -> Result<(), VoidError> {
    // NUL bytes terminate strings on POSIX — never legitimate in CLI args.
    if arg.contains('\0') {
        return Err(VoidError::CLIExecution(
            "Null byte in argument is not allowed".to_string(),
        ));
    }
    Ok(())
}

/// Spawn a CLI process for an AI operation.
///
/// CLI-agnostic: receives a binary name and pre-built argument list.
/// All CLI-specific flag construction happens in TypeScript (CLIProvider).
#[tauri::command]
pub async fn spawn_cli_process(
    state: tauri::State<'_, ProcessRegistry>,
    app_handle: AppHandle,
    operation_id: String,
    binary: String,
    args: Vec<String>,
    working_directory: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<SpawnResult, VoidError> {
    validate_binary(&binary)?;
    for arg in &args {
        validate_arg(arg)?;
    }
    let validated_cwd = match working_directory.as_deref() {
        Some(cwd) => Some(validate_path(cwd)?),
        None => None,
    };

    // Refuse to spawn beyond the concurrent-process cap. We check under the
    // lock so two simultaneous requests can't both observe count = MAX − 1.
    {
        let procs = state.processes.lock().await;
        if procs.len() >= MAX_CONCURRENT_PROCESSES {
            return Err(VoidError::CLIExecution(format!(
                "Refusing to spawn — {MAX_CONCURRENT_PROCESSES} CLI processes already running"
            )));
        }
    }

    let process_id = uuid::Uuid::new_v4().to_string();
    let path_env = expanded_path();
    let requested = timeout_ms.unwrap_or(300_000).min(MAX_PROCESS_TIMEOUT_MS);
    let timeout = std::time::Duration::from_millis(requested);

    // Build the command — fully generic, no CLI-specific knowledge
    let mut cmd = Command::new(&binary);
    cmd.env("PATH", &path_env);

    if let Some(ref cwd) = validated_cwd {
        cmd.current_dir(cwd);
    }

    cmd.args(&args);

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| VoidError::CLIExecution(format!("Failed to spawn {binary}: {e}")))?;

    let cancelled = Arc::new(AtomicBool::new(false));
    let child_arc = Arc::new(Mutex::new(Some(child)));

    // Store handle
    let handle = ProcessHandle {
        process_id: process_id.clone(),
        operation_id: operation_id.clone(),
        child: child_arc.clone(),
        cancelled: cancelled.clone(),
        started_at: std::time::Instant::now(),
    };

    {
        let mut procs = state.processes.lock().await;
        procs.insert(process_id.clone(), handle);
    }

    // Emit started event
    let _ = app_handle.emit(
        "cli:process:started",
        ProcessStartedEvent {
            process_id: process_id.clone(),
            operation_id: operation_id.clone(),
        },
    );

    // Spawn background task to await completion
    let processes = state.processes.clone();
    let pid = process_id.clone();
    let oid = operation_id.clone();
    let ah = app_handle.clone();

    tokio::spawn(async move {
        // Take the child out of the Arc<Mutex> so we own it directly
        let child = {
            let mut guard = child_arc.lock().await;
            guard.take()
        };

        let Some(child) = child else {
            let _ = ah.emit(
                "cli:process:failed",
                ProcessFailedEvent {
                    process_id: pid.clone(),
                    operation_id: oid.clone(),
                    error: "Process already consumed".to_string(),
                },
            );
            return;
        };

        // wait_with_output takes ownership. On timeout, dropping the future
        // drops the Child, which sends SIGKILL on Unix (tokio behavior).
        let result = tokio::time::timeout(timeout, child.wait_with_output()).await;

        // Remove from registry
        {
            let mut procs = processes.lock().await;
            procs.remove(&pid);
        }

        if cancelled.load(Ordering::Relaxed) {
            let _ = ah.emit(
                "cli:process:cancelled",
                ProcessCancelledEvent {
                    process_id: pid,
                    operation_id: oid,
                },
            );
            return;
        }

        match result {
            Ok(Ok(output)) => {
                let _ = ah.emit(
                    "cli:process:completed",
                    ProcessCompletedEvent {
                        process_id: pid,
                        operation_id: oid,
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                        exit_code: output.status.code().unwrap_or(-1),
                    },
                );
            }
            Ok(Err(e)) => {
                let _ = ah.emit(
                    "cli:process:failed",
                    ProcessFailedEvent {
                        process_id: pid,
                        operation_id: oid,
                        error: format!("Process error: {e}"),
                    },
                );
            }
            Err(_) => {
                // Timeout — child was dropped by timeout which kills the process
                let _ = ah.emit(
                    "cli:process:failed",
                    ProcessFailedEvent {
                        process_id: pid,
                        operation_id: oid,
                        error: "Process timed out".to_string(),
                    },
                );
            }
        }
    });

    Ok(SpawnResult { process_id })
}

/// Cancel a running CLI process.
#[tauri::command]
pub async fn cancel_cli_process(
    state: tauri::State<'_, ProcessRegistry>,
    app_handle: AppHandle,
    process_id: String,
) -> Result<(), VoidError> {
    let mut procs = state.processes.lock().await;

    let handle = procs
        .remove(&process_id)
        .ok_or_else(|| VoidError::ProcessNotFound(process_id.clone()))?;

    handle.cancelled.store(true, Ordering::Relaxed);

    // Kill the child process
    let mut guard = handle.child.lock().await;
    if let Some(ref mut child) = *guard {
        let _ = child.kill().await;
    }

    let _ = app_handle.emit(
        "cli:process:cancelled",
        ProcessCancelledEvent {
            process_id: process_id.clone(),
            operation_id: handle.operation_id.clone(),
        },
    );

    Ok(())
}

/// Get info about all active processes.
#[tauri::command]
pub async fn get_active_processes(
    state: tauri::State<'_, ProcessRegistry>,
) -> Result<Vec<ProcessInfo>, VoidError> {
    let procs = state.processes.lock().await;
    let infos: Vec<ProcessInfo> = procs
        .values()
        .map(|h| ProcessInfo {
            process_id: h.process_id.clone(),
            operation_id: h.operation_id.clone(),
            started_at_ms: h.started_at.elapsed().as_millis() as u64,
        })
        .collect();
    Ok(infos)
}

/// Get the count of active processes.
#[tauri::command]
pub async fn get_active_process_count(
    state: tauri::State<'_, ProcessRegistry>,
) -> Result<usize, VoidError> {
    let procs = state.processes.lock().await;
    Ok(procs.len())
}
