use crate::commands::files::validate_path;
use crate::commands::settings::get_settings;
use crate::error::VoidError;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

const GITHUB_API: &str = "https://api.github.com";
const USER_AGENT_VALUE: &str = "Void GitHub Sync";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    path: String,
    status: String,
    staged: bool,
    conflicted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    id: String,
    kind: String,
    path: Option<String>,
    message: String,
    local_ref: Option<String>,
    remote_ref: Option<String>,
    base_ref: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryState {
    repo_kind: String,
    root: Option<String>,
    branch: Option<String>,
    remote_url: Option<String>,
    upstream: Option<String>,
    detached: bool,
    ahead: u32,
    behind: u32,
    changed_files: Vec<GitFileChange>,
    conflicts: Vec<SyncConflict>,
    last_commit: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncArtifactPolicyCommand {
    include_markdown: bool,
    include_void_history: bool,
    include_patterns: Vec<String>,
    exclude_patterns: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    committed: bool,
    commit: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteFile {
    path: String,
    content: String,
    #[serde(rename = "ref")]
    ref_: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeStartResult {
    clean: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeConflictFile {
    path: String,
    status: String,
    supported: bool,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeFile {
    path: String,
    base: Option<String>,
    local: Option<String>,
    remote: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    login: String,
    name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreatedRepository {
    owner: String,
    name: String,
    full_name: String,
    clone_url: String,
    html_url: String,
    default_branch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceAuthStart {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubTokenResult {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    name: String,
    is_current: bool,
    upstream: Option<String>,
    last_commit: Option<String>,
    last_commit_subject: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoSummary {
    owner: String,
    name: String,
    full_name: String,
    private: bool,
    default_branch: String,
    description: Option<String>,
    clone_url: String,
    ssh_url: String,
    html_url: String,
    pushed_at: Option<String>,
    permissions_push: bool,
    void_ready: Option<bool>,
    void_ready_reason: Option<String>,
    void_manifest: Option<VoidRepoManifest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubBranchSummary {
    name: String,
    is_default: bool,
    protected: bool,
    last_commit: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubNameAvailability {
    available: bool,
    reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoidRepoManifest {
    app: String,
    kind: String,
    schema_version: u32,
    workspace_id: String,
    created_at: String,
    artifact_policy_version: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubVoidReadyProbe {
    ready: bool,
    manifest: Option<VoidRepoManifest>,
    reason: Option<String>,
}

struct CommandOutcome {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

fn redact_token(text: &str, token: Option<&str>) -> String {
    match token {
        Some(token) if !token.is_empty() => {
            let trimmed = token.trim();
            let basic = github_git_basic_header(trimmed);
            text.replace(trimmed, "[redacted-token]")
                .replace(&basic, "AUTHORIZATION: Basic [redacted-token]")
        }
        _ => text.to_string(),
    }
}

fn github_git_basic_header(token: &str) -> String {
    let credential = format!("x-access-token:{}", token.trim());
    format!(
        "AUTHORIZATION: Basic {}",
        BASE64_STANDARD.encode(credential)
    )
}

async fn run_git_outcome(
    repo: &Path,
    git_args: &[String],
    token: Option<&str>,
) -> Result<CommandOutcome, VoidError> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(repo)
        .args(git_args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never");

    if let Some(token) = token.filter(|value| !value.is_empty()) {
        command
            .env("GIT_CONFIG_COUNT", "2")
            .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
            .env("GIT_CONFIG_VALUE_0", github_git_basic_header(token))
            .env("GIT_CONFIG_KEY_1", "credential.helper")
            .env("GIT_CONFIG_VALUE_1", "");
    }

    let output = command
        .output()
        .await
        .map_err(|e| VoidError::Git(format!("Could not launch git: {e}")))?;

    Ok(CommandOutcome {
        success: output.status.success(),
        code: output.status.code(),
        stdout: redact_token(&String::from_utf8_lossy(&output.stdout), token),
        stderr: redact_token(&String::from_utf8_lossy(&output.stderr), token),
    })
}

async fn run_git(
    repo: &Path,
    git_args: &[String],
    token: Option<&str>,
) -> Result<String, VoidError> {
    let outcome = run_git_outcome(repo, git_args, token).await?;
    if outcome.success {
        Ok(outcome.stdout.trim().to_string())
    } else {
        Err(VoidError::Git(git_failure_message(&outcome)))
    }
}

async fn validate_sync_workspace_path(notes_path: &str) -> Result<PathBuf, VoidError> {
    let dir = validate_path(notes_path)?;
    let settings = get_settings().await?;
    let active = validate_path(&settings.notes_path)?;
    if dir != active {
        return Err(VoidError::PathNotAllowed(
            "GitHub sync can only operate on the active Void workspace".to_string(),
        ));
    }
    Ok(dir)
}

fn git_failure_message(outcome: &CommandOutcome) -> String {
    let stderr = outcome.stderr.trim();
    let stdout = outcome.stdout.trim();
    if stderr.contains("could not read Username") && stderr.contains("terminal prompts disabled") {
        return "GitHub authentication failed before Git could obtain credentials. Sign in again, or use a token that can read and write the selected private repository.".to_string();
    }
    if !stderr.is_empty() {
        stderr.to_string()
    } else if !stdout.is_empty() {
        stdout.to_string()
    } else {
        format!("git exited with status {:?}", outcome.code)
    }
}

async fn optional_git(repo: &Path, git_args: &[String]) -> Option<String> {
    run_git(repo, git_args, None)
        .await
        .ok()
        .filter(|value| !value.is_empty())
}

async fn git_ref_exists(repo: &Path, git_ref: &str) -> bool {
    run_git_outcome(
        repo,
        &args(&["rev-parse", "--verify", "--quiet", git_ref]),
        None,
    )
    .await
    .map(|outcome| outcome.success)
    .unwrap_or(false)
}

fn canonical_or_self(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn conflict_status(status: &str) -> bool {
    matches!(status, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU")
}

fn parse_status_line(line: &str) -> Option<GitFileChange> {
    if line.len() < 3 {
        return None;
    }

    let status = line.get(0..2)?.to_string();
    let raw_path = line.get(3..)?.trim().trim_matches('"');
    let path = raw_path
        .split(" -> ")
        .last()
        .unwrap_or(raw_path)
        .trim_matches('"')
        .to_string();

    if path.is_empty() {
        return None;
    }

    let staged = status
        .chars()
        .next()
        .map(|value| value != ' ' && value != '?')
        .unwrap_or(false);
    let compact_status = status.replace(' ', "");

    Some(GitFileChange {
        path,
        conflicted: conflict_status(status.as_str()),
        status: if compact_status.is_empty() {
            status
        } else {
            compact_status
        },
        staged,
    })
}

fn conflict_from_change(change: &GitFileChange) -> SyncConflict {
    SyncConflict {
        id: format!("git-conflict-{}", change.path.replace('/', "-")),
        kind: "merge-conflict".to_string(),
        path: Some(change.path.clone()),
        message: format!("Git reports a merge conflict in {}", change.path),
        local_ref: Some("HEAD".to_string()),
        remote_ref: None,
        base_ref: None,
    }
}

fn supported_merge_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".md",
        ".markdown",
        ".txt",
        ".json",
        ".jsonl",
        ".yaml",
        ".yml",
        ".csv",
        ".tsv",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
}

fn merge_conflict_from_change(change: &GitFileChange) -> GitMergeConflictFile {
    let status = change.status.trim().to_string();
    let supported_status = status == "UU";
    let supported_path = supported_merge_path(&change.path);
    let reason = if !supported_status {
        Some("Only both-modified text conflicts can be resolved in Void today".to_string())
    } else if !supported_path {
        Some("This file type is not safe for automatic text merging".to_string())
    } else {
        None
    };
    GitMergeConflictFile {
        path: change.path.clone(),
        status,
        supported: reason.is_none(),
        reason,
    }
}

async fn merge_conflict_files(repo: &Path) -> Result<Vec<GitMergeConflictFile>, VoidError> {
    let status_output = optional_git(repo, &args(&["status", "--porcelain=v1"])).await;
    Ok(status_output
        .as_deref()
        .unwrap_or("")
        .lines()
        .filter_map(parse_status_line)
        .filter(|change| change.conflicted)
        .map(|change| merge_conflict_from_change(&change))
        .collect::<Vec<_>>())
}

fn safe_relative_git_path(path: &str) -> Result<String, VoidError> {
    let trimmed = path.trim().trim_start_matches("./");
    let path_buf = PathBuf::from(trimmed);
    if trimmed.is_empty()
        || path_buf.is_absolute()
        || trimmed.starts_with(".git/")
        || trimmed == ".git"
        || path_buf.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(VoidError::Git("Invalid Git path".to_string()));
    }
    Ok(trimmed.to_string())
}

fn safe_gitignore_pattern(pattern: &str) -> Result<Option<String>, VoidError> {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.starts_with('!')
        || trimmed.starts_with('/')
        || trimmed.contains('\n')
        || trimmed.contains('\r')
        || trimmed == ".git"
        || trimmed.starts_with(".git/")
        || trimmed.split('/').any(|part| part == "..")
    {
        return Err(VoidError::Git(format!(
            "Unsafe sync artifact pattern: {trimmed}"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

fn parent_unignore_patterns(pattern: &str) -> Vec<String> {
    let literal_prefix = pattern.split('*').next().unwrap_or("");
    let parts = literal_prefix
        .trim_end_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() <= 1 {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut path = String::new();
    for part in parts.iter().take(parts.len() - 1) {
        if !path.is_empty() {
            path.push('/');
        }
        path.push_str(part);
        out.push(format!("{path}/"));
    }
    out
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.iter().any(|item| item == &value) {
        list.push(value);
    }
}

fn artifact_policy_block(policy: &SyncArtifactPolicyCommand) -> Result<String, VoidError> {
    let begin = "# BEGIN Void sync local state";
    let end = "# END Void sync local state";
    let mut include_patterns = Vec::new();
    let mut exclude_patterns = Vec::new();

    for pattern in &policy.include_patterns {
        if !policy.include_markdown && matches!(pattern.as_str(), "*.md" | "**/*.md") {
            continue;
        }
        if !policy.include_void_history && pattern.trim().starts_with(".void/") {
            continue;
        }
        if let Some(pattern) = safe_gitignore_pattern(pattern)? {
            push_unique(&mut include_patterns, pattern);
        }
    }
    for pattern in &policy.exclude_patterns {
        if let Some(pattern) = safe_gitignore_pattern(pattern)? {
            push_unique(&mut exclude_patterns, pattern);
        }
    }

    let mut block_lines = vec![
        begin.to_string(),
        "# Void sync uses an allowlist: portable markdown plus durable sidecar history."
            .to_string(),
        "# Everything else in the notes folder remains local unless explicitly allowed."
            .to_string(),
        "*".to_string(),
        ".*".to_string(),
        "!*/".to_string(),
        "!.gitignore".to_string(),
    ];

    for pattern in &include_patterns {
        for parent in parent_unignore_patterns(pattern) {
            push_unique(&mut block_lines, format!("!{parent}"));
        }
        push_unique(&mut block_lines, format!("!{pattern}"));
    }

    for pattern in &exclude_patterns {
        push_unique(&mut block_lines, pattern.clone());
    }

    block_lines.push(end.to_string());
    Ok(block_lines.join("\n"))
}

fn split_ahead_behind(value: &str) -> (u32, u32) {
    let mut parts = value.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

async fn count_commits(repo: &Path, git_ref: &str) -> u32 {
    optional_git(repo, &args(&["rev-list", "--count", git_ref]))
        .await
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
}

async fn ahead_behind(
    repo: &Path,
    upstream: Option<&String>,
    remote_url: Option<&String>,
    branch: Option<&String>,
) -> (u32, u32) {
    let compare_ref = if let Some(upstream) = upstream {
        Some(upstream.to_string())
    } else if remote_url.is_some() {
        if let Some(branch) = branch {
            let remote_ref = format!("origin/{branch}");
            if git_ref_exists(repo, &remote_ref).await {
                Some(remote_ref)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Some(compare_ref) = compare_ref {
        let spec = format!("HEAD...{compare_ref}");
        let outcome = run_git_outcome(
            repo,
            &args(&["rev-list", "--left-right", "--count", &spec]),
            None,
        )
        .await;

        match outcome {
            Ok(outcome) if outcome.success => return split_ahead_behind(&outcome.stdout),
            Ok(_) | Err(_) => {
                let ahead = count_commits(repo, "HEAD").await.max(1);
                let behind = count_commits(repo, &compare_ref).await.max(1);
                return (ahead, behind);
            }
        }
    }

    if remote_url.is_some() && git_ref_exists(repo, "HEAD").await {
        return (count_commits(repo, "HEAD").await, 0);
    }

    (0, 0)
}

#[tauri::command]
pub async fn git_detect(notes_path: String) -> Result<GitRepositoryState, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    if tokio::fs::metadata(&dir).await.is_err() {
        return Ok(GitRepositoryState {
            repo_kind: "none".to_string(),
            root: None,
            branch: None,
            remote_url: None,
            upstream: None,
            detached: false,
            ahead: 0,
            behind: 0,
            changed_files: vec![],
            conflicts: vec![],
            last_commit: None,
            message: Some("Notes folder does not exist".to_string()),
        });
    }

    let root_outcome =
        run_git_outcome(&dir, &args(&["rev-parse", "--show-toplevel"]), None).await?;
    if !root_outcome.success {
        return Ok(GitRepositoryState {
            repo_kind: "none".to_string(),
            root: None,
            branch: None,
            remote_url: None,
            upstream: None,
            detached: false,
            ahead: 0,
            behind: 0,
            changed_files: vec![],
            conflicts: vec![],
            last_commit: None,
            message: None,
        });
    }

    let root_raw = root_outcome.stdout.trim().to_string();
    let root_path = PathBuf::from(&root_raw);
    let notes_canon = canonical_or_self(&dir);
    let root_canon = canonical_or_self(&root_path);
    let is_bare = optional_git(&dir, &args(&["rev-parse", "--is-bare-repository"]))
        .await
        .map(|value| value == "true")
        .unwrap_or(false);

    let repo_kind = if is_bare {
        "bare"
    } else if root_canon == notes_canon {
        "managed"
    } else if notes_canon.starts_with(&root_canon) {
        "nested"
    } else {
        "invalid"
    }
    .to_string();

    let branch = optional_git(&dir, &args(&["symbolic-ref", "--short", "HEAD"])).await;
    let detached = branch.is_none();
    let remote_url = optional_git(&dir, &args(&["config", "--get", "remote.origin.url"])).await;
    let upstream = optional_git(
        &dir,
        &args(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
    )
    .await;
    let last_commit = optional_git(&dir, &args(&["rev-parse", "--short", "HEAD"])).await;
    let status_output = optional_git(&dir, &args(&["status", "--porcelain=v1"])).await;
    let changed_files = status_output
        .as_deref()
        .unwrap_or("")
        .lines()
        .filter_map(parse_status_line)
        .collect::<Vec<_>>();
    let conflicts = changed_files
        .iter()
        .filter(|change| change.conflicted)
        .map(conflict_from_change)
        .collect::<Vec<_>>();
    let (ahead, behind) = ahead_behind(
        &dir,
        upstream.as_ref(),
        remote_url.as_ref(),
        branch.as_ref(),
    )
    .await;

    let message = if repo_kind == "nested" {
        Some("Notes folder is inside a larger Git repository".to_string())
    } else if repo_kind == "bare" {
        Some("Notes folder is a bare Git repository".to_string())
    } else if repo_kind == "invalid" {
        Some("Git root could not be validated".to_string())
    } else if detached {
        Some("Git repository is in detached HEAD state".to_string())
    } else if !conflicts.is_empty() {
        Some("Git conflicts need resolution".to_string())
    } else if repo_kind == "managed" && remote_url.is_none() {
        Some("No origin remote configured".to_string())
    } else if repo_kind == "managed" && upstream.is_none() && remote_url.is_some() {
        Some("No upstream branch configured yet".to_string())
    } else {
        None
    };

    Ok(GitRepositoryState {
        repo_kind,
        root: Some(root_raw),
        branch,
        remote_url,
        upstream,
        detached,
        ahead,
        behind,
        changed_files,
        conflicts,
        last_commit,
        message,
    })
}

#[tauri::command]
pub async fn git_init(notes_path: String, branch: String) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| VoidError::DirectoryCreate {
            path: dir.to_string_lossy().to_string(),
            source: e,
        })?;

    let branch = if branch.trim().is_empty() {
        "main".to_string()
    } else {
        safe_branch_name(&branch)?
    };

    let init = run_git_outcome(&dir, &args(&["init", "-b", &branch]), None).await?;
    if !init.success {
        run_git(&dir, &args(&["init"]), None).await?;
        run_git(&dir, &args(&["checkout", "-B", &branch]), None).await?;
    }
    run_git(&dir, &args(&["config", "user.name", "Void"]), None).await?;
    run_git(&dir, &args(&["config", "user.email", "void@local"]), None).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_ensure_artifact_policy(
    notes_path: String,
    artifact_policy: SyncArtifactPolicyCommand,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let gitignore = dir.join(".gitignore");
    let existing = tokio::fs::read_to_string(&gitignore)
        .await
        .unwrap_or_default();
    let begin = "# BEGIN Void sync local state";
    let end = "# END Void sync local state";
    let block = artifact_policy_block(&artifact_policy)?;

    let next = if let (Some(start), Some(end_index)) = (existing.find(begin), existing.find(end)) {
        let after_end = end_index + end.len();
        format!("{}{}{}", &existing[..start], block, &existing[after_end..])
    } else {
        let separator = if existing.trim().is_empty() {
            ""
        } else {
            "\n\n"
        };
        format!("{}{}{}\n", existing.trim_end(), separator, block)
    };

    if existing != next {
        tokio::fs::write(&gitignore, next)
            .await
            .map_err(|e| VoidError::FileWrite {
                path: gitignore.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    for pattern in artifact_policy
        .exclude_patterns
        .iter()
        .filter(|pattern| !pattern.trim().is_empty())
    {
        let outcome = run_git_outcome(
            &dir,
            &args(&["rm", "-r", "--cached", "--ignore-unmatch", "--", pattern]),
            None,
        )
        .await?;
        if !outcome.success {
            return Err(VoidError::Git(git_failure_message(&outcome)));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn git_set_remote(notes_path: String, remote_url: String) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    validate_github_remote_url(remote_url.trim())?;
    let remove = run_git_outcome(&dir, &args(&["remote", "remove", "origin"]), None).await?;
    if !remove.success && !remove.stderr.contains("No such remote") {
        return Err(VoidError::Git(git_failure_message(&remove)));
    }
    run_git(
        &dir,
        &args(&["remote", "add", "origin", remote_url.trim()]),
        None,
    )
    .await?;
    Ok(())
}

fn validate_github_remote_url(remote_url: &str) -> Result<(), VoidError> {
    if remote_url.starts_with("https://github.com/") {
        if remote_url.contains('@') || remote_url.contains('?') || remote_url.contains('#') {
            return Err(VoidError::Git(
                "GitHub remote URL must not contain credentials or query parameters".to_string(),
            ));
        }
        return Ok(());
    }
    if remote_url.starts_with("git@github.com:") {
        return Ok(());
    }
    Err(VoidError::Git(
        "Void GitHub sync only supports GitHub HTTPS or SSH remotes".to_string(),
    ))
}

#[tauri::command]
pub async fn git_commit_all(
    notes_path: String,
    message: String,
) -> Result<GitCommitResult, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    run_git(&dir, &args(&["add", "-A", "--", "."]), None).await?;
    let diff = run_git_outcome(&dir, &args(&["diff", "--cached", "--quiet"]), None).await?;
    if diff.success {
        let commit = optional_git(&dir, &args(&["rev-parse", "--short", "HEAD"])).await;
        return Ok(GitCommitResult {
            committed: false,
            commit,
            message: "No changes to commit".to_string(),
        });
    }
    if diff.code != Some(1) {
        return Err(VoidError::Git(git_failure_message(&diff)));
    }

    let commit_message = if message.trim().is_empty() {
        "Sync Void notes".to_string()
    } else {
        message
    };
    run_git(
        &dir,
        &args(&["commit", "--no-gpg-sign", "-m", &commit_message]),
        None,
    )
    .await?;
    let commit = optional_git(&dir, &args(&["rev-parse", "--short", "HEAD"])).await;
    Ok(GitCommitResult {
        committed: true,
        commit,
        message: commit_message,
    })
}

#[tauri::command]
pub async fn git_fetch(
    notes_path: String,
    remote: String,
    branch: String,
    token: Option<String>,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let outcome = run_git_outcome(
        &dir,
        &args(&["fetch", "--prune", &remote, &branch]),
        token.as_deref(),
    )
    .await?;
    if outcome.success || outcome.stderr.contains("couldn't find remote ref") {
        Ok(())
    } else {
        Err(VoidError::Git(git_failure_message(&outcome)))
    }
}

#[tauri::command]
pub async fn git_pull_ff(
    notes_path: String,
    remote: String,
    branch: String,
    token: Option<String>,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let remote_ref = format!("{remote}/{branch}");
    if !git_ref_exists(&dir, &remote_ref).await {
        return Ok(());
    }
    run_git(
        &dir,
        &args(&["merge", "--ff-only", &remote_ref]),
        token.as_deref(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    notes_path: String,
    remote: String,
    branch: String,
    token: Option<String>,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let target = format!("HEAD:{branch}");
    run_git(
        &dir,
        &args(&["push", "-u", &remote, &target]),
        token.as_deref(),
    )
    .await?;
    Ok(())
}

/// Negotiate a push with the remote without actually transferring objects.
/// Used to detect token write-permission problems before the first real sync,
/// so fine-grained PATs missing `Contents: Read and write` fail loudly at
/// attach time instead of on the user's first edit.
#[tauri::command]
pub async fn git_push_dry_run(
    notes_path: String,
    remote: String,
    branch: String,
    token: Option<String>,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let target = format!("HEAD:{branch}");
    let outcome = run_git_outcome(
        &dir,
        &args(&["push", "--dry-run", &remote, &target]),
        token.as_deref(),
    )
    .await?;
    if outcome.success {
        return Ok(());
    }
    // A fresh repo with no commits cannot dry-run a HEAD push. Treat that as
    // a non-failure — the real push will create the first commit pointer.
    let stderr = outcome.stderr.to_lowercase();
    if stderr.contains("does not appear to be a git repository")
        || stderr.contains("src refspec head does not match any")
        || stderr.contains("error: src refspec head does not match")
    {
        return Ok(());
    }
    Err(VoidError::Git(git_failure_message(&outcome)))
}

#[tauri::command]
pub async fn git_read_remote_file(
    notes_path: String,
    remote: String,
    branch: String,
    path: String,
    token: Option<String>,
) -> Result<GitRemoteFile, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let safe_path = safe_relative_git_path(&path)?;
    git_fetch(notes_path, remote.clone(), branch.clone(), token.clone()).await?;
    let git_ref = format!("{remote}/{branch}:{safe_path}");
    let content = run_git(&dir, &args(&["show", &git_ref]), token.as_deref()).await?;
    Ok(GitRemoteFile {
        path: safe_path,
        content,
        ref_: format!("{remote}/{branch}"),
    })
}

#[tauri::command]
pub async fn git_build_divergence_conflict(
    notes_path: String,
    branch: String,
) -> Result<SyncConflict, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let branch = safe_branch_name(&branch)?;
    let remote_ref = format!("origin/{branch}");
    let base = optional_git(&dir, &args(&["merge-base", "HEAD", &remote_ref])).await;
    let local = optional_git(&dir, &args(&["rev-parse", "--short", "HEAD"])).await;
    let remote = optional_git(&dir, &args(&["rev-parse", "--short", &remote_ref])).await;
    Ok(SyncConflict {
        id: format!("history-diverged-{}", Utc::now().timestamp_millis()),
        kind: "history-diverged".to_string(),
        path: None,
        message: "Local and remote histories diverged".to_string(),
        local_ref: local,
        remote_ref: remote,
        base_ref: base,
    })
}

#[tauri::command]
pub async fn git_create_recovery_branch(
    notes_path: String,
    branch: String,
) -> Result<String, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let requested = safe_branch_name(&branch)?;
    let mut candidate = requested.clone();
    let mut suffix = 2;
    while git_ref_exists(&dir, &format!("refs/heads/{candidate}")).await {
        candidate = format!("{requested}-{suffix}");
        suffix += 1;
    }
    run_git(&dir, &args(&["branch", &candidate, "HEAD"]), None).await?;
    Ok(candidate)
}

#[tauri::command]
pub async fn git_begin_merge(
    notes_path: String,
    remote: String,
    branch: String,
    token: Option<String>,
) -> Result<GitMergeStartResult, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let remote = safe_remote_name(&remote)?;
    let branch = safe_branch_name(&branch)?;
    let remote_ref = format!("{remote}/{branch}");
    if !git_ref_exists(&dir, &remote_ref).await {
        return Err(VoidError::Git(format!(
            "Remote branch {remote_ref} has not been fetched"
        )));
    }

    let outcome = run_git_outcome(
        &dir,
        &args(&["merge", "--no-commit", "--no-ff", &remote_ref]),
        token.as_deref(),
    )
    .await?;
    if outcome.success {
        return Ok(GitMergeStartResult {
            clean: true,
            message: "Git merge applied cleanly".to_string(),
        });
    }

    let conflicts = merge_conflict_files(&dir).await?;
    if !conflicts.is_empty() {
        return Ok(GitMergeStartResult {
            clean: false,
            message: git_failure_message(&outcome),
        });
    }

    Err(VoidError::Git(git_failure_message(&outcome)))
}

#[tauri::command]
pub async fn git_list_merge_conflicts(
    notes_path: String,
) -> Result<Vec<GitMergeConflictFile>, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    merge_conflict_files(&dir).await
}

async fn merge_stage_content(
    repo: &Path,
    stage: u8,
    path: &str,
) -> Result<Option<String>, VoidError> {
    let spec = format!(":{stage}:{path}");
    let outcome = run_git_outcome(repo, &args(&["show", &spec]), None).await?;
    if outcome.success {
        Ok(Some(outcome.stdout))
    } else if outcome.stderr.contains("exists on disk, but not in")
        || outcome.stderr.contains("Path")
        || outcome.stderr.contains("does not exist")
    {
        Ok(None)
    } else {
        Err(VoidError::Git(git_failure_message(&outcome)))
    }
}

#[tauri::command]
pub async fn git_read_merge_file(
    notes_path: String,
    path: String,
) -> Result<GitMergeFile, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let safe_path = safe_relative_git_path(&path)?;
    Ok(GitMergeFile {
        path: safe_path.clone(),
        base: merge_stage_content(&dir, 1, &safe_path).await?,
        local: merge_stage_content(&dir, 2, &safe_path).await?,
        remote: merge_stage_content(&dir, 3, &safe_path).await?,
    })
}

#[tauri::command]
pub async fn git_write_working_file(
    notes_path: String,
    path: String,
    content: String,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let safe_path = safe_relative_git_path(&path)?;
    let target = dir.join(&safe_path);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: parent.to_string_lossy().to_string(),
                source: e,
            })?;
    }
    tokio::fs::write(&target, content)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: target.to_string_lossy().to_string(),
            source: e,
        })?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage_paths(notes_path: String, paths: Vec<String>) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    if paths.is_empty() {
        return Ok(());
    }
    let safe_paths = paths
        .iter()
        .map(|path| safe_relative_git_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    let mut command = vec!["add".to_string(), "--".to_string()];
    command.extend(safe_paths);
    run_git(&dir, &command, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit_merge(
    notes_path: String,
    message: String,
) -> Result<GitCommitResult, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let merge_in_progress = git_is_merge_in_progress(notes_path.clone()).await?;
    if !merge_in_progress {
        return Err(VoidError::Git("No Git merge is in progress".to_string()));
    }
    let conflicts = merge_conflict_files(&dir).await?;
    if !conflicts.is_empty() {
        return Err(VoidError::Git(
            "Merge conflicts are still unresolved".to_string(),
        ));
    }
    let commit_message = if message.trim().is_empty() {
        "Merge GitHub changes into Void notes".to_string()
    } else {
        message
    };
    run_git(
        &dir,
        &args(&["commit", "--no-gpg-sign", "-m", &commit_message]),
        None,
    )
    .await?;
    let commit = optional_git(&dir, &args(&["rev-parse", "--short", "HEAD"])).await;
    Ok(GitCommitResult {
        committed: true,
        commit,
        message: commit_message,
    })
}

#[tauri::command]
pub async fn git_abort_merge(notes_path: String) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let outcome = run_git_outcome(&dir, &args(&["merge", "--abort"]), None).await?;
    if outcome.success
        || outcome.stderr.contains("There is no merge to abort")
        || outcome.stderr.contains("MERGE_HEAD missing")
    {
        Ok(())
    } else {
        Err(VoidError::Git(git_failure_message(&outcome)))
    }
}

#[tauri::command]
pub async fn git_is_merge_in_progress(notes_path: String) -> Result<bool, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let path = run_git_outcome(
        &dir,
        &args(&["rev-parse", "--git-path", "MERGE_HEAD"]),
        None,
    )
    .await?;
    if !path.success {
        return Ok(false);
    }
    let merge_head = dir.join(path.stdout.trim());
    Ok(tokio::fs::metadata(merge_head).await.is_ok())
}

fn github_client() -> Result<reqwest::Client, VoidError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT_VALUE)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| VoidError::GitHub(format!("Could not create GitHub client: {e}")))
}

fn github_message(status: reqwest::StatusCode, body: &str) -> VoidError {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or(body)
        .trim();
    VoidError::GitHub(format!("GitHub returned {status}: {message}"))
}

fn parse_github_user(value: Value) -> Result<GitHubUser, VoidError> {
    let login = value.get("login").and_then(Value::as_str).ok_or_else(|| {
        VoidError::GitHub("GitHub user response did not include login".to_string())
    })?;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    Ok(GitHubUser {
        login: login.to_string(),
        name,
    })
}

fn parse_github_repo(value: Value) -> Result<GitHubCreatedRepository, VoidError> {
    let owner = value
        .get("owner")
        .and_then(|owner| owner.get("login"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            VoidError::GitHub("Repository response did not include owner".to_string())
        })?;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| VoidError::GitHub("Repository response did not include name".to_string()))?;
    let full_name = value
        .get("full_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let clone_url = value
        .get("clone_url")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            VoidError::GitHub("Repository response did not include clone_url".to_string())
        })?;
    let html_url = value
        .get("html_url")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            VoidError::GitHub("Repository response did not include html_url".to_string())
        })?;
    let default_branch = value
        .get("default_branch")
        .and_then(Value::as_str)
        .unwrap_or("main");

    Ok(GitHubCreatedRepository {
        owner: owner.to_string(),
        name: name.to_string(),
        full_name: if full_name.is_empty() {
            format!("{owner}/{name}")
        } else {
            full_name.to_string()
        },
        clone_url: clone_url.to_string(),
        html_url: html_url.to_string(),
        default_branch: default_branch.to_string(),
    })
}

#[tauri::command]
pub async fn github_validate_token(token: String) -> Result<GitHubUser, VoidError> {
    let client = github_client()?;
    let response = client
        .get(format!("{GITHUB_API}/user"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not reach GitHub: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &body));
    }
    let value = serde_json::from_str::<Value>(&body)?;
    parse_github_user(value)
}

#[tauri::command]
pub async fn github_create_repo(
    token: String,
    name: String,
    private_repo: bool,
    description: Option<String>,
) -> Result<GitHubCreatedRepository, VoidError> {
    if !private_repo {
        return Err(VoidError::GitHub(
            "Void GitHub sync only supports private repositories".to_string(),
        ));
    }
    let client = github_client()?;
    let body = json!({
        "name": name.trim(),
        "private": private_repo,
        "description": description,
        "auto_init": false,
    });
    let response = client
        .post(format!("{GITHUB_API}/user/repos"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not create repository: {e}")))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    parse_github_repo(serde_json::from_str::<Value>(&text)?)
}

#[tauri::command]
pub async fn github_get_void_ready(
    token: String,
    owner: String,
    repo: String,
    ref_name: Option<String>,
) -> Result<GitHubVoidReadyProbe, VoidError> {
    let client = github_client()?;
    let owner_trim = owner.trim();
    let repo_trim = repo.trim();
    if !is_safe_github_component(owner_trim) || !is_safe_github_component(repo_trim) {
        return Err(VoidError::GitHub(
            "Owner and repository contain unsupported characters".to_string(),
        ));
    }

    let mut url = format!("{GITHUB_API}/repos/{owner_trim}/{repo_trim}/contents/.void/repo.json");
    if let Some(ref_name) = ref_name.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        url.push_str("?ref=");
        url.push_str(&form_encode(ref_name));
    }

    let response = client
        .get(url)
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read Void repo manifest: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if status.as_u16() == 404 {
        return Ok(GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Missing .void/repo.json".to_string()),
        });
    }
    if !status.is_success() {
        return Err(github_message(status, &body));
    }

    let value: Value = serde_json::from_str(&body)?;
    let content = value
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| VoidError::GitHub("GitHub contents response did not include content".to_string()))?
        .replace('\n', "");
    let encoding = value
        .get("encoding")
        .and_then(Value::as_str)
        .unwrap_or("base64");
    if encoding != "base64" {
        return Ok(GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Void repo manifest is not base64 encoded by GitHub".to_string()),
        });
    }

    let decoded = BASE64_STANDARD
        .decode(content.as_bytes())
        .map_err(|e| VoidError::GitHub(format!("Could not decode Void repo manifest: {e}")))?;
    let manifest: VoidRepoManifest = serde_json::from_slice(&decoded)
        .map_err(|e| VoidError::GitHub(format!("Invalid Void repo manifest: {e}")))?;
    Ok(validate_void_manifest(manifest))
}

fn form_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn is_safe_github_component(value: &str) -> bool {
    !value.trim().is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        && !value.contains("..")
}

fn validate_void_manifest(manifest: VoidRepoManifest) -> GitHubVoidReadyProbe {
    if manifest.app != "void" {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Manifest app must be \"void\"".to_string()),
        };
    }
    if manifest.kind != "void-workspace" {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Manifest kind must be \"void-workspace\"".to_string()),
        };
    }
    if manifest.schema_version != 1 {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some(format!(
                "Unsupported Void repo schema version: {}",
                manifest.schema_version
            )),
        };
    }
    if manifest.artifact_policy_version != 1 {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some(format!(
                "Unsupported artifact policy version: {}",
                manifest.artifact_policy_version
            )),
        };
    }
    if manifest.workspace_id.trim().is_empty() {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Manifest workspaceId is required".to_string()),
        };
    }
    if manifest.created_at.trim().is_empty() {
        return GitHubVoidReadyProbe {
            ready: false,
            manifest: None,
            reason: Some("Manifest createdAt is required".to_string()),
        };
    }
    GitHubVoidReadyProbe {
        ready: true,
        manifest: Some(manifest),
        reason: None,
    }
}

#[tauri::command]
pub async fn github_begin_device_auth(
    client_id: String,
    scope: String,
) -> Result<GitHubDeviceAuthStart, VoidError> {
    let client = github_client()?;
    let body = format!(
        "client_id={}&scope={}",
        form_encode(client_id.trim()),
        form_encode(scope.trim())
    );
    let response = client
        .post("https://github.com/login/device/code")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not begin device auth: {e}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    let value = serde_json::from_str::<Value>(&text)?;
    Ok(GitHubDeviceAuthStart {
        device_code: value
            .get("device_code")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        user_code: value
            .get("user_code")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        verification_uri: value
            .get("verification_uri")
            .or_else(|| value.get("verification_uri_complete"))
            .and_then(Value::as_str)
            .unwrap_or("https://github.com/login/device")
            .to_string(),
        expires_in: value
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(900),
        interval: value.get("interval").and_then(Value::as_u64).unwrap_or(5),
    })
}

#[tauri::command]
pub async fn github_complete_device_auth(
    client_id: String,
    device_code: String,
) -> Result<GitHubTokenResult, VoidError> {
    let client = github_client()?;
    let body = format!(
        "client_id={}&device_code={}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
        form_encode(client_id.trim()),
        form_encode(device_code.trim())
    );
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not complete device auth: {e}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    let value = serde_json::from_str::<Value>(&text)?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        let description = value
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or(error);
        return Err(VoidError::GitHub(description.to_string()));
    }
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| VoidError::GitHub("GitHub did not return an access token".to_string()))?;
    Ok(GitHubTokenResult {
        access_token: access_token.to_string(),
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        token_type: value
            .get("token_type")
            .and_then(Value::as_str)
            .unwrap_or("bearer")
            .to_string(),
        scope: value
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

fn safe_branch_name(value: &str) -> Result<String, VoidError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(VoidError::Git("Branch name cannot be empty".to_string()));
    }
    if trimmed.starts_with('-')
        || trimmed.contains("..")
        || trimmed.contains(' ')
        || trimmed.contains('\t')
        || trimmed.contains('~')
        || trimmed.contains('^')
        || trimmed.contains(':')
        || trimmed.contains('?')
        || trimmed.contains('*')
        || trimmed.contains('[')
        || trimmed.contains('\\')
        || trimmed.starts_with('/')
        || trimmed.ends_with('/')
        || trimmed.ends_with(".lock")
        || trimmed.ends_with('.')
        || trimmed.contains("//")
        || trimmed.contains("@{")
        || trimmed == "@"
        || trimmed
            .split('/')
            .any(|component| component.starts_with('.') || component.ends_with(".lock"))
        || trimmed.chars().any(|ch| ch.is_control())
    {
        return Err(VoidError::Git(format!(
            "Branch name '{trimmed}' contains characters Git does not allow"
        )));
    }
    Ok(trimmed.to_string())
}

