/**
 * MemorySettingsAdapter - In-memory implementation of SettingsStoragePort
 *
 * This adapter stores settings in memory, enabling testing without Tauri.
 * Part of the Hexagonal Architecture - implements the SettingsStoragePort interface.
 *
 * Use Cases:
 * - Unit testing services that depend on SettingsStoragePort
 * - Browser-only development mode
 * - Storybook component development
 */

import { ok, type Result } from '$lib/core';
import type { SettingsStoragePort } from '$lib/ports/outbound';
import { DEFAULT_SETTINGS, type Settings } from '$lib/domain';

export class MemorySettingsAdapter implements SettingsStoragePort {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly storagePath: string;

  constructor(initialSettings?: Partial<Settings>) {
    if (initialSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...initialSettings };
    }
    this.storagePath = '/memory/settings.json';
  }

  async load(): Promise<Result<Settings, Error>> {
    // Return a copy to prevent external mutation
    return ok({ ...this.settings });
  }

  async save(settings: Settings): Promise<Result<void, Error>> {
    // Store a copy to prevent external mutation
    this.settings = { ...settings };
    return ok(undefined);
  }

  async getPath(): Promise<string> {
    return this.storagePath;
  }

  // --- Testing utilities ---

  /**
   * Reset settings to default values.
   */
  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * Get current settings directly (for testing assertions).
   */
  getCurrent(): Settings {
    return { ...this.settings };
  }

  /**
   * Set settings directly without going through save().
   * Useful for setting up test fixtures.
   */
  seed(settings: Partial<Settings>): void {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }
}
