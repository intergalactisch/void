mod commands;
mod error;
mod window_placement;

use commands::{
    cancel_cli_process, check_cli_available, create_directory, delete_credential, delete_file,
    file_exists, get_active_process_count, get_active_processes, get_credential, get_settings,
    get_settings_path, git_abort_merge, git_begin_merge, git_build_divergence_conflict,
    git_commit_all, git_commit_merge, git_create_branch, git_create_recovery_branch, git_detect,
    git_ensure_artifact_policy, git_fetch, git_init, git_is_merge_in_progress,
    git_list_local_branches, git_list_merge_conflicts, git_pull_ff, git_push, git_read_merge_file,
    git_read_remote_file, git_set_remote, git_stage_paths, git_switch_branch,
    git_write_working_file, github_begin_device_auth, github_check_repo_name,
    github_complete_device_auth, github_create_repo, github_get_repository, github_get_void_ready,
    github_list_branches, github_list_repositories, github_revoke_token, github_validate_token, has_credential,
    list_directory, read_file, remove_directory, rename_path, run_cli_prompt, save_settings,
    spawn_cli_process, start_clipboard_watcher, store_credential, unwatch_all, unwatch_directory,
    void_append_jsonl, void_append_provenance, void_ensure_dir, void_list_dir, void_read_json,
    void_read_jsonl, void_read_provenance, void_write_json, watch_directory, web_fetch, write_file,
    ProcessRegistry, WatcherRegistry,
};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{menu::MenuBuilder, tray::TrayIconBuilder, Emitter, Manager};
use window_placement::{restore_or_center_main_window, save_window_placement};

const MAIN_WINDOW_LABEL: &str = "main";
const MENU_BAR_EVENT: &str = "void:menu-command";

const MENU_NEW_NOTE: &str = "void-menu-new-note";
const MENU_OPEN_SEARCH: &str = "void-menu-open-search";
const MENU_ASK_VOID: &str = "void-menu-ask-void";
const MENU_OPEN_TASKS: &str = "void-menu-open-tasks";
const MENU_SHOW_VOID: &str = "void-menu-show-void";
const MENU_HIDE_WINDOW: &str = "void-menu-hide-window";
const MENU_OPEN_SETTINGS: &str = "void-menu-open-settings";
const MENU_CHECK_UPDATES: &str = "void-menu-check-updates";
const MENU_QUIT: &str = "void-menu-quit";
const WINDOW_PLACEMENT_SAVE_GRACE_PERIOD: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
struct MenuCommandPayload {
    command: &'static str,
}

fn setup_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        restore_or_center_main_window(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn save_main_window_placement(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        save_window_placement(&window);
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn emit_menu_command(app: &tauri::AppHandle, command: &'static str) {
    show_main_window(app);
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        MENU_BAR_EVENT,
        MenuCommandPayload { command },
    );
}

fn handle_menu_event(app: &tauri::AppHandle, menu_id: &str) {
    match menu_id {
        MENU_NEW_NOTE => emit_menu_command(app, "new-note"),
        MENU_OPEN_SEARCH => emit_menu_command(app, "open-search"),
        MENU_ASK_VOID => emit_menu_command(app, "ask-void"),
        MENU_OPEN_TASKS => emit_menu_command(app, "open-tasks"),
        MENU_SHOW_VOID => show_main_window(app),
        MENU_HIDE_WINDOW => hide_main_window(app),
        MENU_OPEN_SETTINGS => emit_menu_command(app, "open-settings"),
        MENU_CHECK_UPDATES => emit_menu_command(app, "check-updates"),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn setup_menu_bar(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_NEW_NOTE, "New Note")
        .text(MENU_OPEN_SEARCH, "Open/Search Notes")
        .text(MENU_ASK_VOID, "Ask Void")
        .text(MENU_OPEN_TASKS, "Tasks")
        .separator()
        .text(MENU_SHOW_VOID, "Show Void")
        .text(MENU_HIDE_WINDOW, "Hide Window")
        .separator()
        .text(MENU_OPEN_SETTINGS, "Settings")
        .text(MENU_CHECK_UPDATES, "Check for Updates…")
        .separator()
        .text(MENU_QUIT, "Quit Void")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("void-menu-bar")
        .menu(&menu)
        .tooltip("Void")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        });

    if let Ok(icon) =
        tauri::image::Image::from_bytes(include_bytes!("../icons/menu-bar.png"))
    {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ProcessRegistry::default())
        .manage(WatcherRegistry::default())
        .setup(|app| {
            setup_menu_bar(app)?;
            setup_main_window(app.handle());
            // Background clipboard watcher: emits void://clipboard-changed
            // events so the frontend can build a history list.
            start_clipboard_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Original command
            greet,
            // File commands
            read_file,
            write_file,
            delete_file,
            list_directory,
            file_exists,
            create_directory,
            remove_directory,
            rename_path,
            // Settings commands
            get_settings,
            save_settings,
            get_settings_path,
            // GitHub sync commands
            git_detect,
            git_init,
            git_ensure_artifact_policy,
            git_set_remote,
            git_commit_all,
            git_fetch,
            git_pull_ff,
            git_push,
            git_read_remote_file,
            git_build_divergence_conflict,
            git_create_recovery_branch,
            git_begin_merge,
            git_list_merge_conflicts,
            git_read_merge_file,
            git_write_working_file,
            git_stage_paths,
            git_commit_merge,
            git_abort_merge,
            git_is_merge_in_progress,
            git_list_local_branches,
            git_create_branch,
            git_switch_branch,
            github_validate_token,
            github_create_repo,
            github_begin_device_auth,
            github_complete_device_auth,
            github_list_repositories,
            github_get_repository,
            github_get_void_ready,
            github_list_branches,
            github_check_repo_name,
            github_revoke_token,
            // Credential commands
            store_credential,
            get_credential,
            delete_credential,
            has_credential,
            // CLI AI commands
            check_cli_available,
            run_cli_prompt,
            // Process manager commands
            spawn_cli_process,
            cancel_cli_process,
            get_active_processes,
            get_active_process_count,
            // Void storage commands
            void_ensure_dir,
            void_append_provenance,
            void_read_provenance,
            void_write_json,
            void_read_json,
            void_append_jsonl,
            void_read_jsonl,
            void_list_dir,
            web_fetch,
            // File watcher commands
            watch_directory,
            unwatch_directory,
            unwatch_all,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let save_window_placement_after = Instant::now() + WINDOW_PLACEMENT_SAVE_GRACE_PERIOD;

    app.run(move |app, event| {
        if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
            if label == MAIN_WINDOW_LABEL {
                match event {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                        if Instant::now() >= save_window_placement_after =>
                    {
                        save_main_window_placement(app);
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        hide_main_window(app);
                    }
                    _ => {}
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        }
    });
}