fn safe_remote_name(value: &str) -> Result<String, VoidError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(VoidError::Git("Remote name cannot be empty".to_string()));
    }
    if trimmed.starts_with('-')
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(VoidError::Git(format!(
            "Remote name '{trimmed}' contains characters Void sync does not allow"
        )));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn git_list_local_branches(notes_path: String) -> Result<Vec<GitBranchInfo>, VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    if tokio::fs::metadata(&dir).await.is_err() {
        return Ok(vec![]);
    }
    let root_outcome =
        run_git_outcome(&dir, &args(&["rev-parse", "--show-toplevel"]), None).await?;
    if !root_outcome.success {
        return Ok(vec![]);
    }

    let format =
        "%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(objectname:short)\t%(contents:subject)";
    let format_arg = format!("--format={format}");
    let outcome = run_git_outcome(
        &dir,
        &args(&["branch", "--list", "--all", &format_arg]),
        None,
    )
    .await?;
    if !outcome.success {
        return Err(VoidError::Git(git_failure_message(&outcome)));
    }

    let mut seen = std::collections::HashSet::new();
    let mut branches: Vec<GitBranchInfo> = Vec::new();
    for line in outcome.stdout.lines() {
        let parts: Vec<&str> = line.splitn(5, '\t').collect();
        if parts.is_empty() {
            continue;
        }
        let raw_name = parts.first().unwrap_or(&"").trim();
        if raw_name.is_empty() {
            continue;
        }
        // Strip "remotes/<name>/" for remote refs while preserving slashy
        // branch names like "feature/sync". Prefer local copies.
        let is_remote = raw_name.starts_with("remotes/");
        let stripped: &str = raw_name.strip_prefix("remotes/").unwrap_or(raw_name);
        if stripped.starts_with("origin/HEAD") || stripped.ends_with("/HEAD") {
            continue;
        }
        let branch_name = if is_remote {
            stripped
                .split_once('/')
                .map(|(_, name)| name)
                .unwrap_or(stripped)
        } else {
            stripped
        };
        if branch_name.is_empty() || !seen.insert(branch_name.to_string()) {
            continue;
        }
        let is_current = parts.get(1).map(|v| v.trim() == "*").unwrap_or(false);
        let upstream = parts
            .get(2)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let last_commit = parts
            .get(3)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let last_commit_subject = parts
            .get(4)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        branches.push(GitBranchInfo {
            name: branch_name.to_string(),
            is_current,
            upstream,
            last_commit,
            last_commit_subject,
        });
    }
    branches.sort_by(|a, b| match (a.is_current, b.is_current) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(branches)
}

