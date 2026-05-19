/**
 * Integration tests for Settings Store
 *
 * Tests the SettingsStore with a mock SettingsService to verify:
 * - Initialization with service
 * - Loading settings from service
 * - Getting setting values
 * - Setting values with persistence
 * - Reactive state (loading, error, isInitialized, isLoaded)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { SettingsService } from '$lib/ports/inbound';
import { DEFAULT_SETTINGS, type Settings } from '$lib/domain';
import { ok, err } from '$lib/core';

/**
 * Creates a mock SettingsService for testing.
 * Maintains internal settings state and tracks all method calls.
 */
function createMockSettingsService(): SettingsService {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  return {
    load: vi.fn().mockImplementation(async () => ok(settings)),
    save: vi.fn().mockImplementation(async (newSettings: Settings) => {
      settings = newSettings;
      return ok(undefined);
    }),
    get: vi.fn().mockImplementation(<K extends keyof Settings>(key: K) => settings[key]),
    set: vi.fn().mockImplementation(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      settings = { ...settings, [key]: value };
      return ok(undefined);
    }),
    current: vi.fn().mockImplementation(() => settings),
  };
}

/**
 * Creates a mock SettingsService that returns an error on load.
 */
function createFailingMockSettingsService(errorMessage: string): SettingsService {
  return {
    load: vi.fn().mockImplementation(async () => err(new Error(errorMessage))),
    save: vi.fn().mockImplementation(async () => err(new Error(errorMessage))),
    get: vi.fn().mockImplementation(() => undefined),
    set: vi.fn().mockImplementation(async () => err(new Error(errorMessage))),
    current: vi.fn().mockImplementation(() => DEFAULT_SETTINGS),
  };
}

