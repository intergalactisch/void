/**
 * Unit tests for SettingsServiceImpl
 *
 * Tests for the settings service implementation, verifying:
 * - Loading settings from storage
 * - Saving settings to storage
 * - Getting individual settings from cache
 * - Setting individual settings with persistence
 * - Event emissions for settings:loaded and settings:changed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mitt from 'mitt';
import type { EventMap } from '$lib/events/types';
import { MemorySettingsAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl } from '$lib/application/services';
import { DEFAULT_SETTINGS, type Settings } from '$lib/domain';

// Mock the events module
vi.mock('$lib/events', () => {
  const mockEvents = mitt<EventMap>();
  return { events: mockEvents };
});

// Import the mocked events for testing
import { events } from '$lib/events';

describe('SettingsServiceImpl', () => {
  let adapter: MemorySettingsAdapter;
  let service: SettingsServiceImpl;

  beforeEach(() => {
    adapter = new MemorySettingsAdapter();
    service = new SettingsServiceImpl(adapter);
    // Clear all event listeners between tests
    events.all.clear();
  });

  afterEach(() => {
    events.all.clear();
    vi.clearAllMocks();
  });

  describe('load()', () => {
    it('loads settings from storage', async () => {
      const result = await service.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(DEFAULT_SETTINGS);
      }
    });

    it('loads custom settings from storage', async () => {
      adapter.seed({ theme: 'dark', fontSize: 18 });

      const result = await service.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.theme).toBe('dark');
        expect(result.value.fontSize).toBe(18);
      }
    });

    it('emits settings:loaded event on success', async () => {
      const handler = vi.fn();
      events.on('settings:loaded', handler);

      await service.load();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });

    it('emits settings:loaded with correct settings data', async () => {
      adapter.seed({ theme: 'dark', autoSave: false });
      const handler = vi.fn();
      events.on('settings:loaded', handler);

      await service.load();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'dark',
          autoSave: false,
        })
      );
    });

    it('updates internal cache after load', async () => {
      adapter.seed({ theme: 'dark' });

      await service.load();
      const current = service.current();

      expect(current.theme).toBe('dark');
    });
  });

  describe('save()', () => {
    it('persists settings to storage', async () => {
      const newSettings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'dark',
        fontSize: 20,
      };

      const result = await service.save(newSettings);

      expect(result.ok).toBe(true);
      expect(adapter.getCurrent().theme).toBe('dark');
      expect(adapter.getCurrent().fontSize).toBe(20);
    });

    it('updates internal cache after save', async () => {
      const newSettings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'light',
        autoSaveDelay: 2000,
      };

      await service.save(newSettings);
      const current = service.current();

      expect(current.theme).toBe('light');
      expect(current.autoSaveDelay).toBe(2000);
    });

    it('returns success result on successful save', async () => {
      const result = await service.save(DEFAULT_SETTINGS);

      expect(result.ok).toBe(true);
    });

    it('does not emit events', async () => {
      const loadedHandler = vi.fn();
      const changedHandler = vi.fn();
      events.on('settings:loaded', loadedHandler);
      events.on('settings:changed', changedHandler);

      await service.save(DEFAULT_SETTINGS);

      expect(loadedHandler).not.toHaveBeenCalled();
      expect(changedHandler).not.toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('returns specific setting from cache', async () => {
      await service.load();

      const theme = service.get('theme');

      expect(theme).toBe(DEFAULT_SETTINGS.theme);
    });

    it('returns correct values for different settings', async () => {
      adapter.seed({
        theme: 'dark',
        autoSave: false,
        autoSaveDelay: 5000,
        aiProvider: 'claude',
      });
      await service.load();

      expect(service.get('theme')).toBe('dark');
      expect(service.get('autoSave')).toBe(false);
      expect(service.get('autoSaveDelay')).toBe(5000);
      expect(service.get('aiProvider')).toBe('claude');
    });

    it('returns default values before load is called', () => {
      // Service starts with DEFAULT_SETTINGS in cache
      expect(service.get('theme')).toBe(DEFAULT_SETTINGS.theme);
      expect(service.get('notesPath')).toBe(DEFAULT_SETTINGS.notesPath);
    });

    it('reflects changes after set() is called', async () => {
      await service.load();
      await service.set('theme', 'dark');

      expect(service.get('theme')).toBe('dark');
    });
  });

  describe('set()', () => {
    it('updates specific setting and persists', async () => {
      await service.load();

      await service.set('theme', 'dark');

      expect(service.get('theme')).toBe('dark');
      expect(adapter.getCurrent().theme).toBe('dark');
    });

    it('emits settings:changed event', async () => {
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('theme', 'dark');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
    });

    it('emits correct payload for different settings', async () => {
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('autoSaveDelay', 3000);

      expect(handler).toHaveBeenCalledWith({
        key: 'autoSaveDelay',
        value: 3000,
      });
    });

    it('preserves other settings when setting one value', async () => {
      adapter.seed({ theme: 'dark', autoSave: false });
      await service.load();

      await service.set('autoSaveDelay', 5000);

      expect(service.get('theme')).toBe('dark');
      expect(service.get('autoSave')).toBe(false);
      expect(service.get('autoSaveDelay')).toBe(5000);
    });

    it('can set aiProvider to null', async () => {
      adapter.seed({ aiProvider: 'claude' });
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('aiProvider', null);

      expect(service.get('aiProvider')).toBeNull();
      expect(handler).toHaveBeenCalledWith({ key: 'aiProvider', value: null });
    });

    it('can set boolean values', async () => {
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('autoSave', false);

      expect(service.get('autoSave')).toBe(false);
      expect(handler).toHaveBeenCalledWith({ key: 'autoSave', value: false });
    });

    it('can set string values', async () => {
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('notesPath', '/custom/path');

      expect(service.get('notesPath')).toBe('/custom/path');
      expect(handler).toHaveBeenCalledWith({
        key: 'notesPath',
        value: '/custom/path',
      });
    });
  });

  describe('current()', () => {
    it('returns all settings from cache', async () => {
      await service.load();

      const current = service.current();

      expect(current).toEqual(DEFAULT_SETTINGS);
    });

    it('returns updated settings after modifications', async () => {
      adapter.seed({ theme: 'dark', fontSize: 16 });
      await service.load();

      const current = service.current();

      expect(current.theme).toBe('dark');
      expect(current.fontSize).toBe(16);
    });

    it('reflects changes made via set()', async () => {
      await service.load();
      await service.set('theme', 'light');
      await service.set('autoSave', false);

      const current = service.current();

      expect(current.theme).toBe('light');
      expect(current.autoSave).toBe(false);
    });

    it('reflects changes made via save()', async () => {
      const newSettings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'dark',
        aiProvider: 'openai',
      };
      await service.save(newSettings);

      const current = service.current();

      expect(current.theme).toBe('dark');
      expect(current.aiProvider).toBe('openai');
    });

    it('returns default settings before load is called', () => {
      const current = service.current();

      expect(current).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('integration scenarios', () => {
    it('handles full settings workflow', async () => {
      const loadHandler = vi.fn();
      const changeHandler = vi.fn();
      events.on('settings:loaded', loadHandler);
      events.on('settings:changed', changeHandler);

      // Load initial settings
      await service.load();
      expect(loadHandler).toHaveBeenCalledTimes(1);

      // Modify a setting
      await service.set('theme', 'dark');
      expect(changeHandler).toHaveBeenCalledTimes(1);

      // Verify persistence
      const adapterSettings = adapter.getCurrent();
      expect(adapterSettings.theme).toBe('dark');

      // Verify cache
      expect(service.get('theme')).toBe('dark');
      expect(service.current().theme).toBe('dark');
    });

    it('multiple set operations emit multiple events', async () => {
      await service.load();
      const handler = vi.fn();
      events.on('settings:changed', handler);

      await service.set('theme', 'dark');
      await service.set('autoSave', false);
      await service.set('autoSaveDelay', 2000);

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('save does not affect subsequent get calls before load', async () => {
      // Create a new service (fresh cache with defaults)
      const newService = new SettingsServiceImpl(adapter);

      // Save custom settings through adapter directly
      await adapter.save({ ...DEFAULT_SETTINGS, theme: 'dark' });

      // Without calling load(), service still has defaults in cache
      expect(newService.get('theme')).toBe(DEFAULT_SETTINGS.theme);

      // After load, it picks up the saved settings
      await newService.load();
      expect(newService.get('theme')).toBe('dark');
    });
  });
});
