use crate::error::VoidError;
use chrono::Utc;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// Expand ~ to home directory in a path string.
/// Used when loading settings from disk where the stored path may contain ~.
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Application settings
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub notes_path: String,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub github_account: Option<GitHubAccountRef>,
    pub theme: Theme,
    pub auto_save: bool,
    pub auto_save_delay: u32,
    #[serde(default = "default_automatic_update_checks")]
    pub automatic_update_checks: bool,
    pub ai_provider: Option<AiProvider>,
    #[serde(default = "default_cli_provider")]
    pub cli_provider: CliProvider,
    #[serde(default = "default_ai_reasoning_effort")]
    pub ai_reasoning_effort: AiReasoningEffort,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    #[serde(default = "default_content_width")]
    pub content_width: u32,
    #[serde(default = "default_task_default_view")]
    pub task_default_view: TaskDefaultView,
    #[serde(default)]
    pub keymap_overrides: HashMap<String, String>,
    #[serde(default = "default_density")]
    pub density: Density,
    #[serde(default = "default_capture_shortcut")]
    pub capture_shortcut: String,
    #[serde(default = "default_capture_target")]
    pub capture_target_default: CaptureTarget,
    #[serde(default = "default_sync_settings")]
    pub sync: SyncSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub notes_path: String,
    pub created_at: String,
    pub last_opened_at: String,
    #[serde(default = "default_sync_settings")]
    pub sync: SyncSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccountRef {
    pub provider: String,
    pub login: String,
    pub name: Option<String>,
    pub last_authenticated_at: Option<String>,
}

fn default_font_size() -> u32 {
    16
}
fn default_line_height() -> f64 {
    1.6
}
fn default_content_width() -> u32 {
    720
}
fn default_task_default_view() -> TaskDefaultView {
    TaskDefaultView::All
}
fn default_cli_provider() -> CliProvider {
    CliProvider::Codex
}
fn default_ai_reasoning_effort() -> AiReasoningEffort {
    AiReasoningEffort::Medium
}
fn default_density() -> Density {
    Density::Comfortable
}
fn default_capture_shortcut() -> String {
    "mod+shift+enter".to_string()
}
fn default_capture_target() -> CaptureTarget {
    CaptureTarget::Inbox
}
fn default_automatic_update_checks() -> bool {
    true
}
fn default_sync_settings() -> SyncSettings {
    SyncSettings::default()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub enabled: bool,
    pub auto_sync: bool,
    pub auth_mode: String,
    pub repository: Option<SyncRepositoryRef>,
    pub artifact_policy: SyncArtifactPolicy,
    pub last_sync_at: Option<String>,
    pub paused: bool,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_sync: true,
            auth_mode: "github-app".to_string(),
            repository: None,
            artifact_policy: SyncArtifactPolicy::default(),
            last_sync_at: None,
            paused: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncRepositoryRef {
    pub provider: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub remote_url: String,
    pub branch: String,
    pub html_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncArtifactPolicy {
    pub include_markdown: bool,
    pub include_void_history: bool,
    pub include_patterns: Vec<String>,
    pub exclude_patterns: Vec<String>,
}

impl Default for SyncArtifactPolicy {
    fn default() -> Self {
        Self {
            include_markdown: true,
            include_void_history: true,
            include_patterns: vec![
                "*.md".to_string(),
                "**/*.md".to_string(),
                ".void/provenance/**".to_string(),
                ".void/lineage/**".to_string(),
                ".void/conversations/**".to_string(),
                ".void/branches/**".to_string(),
                ".void/sessions/**".to_string(),
                ".void/agents/**".to_string(),
                ".void/repo.json".to_string(),
            ],
            exclude_patterns: vec![
                ".void/index/**".to_string(),
                ".void/insights/pending.json".to_string(),
                ".void/sync/**".to_string(),
                ".DS_Store".to_string(),
            ],
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Claude,
    Openai,
    Local,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CliProvider {
    Codex,
    ClaudeCode,
}

impl<'de> Deserialize<'de> for CliProvider {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "claude-code" | "claude" => CliProvider::ClaudeCode,
            "codex" | "auto" => CliProvider::Codex,
            _ => CliProvider::Codex,
        })
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiReasoningEffort {
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl<'de> Deserialize<'de> for AiReasoningEffort {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "minimal" => AiReasoningEffort::Minimal,
            "low" => AiReasoningEffort::Low,
            "high" => AiReasoningEffort::High,
            "xhigh" => AiReasoningEffort::Xhigh,
            "medium" => AiReasoningEffort::Medium,
            _ => AiReasoningEffort::Medium,
        })
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Compact,
    Comfortable,
    Spacious,
}

impl<'de> Deserialize<'de> for Density {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "compact" => Density::Compact,
            "spacious" => Density::Spacious,
            "comfortable" => Density::Comfortable,
            _ => Density::Comfortable,
        })
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureTarget {
    Inbox,
    Daily,
}

impl<'de> Deserialize<'de> for CaptureTarget {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "daily" => CaptureTarget::Daily,
            "inbox" => CaptureTarget::Inbox,
            _ => CaptureTarget::Inbox,
        })
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskDefaultView {
    All,
    Inbox,
    Today,
    Upcoming,
    Anytime,
    Someday,
    Notes,
    Tags,
    Logbook,
}

impl<'de> Deserialize<'de> for TaskDefaultView {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "all" => TaskDefaultView::All,
            "inbox" => TaskDefaultView::Inbox,
            "today" => TaskDefaultView::Today,
            "upcoming" => TaskDefaultView::Upcoming,
            "anytime" => TaskDefaultView::Anytime,
            "someday" => TaskDefaultView::Someday,
            "notes" => TaskDefaultView::Notes,
            "tags" => TaskDefaultView::Tags,
            "logbook" => TaskDefaultView::Logbook,
            _ => TaskDefaultView::All,
        })
    }
}

