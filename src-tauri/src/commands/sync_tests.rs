use super::*;

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("void-sync-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

async fn git(dir: &Path, command: &[&str]) -> String {
    run_git(dir, &args(command), None).await.unwrap()
}

async fn configure(dir: &Path) {
    git(dir, &["config", "user.name", "Void Test"]).await;
    git(dir, &["config", "user.email", "void-test@example.invalid"]).await;
    git(dir, &["config", "commit.gpgsign", "false"]).await;
}

/// Real Git repositories, no GitHub credentials or network involved.
#[tokio::test]
async fn offline_edits_diverge_and_both_versions_survive_reconnection() {
    let sandbox = Sandbox::new();
    let root = &sandbox.0;
    git(root, &["init", "--bare", "remote.git"]).await;
    git(root, &["clone", "remote.git", "device-a"]).await;
    let a = root.join("device-a");
    configure(&a).await;
    git(&a, &["checkout", "-b", "main"]).await;
    write_sync_file(&a, "note.md", "# Note
Shared line
").await.unwrap();
    git(&a, &["add", "note.md"]).await;
    git(&a, &["commit", "-m", "base"]).await;
    git(&a, &["push", "-u", "origin", "main"]).await;
    git(root, &["clone", "-b", "main", "remote.git", "device-b"]).await;
    let b = root.join("device-b");
    configure(&b).await;

    // Simulate an unavailable remote without changing OS networking.
    std::fs::rename(root.join("remote.git"), root.join("remote.offline")).unwrap();
    write_sync_file(&a, "note.md", "# Note
Device A offline text
").await.unwrap();
    git(&a, &["add", "note.md"]).await;
    git(&a, &["commit", "-m", "offline A"]).await;
    assert!(!run_git_outcome(&a, &args(&["fetch", "origin", "main"]), None).await.unwrap().success);
    assert_eq!(std::fs::read_to_string(a.join("note.md")).unwrap(), "# Note
Device A offline text
");

    write_sync_file(&b, "note.md", "# Note
Device B independent text
").await.unwrap();
    git(&b, &["add", "note.md"]).await;
    git(&b, &["commit", "-m", "offline B"]).await;
    std::fs::rename(root.join("remote.offline"), root.join("remote.git")).unwrap();
    git(&b, &["push", "origin", "main"]).await;
    git(&a, &["fetch", "origin", "main"]).await;
    git(&a, &["branch", "void-sync-recovery/test"]).await;
    assert!(!run_git_outcome(&a, &args(&["merge", "--no-commit", "origin/main"]), None).await.unwrap().success);

    let local = merge_stage_content(&a, 2, "note.md").await.unwrap().unwrap();
    let remote = merge_stage_content(&a, 3, "note.md").await.unwrap().unwrap();
    assert!(local.contains("Device A offline text"));
    assert!(remote.contains("Device B independent text"));
    write_sync_file(&a, "note-local.md", &local).await.unwrap();
    write_sync_file(&a, "note.md", &remote).await.unwrap();
    git(&a, &["add", "note.md", "note-local.md"]).await;
    git(&a, &["commit", "-m", "Keep both"]).await;
    git(&a, &["push", "origin", "main"]).await;
    git(&b, &["fetch", "origin", "main"]).await;
    git(&b, &["merge", "--ff-only", "origin/main"]).await;
    assert_eq!(std::fs::read_to_string(b.join("note-local.md")).unwrap(), local);
    assert_eq!(std::fs::read_to_string(b.join("note.md")).unwrap(), remote);
    assert!(git(&a, &["show", "void-sync-recovery/test:note.md"]).await.contains("Device A offline text"));
}

#[cfg(unix)]
#[tokio::test]
async fn sync_writes_do_not_follow_links_outside_the_workspace() {
    let sandbox = Sandbox::new();
    let workspace = sandbox.0.join("notes");
    std::fs::create_dir(&workspace).unwrap();
    let outside = sandbox.0.join("outside.md");
    std::fs::write(&outside, "keep me").unwrap();
    std::os::unix::fs::symlink(&outside, workspace.join("note.md")).unwrap();
    assert!(write_sync_file(&workspace, "note.md", "replacement").await.is_err());
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "keep me");
}

#[cfg(unix)]
#[tokio::test]
async fn failed_sync_write_preserves_the_original_file() {
    use std::os::unix::fs::PermissionsExt;
    let sandbox = Sandbox::new();
    let file = sandbox.0.join("note.md");
    std::fs::write(&file, "original").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o444)).unwrap();
    assert!(write_sync_file(&sandbox.0, "note.md", "replacement").await.is_err());
    assert_eq!(std::fs::read_to_string(file).unwrap(), "original");
}
