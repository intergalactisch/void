use crate::error::VoidError;
use std::path::{Component, Path, PathBuf};

/// Expand ~ to home directory in a path string.
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Resolve the .void/ base directory within a notes directory.
fn void_base(notes_dir: &str) -> PathBuf {
    let expanded = expand_tilde(notes_dir);
    PathBuf::from(expanded).join(".void")
}

/// Validate that a relative path stays within the .void/ base directory.
///
/// Rejects:
/// - Absolute paths (must be relative to .void/)
/// - Parent traversal segments (..)
/// - Path prefix or root components
///
/// Returns the joined absolute path on success.
fn validate_void_path(base: &Path, relative: &str) -> Result<PathBuf, VoidError> {
    let candidate = Path::new(relative);

    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                return Err(VoidError::PathNotAllowed(
                    "Path traversal (..) is not allowed".to_string(),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(VoidError::PathNotAllowed(
                    "Absolute paths are not allowed inside .void/".to_string(),
                ));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }

    Ok(base.join(candidate))
}

/// Validate a note name used as a filename inside .void/provenance/ etc.
///
/// Rejects any path separator or traversal segment so a malicious frontend
/// cannot escape the configured subdirectory.
fn validate_note_name(name: &str) -> Result<(), VoidError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(VoidError::PathNotAllowed(format!(
            "Invalid note name: {name:?}"
        )));
    }
    Ok(())
}

/// Ensure the .void/ directory structure exists.
///
/// Creates:
/// - .void/provenance/
/// - .void/conversations/
/// - .void/branches/
/// - .void/lineage/
/// - .void/index/
/// - .void/insights/
#[tauri::command]
pub async fn void_ensure_dir(notes_dir: String) -> Result<(), VoidError> {
    let base = void_base(&notes_dir);

    let subdirs = [
        "provenance",
        "conversations",
        "branches",
        "lineage",
        "index",
        "insights",
    ];

    for subdir in &subdirs {
        let path = base.join(subdir);
        tokio::fs::create_dir_all(&path)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: path.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    Ok(())
}

/// Append a JSONL line to a provenance file.
///
/// Creates the file if it doesn't exist.
#[tauri::command]
pub async fn void_append_provenance(
    notes_dir: String,
    note_name: String,
    event: String,
) -> Result<(), VoidError> {
    validate_note_name(&note_name)?;
    let base = void_base(&notes_dir);
    let file_path = base.join("provenance").join(format!("{}.jsonl", note_name));

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: parent.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    // Append line (with newline)
    let line = if event.ends_with('\n') {
        event
    } else {
        format!("{}\n", event)
    };

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    file.write_all(line.as_bytes())
        .await
        .map_err(|e| VoidError::FileWrite {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    Ok(())
}

/// Read all provenance events for a note.
///
/// Returns a Vec of JSON strings (one per line).
/// Returns empty Vec if the file doesn't exist.
#[tauri::command]
pub async fn void_read_provenance(
    notes_dir: String,
    note_name: String,
) -> Result<Vec<String>, VoidError> {
    validate_note_name(&note_name)?;
    let base = void_base(&notes_dir);
    let file_path = base.join("provenance").join(format!("{}.jsonl", note_name));

    // Return empty if file doesn't exist
    if tokio::fs::metadata(&file_path).await.is_err() {
        return Ok(Vec::new());
    }

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    let lines: Vec<String> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect();

    Ok(lines)
}

/// Write JSON content to a .void/ path.
///
/// Creates parent directories if needed.
#[tauri::command]
pub async fn void_write_json(
    notes_dir: String,
    relative_path: String,
    content: String,
) -> Result<(), VoidError> {
    let base = void_base(&notes_dir);
    let file_path = validate_void_path(&base, &relative_path)?;

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: parent.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    let tmp_path = file_path.with_extension(format!(
        "{}tmp",
        file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));

    tokio::fs::write(&tmp_path, &content)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: tmp_path.to_string_lossy().to_string(),
            source: e,
        })?;

    tokio::fs::rename(&tmp_path, &file_path)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    Ok(())
}

/// Read JSON content from a .void/ path.
///
/// Returns the raw JSON string. Returns empty string if file doesn't exist.
#[tauri::command]
pub async fn void_read_json(notes_dir: String, relative_path: String) -> Result<String, VoidError> {
    let base = void_base(&notes_dir);
    let file_path = validate_void_path(&base, &relative_path)?;

    // Return empty if file doesn't exist
    if tokio::fs::metadata(&file_path).await.is_err() {
        return Ok(String::new());
    }

    tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })
}

/// Append a JSONL line to any validated .void/ path.
///
/// Creates parent directories and the file if they don't exist.
#[tauri::command]
pub async fn void_append_jsonl(
    notes_dir: String,
    relative_path: String,
    line: String,
) -> Result<(), VoidError> {
    let base = void_base(&notes_dir);
    let file_path = validate_void_path(&base, &relative_path)?;

    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: parent.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    let line = if line.ends_with('\n') {
        line
    } else {
        format!("{}\n", line)
    };

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    file.write_all(line.as_bytes())
        .await
        .map_err(|e| VoidError::FileWrite {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    Ok(())
}

/// Read JSONL lines from any validated .void/ path.
///
/// Returns an empty Vec if the file doesn't exist.
#[tauri::command]
pub async fn void_read_jsonl(
    notes_dir: String,
    relative_path: String,
) -> Result<Vec<String>, VoidError> {
    let base = void_base(&notes_dir);
    let file_path = validate_void_path(&base, &relative_path)?;

    if tokio::fs::metadata(&file_path).await.is_err() {
        return Ok(Vec::new());
    }

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: file_path.to_string_lossy().to_string(),
            source: e,
        })?;

    Ok(content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect())
}

/// List files in a .void/ subdirectory.
///
/// Returns file names (not full paths). Returns empty Vec if directory doesn't exist.
#[tauri::command]
pub async fn void_list_dir(
    notes_dir: String,
    relative_path: String,
) -> Result<Vec<String>, VoidError> {
    let base = void_base(&notes_dir);
    let dir_path = validate_void_path(&base, &relative_path)?;

    // Return empty if directory doesn't exist
    if tokio::fs::metadata(&dir_path).await.is_err() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&dir_path)
        .await
        .map_err(|e| VoidError::DirectoryList {
            path: dir_path.to_string_lossy().to_string(),
            source: e,
        })?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| VoidError::DirectoryList {
            path: dir_path.to_string_lossy().to_string(),
            source: e,
        })?
    {
        entries.push(entry.file_name().to_string_lossy().to_string());
    }

    Ok(entries)
}