impl Default for Settings {
    fn default() -> Self {
        let notes_path = dirs::home_dir()
            .map(|h| h.join("Documents").join("void"))
            .unwrap_or_else(|| std::path::PathBuf::from("~/Documents/void"))
            .to_string_lossy()
            .to_string();
        let sync = default_sync_settings();
        let workspace = default_workspace(&notes_path, sync.clone());

        Self {
            notes_path: workspace.notes_path.clone(),
            workspaces: vec![workspace.clone()],
            active_workspace_id: Some(workspace.id.clone()),
            github_account: None,
            theme: Theme::System,
            auto_save: true,
            auto_save_delay: 1000,
            automatic_update_checks: default_automatic_update_checks(),
            ai_provider: None,
            cli_provider: default_cli_provider(),
            ai_reasoning_effort: default_ai_reasoning_effort(),
            font_size: default_font_size(),
            line_height: default_line_height(),
            content_width: default_content_width(),
            task_default_view: default_task_default_view(),
            keymap_overrides: HashMap::new(),
            density: default_density(),
            capture_shortcut: default_capture_shortcut(),
            capture_target_default: default_capture_target(),
            sync: workspace.sync.clone(),
        }
    }
}

fn default_workspace(notes_path: &str, sync: SyncSettings) -> Workspace {
    let now = Utc::now().to_rfc3339();
    Workspace {
        id: format!("workspace-{}", stable_id_suffix(notes_path)),
        name: notes_path
            .replace('\\', "/")
            .split('/')
            .rfind(|part| !part.is_empty())
            .unwrap_or("Void")
            .to_string(),
        notes_path: notes_path.to_string(),
        created_at: now.clone(),
        last_opened_at: now,
        sync,
    }
}

fn stable_id_suffix(value: &str) -> String {
    let mut hash: u32 = 2166136261;
    for byte in value.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:x}")
}