#[tauri::command]
pub async fn git_create_branch(
    notes_path: String,
    branch: String,
    base: Option<String>,
    checkout: bool,
) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let name = safe_branch_name(&branch)?;
    let base = match base {
        Some(value) if !value.trim().is_empty() => Some(safe_branch_name(&value)?),
        _ => None,
    };
    let cmd = if checkout {
        let mut command = vec!["checkout".to_string(), "-b".to_string(), name];
        if let Some(base) = base.clone() {
            command.push(base);
        }
        command
    } else {
        let mut command = vec!["branch".to_string(), name];
        if let Some(base) = base {
            command.push(base);
        }
        command
    };
    run_git(&dir, &cmd, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_switch_branch(notes_path: String, branch: String) -> Result<(), VoidError> {
    let dir = validate_sync_workspace_path(&notes_path).await?;
    let name = safe_branch_name(&branch)?;
    let outcome = run_git_outcome(&dir, &args(&["switch", &name]), None).await?;
    if outcome.success {
        return Ok(());
    }
    // `git switch` is unavailable on very old git installs; fall back.
    let fallback = run_git_outcome(&dir, &args(&["checkout", &name]), None).await?;
    if fallback.success {
        Ok(())
    } else {
        Err(VoidError::Git(git_failure_message(&fallback)))
    }
}

fn parse_github_repo_summary(value: &Value) -> Option<GitHubRepoSummary> {
    let owner = value
        .get("owner")
        .and_then(|owner| owner.get("login"))
        .and_then(Value::as_str)?
        .to_string();
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let full_name = value
        .get("full_name")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("{owner}/{name}"));
    let clone_url = value.get("clone_url").and_then(Value::as_str)?.to_string();
    let ssh_url = value
        .get("ssh_url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let html_url = value.get("html_url").and_then(Value::as_str)?.to_string();
    let default_branch = value
        .get("default_branch")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .to_string();
    let private = value
        .get("private")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .filter(|v| !v.is_empty());
    let pushed_at = value
        .get("pushed_at")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let permissions_push = value
        .get("permissions")
        .and_then(|p| p.get("push"))
        .and_then(Value::as_bool)
        .unwrap_or(true);

    Some(GitHubRepoSummary {
        owner,
        name,
        full_name,
        private,
        default_branch,
        description,
        clone_url,
        ssh_url,
        html_url,
        pushed_at,
        permissions_push,
        void_ready: None,
        void_ready_reason: None,
        void_manifest: None,
    })
}

#[tauri::command]
pub async fn github_list_repositories(token: String) -> Result<Vec<GitHubRepoSummary>, VoidError> {
    let client = github_client()?;
    let mut repos: Vec<GitHubRepoSummary> = Vec::new();
    // GitHub returns max 100 per page; cap to 4 pages (400 repos) to keep
    // the picker snappy and avoid pagination loops on huge accounts.
    for page in 1..=4 {
        let url = format!(
            "{GITHUB_API}/user/repos?per_page=100&page={page}&sort=pushed&affiliation=owner,collaborator,organization_member"
        );
        let response = client
            .get(&url)
            .header(ACCEPT, "application/vnd.github+json")
            .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
            .send()
            .await
            .map_err(|e| VoidError::GitHub(format!("Could not list repositories: {e}")))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
        if !status.is_success() {
            return Err(github_message(status, &body));
        }
        let parsed: Value = serde_json::from_str(&body)?;
        let array = parsed
            .as_array()
            .ok_or_else(|| VoidError::GitHub("Expected an array of repositories".to_string()))?;
        let page_len = array.len();
        for item in array {
            if let Some(summary) = parse_github_repo_summary(item) {
                repos.push(summary);
            }
        }
        if page_len < 100 {
            break;
        }
    }
    Ok(repos)
}

#[tauri::command]
pub async fn github_get_repository(
    token: String,
    owner: String,
    repo: String,
) -> Result<GitHubRepoSummary, VoidError> {
    let client = github_client()?;
    let owner_trim = owner.trim();
    let repo_trim = repo.trim();
    if owner_trim.is_empty() || repo_trim.is_empty() {
        return Err(VoidError::GitHub(
            "Owner and repository are required".to_string(),
        ));
    }

    let response = client
        .get(format!("{GITHUB_API}/repos/{owner_trim}/{repo_trim}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not load repository: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &body));
    }
    parse_github_repo_summary(&serde_json::from_str::<Value>(&body)?)
        .ok_or_else(|| VoidError::GitHub("GitHub repository response was incomplete".to_string()))
}

#[tauri::command]
pub async fn github_list_branches(
    token: String,
    owner: String,
    repo: String,
) -> Result<Vec<GitHubBranchSummary>, VoidError> {
    let client = github_client()?;
    let owner_trim = owner.trim();
    let repo_trim = repo.trim();
    if owner_trim.is_empty() || repo_trim.is_empty() {
        return Err(VoidError::GitHub(
            "Owner and repository are required".to_string(),
        ));
    }
    // First grab default_branch so we can flag it.
    let repo_response = client
        .get(format!("{GITHUB_API}/repos/{owner_trim}/{repo_trim}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not load repository: {e}")))?;
    let repo_status = repo_response.status();
    let repo_body = repo_response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !repo_status.is_success() {
        return Err(github_message(repo_status, &repo_body));
    }
    let repo_value: Value = serde_json::from_str(&repo_body)?;
    let default_branch = repo_value
        .get("default_branch")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .to_string();

    let mut branches: Vec<GitHubBranchSummary> = Vec::new();
    for page in 1..=4 {
        let url = format!(
            "{GITHUB_API}/repos/{owner_trim}/{repo_trim}/branches?per_page=100&page={page}"
        );
        let response = client
            .get(&url)
            .header(ACCEPT, "application/vnd.github+json")
            .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
            .send()
            .await
            .map_err(|e| VoidError::GitHub(format!("Could not list branches: {e}")))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
        if !status.is_success() {
            return Err(github_message(status, &body));
        }
        let parsed: Value = serde_json::from_str(&body)?;
        let array = parsed
            .as_array()
            .ok_or_else(|| VoidError::GitHub("Expected an array of branches".to_string()))?;
        let page_len = array.len();
        for item in array {
            let name = match item.get("name").and_then(Value::as_str) {
                Some(name) => name.to_string(),
                None => continue,
            };
            let protected = item
                .get("protected")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let last_commit = item
                .get("commit")
                .and_then(|c| c.get("sha"))
                .and_then(Value::as_str)
                .map(|s| s.chars().take(7).collect::<String>());
            branches.push(GitHubBranchSummary {
                is_default: name == default_branch,
                name,
                protected,
                last_commit,
            });
        }
        if page_len < 100 {
            break;
        }
    }
    branches.sort_by(|a, b| match (a.is_default, b.is_default) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(branches)
}

#[tauri::command]
pub async fn github_check_repo_name(
    token: String,
    name: String,
) -> Result<GitHubNameAvailability, VoidError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(GitHubNameAvailability {
            available: false,
            reason: Some("Repository name cannot be empty".to_string()),
        });
    }
    if trimmed.len() > 100 || trimmed.contains('/') || trimmed.contains(' ') {
        return Ok(GitHubNameAvailability {
            available: false,
            reason: Some(
                "Use letters, numbers, hyphens, underscores, or dots (max 100 chars)".to_string(),
            ),
        });
    }

    let client = github_client()?;
    // Pull the authenticated login so we can probe /repos/{login}/{name}.
    let user_response = client
        .get(format!("{GITHUB_API}/user"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not reach GitHub: {e}")))?;
    let status = user_response.status();
    let body = user_response
        .text()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not read GitHub response: {e}")))?;
    if !status.is_success() {
        return Err(github_message(status, &body));
    }
    let user_value = serde_json::from_str::<Value>(&body)?;
    let login = user_value
        .get("login")
        .and_then(Value::as_str)
        .ok_or_else(|| VoidError::GitHub("Could not read GitHub login".to_string()))?;

    let response = client
        .get(format!("{GITHUB_API}/repos/{login}/{trimmed}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not check repository: {e}")))?;
    let probe_status = response.status();
    if probe_status == reqwest::StatusCode::NOT_FOUND {
        return Ok(GitHubNameAvailability {
            available: true,
            reason: None,
        });
    }
    if probe_status.is_success() {
        return Ok(GitHubNameAvailability {
            available: false,
            reason: Some(format!(
                "@{login} already has a repository named '{trimmed}'"
            )),
        });
    }
    let probe_body = response.text().await.unwrap_or_default();
    Err(github_message(probe_status, &probe_body))
}

#[tauri::command]
pub async fn github_revoke_token(client_id: String, token: String) -> Result<(), VoidError> {
    let trimmed_token = token.trim();
    let trimmed_id = client_id.trim();
    if trimmed_token.is_empty() || trimmed_id.is_empty() {
        return Ok(());
    }
    let client = github_client()?;
    let body = json!({ "access_token": trimmed_token });
    let response = client
        .delete(format!("{GITHUB_API}/applications/{trimmed_id}/grant"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", trimmed_token))
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| VoidError::GitHub(format!("Could not revoke token: {e}")))?;
    // 204 = revoked, 404 = nothing to revoke; both fine.
    if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
        Ok(())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(github_message(status, &text))
    }
}
