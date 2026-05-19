/**
 * KeymapService - Inbound port for the application's keymap layer.
 *
 * Maps `KeyChord → commandId` resolution, scoped by a `ScopeSnapshot`.
 * Built once at app startup and kept in sync with the CommandService:
 * every command with a `defaultKeybinding` is auto-registered here.
 *
 * The service is pure — it does not touch the DOM. The `globalKeymapBinder`
 * primary adapter wires `window.keydown` events to `resolve()`.
 */

import type { Result } from '$lib/core';
import type { KeyChord } from '$lib/domain/values';
import type { ScopeSnapshot } from '$lib/domain/values/ScopeSnapshot';

// `Result` is referenced in this module's interface methods; keep the import.

/** A resolved binding: which chord triggers which command in which scopes. */
export interface KeyBinding {
  /** Command id this binding fires. */
  commandId: string;
  /** Active chord (override if set, otherwise default). */
  chord: KeyChord;
  /** Default chord shipped with the command. May differ from `chord` if user overrode. */
  defaultChord: KeyChord;
  /** Whether this is a user override of the default. */
  isOverride: boolean;
  /** Scopes in which this binding is active. Defaults to ['global']. */
  scope: string[];
  /** Tie-break priority across overlapping bindings. */
  priority: number;
}

/** A conflict between two commands sharing a chord in overlapping scopes. */
export interface KeyConflict {
  chord: KeyChord;
  bindings: KeyBinding[];
}

export interface KeymapService {
  /**
   * Register a command's default keybinding. Idempotent — re-registration
   * with a new default updates the default but preserves an existing user
   * override.
   */
  register(
    commandId: string,
    defaultChord: KeyChord,
    options?: { scope?: string[]; priority?: number }
  ): void;

  /** Remove a command from the keymap entirely (no default, no override). */
  unregister(commandId: string): void;

  /** Set a user override for a command. Pass NULL_CHORD to remove the binding. */
  setOverride(commandId: string, chord: KeyChord): Promise<Result<void, Error>>;

  /** Remove a user override; the default is restored. */
  clearOverride(commandId: string): Promise<Result<void, Error>>;

  /**
   * Resolve a chord against the current scope snapshot, returning the matching
   * commandId or null. Narrowest scope wins; ties broken by `priority` (higher
   * first), then by registration order.
   */
  resolve(chord: KeyChord, scope: ScopeSnapshot): string | null;

  /** All current bindings (defaults overlaid with overrides). */
  getBindings(): KeyBinding[];

  /** Detect chord conflicts between bindings with overlapping scopes. */
  findConflicts(): KeyConflict[];

  /** Subscribe to binding changes. Returns an unsubscribe function. */
  subscribe(callback: (bindings: KeyBinding[]) => void): () => void;

  /**
   * Load user overrides from storage. Idempotent — call once at boot.
   * Subsequent calls reload (useful for tests or live settings sync).
   */
  load(): Promise<Result<void, Error>>;

  /** Has the service finished loading user overrides from storage? */
  isReady(): boolean;
}
