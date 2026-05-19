/**
 * Unit tests for Result type utilities
 */
import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  tryCatch,
  collect,
  isOk,
  isErr,
} from '$lib/core/result';

describe('Result type', () => {
  describe('ok()', () => {
    it('creates a success result', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('works with different value types', () => {
      expect(ok('hello').value).toBe('hello');
      expect(ok({ foo: 'bar' }).value).toEqual({ foo: 'bar' });
      expect(ok([1, 2, 3]).value).toEqual([1, 2, 3]);
      expect(ok(null).value).toBe(null);
    });
  });

  describe('err()', () => {
    it('creates an error result', () => {
      const error = new Error('Something went wrong');
      const result = err(error);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(error);
    });

    it('works with custom error types', () => {
      const result = err({ code: 'NOT_FOUND', message: 'Not found' });
      expect(result.ok).toBe(false);
      expect(result.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    });
  });

  describe('unwrap()', () => {
    it('returns value for success result', () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it('throws for error result', () => {
      const error = new Error('Test error');
      const result = err(error);
      expect(() => unwrap(result)).toThrow(error);
    });
  });

  describe('unwrapOr()', () => {
    it('returns value for success result', () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('returns default for error result', () => {
      const result = err(new Error('Test error'));
      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('map()', () => {
    it('transforms success value', () => {
      const result = ok(10);
      const mapped = map(result, (x) => x * 2);
      expect(mapped.ok).toBe(true);
      expect(mapped.value).toBe(20);
    });

    it('passes through error unchanged', () => {
      const error = new Error('Original error');
      const result = err(error);
      const mapped = map(result, (x: number) => x * 2);
      expect(mapped.ok).toBe(false);
      expect(mapped.error).toBe(error);
    });
  });

  describe('mapErr()', () => {
    it('transforms error value', () => {
      const result = err(new Error('Original'));
      const mapped = mapErr(result, (e) => new Error(`Wrapped: ${e.message}`));
      expect(mapped.ok).toBe(false);
      expect(mapped.error.message).toBe('Wrapped: Original');
    });

    it('passes through success unchanged', () => {
      const result = ok(42);
      const mapped = mapErr(result, (e: Error) => new Error(`Wrapped: ${e.message}`));
      expect(mapped.ok).toBe(true);
      expect(mapped.value).toBe(42);
    });
  });

  describe('andThen()', () => {
    it('chains successful operations', async () => {
      const result = ok(10);
      const chained = await andThen(result, async (x) => ok(x * 2));
      expect(chained.ok).toBe(true);
      expect(chained.value).toBe(20);
    });

    it('short-circuits on error', async () => {
      const error = new Error('First error');
      const result = err(error);
      const chained = await andThen(result, async (x: number) => ok(x * 2));
      expect(chained.ok).toBe(false);
      expect(chained.error).toBe(error);
    });

    it('propagates error from chained operation', async () => {
      const result = ok(10);
      const chained = await andThen(result, async () => err(new Error('Chained error')));
      expect(chained.ok).toBe(false);
      expect(chained.error.message).toBe('Chained error');
    });
  });

  describe('tryCatch()', () => {
    it('returns success for non-throwing async function', async () => {
      const result = await tryCatch(async () => 42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('catches thrown Error', async () => {
      const result = await tryCatch(async () => {
        throw new Error('Async error');
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('Async error');
    });

    it('wraps non-Error throws in Error', async () => {
      const result = await tryCatch(async () => {
        throw 'string error';
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('string error');
    });
  });

  describe('collect()', () => {
    it('collects all success values into array', () => {
      const results = [ok(1), ok(2), ok(3)];
      const collected = collect(results);
      expect(collected.ok).toBe(true);
      expect(collected.value).toEqual([1, 2, 3]);
    });

    it('returns first error encountered', () => {
      const error = new Error('Second failed');
      const results = [ok(1), err(error), ok(3)];
      const collected = collect(results);
      expect(collected.ok).toBe(false);
      expect(collected.error).toBe(error);
    });

    it('handles empty array', () => {
      const results: ReturnType<typeof ok<number>>[] = [];
      const collected = collect(results);
      expect(collected.ok).toBe(true);
      expect(collected.value).toEqual([]);
    });
  });

  describe('isOk()', () => {
    it('returns true for success result', () => {
      expect(isOk(ok(42))).toBe(true);
    });

    it('returns false for error result', () => {
      expect(isOk(err(new Error()))).toBe(false);
    });

    it('works as type guard', () => {
      const result = ok(42);
      if (isOk(result)) {
        // TypeScript should know result.value exists here
        expect(result.value).toBe(42);
      }
    });
  });

  describe('isErr()', () => {
    it('returns true for error result', () => {
      expect(isErr(err(new Error()))).toBe(true);
    });

    it('returns false for success result', () => {
      expect(isErr(ok(42))).toBe(false);
    });

    it('works as type guard', () => {
      const result = err(new Error('Test'));
      if (isErr(result)) {
        // TypeScript should know result.error exists here
        expect(result.error.message).toBe('Test');
      }
    });
  });
});