fn normalize_settings(settings: &mut Settings) {
    settings.notes_path = expand_tilde(&settings.notes_path);
    if settings.workspaces.is_empty() {
        settings.workspaces.push(default_workspace(
            &settings.notes_path,
            settings.sync.clone(),
        ));
    }
    for workspace in &mut settings.workspaces {
        workspace.notes_path = expand_tilde(&workspace.notes_path);
        if workspace.id.trim().is_empty() {
            workspace.id = format!("workspace-{}", stable_id_suffix(&workspace.notes_path));
        }
        if workspace.name.trim().is_empty() {
            workspace.name = workspace
                .notes_path
                .replace('\\', "/")
                .split('/')
                .rfind(|part| !part.is_empty())
                .unwrap_or("Void")
                .to_string();
        }
    }
    let active_id = settings
        .active_workspace_id
        .as_deref()
        .filter(|id| {
            settings
                .workspaces
                .iter()
                .any(|workspace| workspace.id == *id)
        })
        .map(ToString::to_string)
        .or_else(|| {
            settings
                .workspaces
                .first()
                .map(|workspace| workspace.id.clone())
        });
    settings.active_workspace_id = active_id.clone();
    if let Some(active_id) = active_id {
        if let Some(active) = settings
            .workspaces
            .iter()
            .find(|workspace| workspace.id == active_id)
            .cloned()
        {
            settings.notes_path = active.notes_path;
            settings.sync = active.sync;
        }
    }
}

/// Get the path to the settings file
fn settings_path() -> Result<std::path::PathBuf, VoidError> {
    dirs::config_dir()
        .map(|c| c.join("void").join("settings.json"))
        .ok_or(VoidError::SettingsPathNotFound)
}

/// Get the settings file path as a string
#[tauri::command]
pub async fn get_settings_path() -> Result<String, VoidError> {
    settings_path().map(|p| p.to_string_lossy().to_string())
}

/// Load settings from disk, returning defaults if not found
#[tauri::command]
pub async fn get_settings() -> Result<Settings, VoidError> {
    let path = settings_path()?;

    // Use async metadata check instead of blocking path.exists()
    if tokio::fs::metadata(&path).await.is_err() {
        return Ok(Settings::default());
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: path.to_string_lossy().to_string(),
            source: e,
        })?;

    let mut settings: Settings = serde_json::from_str(&content).map_err(VoidError::from)?;
    normalize_settings(&mut settings);

    Ok(settings)
}

