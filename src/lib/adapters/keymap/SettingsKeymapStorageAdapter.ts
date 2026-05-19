/**
 * SettingsKeymapStorageAdapter - persists keymap overrides via SettingsService.
 *
 * Reads/writes the `keymapOverrides` field on the canonical Settings entity,
 * so user keybinding edits round-trip through the same store as every other
 * preference and survive across sessions.
 */

import type { KeymapStoragePort, KeymapOverrides } from '$lib/ports/outbound/KeymapStoragePort';
import type { SettingsService } from '$lib/ports/inbound/SettingsService';
import { ok, err, type Result } from '$lib/core';

export class SettingsKeymapStorageAdapter implements KeymapStoragePort {
  constructor(private readonly settings: SettingsService) {}

  async loadOverrides(): Promise<Result<KeymapOverrides, Error>> {
    try {
      const overrides = this.settings.get('keymapOverrides') ?? {};
      return ok({ ...overrides });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async saveOverrides(overrides: KeymapOverrides): Promise<Result<void, Error>> {
    return this.settings.set('keymapOverrides', { ...overrides });
  }
}
