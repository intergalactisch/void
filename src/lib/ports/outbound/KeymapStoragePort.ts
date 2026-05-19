/**
 * KeymapStoragePort - Outbound port for persisting user keybinding overrides.
 *
 * The application layer depends on this interface; concrete adapters
 * (settings-backed or in-memory) implement it.
 *
 * Wire format: a flat record `{ commandId: serializedChord }`. Empty string
 * means "no binding" (user explicitly cleared the default). Missing keys
 * mean "use the default".
 */

import type { Result } from '$lib/core';

/** Persisted user overrides: commandId → serialized chord (e.g. 'mod+shift+f'). */
export type KeymapOverrides = Record<string, string>;

export interface KeymapStoragePort {
  /** Load all user-defined overrides. */
  loadOverrides(): Promise<Result<KeymapOverrides, Error>>;

  /** Persist all user-defined overrides. */
  saveOverrides(overrides: KeymapOverrides): Promise<Result<void, Error>>;
}