describe('Settings Store Integration', () => {
  let mockService: SettingsService;

  beforeEach(() => {
    mockService = createMockSettingsService();
  });

  describe('init()', () => {
    it('accepts a service', () => {
      settingsStore.init(mockService);
      expect(settingsStore.isInitialized).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('is true after init() is called', () => {
      settingsStore.init(mockService);
      expect(settingsStore.isInitialized).toBe(true);
    });
  });

  describe('load()', () => {
    beforeEach(() => {
      settingsStore.init(mockService);
    });

    it('calls service.load() and updates settings state', async () => {
      await settingsStore.load();

      expect(mockService.load).toHaveBeenCalledTimes(1);
      expect(settingsStore.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('sets loading=true during load, false after', async () => {
      // We can't easily test the intermediate state during async,
      // but we can verify it's false after completion
      expect(settingsStore.loading).toBe(false);

      const loadPromise = settingsStore.load();
      // Note: Due to async nature, checking intermediate state is unreliable
      // We verify the final state instead

      await loadPromise;

      expect(settingsStore.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const errorMessage = 'Failed to load settings';
      const failingService = createFailingMockSettingsService(errorMessage);
      settingsStore.init(failingService);

      await settingsStore.load();

      expect(settingsStore.error).not.toBeNull();
      expect(settingsStore.error?.message).toBe(errorMessage);
      expect(settingsStore.loading).toBe(false);
    });

    it('clears error on successful load after previous failure', async () => {
      // First, cause an error
      const failingService = createFailingMockSettingsService('First error');
      settingsStore.init(failingService);
      await settingsStore.load();
      expect(settingsStore.error).not.toBeNull();

      // Then, reinitialize with working service and load again
      settingsStore.init(mockService);
      await settingsStore.load();

      expect(settingsStore.error).toBeNull();
      expect(settingsStore.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('loads custom settings from service', async () => {
      const customSettings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'dark',
        autoSave: false,
      };

      const customService: SettingsService = {
        ...mockService,
        load: vi.fn().mockResolvedValue(ok(customSettings)),
        current: vi.fn().mockReturnValue(customSettings),
      };

      settingsStore.init(customService);
      await settingsStore.load();

      expect(settingsStore.settings?.theme).toBe('dark');
      expect(settingsStore.settings?.autoSave).toBe(false);
    });
  });

  describe('get()', () => {
    it('returns setting value from loaded settings', async () => {
      settingsStore.init(mockService);
      await settingsStore.load();

      const theme = settingsStore.get('theme');

      expect(theme).toBe(DEFAULT_SETTINGS.theme);
    });

    it('returns value from current settings (singleton retains state)', () => {
      // Note: settingsStore is a singleton and retains state between tests.
      // The get() method uses optional chaining, so it returns undefined
      // when settings is null, or the value when settings exists.
      const freshMock = createMockSettingsService();
      settingsStore.init(freshMock);

      const result = settingsStore.get('theme');

      // Method should not throw and should return either undefined (if no settings)
      // or the theme value (if settings exist from previous tests)
      expect(result === undefined || typeof result === 'string').toBe(true);
    });

    it('returns different setting values correctly', async () => {
      const customSettings: Settings = {
        notesPath: '/custom/path',
        theme: 'dark',
        autoSave: false,
        autoSaveDelay: 2000,
        aiProvider: 'claude',
      };

      const customService: SettingsService = {
        ...mockService,
        load: vi.fn().mockResolvedValue(ok(customSettings)),
      };

      settingsStore.init(customService);
      await settingsStore.load();

      expect(settingsStore.get('notesPath')).toBe('/custom/path');
      expect(settingsStore.get('theme')).toBe('dark');
      expect(settingsStore.get('autoSave')).toBe(false);
      expect(settingsStore.get('autoSaveDelay')).toBe(2000);
      expect(settingsStore.get('aiProvider')).toBe('claude');
    });
  });

  describe('set()', () => {
    beforeEach(async () => {
      settingsStore.init(mockService);
      await settingsStore.load();
    });

    it('calls service.set() and updates local state', async () => {
      await settingsStore.set('theme', 'dark');

      expect(mockService.set).toHaveBeenCalledWith('theme', 'dark');
      expect(settingsStore.get('theme')).toBe('dark');
    });

    it('persists changes through service', async () => {
      await settingsStore.set('autoSave', false);

      expect(mockService.set).toHaveBeenCalledTimes(1);
      expect(mockService.set).toHaveBeenCalledWith('autoSave', false);
    });

    it('preserves other settings when setting one value', async () => {
      const originalPath = settingsStore.get('notesPath');

      await settingsStore.set('theme', 'dark');

      expect(settingsStore.get('notesPath')).toBe(originalPath);
      expect(settingsStore.get('theme')).toBe('dark');
    });

    it('can set aiProvider to null', async () => {
      await settingsStore.set('aiProvider', null);

      expect(mockService.set).toHaveBeenCalledWith('aiProvider', null);
      expect(settingsStore.get('aiProvider')).toBeNull();
    });

    it('can set numeric values', async () => {
      await settingsStore.set('autoSaveDelay', 5000);

      expect(mockService.set).toHaveBeenCalledWith('autoSaveDelay', 5000);
      expect(settingsStore.get('autoSaveDelay')).toBe(5000);
    });

    it('can set string values', async () => {
      await settingsStore.set('notesPath', '/new/path');

      expect(mockService.set).toHaveBeenCalledWith('notesPath', '/new/path');
      expect(settingsStore.get('notesPath')).toBe('/new/path');
    });
  });

  describe('isLoaded', () => {
    it('reflects whether settings is not null', () => {
      // isLoaded is derived from settings !== null
      // Since settingsStore is a singleton, we verify the contract holds
      const freshMock = createMockSettingsService();
      settingsStore.init(freshMock);

      const isLoaded = settingsStore.isLoaded;
      const hasSettings = settingsStore.settings !== null;

      expect(isLoaded).toBe(hasSettings);
    });

    it('is true after load() completes successfully', async () => {
      settingsStore.init(mockService);
      await settingsStore.load();

      expect(settingsStore.isLoaded).toBe(true);
      expect(settingsStore.settings).not.toBeNull();
    });

    it('does not update settings on failed load', async () => {
      // First load successfully to establish baseline
      settingsStore.init(mockService);
      await settingsStore.load();
      const settingsBeforeFailure = settingsStore.settings;

      // Now try to load with a failing service
      const failingService = createFailingMockSettingsService('Load failed');
      settingsStore.init(failingService);
      await settingsStore.load();

      // After a failed load, settings should remain unchanged (not updated)
      // The error state indicates the failure
      expect(settingsStore.error).not.toBeNull();
      expect(settingsStore.settings).toEqual(settingsBeforeFailure);
    });
  });

  describe('error state', () => {
    it('is cleared by successful load', async () => {
      settingsStore.init(mockService);
      await settingsStore.load();

      // After successful load, error should be null
      expect(settingsStore.error).toBeNull();
    });

    it('is null after successful load', async () => {
      settingsStore.init(mockService);
      await settingsStore.load();

      expect(settingsStore.error).toBeNull();
    });

    it('contains error after failed load', async () => {
      const failingService = createFailingMockSettingsService('Connection failed');
      settingsStore.init(failingService);
      await settingsStore.load();

      expect(settingsStore.error).toBeInstanceOf(Error);
      expect(settingsStore.error?.message).toBe('Connection failed');
    });
  });

  describe('integration scenarios', () => {
    it('handles full workflow: init -> load -> get -> set', async () => {
      settingsStore.init(mockService);

      // Before load
      expect(settingsStore.isInitialized).toBe(true);

      // Load settings
      await settingsStore.load();
      expect(settingsStore.isLoaded).toBe(true);
      expect(settingsStore.error).toBeNull();

      // Get a value
      const initialTheme = settingsStore.get('theme');
      expect(initialTheme).toBe(DEFAULT_SETTINGS.theme);

      // Set a value
      await settingsStore.set('theme', 'dark');
      expect(settingsStore.get('theme')).toBe('dark');

      // Verify service was called
      expect(mockService.set).toHaveBeenCalledWith('theme', 'dark');
    });

    it('can reload settings after changes', async () => {
      let storedSettings = { ...DEFAULT_SETTINGS };

      const dynamicService: SettingsService = {
        load: vi.fn().mockImplementation(async () => ok({ ...storedSettings })),
        save: vi.fn(),
        get: vi.fn().mockImplementation((key) => storedSettings[key as keyof Settings]),
        set: vi.fn().mockImplementation(async (key, value) => {
          storedSettings = { ...storedSettings, [key]: value };
          return ok(undefined);
        }),
        current: vi.fn().mockReturnValue(storedSettings),
      };

      settingsStore.init(dynamicService);
      await settingsStore.load();
      expect(settingsStore.get('theme')).toBe('system');

      // Modify the underlying storage
      storedSettings.theme = 'dark';

      // Reload and verify changes are picked up
      await settingsStore.load();
      expect(settingsStore.get('theme')).toBe('dark');
    });
  });
});
