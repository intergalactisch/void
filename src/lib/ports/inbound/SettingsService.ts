/**
 * Settings Service - Inbound Port
 *
 * This interface defines the application API for managing settings.
 * Components and stores depend on this interface, NOT on concrete implementations.
 *
 * Part of Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { Settings } from '$lib/domain';

export interface SettingsService {
  /**
   * Load settings from storage
   */
  load(): Promise<Result<Settings, Error>>;

  /**
   * Save entire settings object to storage
   */
  save(settings: Settings): Promise<Result<void, Error>>;

  /**
   * Get a specific setting value (from in-memory cache)
   */
  get<K extends keyof Settings>(key: K): Settings[K];

  /**
   * Set a specific setting value (persists immediately).
   * Returns the persistence result so callers can react to disk failures.
   */
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Result<void, Error>>;

  /**
   * Get the current settings object (in-memory)
   */
  current(): Settings;

  /**
   * Reset settings to defaults and persist
   */
  reset(): Promise<Result<Settings, Error>>;
}
