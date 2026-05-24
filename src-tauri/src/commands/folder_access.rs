use crate::error::VoidError;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderAccessBookmark {
    pub path: String,
    pub bookmark_data: String,
    pub stale: bool,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::FolderAccessBookmark;
    use crate::error::VoidError;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use objc2::{runtime::Bool, MainThreadMarker};
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::{
        NSData, NSError, NSString, NSURL, NSURLBookmarkCreationOptions,
        NSURLBookmarkResolutionOptions,
    };
    use std::sync::mpsc;
    use tauri::AppHandle;

    fn ns_error_message(error: &NSError) -> String {
        error.localizedDescription().to_string()
    }

    fn url_path(url: &NSURL) -> Result<String, VoidError> {
        url.path()
            .map(|path| path.to_string())
            .ok_or_else(|| VoidError::PathNotAllowed("Folder bookmark did not resolve to a file path".into()))
    }

    fn bookmark_from_url(url: &NSURL, stale: bool) -> Result<FolderAccessBookmark, VoidError> {
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .map_err(|error| VoidError::PathNotAllowed(ns_error_message(&error)))?;

        Ok(FolderAccessBookmark {
            path: url_path(url)?,
            bookmark_data: STANDARD.encode(data.to_vec()),
            stale,
        })
    }

    pub fn create_bookmark(path: String) -> Result<FolderAccessBookmark, VoidError> {
        let path_string = NSString::from_str(&path);
        let url = NSURL::fileURLWithPath_isDirectory(&path_string, true);
        bookmark_from_url(&url, false)
    }

    pub fn request_access(app: AppHandle, suggested_path: String) -> Result<FolderAccessBookmark, VoidError> {
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let result = request_access_on_main_thread(&suggested_path);
            let _ = tx.send(result);
        })
        .map_err(|error| VoidError::PathNotAllowed(format!("Could not open folder picker: {error}")))?;
        rx.recv()
            .map_err(|error| VoidError::PathNotAllowed(format!("Folder picker failed: {error}")))?
    }

    fn request_access_on_main_thread(suggested_path: &str) -> Result<FolderAccessBookmark, VoidError> {
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| VoidError::PathNotAllowed("Folder picker must run on the main thread".into()))?;
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseDirectories(true);
        panel.setCanChooseFiles(false);
        panel.setAllowsMultipleSelection(false);
        panel.setResolvesAliases(true);
        panel.setTitle(Some(&NSString::from_str("Reconnect notes folder")));
        let suggested = NSString::from_str(suggested_path);
        let directory_url = NSURL::fileURLWithPath_isDirectory(&suggested, true);
        panel.setDirectoryURL(Some(&directory_url));

        let response = panel.runModal();
        if response != NSModalResponseOK {
            return Err(VoidError::PathNotAllowed("Folder reconnect was cancelled.".into()));
        }

        let url = panel
            .URLs()
            .firstObject()
            .ok_or_else(|| VoidError::PathNotAllowed("No folder was selected.".into()))?;
        let started = unsafe { url.startAccessingSecurityScopedResource() };
        if !started {
            return Err(VoidError::PathNotAllowed(
                "macOS did not grant access to the selected folder".into(),
            ));
        }
        let bookmark = bookmark_from_url(&url, false);
        unsafe { url.stopAccessingSecurityScopedResource() };
        bookmark
    }

    pub fn resolve_bookmark(bookmark_data: String, start_access: bool) -> Result<FolderAccessBookmark, VoidError> {
        let bytes = STANDARD
            .decode(bookmark_data.as_bytes())
            .map_err(|error| VoidError::PathNotAllowed(format!("Invalid folder bookmark: {error}")))?;
        let data = NSData::with_bytes(&bytes);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .map_err(|error| VoidError::PathNotAllowed(ns_error_message(&error)))?;

        if stale.as_bool() && !start_access {
            return bookmark_from_url(&url, false);
        }

        if start_access {
            let started = unsafe { url.startAccessingSecurityScopedResource() };
            if !started {
                return Err(VoidError::PathNotAllowed(
                    "macOS did not grant access to the bookmarked folder".into(),
                ));
            }
        }

        Ok(FolderAccessBookmark {
            path: url_path(&url)?,
            bookmark_data,
            stale: stale.as_bool(),
        })
    }

    pub fn stop_access(bookmark_data: String) -> Result<(), VoidError> {
        let bytes = STANDARD
            .decode(bookmark_data.as_bytes())
            .map_err(|error| VoidError::PathNotAllowed(format!("Invalid folder bookmark: {error}")))?;
        let data = NSData::with_bytes(&bytes);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .map_err(|error| VoidError::PathNotAllowed(ns_error_message(&error)))?;
        unsafe { url.stopAccessingSecurityScopedResource() };
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use super::FolderAccessBookmark;
    use crate::error::VoidError;
    use tauri::AppHandle;

    pub fn create_bookmark(path: String) -> Result<FolderAccessBookmark, VoidError> {
        Ok(FolderAccessBookmark {
            path,
            bookmark_data: String::new(),
            stale: false,
        })
    }

    pub fn request_access(_app: AppHandle, suggested_path: String) -> Result<FolderAccessBookmark, VoidError> {
        create_bookmark(suggested_path)
    }

    pub fn resolve_bookmark(bookmark_data: String, _start_access: bool) -> Result<FolderAccessBookmark, VoidError> {
        Ok(FolderAccessBookmark {
            path: String::new(),
            bookmark_data,
            stale: false,
        })
    }

    pub fn stop_access(_bookmark_data: String) -> Result<(), VoidError> {
        Ok(())
    }
}

#[tauri::command]
pub async fn folder_access_create_bookmark(path: String) -> Result<FolderAccessBookmark, VoidError> {
    macos::create_bookmark(path)
}

#[tauri::command]
pub async fn folder_access_request_access(
    app: tauri::AppHandle,
    suggested_path: String,
) -> Result<FolderAccessBookmark, VoidError> {
    macos::request_access(app, suggested_path)
}

#[tauri::command]
pub async fn folder_access_resolve_bookmark(bookmark_data: String) -> Result<FolderAccessBookmark, VoidError> {
    macos::resolve_bookmark(bookmark_data, false)
}

#[tauri::command]
pub async fn folder_access_start(bookmark_data: String) -> Result<FolderAccessBookmark, VoidError> {
    macos::resolve_bookmark(bookmark_data, true)
}

#[tauri::command]
pub async fn folder_access_stop(bookmark_data: String) -> Result<(), VoidError> {
    macos::stop_access(bookmark_data)
}
