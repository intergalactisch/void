/**
 * TauriSettingsAdapter - Secondary adapter for settings persistence
 *
 * Implements SettingsStoragePort using Tauri's settings commands.
 * Part of the Hexagonal Architecture - this adapter translates between
 * the domain's SettingsStoragePort interface and Tauri's infrastructure.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { Settings } from '$lib/domain';
import type { SettingsStoragePort } from '$lib/ports/outbound';
import { settingsCommands } from './commands';

export class TauriSettingsAdapter implements SettingsStoragePort {
  /**
   * Load settings from storage
   * Returns default settings if none exist yet
   */
  async load(): Promise<Result<Settings, Error>> {
    try {
      const settings = await settingsCommands.getSettings();
      return ok(settings);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Save settings to storage
   */
  async save(settings: Settings): Promise<Result<void, Error>> {
    try {
      await settingsCommands.saveSettings(settings);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Get the path where settings are stored
   */
  async getPath(): Promise<string> {
    return await settingsCommands.getSettingsPath();
  }
}
