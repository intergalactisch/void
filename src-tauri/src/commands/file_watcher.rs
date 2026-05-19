//! File watcher commands.
//!
//! Watches a directory for changes (create / modify / remove) and emits
//! `void://file-changed` events to the webview. Uses `notify-debouncer-full`
//! so a single user save doesn't fan out into a flurry of duplicate events.
//!
//! The TS side maintains the higher-level dispatch — we just push raw
//! debounced events with a `kind` discriminator so the adapter can
//! decide what to do (reload, conflict-detect, drop dead tabs, etc.).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, FileIdMap,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::files::validate_path;
use crate::error::VoidError;

const FILE_CHANGED_EVENT: &str = "void://file-changed";
const DEBOUNCE_TIMEOUT_MS: u64 = 200;

#[derive(Default)]
pub struct WatcherRegistry {
    watchers: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher, FileIdMap>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    /// Stable id the TS side gave when registering — useful to route
    /// events to the right adapter when multiple watchers are alive.
    pub watcher_id: String,
    /// Absolute path of the changed file.
    pub path: String,
    /// One of: "create" | "modify" | "remove" | "rename" | "other".
    pub kind: String,
}

fn classify_event_kind(kind: &notify::EventKind) -> &'static str {
    match kind {
        notify::EventKind::Create(_) => "create",
        notify::EventKind::Modify(notify::event::ModifyKind::Name(_)) => "rename",
        notify::EventKind::Modify(_) => "modify",
        notify::EventKind::Remove(_) => "remove",
        _ => "other",
    }
}

#[tauri::command]
pub async fn watch_directory(
    app: AppHandle,
    registry: State<'_, WatcherRegistry>,
    path: String,
    watcher_id: String,
) -> Result<(), VoidError> {
    let dir = validate_path(&path)?;
    if !dir.exists() {
        return Err(VoidError::Watcher(format!(
            "Directory does not exist: {}",
            path
        )));
    }
    if !dir.is_dir() {
        return Err(VoidError::Watcher(format!(
            "Path is not a directory: {}",
            path
        )));
    }

    let watcher_id_emit = watcher_id.clone();
    let app_for_callback = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_TIMEOUT_MS),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                for evt in events {
                    let kind = classify_event_kind(&evt.event.kind).to_string();
                    for path_buf in &evt.event.paths {
                        let payload = FileChangedPayload {
                            watcher_id: watcher_id_emit.clone(),
                            path: path_buf.to_string_lossy().to_string(),
                            kind: kind.clone(),
                        };
                        let _ = app_for_callback.emit(FILE_CHANGED_EVENT, payload);
                    }
                }
            }
            Err(errors) => {
                for err in errors {
                    eprintln!("file watcher error: {err}");
                }
            }
        },
    )
    .map_err(|e| VoidError::Watcher(format!("Failed to create watcher: {e}")))?;

    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| VoidError::Watcher(format!("Failed to watch directory: {e}")))?;

    debouncer
        .cache()
        .add_root(&dir, RecursiveMode::Recursive);

    let mut watchers = registry
        .watchers
        .lock()
        .map_err(|e| VoidError::Watcher(format!("Watcher registry lock poisoned: {e}")))?;

    // If a watcher with this id already exists, replace it (drops the old).
    watchers.insert(watcher_id, debouncer);

    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn unwatch_directory(
    registry: State<'_, WatcherRegistry>,
    watcher_id: String,
) -> Result<(), VoidError> {
    let mut watchers = registry
        .watchers
        .lock()
        .map_err(|e| VoidError::Watcher(format!("Watcher registry lock poisoned: {e}")))?;
    watchers.remove(&watcher_id);
    Ok(())
}

#[tauri::command]
pub fn unwatch_all(registry: State<'_, WatcherRegistry>) -> Result<(), VoidError> {
    let mut watchers = registry
        .watchers
        .lock()
        .map_err(|e| VoidError::Watcher(format!("Watcher registry lock poisoned: {e}")))?;
    watchers.clear();
    Ok(())
}

#[allow(dead_code)]
fn _ensure_manager_used(app: &AppHandle) {
    // Touching `Manager` so the trait import doesn't get pruned by the
    // optimiser when no public function uses it directly. Cheap no-op.
    let _ = app.app_handle();
}
