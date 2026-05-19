/**
 * SettingsStoragePort - Outbound port for settings persistence.
 *
 * This interface defines the contract for storing and retrieving settings.
 * Part of the Hexagonal Architecture - adapters implement this interface.
 *
 * Implementations:
 * - TauriSettingsAdapter: Persists to disk via Tauri
 * - MemorySettingsAdapter: In-memory for testing
 */

import type { Result } from '$lib/core';
import type { Settings } from '$lib/domain';

export interface SettingsStoragePort {
  /**
   * Load settings from storage
   * @returns Loaded settings or error if loading fails
   */
  load(): Promise<Result<Settings, Error>>;

  /**
   * Save settings to storage
   * @param settings - Settings object to persist
   * @returns Success or error if saving fails
   */
  save(settings: Settings): Promise<Result<void, Error>>;

  /**
   * Get the path where settings are stored
   * @returns Absolute path to the settings file
   */
  getPath(): Promise<string>;
}
