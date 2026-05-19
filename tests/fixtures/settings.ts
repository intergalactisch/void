/**
 * Settings fixtures for testing
 */
import type { Settings } from '$lib/domain/entities/Settings';
import { DEFAULT_SETTINGS } from '$lib/domain/entities/Settings';

export function createTestSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    theme: 'system',
    fontSize: 16,
    notesPath: '/test/notes',
    autoSave: true,
    ...overrides,
  };
}

export function createDarkThemeSettings(): Settings {
  return createTestSettings({ theme: 'dark' });
}

export function createLightThemeSettings(): Settings {
  return createTestSettings({ theme: 'light' });
}

export function createNoAutoSaveSettings(): Settings {
  return createTestSettings({ autoSave: false });
}
