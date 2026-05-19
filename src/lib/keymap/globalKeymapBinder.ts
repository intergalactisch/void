/**
 * Global keymap binder — the single window-level keydown listener.
 *
 * On every keydown event:
 *   1. Build a KeyChord from the event.
 *   2. Build a ScopeSnapshot from registered predicates.
 *   3. Ask KeymapService to resolve (chord, snapshot) → commandId.
 *   4. If a commandId resolves, call CommandService.executeById and prevent default.
 *
 * Editor boundary: ProseMirror keymap plugins fire FIRST and can call
 * `event.preventDefault()` / return `true` from a chained command. When that
 * happens, the editor "consumes" the keystroke and our handler still runs but
 * sees an event with `defaultPrevented === true` — we skip dispatch in that
 * case so we don't double-fire. Inputs and textareas are handled the same way.
 *
 * This is the only file in the codebase that calls
 * `window.addEventListener('keydown')` for the global keymap layer.
 */

import type { CommandService } from '$lib/ports/inbound/CommandService';
import type { KeymapService } from '$lib/ports/inbound/KeymapService';
import type { CommandContext } from '$lib/ports/outbound/CommandRegistryPort';
import { chordFromKeyboardEvent, detectPlatform, type Platform } from '$lib/domain/values/KeyChord';
import { buildScopeSnapshot } from './scopes';

export interface GlobalKeymapBinderOptions {
  keymap: KeymapService;
  commands: CommandService;
  /** Override for tests; defaults to platform detection. */
  platform?: Platform;
  /**
   * Optional per-event guard. Return `false` to skip dispatch entirely
   * (e.g., during a modal animation). Default: always dispatch.
   */
  shouldDispatch?: (event: KeyboardEvent) => boolean;
}

export interface GlobalKeymapBinder {
  /** Detach the keydown listener and stop dispatching. */
  dispose(): void;
}

/**
 * Attach the global keymap binder to `window`. Call from a top-level
 * onMount once bootstrap has resolved. Returns a binder with `dispose()`
 * for use in onDestroy.
 */
export function attachGlobalKeymapBinder(
  options: GlobalKeymapBinderOptions
): GlobalKeymapBinder {
  if (typeof window === 'undefined') {
    return { dispose: () => {} };
  }

  const platform = options.platform ?? detectPlatform();

  const handler = (event: KeyboardEvent) => {
    // Don't dispatch if the editor (or another handler) already consumed
    // the event. ProseMirror calls preventDefault on consumed shortcuts.
    if (event.defaultPrevented) return;

    if (options.shouldDispatch && !options.shouldDispatch(event)) return;

    const chord = chordFromKeyboardEvent(event, platform);
    if (!chord.key) return;

    const snapshot = buildScopeSnapshot();
    const commandId = options.keymap.resolve(chord, snapshot);
    if (!commandId) return;

    const context: CommandContext = {
      scope: snapshot,
    };

    event.preventDefault();
    event.stopPropagation();

    void options.commands.executeById(commandId, context).then((result) => {
      if (!result.ok) {
        // Failures are logged but never thrown; the keymap layer must not
        // surface execution errors to the user-facing keydown loop.
        console.warn(`[keymap] command "${commandId}" failed:`, result.error);
      }
    });
  };

  window.addEventListener('keydown', handler, { capture: false });

  return {
    dispose: () => {
      window.removeEventListener('keydown', handler, { capture: false });
    },
  };
}
