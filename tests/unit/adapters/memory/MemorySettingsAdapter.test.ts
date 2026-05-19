/**
 * Unit tests for MemorySettingsAdapter
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySettingsAdapter } from '$lib/adapters/memory';
import { DEFAULT_SETTINGS } from '$lib/domain';

describe('MemorySettingsAdapter', () => {
  let adapter: MemorySettingsAdapter;

  beforeEach(() => {
    adapter = new MemorySettingsAdapter();
  });

  describe('constructor', () => {
    it('initializes with default settings', async () => {
      const result = await adapter.load();
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(DEFAULT_SETTINGS);
    });

    it('accepts initial settings', async () => {
      const custom = new MemorySettingsAdapter({ theme: 'dark' });
      const result = await custom.load();

      expect(result.ok).toBe(true);
      expect(result.value.theme).toBe('dark');
    });

    it('merges initial settings with defaults', async () => {
      const custom = new MemorySettingsAdapter({ theme: 'dark' });
      const result = await custom.load();

      expect(result.ok).toBe(true);
      // Custom value
      expect(result.value.theme).toBe('dark');
      // Default value should be preserved
      expect(result.value.notesPath).toBe(DEFAULT_SETTINGS.notesPath);
    });
  });

  describe('load()', () => {
    it('returns current settings', async () => {
      const result = await adapter.load();
      expect(result.ok).toBe(true);
    });

    it('returns a copy (prevents mutation)', async () => {
      const result1 = await adapter.load();
      const result2 = await adapter.load();

      expect(result1.value).toEqual(result2.value);
      expect(result1.value).not.toBe(result2.value);
    });
  });

  describe('save()', () => {
    it('persists settings', async () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        theme: 'dark' as const,
        fontSize: 18,
      };

      const saveResult = await adapter.save(newSettings);
      expect(saveResult.ok).toBe(true);

      const loadResult = await adapter.load();
      expect(loadResult.ok).toBe(true);
      expect(loadResult.value.theme).toBe('dark');
      expect(loadResult.value.fontSize).toBe(18);
    });

    it('stores a copy (prevents mutation)', async () => {
      const settings = { ...DEFAULT_SETTINGS, theme: 'dark' as const };
      await adapter.save(settings);

      // Mutate original
      settings.theme = 'light';

      const result = await adapter.load();
      expect(result.value.theme).toBe('dark');
    });
  });

  describe('getPath()', () => {
    it('returns storage path', async () => {
      const path = await adapter.getPath();
      expect(path).toBe('/memory/settings.json');
    });
  });

  describe('Testing utilities', () => {
    describe('reset()', () => {
      it('resets to default settings', async () => {
        await adapter.save({ ...DEFAULT_SETTINGS, theme: 'dark' });
        adapter.reset();

        const result = await adapter.load();
        expect(result.value).toEqual(DEFAULT_SETTINGS);
      });
    });

    describe('getCurrent()', () => {
      it('returns current settings directly', async () => {
        await adapter.save({ ...DEFAULT_SETTINGS, theme: 'dark' });
        const current = adapter.getCurrent();

        expect(current.theme).toBe('dark');
      });

      it('returns a copy', () => {
        const current1 = adapter.getCurrent();
        const current2 = adapter.getCurrent();

        expect(current1).toEqual(current2);
        expect(current1).not.toBe(current2);
      });
    });

    describe('seed()', () => {
      it('sets partial settings', () => {
        adapter.seed({ theme: 'light', fontSize: 20 });
        const current = adapter.getCurrent();

        expect(current.theme).toBe('light');
        expect(current.fontSize).toBe(20);
        // Default values preserved
        expect(current.notesPath).toBe(DEFAULT_SETTINGS.notesPath);
      });
    });
  });
});
