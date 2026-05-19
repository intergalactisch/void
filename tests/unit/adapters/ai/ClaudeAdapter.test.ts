/**
 * Unit tests for ClaudeAdapter
 *
 * Tests the ClaudeAdapter public API including:
 * - Configuration and initialization
 * - Token estimation
 * - Token usage tracking
 * - Context size calculations
 * - Provider identification
 *
 * Note: Network-dependent tests (prompt, stream, retry) would require
 * integration tests with a mock server or the real API.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeAdapter } from '$lib/adapters/ai/ClaudeAdapter';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter({ apiKey: 'test-api-key' });
  });

  describe('constructor', () => {
    it('initializes with default options', () => {
      const defaultAdapter = new ClaudeAdapter();

      expect(defaultAdapter.hasApiKey()).toBe(false);
      expect(defaultAdapter.getModel()).toBe('claude-sonnet-4-20250514');
    });

    it('initializes with provided API key', () => {
      const customAdapter = new ClaudeAdapter({
        apiKey: 'custom-key',
      });

      expect(customAdapter.hasApiKey()).toBe(true);
    });

    it('initializes with custom model', () => {
      const customAdapter = new ClaudeAdapter({
        model: 'claude-3-opus-20240229',
      });

      expect(customAdapter.getModel()).toBe('claude-3-opus-20240229');
    });

    it('initializes with custom API endpoint', () => {
      // Endpoint is private, but configure() can set it
      const customAdapter = new ClaudeAdapter({
        apiEndpoint: 'https://custom.api.com/v1/messages',
      });

      // No direct way to verify, but constructor shouldn't throw
      expect(customAdapter).toBeDefined();
    });

    it('initializes with custom timeout', () => {
      // Timeout is private, so we just verify no error
      const customAdapter = new ClaudeAdapter({
        timeout: 60000,
      });

      expect(customAdapter).toBeDefined();
    });
  });

  describe('getProviderType()', () => {
    it('returns "claude"', () => {
      expect(adapter.getProviderType()).toBe('claude');
    });
  });

  describe('isAvailable()', () => {
    it('returns true when API key is set', async () => {
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('returns false when API key is not set', async () => {
      const noKeyAdapter = new ClaudeAdapter();
      expect(await noKeyAdapter.isAvailable()).toBe(false);
    });

    it('returns false for empty string API key', async () => {
      const emptyKeyAdapter = new ClaudeAdapter({ apiKey: '' });
      expect(await emptyKeyAdapter.isAvailable()).toBe(false);
    });
  });

  describe('hasApiKey()', () => {
    it('returns true when API key is set', () => {
      expect(adapter.hasApiKey()).toBe(true);
    });

    it('returns false when API key is not set', () => {
      const noKeyAdapter = new ClaudeAdapter();
      expect(noKeyAdapter.hasApiKey()).toBe(false);
    });
  });

  describe('estimateTokens()', () => {
    it('estimates tokens based on character count (~4 chars per token)', () => {
      // 5 chars / 4 = 1.25, ceil = 2
      expect(adapter.estimateTokens('Hello')).toBe(2);
    });

    it('handles exact multiples of 4', () => {
      // 12 chars / 4 = 3
      expect(adapter.estimateTokens('Hello world!')).toBe(3);
    });

    it('returns 0 for empty string', () => {
      expect(adapter.estimateTokens('')).toBe(0);
    });

    it('handles long text', () => {
      const longText = 'a'.repeat(1000);
      // 1000 / 4 = 250
      expect(adapter.estimateTokens(longText)).toBe(250);
    });

    it('handles very long text', () => {
      const veryLongText = 'x'.repeat(10000);
      // 10000 / 4 = 2500
      expect(adapter.estimateTokens(veryLongText)).toBe(2500);
    });

    it('handles text with special characters', () => {
      const specialText = '🎉🎊🎈';
      // Emoji use surrogate pairs in JavaScript, so 3 emoji = 6 characters
      // 6 chars / 4 = 1.5, ceil = 2
      expect(adapter.estimateTokens(specialText)).toBe(2);
    });

    it('handles newlines', () => {
      const withNewlines = 'line1\nline2\nline3';
      // 17 chars / 4 = 4.25, ceil = 5
      expect(adapter.estimateTokens(withNewlines)).toBe(5);
    });
  });

  describe('getMaxContextSize()', () => {
    it('returns 200k for Claude 3.5 Sonnet models', () => {
      adapter.setModel('claude-3-5-sonnet-20241022');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 200k for Claude Sonnet 4 models', () => {
      adapter.setModel('claude-sonnet-4-20250514');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 200k for Claude Opus 4 models', () => {
      adapter.setModel('claude-opus-4-20250514');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 200k for Claude 3 Opus models', () => {
      adapter.setModel('claude-3-opus-20240229');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 200k for Claude 3 Sonnet models', () => {
      adapter.setModel('claude-3-sonnet-20240229');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 200k for Claude 3 Haiku models', () => {
      adapter.setModel('claude-3-haiku-20240307');
      expect(adapter.getMaxContextSize()).toBe(200000);
    });

    it('returns 100k for unknown models', () => {
      adapter.setModel('unknown-model');
      expect(adapter.getMaxContextSize()).toBe(100000);
    });

    it('returns 100k for older Claude 2 models', () => {
      adapter.setModel('claude-2.1');
      expect(adapter.getMaxContextSize()).toBe(100000);
    });
  });

  describe('token usage tracking', () => {
    it('starts with zero usage', () => {
      const usage = adapter.getTokenUsage();

      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.requestCount).toBe(0);
    });

    it('includes lastResetAt date', () => {
      const usage = adapter.getTokenUsage();

      expect(usage.lastResetAt).toBeInstanceOf(Date);
    });

    it('resetTokenUsage clears all counters', () => {
      adapter.resetTokenUsage();

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.requestCount).toBe(0);
    });

    it('resetTokenUsage updates lastResetAt', () => {
      const beforeReset = adapter.getTokenUsage().lastResetAt;

      // Small delay to ensure different timestamp
      adapter.resetTokenUsage();

      const afterReset = adapter.getTokenUsage().lastResetAt;
      expect(afterReset.getTime()).toBeGreaterThanOrEqual(beforeReset.getTime());
    });

    it('getTokenUsage returns a copy, not the original', () => {
      const usage1 = adapter.getTokenUsage();
      const usage2 = adapter.getTokenUsage();

      expect(usage1).not.toBe(usage2);
      expect(usage1).toEqual(usage2);
    });
  });

  describe('rate limit status', () => {
    it('returns null when no requests have been made', async () => {
      const status = await adapter.getRateLimitStatus();
      expect(status).toBeNull();
    });
  });

  describe('configuration methods', () => {
    describe('setApiKey()', () => {
      it('sets the API key', () => {
        const noKeyAdapter = new ClaudeAdapter();
        expect(noKeyAdapter.hasApiKey()).toBe(false);

        noKeyAdapter.setApiKey('new-key');
        expect(noKeyAdapter.hasApiKey()).toBe(true);
      });

      it('can update existing API key', () => {
        adapter.setApiKey('updated-key');
        expect(adapter.hasApiKey()).toBe(true);
      });

      it('can clear API key with empty string', () => {
        adapter.setApiKey('');
        expect(adapter.hasApiKey()).toBe(false);
      });
    });

    describe('setModel()', () => {
      it('updates the model', () => {
        adapter.setModel('claude-3-opus-20240229');
        expect(adapter.getModel()).toBe('claude-3-opus-20240229');
      });

      it('can set any model string', () => {
        adapter.setModel('custom-model');
        expect(adapter.getModel()).toBe('custom-model');
      });
    });

    describe('getModel()', () => {
      it('returns the current model', () => {
        expect(adapter.getModel()).toBe('claude-sonnet-4-20250514');
      });
    });

    describe('setApiEndpoint()', () => {
      it('does not throw when setting endpoint', () => {
        expect(() => {
          adapter.setApiEndpoint('https://custom.api.com/v1/messages');
        }).not.toThrow();
      });
    });

    describe('setTimeout()', () => {
      it('does not throw when setting timeout', () => {
        expect(() => {
          adapter.setTimeout(60000);
        }).not.toThrow();
      });
    });
  });

  describe('configure()', () => {
    it('configures adapter with connection settings', async () => {
      const newAdapter = new ClaudeAdapter();

      await newAdapter.configure({
        provider: 'claude',
        apiKey: 'configured-key',
        config: {
          defaultModel: 'claude-3-opus-20240229',
        },
      });

      expect(newAdapter.hasApiKey()).toBe(true);
      expect(newAdapter.getModel()).toBe('claude-3-opus-20240229');
    });

    it('updates API key from config', async () => {
      const newAdapter = new ClaudeAdapter();

      await newAdapter.configure({
        provider: 'claude',
        apiKey: 'new-key',
        config: {},
      });

      expect(newAdapter.hasApiKey()).toBe(true);
    });

    it('updates model from config', async () => {
      await adapter.configure({
        provider: 'claude',
        config: {
          defaultModel: 'claude-3-haiku-20240307',
        },
      });

      expect(adapter.getModel()).toBe('claude-3-haiku-20240307');
    });

    it('updates endpoint from config', async () => {
      // No direct way to verify, but shouldn't throw
      await expect(
        adapter.configure({
          provider: 'claude',
          config: {
            apiEndpoint: 'https://custom.api.com',
          },
        })
      ).resolves.not.toThrow();
    });

    it('throws error for invalid provider type', async () => {
      await expect(
        adapter.configure({
          provider: 'openai' as never,
          apiKey: 'key',
          config: {},
        })
      ).rejects.toThrow("Invalid provider type: expected 'claude', got 'openai'");
    });

    it('throws error for gpt provider', async () => {
      await expect(
        adapter.configure({
          provider: 'gpt' as never,
          config: {},
        })
      ).rejects.toThrow("Invalid provider type");
    });
  });

  describe('getAvailableModels()', () => {
    it('returns an array of models', async () => {
      const models = await adapter.getAvailableModels();

      expect(Array.isArray(models)).toBe(true);
    });

    it('returns at least one model', async () => {
      const models = await adapter.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
    });

    it('includes Claude models', async () => {
      const models = await adapter.getAvailableModels();

      expect(models.some((m) => m.includes('claude'))).toBe(true);
    });
  });

  describe('cancel()', () => {
    it('does not throw when called without active request', () => {
      expect(() => {
        adapter.cancel();
      }).not.toThrow();
    });

    it('can be called multiple times', () => {
      expect(() => {
        adapter.cancel();
        adapter.cancel();
        adapter.cancel();
      }).not.toThrow();
    });
  });

  describe('prompt() without API key', () => {
    it('returns error when API key is not configured', async () => {
      const noKeyAdapter = new ClaudeAdapter();

      const result = await noKeyAdapter.prompt({
        message: 'Hi',
        conversationHistory: [],
        tools: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API key is not configured');
      }
    });
  });

  describe('stream() without API key', () => {
    it('returns error when API key is not configured', async () => {
      const noKeyAdapter = new ClaudeAdapter();

      const result = await noKeyAdapter.stream(
        {
          message: 'Hi',
          conversationHistory: [],
          tools: [],
        },
        () => {}
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API key is not configured');
      }
    });
  });
});
