use crate::error::VoidError;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// Cap on bytes read from disk in one shot. The notes app stores markdown —
/// even a 50 MB note is implausible. Anything bigger is either a stray binary
/// in the notes folder or a probe trying to OOM us.
pub(crate) const MAX_READ_BYTES: u64 = 50 * 1024 * 1024;

/// Cap on bytes accepted from the frontend in `write_file`. Same reasoning:
/// notes don't grow this large, oversized payloads stall the renderer + disk.
pub(crate) const MAX_WRITE_BYTES: usize = 50 * 1024 * 1024;

/// Sensitive directory names that should never be accessed.
/// Matched as canonical path components, not substrings, so `notes-aws/`
/// and `aws-notes/` are unaffected.
const SENSITIVE_COMPONENTS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".config/gh",
    ".docker",
    ".npmrc",
    ".pypirc",
    "Keychains",
];

/// Sensitive absolute path prefixes (must match canonical path roots).
const SENSITIVE_ROOTS: &[&str] = &[
    "/etc",
    "/private/etc",
    "/var/root",
    "/var/db/sudo",
    "/Library/Keychains",
    "/System",
];

/// Expand ~ to home directory in a path string.
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Best-effort canonicalisation that resolves symlinks for the longest
/// existing prefix of the path and re-joins the remaining tail. This lets
/// us validate paths that are about to be created (e.g. `write_file` on a
/// new file) without blowing up because the leaf doesn't exist yet.
fn canonicalize_existing_prefix(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();

    loop {
        if let Ok(canon) = std::fs::canonicalize(&current) {
            tail.reverse();
            let mut result = canon;
            for piece in tail {
                result.push(piece);
            }
            return result;
        }
        let file_name = current.file_name().map(|n| n.to_os_string());
        let parent = current.parent().map(|p| p.to_path_buf());
        let Some(parent) = parent else {
            break;
        };
        if let Some(name) = file_name {
            tail.push(name);
        }
        if parent.as_os_str().is_empty() {
            break;
        }
        current = parent;
    }

    path.to_path_buf()
}

/// Validate that a path is safe to access.
///
/// Steps:
/// 1. Expand `~` to the home directory.
/// 2. Reject parent-traversal segments (`..`) at the component level so that
///    legitimate filenames like `file..txt` are accepted.
/// 3. Resolve symlinks for the longest existing prefix and verify the result
///    does not land inside a sensitive directory. This prevents a
///    `~/notes/secret -> /etc/ssh` symlink from bypassing the check.
pub fn validate_path(path: &str) -> Result<PathBuf, VoidError> {
    let expanded = expand_tilde(path);
    let path_buf = PathBuf::from(&expanded);

    // Reject parent-traversal segments at the component level.
    if path_buf
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(VoidError::PathNotAllowed(
            "Path traversal (..) is not allowed".to_string(),
        ));
    }

    // Resolve symlinks for the longest existing prefix.
    let resolved = canonicalize_existing_prefix(&path_buf);
    let resolved_str = resolved.to_string_lossy();

    // Block sensitive component names anywhere in the resolved path.
    for component in resolved.components() {
        if let Component::Normal(name) = component {
            let name_str = name.to_string_lossy();
            if SENSITIVE_COMPONENTS.contains(&name_str.as_ref()) {
                return Err(VoidError::PathNotAllowed(format!(
                    "Access to '{}' is not allowed",
                    name_str
                )));
            }
        }
    }

    // Block sensitive absolute roots.
    for root in SENSITIVE_ROOTS {
        if resolved_str.starts_with(root) {
            let next = resolved_str.as_bytes().get(root.len()).copied();
            if matches!(next, None | Some(b'/')) {
                return Err(VoidError::PathNotAllowed(format!(
                    "Access to '{}' is not allowed",
                    root
                )));
            }
        }
    }

    Ok(path_buf)
}

/// Represents a file or directory entry
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

