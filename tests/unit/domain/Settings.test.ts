/**
 * Unit tests for Settings entity
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings, type Settings } from '$lib/domain/entities/Settings';

describe('Settings entity', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('has all required fields', () => {
      expect(DEFAULT_SETTINGS).toHaveProperty('notesPath');
      expect(DEFAULT_SETTINGS).toHaveProperty('theme');
      expect(DEFAULT_SETTINGS).toHaveProperty('autoSave');
      expect(DEFAULT_SETTINGS).toHaveProperty('autoSaveDelay');
      expect(DEFAULT_SETTINGS).toHaveProperty('aiProvider');
      expect(DEFAULT_SETTINGS).toHaveProperty('cliProvider');
      expect(DEFAULT_SETTINGS).toHaveProperty('aiReasoningEffort');
      expect(DEFAULT_SETTINGS).toHaveProperty('taskDefaultView');
    });

    it('has correct notesPath default', () => {
      expect(DEFAULT_SETTINGS.notesPath).toBe('~/Documents/void');
    });

    it('has correct theme default', () => {
      expect(DEFAULT_SETTINGS.theme).toBe('system');
    });

    it('has correct autoSave default', () => {
      expect(DEFAULT_SETTINGS.autoSave).toBe(true);
    });

    it('has correct autoSaveDelay default', () => {
      expect(DEFAULT_SETTINGS.autoSaveDelay).toBe(1000);
    });

    it('has correct aiProvider default', () => {
      expect(DEFAULT_SETTINGS.aiProvider).toBeNull();
    });

    it('has correct cliProvider default', () => {
      expect(DEFAULT_SETTINGS.cliProvider).toBe('codex');
    });

    it('has correct aiReasoningEffort default', () => {
      expect(DEFAULT_SETTINGS.aiReasoningEffort).toBe('medium');
    });

    it('has correct taskDefaultView default', () => {
      expect(DEFAULT_SETTINGS.taskDefaultView).toBe('all');
    });
  });

  describe('validateSettings', () => {
    it('falls back to all for invalid taskDefaultView values', () => {
      const settings = validateSettings({ taskDefaultView: 'mystery' as Settings['taskDefaultView'] });

      expect(settings.taskDefaultView).toBe('all');
    });

    it('preserves valid non-default taskDefaultView values', () => {
      const settings = validateSettings({ taskDefaultView: 'inbox' });

      expect(settings.taskDefaultView).toBe('inbox');
    });

    it('migrates legacy auto cliProvider to codex', () => {
      const settings = validateSettings({ cliProvider: 'auto' as unknown as Settings['cliProvider'] });

      expect(settings.cliProvider).toBe('codex');
    });

    it('preserves valid Claude Code cliProvider values', () => {
      const settings = validateSettings({ cliProvider: 'claude-code' });

      expect(settings.cliProvider).toBe('claude-code');
    });

    it('falls back to medium for invalid reasoning effort values', () => {
      const settings = validateSettings({ aiReasoningEffort: 'extreme' as unknown as Settings['aiReasoningEffort'] });

      expect(settings.aiReasoningEffort).toBe('medium');
    });

    it('preserves valid non-default reasoning effort values', () => {
      const settings = validateSettings({ aiReasoningEffort: 'xhigh' });

      expect(settings.aiReasoningEffort).toBe('xhigh');
    });
  });

  describe('Settings interface', () => {
    it('accepts valid light theme', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'light',
      };
      expect(settings.theme).toBe('light');
    });

    it('accepts valid dark theme', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'dark',
      };
      expect(settings.theme).toBe('dark');
    });

    it('accepts valid system theme', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        theme: 'system',
      };
      expect(settings.theme).toBe('system');
    });

    it('accepts claude as aiProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        aiProvider: 'claude',
      };
      expect(settings.aiProvider).toBe('claude');
    });

    it('accepts openai as aiProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        aiProvider: 'openai',
      };
      expect(settings.aiProvider).toBe('openai');
    });

    it('accepts local as aiProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        aiProvider: 'local',
      };
      expect(settings.aiProvider).toBe('local');
    });

    it('accepts null as aiProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        aiProvider: null,
      };
      expect(settings.aiProvider).toBeNull();
    });

    it('accepts codex as cliProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        cliProvider: 'codex',
      };
      expect(settings.cliProvider).toBe('codex');
    });

    it('accepts claude-code as cliProvider', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        cliProvider: 'claude-code',
      };
      expect(settings.cliProvider).toBe('claude-code');
    });

    it('accepts minimal as aiReasoningEffort', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        aiReasoningEffort: 'minimal',
      };
      expect(settings.aiReasoningEffort).toBe('minimal');
    });

    it('accepts custom notesPath', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        notesPath: '/custom/notes/path',
      };
      expect(settings.notesPath).toBe('/custom/notes/path');
    });

    it('accepts custom autoSaveDelay', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        autoSaveDelay: 5000,
      };
      expect(settings.autoSaveDelay).toBe(5000);
    });

    it('accepts autoSave as false', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        autoSave: false,
      };
      expect(settings.autoSave).toBe(false);
    });
  });
});
