/**
 * captureWindowManager — primary adapter wiring the OS-level global shortcut
 * (via `tauri-plugin-global-shortcut`) and the secondary `capture` Tauri
 * window. The rest of the app talks to a tiny interface so the
 * `capture.open` command, the Settings UI, and the bootstrap event
 * listener don't depend on Tauri APIs directly.
 *
 * Failure mode: registration failures (chord conflict, missing
 * accessibility permission) log a warning and degrade — the rest of the
 * app must come up. Same posture as the clipboard watcher.
 */

import {
  register,
  unregister,
  isRegistered,
} from '@tauri-apps/plugin-global-shortcut';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { parseChord, type KeyChord } from '$lib/domain';
import { getLogger } from '$lib/logging';

const log = getLogger('CaptureWindowManager');

const CAPTURE_WINDOW_LABEL = 'capture';
const CAPTURE_PREFILL_EVENT = 'void://capture-prefill';

export interface CaptureWindowManager {
  /**
   * Show the capture window. Sends a prefill event with the current default
   * target so the new window seeds its state without round-tripping the
   * settings adapter.
   */
  showCapture(defaultTarget: 'inbox' | 'daily'): Promise<void>;
  /**
   * Apply a new shortcut from settings. Re-registers if the chord changed;
   * if only the default target changed it skips the OS round-trip. Empty
   * chord string disables the global shortcut. Idempotent and safe to call
   * repeatedly.
   */
  applyShortcut(serializedChord: string, defaultTarget: 'inbox' | 'daily'): Promise<void>;
  /** Tear down: unregister the current shortcut. */
  dispose(): Promise<void>;
}

/** No-op implementation used in browser dev / tests. */
export class NoopCaptureWindowManager implements CaptureWindowManager {
  async showCapture(): Promise<void> {
    log.debug('showCapture noop');
  }
  async applyShortcut(): Promise<void> {
    log.debug('applyShortcut noop');
  }
  async dispose(): Promise<void> {
    log.debug('dispose noop');
  }
}

export class TauriCaptureWindowManager implements CaptureWindowManager {
  private currentAccelerator: string | null = null;
  /** Last-applied chord in serialized form — for change detection. */
  private currentSerializedChord = '';
  /** Latest defaultTarget — used by the global-shortcut callback. */
  private currentDefaultTarget: 'inbox' | 'daily' = 'inbox';

  async showCapture(defaultTarget: 'inbox' | 'daily'): Promise<void> {
    this.currentDefaultTarget = defaultTarget;
    try {
      // Emit the prefill BEFORE showing — if the capture window was already
      // open on stale state, this resets it; if it's about to open for the
      // first time, the event is buffered and replayed on listen() (Tauri
      // 2 events are fire-and-forget but the capture window listens
      // before declaring itself ready, so this is fine for our flow).
      await emit(CAPTURE_PREFILL_EVENT, { defaultTarget });

      const win = await WebviewWindow.getByLabel(CAPTURE_WINDOW_LABEL);
      if (!win) {
        log.error('capture window not found in app config; skipping show');
        return;
      }
      await win.show();
      await win.setFocus();
    } catch (err) {
      log.error('showCapture failed', { error: String(err) });
    }
  }

  async applyShortcut(
    serializedChord: string,
    defaultTarget: 'inbox' | 'daily',
  ): Promise<void> {
    this.currentDefaultTarget = defaultTarget;

    // No-op if the chord hasn't changed — only the target was updated.
    if (serializedChord === this.currentSerializedChord) {
      return;
    }
    this.currentSerializedChord = serializedChord;

    // Unregister whatever is currently bound, if anything.
    if (this.currentAccelerator) {
      try {
        const stillRegistered = await isRegistered(this.currentAccelerator);
        if (stillRegistered) {
          await unregister(this.currentAccelerator);
        }
      } catch (err) {
        log.warn('failed to unregister previous shortcut', {
          accelerator: this.currentAccelerator,
          error: String(err),
        });
      }
      this.currentAccelerator = null;
    }

    if (!serializedChord) {
      log.info('global capture shortcut disabled (empty)');
      return;
    }

    const chord = parseChord(serializedChord);
    if (!chord.key) {
      log.warn('failed to parse capture shortcut; leaving disabled', {
        chord: serializedChord,
      });
      return;
    }

    const accelerator = chordToTauriAccelerator(chord);

    try {
      const already = await isRegistered(accelerator);
      if (already) {
        // Some other component (or a previous instance) holds it; skip rather
        // than fight for it. User will see the warning in the log.
        log.warn('shortcut already registered by another holder; skipping', {
          accelerator,
        });
        return;
      }
      await register(accelerator, (event) => {
        // ShortcutEvent fires twice (Pressed + Released); only react once.
        if (event.state !== 'Pressed') return;
        void this.showCapture(this.currentDefaultTarget);
      });
      this.currentAccelerator = accelerator;
      log.info('global capture shortcut registered', { accelerator });
    } catch (err) {
      // Common causes: chord conflict, missing macOS Accessibility
      // permission. Log and let the rest of the app continue.
      log.warn('failed to register capture shortcut', {
        accelerator,
        error: String(err),
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.currentAccelerator) {
      try {
        await unregister(this.currentAccelerator);
      } catch (err) {
        log.warn('failed to unregister shortcut on dispose', {
          accelerator: this.currentAccelerator,
          error: String(err),
        });
      }
      this.currentAccelerator = null;
    }
  }
}

/**
 * Convert our `KeyChord` representation (lowercase, `mod`/`shift`/`alt`/`ctrl`
 * flags) to the Tauri `Accelerator` string format expected by
 * `@tauri-apps/plugin-global-shortcut`.
 *
 * Mapping:
 *   - `mod`  → `CommandOrControl` (Cmd on macOS, Ctrl elsewhere)
 *   - `ctrl` (when distinct from mod, i.e. on macOS) → `Control`
 *   - `alt`  → `Alt`
 *   - `shift` → `Shift`
 *   - key:
 *     - `' '` (space) → `Space`
 *     - single chars → uppercased
 *     - named keys → title-cased (e.g. `enter` → `Enter`, `escape` → `Escape`)
 *     - arrow keys → `ArrowUp` / `ArrowDown` / etc. (Tauri accepts these)
 */
export function chordToTauriAccelerator(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push('CommandOrControl');
  // On macOS the user can use literal Ctrl alongside Cmd. Off-mac, parseChord
  // collapses ctrl into mod, so this branch only fires for explicit mac ctrl.
  if (chord.ctrl && !chord.mod) parts.push('Control');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(formatKeyForAccelerator(chord.key));
  return parts.join('+');
}

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  enter: 'Enter',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  comma: ',',
  period: '.',
};

function formatKeyForAccelerator(key: string): string {
  if (!key) return '';
  const named = NAMED_KEYS[key];
  if (named !== undefined) return named;
  // Function keys: f1..f24 → F1..F24
  const fnMatch = /^f(\d+)$/i.exec(key);
  if (fnMatch) return `F${fnMatch[1]}`;
  if (key.length === 1) return key.toUpperCase();
  // Multi-char: title-case as a best-effort fallback.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

