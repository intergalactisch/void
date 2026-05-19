/**
 * Settings Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the SettingsService application service.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import type { SettingsService } from '$lib/ports/inbound';
import type { Settings } from '$lib/domain';

class SettingsStore {
  #service: SettingsService | null = null;
  settings = $state<Settings | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  /**
   * Initialize the store with a SettingsService instance.
   * Must be called before using any other methods.
   */
  init(service: SettingsService) {
    this.#service = service;
  }

  /**
   * Load settings from the service.
   * Updates reactive state with loading/error/settings.
   */
  async load() {
    if (!this.#service) throw new Error('SettingsStore not initialized');
    this.loading = true;
    this.error = null;

    const result = await this.#service.load();
    if (result.ok) {
      this.settings = result.value;
    } else {
      this.error = result.error;
    }
    this.loading = false;
  }

  /**
   * Get a specific setting value from the current settings.
   * Returns undefined if settings are not loaded.
   */
  get<K extends keyof Settings>(key: K): Settings[K] | undefined {
    return this.settings?.[key];
  }

  /**
   * Set a specific setting value.
   * Persists via service and updates local state. Returns true on
   * success, false if persistence failed (the local state is left
   * untouched in that case so the UI can re-render with the old value).
   */
  async set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean> {
    if (!this.#service || !this.settings) return false;
    const result = await this.#service.set(key, value);
    if (!result.ok) return false;
    this.settings = { ...this.settings, [key]: value };
    return true;
  }

  /**
   * Check if the store has been initialized with a service.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if settings are loaded.
   */
  get isLoaded(): boolean {
    return this.settings !== null;
  }

  /**
   * Reset settings to defaults.
   * Persists via service and updates local state.
   */
  async reset(): Promise<boolean> {
    if (!this.#service) throw new Error('SettingsStore not initialized');
    this.loading = true;
    this.error = null;

    const result = await this.#service.reset();
    if (result.ok) {
      this.settings = result.value;
      this.loading = false;
      return true;
    } else {
      this.error = result.error;
      this.loading = false;
      return false;
    }
  }
}

export const settingsStore = new SettingsStore();
