use crate::error::VoidError;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoidUpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: String,
    pub pub_date: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum VoidUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

fn updater_error(error: impl std::fmt::Display) -> VoidError {
    VoidError::Updater(error.to_string())
}

fn update_info(update: &Update) -> VoidUpdateInfo {
    VoidUpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        pub_date: update.date.as_ref().map(|date| date.to_string()).unwrap_or_default(),
    }
}

#[tauri::command]
pub async fn void_updater_current_version(app: AppHandle) -> Result<String, VoidError> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn void_updater_check(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<VoidUpdateInfo>, VoidError> {
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;
    let info = update.as_ref().map(update_info);

    let mut pending = pending_update
        .0
        .lock()
        .map_err(|_| VoidError::Updater("Pending update state is unavailable".to_string()))?;
    *pending = update;

    Ok(info)
}

#[tauri::command]
pub async fn void_updater_install(
    pending_update: State<'_, PendingUpdate>,
    on_event: Channel<VoidUpdateDownloadEvent>,
) -> Result<(), VoidError> {
    let update = {
        let mut pending = pending_update
            .0
            .lock()
            .map_err(|_| VoidError::Updater("Pending update state is unavailable".to_string()))?;
        pending.take().ok_or_else(|| {
            VoidError::Updater("No pending update. Check for updates first.".to_string())
        })?
    };

    let mut first_chunk = true;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(VoidUpdateDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(VoidUpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(VoidUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(updater_error)?;

    Ok(())
}

#[tauri::command]
pub async fn void_updater_restart(app: AppHandle) -> Result<(), VoidError> {
    app.restart()
}
