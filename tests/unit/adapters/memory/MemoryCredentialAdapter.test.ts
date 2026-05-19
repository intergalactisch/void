/**
 * Unit tests for MemoryCredentialAdapter
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCredentialAdapter } from '$lib/adapters/memory';

describe('MemoryCredentialAdapter', () => {
  let adapter: MemoryCredentialAdapter;

  beforeEach(() => {
    adapter = new MemoryCredentialAdapter();
  });

  describe('store()', () => {
    it('stores credential', async () => {
      const result = await adapter.store('openai-api', 'sk-test-key');
      expect(result.ok).toBe(true);

      const getResult = await adapter.get('openai-api');
      expect(getResult.ok).toBe(true);
      expect(getResult.value).toBe('sk-test-key');
    });

    it('overwrites existing credential', async () => {
      await adapter.store('api-key', 'old-key');
      await adapter.store('api-key', 'new-key');

      const result = await adapter.get('api-key');
      expect(result.value).toBe('new-key');
    });
  });

  describe('get()', () => {
    it('returns stored credential', async () => {
      await adapter.store('service', 'credential');
      const result = await adapter.get('service');

      expect(result.ok).toBe(true);
      expect(result.value).toBe('credential');
    });

    it('returns null for non-existent credential', async () => {
      const result = await adapter.get('nonexistent');

      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });
  });

  describe('delete()', () => {
    it('deletes existing credential', async () => {
      await adapter.store('service', 'credential');
      const deleteResult = await adapter.delete('service');

      expect(deleteResult.ok).toBe(true);

      const getResult = await adapter.get('service');
      expect(getResult.value).toBeNull();
    });

    it('succeeds for non-existent credential', async () => {
      const result = await adapter.delete('nonexistent');
      expect(result.ok).toBe(true);
    });
  });

  describe('has()', () => {
    it('returns true for existing credential', async () => {
      await adapter.store('service', 'credential');
      expect(await adapter.has('service')).toBe(true);
    });

    it('returns false for non-existent credential', async () => {
      expect(await adapter.has('nonexistent')).toBe(false);
    });
  });

  describe('Testing utilities', () => {
    describe('seed()', () => {
      it('populates credentials', async () => {
        adapter.seed({
          'openai-api': 'sk-openai',
          'claude-api': 'sk-claude',
        });

        expect(await adapter.has('openai-api')).toBe(true);
        expect(await adapter.has('claude-api')).toBe(true);
      });
    });

    describe('clear()', () => {
      it('removes all credentials', async () => {
        adapter.seed({
          'service1': 'cred1',
          'service2': 'cred2',
        });

        adapter.clear();

        expect(await adapter.has('service1')).toBe(false);
        expect(await adapter.has('service2')).toBe(false);
        expect(adapter.count()).toBe(0);
      });
    });

    describe('getServices()', () => {
      it('returns all service names', async () => {
        adapter.seed({
          'openai': 'key1',
          'claude': 'key2',
        });

        const services = adapter.getServices();
        expect(services).toContain('openai');
        expect(services).toContain('claude');
      });
    });

    describe('count()', () => {
      it('returns number of stored credentials', async () => {
        expect(adapter.count()).toBe(0);

        adapter.seed({ 'a': '1', 'b': '2', 'c': '3' });
        expect(adapter.count()).toBe(3);

        await adapter.delete('a');
        expect(adapter.count()).toBe(2);
      });
    });
  });
});
