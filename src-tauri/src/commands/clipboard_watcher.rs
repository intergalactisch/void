//! Clipboard watcher
//!
//! Polls the system clipboard for text changes while the app is running and
//! emits `void://clipboard-changed` events whenever a new value lands. The
//! frontend builds the history list from those events.
//!
//! Polling is the pragmatic approach: macOS has `NSPasteboard.changeCount`
//! and Linux/X11 has selection-changed, but cross-platform notifications via
//! `arboard` aren't available. A 500ms tick is invisible to humans and cheap.
//! We hash the previous value so identical reads don't re-emit.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use arboard::Clipboard;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL_MS: u64 = 500;
const MAX_TEXT_LEN: usize = 100_000; // 100 KB cap — anything bigger is probably not what the user wants in their history

/// Event payload emitted on clipboard change.
#[derive(Clone, Debug, Serialize)]
pub struct ClipboardChangedPayload {
    /// The new clipboard text value.
    pub text: String,
    /// Hash of the value, useful for de-dup on the frontend.
    pub hash: String,
    /// Approximate length in characters (clamped at MAX_TEXT_LEN).
    pub length: usize,
}

fn hash_text(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Spawn the clipboard watcher. Runs for the lifetime of the app.
///
/// Errors during initial clipboard creation log a warning and skip the
/// watcher rather than failing app startup — clipboard access can be
/// flaky on first launch (macOS permission prompts) and the rest of the
/// app should still come up.
pub fn start_clipboard_watcher(app: AppHandle) {
    let last_hash: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    std::thread::spawn(move || {
        // arboard::Clipboard isn't Send across threads on macOS in some
        // versions, so we create it inside the spawned thread. If creation
        // fails we abort silently; the user can restart to retry.
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(err) => {
                eprintln!("[clipboard-watcher] init failed: {err}");
                return;
            }
        };

        // Seed the hash with whatever's already on the clipboard so we
        // don't fire an event for content that pre-dates the watcher.
        if let Ok(initial) = clipboard.get_text() {
            *last_hash.lock().unwrap() = Some(hash_text(&initial));
        }

        loop {
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

            let text = match clipboard.get_text() {
                Ok(t) => t,
                Err(_) => continue, // empty / non-text clipboard
            };

            // Skip empty or whitespace-only values — they aren't useful
            // and tend to fire repeatedly when an app clears its selection.
            if text.trim().is_empty() {
                continue;
            }

            let truncated = if text.len() > MAX_TEXT_LEN {
                // Avoid splitting in the middle of a multi-byte UTF-8
                // character — round down to the nearest char boundary.
                let mut end = MAX_TEXT_LEN;
                while !text.is_char_boundary(end) && end > 0 {
                    end -= 1;
                }
                text[..end].to_string()
            } else {
                text
            };

            let hash = hash_text(&truncated);
            {
                let mut guard = last_hash.lock().unwrap();
                if guard.as_deref() == Some(hash.as_str()) {
                    continue;
                }
                *guard = Some(hash.clone());
            }

            let payload = ClipboardChangedPayload {
                length: truncated.chars().count(),
                hash,
                text: truncated,
            };
            if let Err(err) = app.emit("void://clipboard-changed", &payload) {
                eprintln!("[clipboard-watcher] emit failed: {err}");
            }
        }
    });
}