/// Read the contents of a file as a string
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, VoidError> {
    let expanded_path = validate_path(&path)?;

    let metadata = tokio::fs::metadata(&expanded_path).await.map_err(|e| {
        VoidError::FileRead {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        }
    })?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(VoidError::FileRead {
            path: expanded_path.to_string_lossy().to_string(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("File exceeds {MAX_READ_BYTES}-byte read limit"),
            ),
        });
    }

    tokio::fs::read_to_string(&expanded_path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// Write content to a file, creating parent directories if needed
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), VoidError> {
    if content.len() > MAX_WRITE_BYTES {
        return Err(VoidError::FileWrite {
            path: path.clone(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Content exceeds {MAX_WRITE_BYTES}-byte write limit"),
            ),
        });
    }
    let expanded_path = validate_path(&path)?;

    // Ensure parent directory exists (use async metadata check)
    if let Some(parent) = expanded_path.parent() {
        if tokio::fs::metadata(parent).await.is_err() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| VoidError::DirectoryCreate {
                    path: parent.to_string_lossy().to_string(),
                    source: e,
                })?;
        }
    }

    tokio::fs::write(&expanded_path, content)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// Delete a file
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), VoidError> {
    let expanded_path = validate_path(&path)?;

    tokio::fs::remove_file(&expanded_path)
        .await
        .map_err(|e| VoidError::FileDelete {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// List contents of a directory
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, VoidError> {
    let expanded_path = validate_path(&path)?;
    let expanded_str = expanded_path.to_string_lossy().to_string();

    let mut entries = Vec::new();
    let mut dir =
        tokio::fs::read_dir(&expanded_path)
            .await
            .map_err(|e| VoidError::DirectoryList {
                path: expanded_str.clone(),
                source: e,
            })?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| VoidError::DirectoryList {
            path: expanded_str.clone(),
            source: e,
        })?
    {
        let metadata = entry.metadata().await.ok();
        let file_type = entry.file_type().await.ok();

        let (is_file, is_directory) = match file_type {
            Some(ft) => (ft.is_file(), ft.is_dir()),
            None => (false, false),
        };

        let (size, modified) = match metadata {
            Some(meta) => {
                let size = meta.len();
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                (size, modified)
            }
            None => (0, None),
        };

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_directory,
            is_file,
            size,
            modified,
        });
    }

    Ok(entries)
}

/// Check if a file or directory exists
#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, VoidError> {
    let expanded_path = validate_path(&path)?;

    Ok(tokio::fs::metadata(&expanded_path).await.is_ok())
}

/// Create a directory and all parent directories
#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), VoidError> {
    let expanded_path = validate_path(&path)?;

    tokio::fs::create_dir_all(&expanded_path)
        .await
        .map_err(|e| VoidError::DirectoryCreate {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// Recursively remove a directory and all of its contents
#[tauri::command]
pub async fn remove_directory(path: String) -> Result<(), VoidError> {
    let expanded_path = validate_path(&path)?;

    tokio::fs::remove_dir_all(&expanded_path)
        .await
        .map_err(|e| VoidError::DirectoryDelete {
            path: expanded_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// Move a file or directory to the operating system Trash.
#[tauri::command]
pub async fn move_to_trash(path: String) -> Result<(), VoidError> {
    let expanded_path = validate_path(&path)?;
    let display_path = expanded_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || move_path_to_trash(&expanded_path))
        .await
        .map_err(|e| VoidError::PathTrash {
            path: display_path.clone(),
            message: format!("Trash worker failed: {e}"),
        })?
        .map_err(|e| VoidError::PathTrash {
            path: display_path,
            message: e.to_string(),
        })
}

#[cfg(target_os = "macos")]
fn move_path_to_trash(path: &std::path::Path) -> Result<(), trash::Error> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};

    let mut trash_context = trash::TrashContext::new();
    trash_context.set_delete_method(DeleteMethod::NsFileManager);
    trash_context.delete(path)
}

#[cfg(not(target_os = "macos"))]
fn move_path_to_trash(path: &std::path::Path) -> Result<(), trash::Error> {
    trash::delete(path)
}

/// Rename / move a file or directory.
#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), VoidError> {
    let expanded_from = validate_path(&from)?;
    let expanded_to = validate_path(&to)?;

    tokio::fs::rename(&expanded_from, &expanded_to)
        .await
        .map_err(|e| VoidError::PathRename {
            from: expanded_from.to_string_lossy().to_string(),
            to: expanded_to.to_string_lossy().to_string(),
            source: e,
        })
}
