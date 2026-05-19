/**
 * MemoryKeymapStorageAdapter - in-memory keymap storage.
 *
 * Used by the browser-only dev mode (`useMocks: true`) and by unit tests.
 * State is lost on reload; that's the intent.
 */

import type { KeymapStoragePort, KeymapOverrides } from '$lib/ports/outbound/KeymapStoragePort';
import { ok, type Result } from '$lib/core';

export class MemoryKeymapStorageAdapter implements KeymapStoragePort {
  private overrides: KeymapOverrides;

  constructor(initial: KeymapOverrides = {}) {
    this.overrides = { ...initial };
  }

  async loadOverrides(): Promise<Result<KeymapOverrides, Error>> {
    return ok({ ...this.overrides });
  }

  async saveOverrides(overrides: KeymapOverrides): Promise<Result<void, Error>> {
    this.overrides = { ...overrides };
    return ok(undefined);
  }
}
