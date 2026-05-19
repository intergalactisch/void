/**
 * CredentialServiceImpl Tests
 *
 * Tests for the credential service implementation which wraps CredentialPort
 * to provide secure credential storage operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCredentialAdapter } from '$lib/adapters/memory';
import { CredentialServiceImpl } from '$lib/application/services';

describe('CredentialServiceImpl', () => {
  let adapter: MemoryCredentialAdapter;
  let service: CredentialServiceImpl;

  beforeEach(() => {
    adapter = new MemoryCredentialAdapter();
    service = new CredentialServiceImpl(adapter);
  });

  describe('store()', () => {
    it('stores credential successfully', async () => {
      const result = await service.store('openai-api-key', 'sk-test-12345');

      expect(result.ok).toBe(true);
    });

    it('allows retrieving stored credential via get', async () => {
      await service.store('claude-api-key', 'sk-claude-secret');

      const result = await service.get('claude-api-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('sk-claude-secret');
      }
    });

    it('overwrites existing credential with same key', async () => {
      await service.store('api-key', 'old-secret');
      await service.store('api-key', 'new-secret');

      const result = await service.get('api-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('new-secret');
      }
    });

    it('stores credentials with empty string value', async () => {
      const storeResult = await service.store('empty-key', '');

      expect(storeResult.ok).toBe(true);

      const getResult = await service.get('empty-key');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBe('');
      }
    });

    it('stores credentials with special characters in key', async () => {
      const key = 'my-service:api/key.v2';
      const value = 'secret-value';

      await service.store(key, value);

      const result = await service.get(key);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(value);
      }
    });

    it('stores credentials with special characters in value', async () => {
      const key = 'password';
      const value = 'p@$$w0rd!#$%^&*()';

      await service.store(key, value);

      const result = await service.get(key);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(value);
      }
    });
  });

  describe('get()', () => {
    it('retrieves stored credential', async () => {
      await service.store('my-service', 'my-secret');

      const result = await service.get('my-service');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('my-secret');
      }
    });

    it('returns null for non-existent credential', async () => {
      const result = await service.get('nonexistent-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null after credential is deleted', async () => {
      await service.store('temp-key', 'temp-value');
      await service.delete('temp-key');

      const result = await service.get('temp-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('retrieves multiple different credentials correctly', async () => {
      await service.store('key1', 'value1');
      await service.store('key2', 'value2');
      await service.store('key3', 'value3');

      const result1 = await service.get('key1');
      const result2 = await service.get('key2');
      const result3 = await service.get('key3');

      expect(result1.ok && result1.value).toBe('value1');
      expect(result2.ok && result2.value).toBe('value2');
      expect(result3.ok && result3.value).toBe('value3');
    });
  });

  describe('delete()', () => {
    it('removes existing credential', async () => {
      await service.store('to-delete', 'secret');

      const deleteResult = await service.delete('to-delete');

      expect(deleteResult.ok).toBe(true);

      const hasResult = await service.has('to-delete');
      expect(hasResult).toBe(false);
    });

    it('succeeds when deleting non-existent credential', async () => {
      const result = await service.delete('never-existed');

      expect(result.ok).toBe(true);
    });

    it('allows re-storing after delete', async () => {
      await service.store('reusable-key', 'first-value');
      await service.delete('reusable-key');
      await service.store('reusable-key', 'second-value');

      const result = await service.get('reusable-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('second-value');
      }
    });

    it('only deletes specified credential', async () => {
      await service.store('keep-this', 'keeper');
      await service.store('delete-this', 'goner');

      await service.delete('delete-this');

      expect(await service.has('keep-this')).toBe(true);
      expect(await service.has('delete-this')).toBe(false);
    });
  });

  describe('has()', () => {
    it('returns true for existing credential', async () => {
      await service.store('existing-key', 'value');

      const result = await service.has('existing-key');

      expect(result).toBe(true);
    });

    it('returns false for non-existent credential', async () => {
      const result = await service.has('missing-key');

      expect(result).toBe(false);
    });

    it('returns false after credential is deleted', async () => {
      await service.store('temporary', 'value');
      await service.delete('temporary');

      const result = await service.has('temporary');

      expect(result).toBe(false);
    });

    it('returns true for credential with empty string value', async () => {
      await service.store('empty-value-key', '');

      const result = await service.has('empty-value-key');

      expect(result).toBe(true);
    });

    it('checks multiple credentials independently', async () => {
      await service.store('exists1', 'val1');
      await service.store('exists2', 'val2');

      expect(await service.has('exists1')).toBe(true);
      expect(await service.has('exists2')).toBe(true);
      expect(await service.has('not-exists')).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('handles credential lifecycle: store, get, update, delete', async () => {
      // Store initial credential
      const storeResult = await service.store('lifecycle-key', 'initial');
      expect(storeResult.ok).toBe(true);
      expect(await service.has('lifecycle-key')).toBe(true);

      // Get credential
      let getResult = await service.get('lifecycle-key');
      expect(getResult.ok && getResult.value).toBe('initial');

      // Update credential
      await service.store('lifecycle-key', 'updated');
      getResult = await service.get('lifecycle-key');
      expect(getResult.ok && getResult.value).toBe('updated');

      // Delete credential
      const deleteResult = await service.delete('lifecycle-key');
      expect(deleteResult.ok).toBe(true);
      expect(await service.has('lifecycle-key')).toBe(false);

      // Verify it is gone
      getResult = await service.get('lifecycle-key');
      expect(getResult.ok && getResult.value).toBeNull();
    });

    it('manages multiple credentials simultaneously', async () => {
      const credentials = [
        { key: 'openai', value: 'sk-openai-key' },
        { key: 'anthropic', value: 'sk-anthropic-key' },
        { key: 'google', value: 'google-api-key' },
      ];

      // Store all
      for (const { key, value } of credentials) {
        await service.store(key, value);
      }

      // Verify all exist and have correct values
      for (const { key, value } of credentials) {
        expect(await service.has(key)).toBe(true);
        const result = await service.get(key);
        expect(result.ok && result.value).toBe(value);
      }

      // Delete one
      await service.delete('google');

      // Verify state
      expect(await service.has('openai')).toBe(true);
      expect(await service.has('anthropic')).toBe(true);
      expect(await service.has('google')).toBe(false);
    });
  });
});