/// Save settings to disk
#[tauri::command]
pub async fn save_settings(mut settings: Settings) -> Result<(), VoidError> {
    let path = settings_path()?;
    normalize_settings(&mut settings);

    // Ensure parent directory exists (use async metadata check)
    if let Some(parent) = path.parent() {
        if tokio::fs::metadata(parent).await.is_err() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| VoidError::DirectoryCreate {
                    path: parent.to_string_lossy().to_string(),
                    source: e,
                })?;
        }
    }

    let content = serde_json::to_string_pretty(&settings)?;

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: path.to_string_lossy().to_string(),
            source: e,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_tilde_with_home() {
        let path = "~/Documents/void";
        let expanded = expand_tilde(path);
        assert!(!expanded.starts_with("~"), "Path should not start with ~");
        assert!(
            expanded.ends_with("/Documents/void"),
            "Path should end with /Documents/void"
        );
    }

    #[test]
    fn test_expand_tilde_absolute_unchanged() {
        let path = "/absolute/path";
        assert_eq!(expand_tilde(path), path);
    }

    #[test]
    fn test_expand_tilde_relative_unchanged() {
        let path = "relative/path";
        assert_eq!(expand_tilde(path), path);
    }

    #[test]
    fn test_expand_tilde_just_tilde_unchanged() {
        // Edge case: just ~ without slash should not be expanded
        let path = "~";
        assert_eq!(expand_tilde(path), path);
    }

    #[test]
    fn test_expand_tilde_nested_tilde_unchanged() {
        // Edge case: ~ not at start should not be expanded
        let path = "/home/user/~test";
        assert_eq!(expand_tilde(path), path);
    }

    #[test]
    fn test_task_default_view_defaults_to_all() {
        let settings = Settings::default();
        assert_eq!(settings.task_default_view, TaskDefaultView::All);
    }

    #[test]
    fn test_ai_cli_defaults_to_codex_medium() {
        let settings = Settings::default();
        assert_eq!(settings.cli_provider, CliProvider::Codex);
        assert_eq!(settings.ai_reasoning_effort, AiReasoningEffort::Medium);
        assert!(settings.automatic_update_checks);
        assert!(!settings.sync.enabled);
        assert_eq!(settings.sync.auth_mode, "github-app");
        assert_eq!(settings.workspaces.len(), 1);
        assert_eq!(
            settings.active_workspace_id.as_deref(),
            settings
                .workspaces
                .first()
                .map(|workspace| workspace.id.as_str())
        );
    }

    #[test]
    fn test_legacy_settings_migrate_to_workspace() {
        let json = r#"{
            "notesPath": "/notes",
            "theme": "system",
            "autoSave": true,
            "autoSaveDelay": 1000,
            "aiProvider": null,
            "taskDefaultView": "all",
            "sync": {
                "enabled": true,
                "autoSync": false,
                "authMode": "token",
                "repository": null,
                "artifactPolicy": {
                    "includeMarkdown": true,
                    "includeVoidHistory": true,
                    "includePatterns": ["*.md"],
                    "excludePatterns": [".void/sync/**"]
                },
                "lastSyncAt": null,
                "paused": true
            }
        }"#;

        let mut settings: Settings = serde_json::from_str(json).expect("settings should parse");
        normalize_settings(&mut settings);

        assert_eq!(settings.workspaces.len(), 1);
        assert_eq!(settings.workspaces[0].notes_path, "/notes");
        assert!(settings.workspaces[0].sync.enabled);
        assert!(settings.sync.paused);
        assert_eq!(
            settings.active_workspace_id.as_deref(),
            Some(settings.workspaces[0].id.as_str())
        );
    }

    #[test]
    fn test_task_default_view_deserializes_all() {
        let json = r#"{
            "notesPath": "/notes",
            "theme": "system",
            "autoSave": true,
            "autoSaveDelay": 1000,
            "aiProvider": null,
            "taskDefaultView": "all"
        }"#;

        let settings: Settings = serde_json::from_str(json).expect("settings should parse");
        assert_eq!(settings.task_default_view, TaskDefaultView::All);
        assert!(settings.automatic_update_checks);
        assert_eq!(settings.cli_provider, CliProvider::Codex);
        assert_eq!(settings.ai_reasoning_effort, AiReasoningEffort::Medium);
    }

    #[test]
    fn test_automatic_update_checks_can_be_disabled() {
        let json = r#"{
            "notesPath": "/notes",
            "theme": "system",
            "autoSave": true,
            "autoSaveDelay": 1000,
            "automaticUpdateChecks": false,
            "aiProvider": null,
            "taskDefaultView": "all"
        }"#;

        let settings: Settings = serde_json::from_str(json).expect("settings should parse");
        assert!(!settings.automatic_update_checks);
    }

    #[test]
    fn test_unknown_task_default_view_falls_back_to_all() {
        let json = r#"{
            "notesPath": "/notes",
            "theme": "system",
            "autoSave": true,
            "autoSaveDelay": 1000,
            "aiProvider": null,
            "taskDefaultView": "mystery"
        }"#;

        let settings: Settings = serde_json::from_str(json).expect("settings should parse");
        assert_eq!(settings.task_default_view, TaskDefaultView::All);
    }

    #[test]
    fn test_legacy_auto_cli_provider_deserializes_as_codex() {
        let json = r#"{
            "notesPath": "/notes",
            "theme": "system",
            "autoSave": true,
            "autoSaveDelay": 1000,
            "aiProvider": null,
            "cliProvider": "auto",
            "aiReasoningEffort": "xhigh",
            "taskDefaultView": "all"
        }"#;

        let settings: Settings = serde_json::from_str(json).expect("settings should parse");
        assert_eq!(settings.cli_provider, CliProvider::Codex);
        assert_eq!(settings.ai_reasoning_effort, AiReasoningEffort::Xhigh);
    }
}
