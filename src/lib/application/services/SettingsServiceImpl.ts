/**
 * SettingsServiceImpl - Application service for managing settings
 *
 * This is a use case implementation that orchestrates settings operations.
 * It depends ONLY on port interfaces, never on concrete adapters.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { SettingsService } from '$lib/ports/inbound';
import type { SettingsStoragePort } from '$lib/ports/outbound';
import { events } from '$lib/events';
import { ResourceLock } from '$lib/events/queue/ResourceLock';
import { DEFAULT_SETTINGS, type Settings, validateSettings } from '$lib/domain';
import type { Result } from '$lib/core';

export class SettingsServiceImpl implements SettingsService {
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly persistenceLock = new ResourceLock();

  // Compute updates only after earlier writes complete, so rapid changes to
  // different settings cannot overwrite each other with stale snapshots.
  private enqueue<T>(operation: () => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    return this.persistenceLock.withLock('settings', async () => {
      try {
        return await operation();
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error : new Error(String(error)) };
      }
    });
  }

  constructor(private storage: SettingsStoragePort) {}

  /**
   * Load settings from storage. Sanitises the loaded values through
   * `validateSettings` so consumers can trust ranges (font size, line
   * height, etc.) without re-checking.
   */
  async load(): Promise<Result<Settings, Error>> {
    return this.enqueue(async () => {
      const result = await this.storage.load();
      if (result.ok) {
        this.settings = validateSettings(result.value);
        events.emit('settings:loaded', this.settings);
        return { ok: true, value: this.settings };
      }
      return result;
    });
  }

  /**
   * Save entire settings object to storage. Validates before persistence.
   */
  async save(settings: Settings): Promise<Result<void, Error>> {
    return this.enqueue(async () => {
      const validated = validateSettings(settings);
      const result = await this.storage.save(validated);
      if (result.ok) {
        this.settings = validated;
      }
      return result;
    });
  }

  /**
   * Get a specific setting value from in-memory cache
   */
  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  /**
   * Set a specific setting value and persist immediately. Returns the
   * persistence Result so callers can react to disk errors.
   * Emits 'settings:changed' event only on success.
   */
  async set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Result<void, Error>> {
    return this.enqueue(async () => {
      const next = validateSettings({ ...this.settings, [key]: value });
      const result = await this.storage.save(next);
      if (result.ok) {
        this.settings = next;
        events.emit('settings:changed', { key, value: next[key] });
      }
      return result;
    });
  }

  /**
   * Get the current settings object from in-memory cache
   */
  current(): Settings {
    return this.settings;
  }

  /**
   * Reset settings to defaults and persist
   * Emits 'settings:loaded' event on success
   */
  async reset(): Promise<Result<Settings, Error>> {
    return this.enqueue(async () => {
      const result = await this.storage.save(DEFAULT_SETTINGS);
      if (result.ok) {
        this.settings = DEFAULT_SETTINGS;
        events.emit('settings:loaded', this.settings);
        return { ok: true, value: this.settings };
      }
      return { ok: false, error: result.error };
    });
  }
}
