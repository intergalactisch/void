use serde::Serialize;
use thiserror::Error;

/// Redact a filesystem path for display in user-facing errors.
///
/// Replaces the home-directory prefix with `~` so we don't leak the
/// user's full directory layout. The source `std::io::Error` is kept
/// untouched — it still carries the OS-level cause (NotFound,
/// PermissionDenied, etc.) but without the absolute path.
fn redact_path(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if path.starts_with(home_str.as_ref()) {
            return format!("~{}", &path[home_str.len()..]);
        }
    }
    path.to_string()
}

/// Application-wide error type for void
#[derive(Error, Debug)]
pub enum VoidError {
    #[error("Failed to read file {}: {source}", redact_path(path))]
    FileRead {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to write file {}: {source}", redact_path(path))]
    FileWrite {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to delete file {}: {source}", redact_path(path))]
    FileDelete {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to list directory {}: {source}", redact_path(path))]
    DirectoryList {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to create directory {}: {source}", redact_path(path))]
    DirectoryCreate {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to delete directory {}: {source}", redact_path(path))]
    DirectoryDelete {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error(
        "Failed to rename {} to {}: {source}",
        redact_path(from),
        redact_path(to)
    )]
    PathRename {
        from: String,
        to: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to parse JSON: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Failed to access keychain: {0}")]
    Keychain(String),

    #[error("Settings path not found")]
    SettingsPathNotFound,

    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("CLI execution failed: {0}")]
    CLIExecution(String),

    #[error("Process not found: {0}")]
    ProcessNotFound(String),

    #[error("Web fetch failed: {0}")]
    WebFetch(String),

    #[error("File watcher error: {0}")]
    Watcher(String),

    #[error("Git operation failed: {0}")]
    Git(String),

    #[error("GitHub request failed: {0}")]
    GitHub(String),
}

// Implement Serialize for Tauri command error handling
impl Serialize for VoidError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
