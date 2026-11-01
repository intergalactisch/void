use crate::error::VoidError;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State, WebviewWindow};

#[derive(Default)]
pub struct ExitApproval(AtomicBool);

impl ExitApproval {
    pub fn is_approved(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Called by the main editor only after notes and pending history are durable.
#[tauri::command]
pub async fn complete_app_exit(
    app: AppHandle,
    window: WebviewWindow,
    approval: State<'_, ExitApproval>,
) -> Result<(), VoidError> {
    if window.label() != "main" {
        return Err(VoidError::Lifecycle("Only the main editor can finish shutdown".into()));
    }
    approval.0.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
