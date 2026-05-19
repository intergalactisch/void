/**
 * Unit tests for DI Container
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Container, TOKENS } from '$lib/core';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register()', () => {
    it('registers a factory', () => {
      const token = Symbol('test');
      container.register(token, () => 'service');
      expect(container.has(token)).toBe(true);
    });

    it('overwrites existing registration', () => {
      const token = Symbol('test');
      container.register(token, () => 'first');
      container.register(token, () => 'second');
      expect(container.resolve(token)).toBe('second');
    });

    it('clears cached instance when re-registering', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(token, () => ++callCount);

      // First resolve
      expect(container.resolve(token)).toBe(1);
      // Second resolve (should be cached)
      expect(container.resolve(token)).toBe(1);

      // Re-register
      container.register(token, () => ++callCount);
      // Should call factory again
      expect(container.resolve(token)).toBe(2);
    });
  });

  describe('resolve()', () => {
    it('resolves registered service', () => {
      const token = Symbol('test');
      container.register(token, () => ({ name: 'TestService' }));
      const result = container.resolve<{ name: string }>(token);
      expect(result.name).toBe('TestService');
    });

    it('throws for unregistered token', () => {
      const token = Symbol('unregistered');
      expect(() => container.resolve(token)).toThrow('No provider registered');
    });

    it('returns same instance for singleton (default)', () => {
      const token = Symbol('singleton');
      let callCount = 0;
      container.register(token, () => ({ id: ++callCount }));

      const first = container.resolve<{ id: number }>(token);
      const second = container.resolve<{ id: number }>(token);

      expect(first.id).toBe(1);
      expect(second.id).toBe(1);
      expect(first).toBe(second);
    });

    it('creates new instance each time for non-singleton', () => {
      const token = Symbol('transient');
      let callCount = 0;
      container.register(token, () => ({ id: ++callCount }), false);

      const first = container.resolve<{ id: number }>(token);
      const second = container.resolve<{ id: number }>(token);

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
      expect(first).not.toBe(second);
    });
  });

  describe('has()', () => {
    it('returns true for registered token', () => {
      const token = Symbol('test');
      container.register(token, () => 'value');
      expect(container.has(token)).toBe(true);
    });

    it('returns false for unregistered token', () => {
      const token = Symbol('unregistered');
      expect(container.has(token)).toBe(false);
    });
  });

  describe('clear()', () => {
    it('removes all registrations', () => {
      const token1 = Symbol('test1');
      const token2 = Symbol('test2');
      container.register(token1, () => 'one');
      container.register(token2, () => 'two');

      container.clear();

      expect(container.has(token1)).toBe(false);
      expect(container.has(token2)).toBe(false);
    });

    it('clears cached instances', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(token, () => ++callCount);
      container.resolve(token);

      container.clear();
      container.register(token, () => ++callCount);

      expect(container.resolve(token)).toBe(2);
    });
  });

  describe('clearInstances()', () => {
    it('clears cached instances but keeps registrations', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(token, () => ++callCount);
      container.resolve(token);

      container.clearInstances();

      expect(container.has(token)).toBe(true);
      expect(container.resolve(token)).toBe(2);
    });
  });

  describe('TOKENS', () => {
    it('has unique symbols for each service', () => {
      const tokenValues = Object.values(TOKENS);
      const uniqueValues = new Set(tokenValues);
      expect(uniqueValues.size).toBe(tokenValues.length);
    });

    it('uses Symbol.for() for consistent symbols', () => {
      // Symbol.for() returns the same symbol when called with the same key
      expect(TOKENS.FileSystem).toBe(Symbol.for('void:FileSystem'));
      expect(TOKENS.SettingsService).toBe(Symbol.for('void:SettingsService'));
    });
  });
});
