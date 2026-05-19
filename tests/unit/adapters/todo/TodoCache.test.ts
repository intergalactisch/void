/**
 * Unit tests for TodoCache
 *
 * Tests in-memory caching for parsed todos with:
 * - Hash-based invalidation (content change detection)
 * - Time-based expiration (configurable maxAge)
 * - Per-file and full cache invalidation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TodoCache, hashContent } from '$lib/adapters/todo/TodoCache';
import type { Todo } from '$lib/domain/entities/Todo';
import { createTodo } from '$lib/domain/entities/Todo';

/**
 * Helper to create a basic todo for testing.
 */
function createBasicTodo(overrides: Partial<Parameters<typeof createTodo>[0]> = {}): Todo {
  return createTodo({
    content: 'Test task',
    source: 'inline',
    sourceFile: '/notes/test.md',
    lineNumber: 10,
    rawLine: '- [ ] Test task',
    ...overrides,
  });
}

describe('TodoCache', () => {
  let cache: TodoCache;

  beforeEach(() => {
    cache = new TodoCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates cache with default maxAge of 5 minutes', () => {
      const stats = cache.getStats();
      expect(stats.maxAge).toBe(5 * 60 * 1000);
    });

    it('accepts custom maxAge in milliseconds', () => {
      const customCache = new TodoCache(10 * 60 * 1000); // 10 minutes
      const stats = customCache.getStats();
      expect(stats.maxAge).toBe(10 * 60 * 1000);
    });

    it('starts with empty cache', () => {
      expect(cache.size()).toBe(0);
      expect(cache.getAllCached()).toEqual([]);
    });
  });

  describe('get()', () => {
    it('returns null for missing entry', () => {
      const result = cache.get('/notes/nonexistent.md', 'somehash');
      expect(result).toBeNull();
    });

    it('returns cached todos for valid entry', () => {
      const todos = [
        createBasicTodo({ content: 'Task 1', lineNumber: 1 }),
        createBasicTodo({ content: 'Task 2', lineNumber: 2 }),
      ];
      const hash = 'abc123';

      cache.set('/notes/test.md', todos, hash);
      const result = cache.get('/notes/test.md', hash);

      expect(result).toEqual(todos);
    });

    it('returns null when hash does not match (content changed)', () => {
      const todos = [createBasicTodo({ content: 'Task 1' })];
      const originalHash = 'hash1';
      const newHash = 'hash2';

      cache.set('/notes/test.md', todos, originalHash);
      const result = cache.get('/notes/test.md', newHash);

      expect(result).toBeNull();
    });

    it('removes entry from cache when hash mismatch', () => {
      const todos = [createBasicTodo({ content: 'Task 1' })];
      cache.set('/notes/test.md', todos, 'hash1');

      expect(cache.size()).toBe(1);

      // Access with wrong hash
      cache.get('/notes/test.md', 'hash2');

      expect(cache.size()).toBe(0);
    });

    it('returns null when entry expired', () => {
      vi.useFakeTimers();

      const todos = [createBasicTodo({ content: 'Task 1' })];
      const hash = 'abc123';

      cache.set('/notes/test.md', todos, hash);

      // Advance time past 5 minute expiration
      vi.advanceTimersByTime(6 * 60 * 1000);

      const result = cache.get('/notes/test.md', hash);
      expect(result).toBeNull();
    });

    it('removes entry from cache when expired', () => {
      vi.useFakeTimers();

      const todos = [createBasicTodo({ content: 'Task 1' })];
      cache.set('/notes/test.md', todos, 'hash');

      expect(cache.size()).toBe(1);

      vi.advanceTimersByTime(6 * 60 * 1000);
      cache.get('/notes/test.md', 'hash');

      expect(cache.size()).toBe(0);
    });

    it('returns todos when entry not yet expired', () => {
      vi.useFakeTimers();

      const todos = [createBasicTodo({ content: 'Task 1' })];
      const hash = 'abc123';

      cache.set('/notes/test.md', todos, hash);

      // Advance time but stay within 5 minute window
      vi.advanceTimersByTime(4 * 60 * 1000);

      const result = cache.get('/notes/test.md', hash);
      expect(result).toEqual(todos);
    });

    it('respects custom maxAge for expiration', () => {
      vi.useFakeTimers();

      const customCache = new TodoCache(1000); // 1 second
      const todos = [createBasicTodo({ content: 'Task 1' })];
      const hash = 'abc123';

      customCache.set('/notes/test.md', todos, hash);

      // Within expiration window
      vi.advanceTimersByTime(500);
      expect(customCache.get('/notes/test.md', hash)).toEqual(todos);

      // Past expiration window
      vi.advanceTimersByTime(600);
      expect(customCache.get('/notes/test.md', hash)).toBeNull();
    });
  });

  describe('set()', () => {
    it('stores todos with hash and timestamp', () => {
      const todos = [
        createBasicTodo({ content: 'Task 1', lineNumber: 1 }),
        createBasicTodo({ content: 'Task 2', lineNumber: 2 }),
      ];
      const hash = 'abc123';

      cache.set('/notes/test.md', todos, hash);

      expect(cache.size()).toBe(1);
      expect(cache.get('/notes/test.md', hash)).toEqual(todos);
    });

    it('overwrites existing entry for same file path', () => {
      const todos1 = [createBasicTodo({ content: 'Task 1' })];
      const todos2 = [createBasicTodo({ content: 'Task 2' })];

      cache.set('/notes/test.md', todos1, 'hash1');
      cache.set('/notes/test.md', todos2, 'hash2');

      expect(cache.size()).toBe(1);
      expect(cache.get('/notes/test.md', 'hash2')).toEqual(todos2);
      expect(cache.get('/notes/test.md', 'hash1')).toBeNull();
    });

    it('stores empty todo array', () => {
      cache.set('/notes/empty.md', [], 'emptyhash');

      expect(cache.size()).toBe(1);
      expect(cache.get('/notes/empty.md', 'emptyhash')).toEqual([]);
    });

    it('stores entries for multiple files', () => {
      const todos1 = [createBasicTodo({ content: 'Task 1', sourceFile: '/notes/a.md' })];
      const todos2 = [createBasicTodo({ content: 'Task 2', sourceFile: '/notes/b.md' })];
      const todos3 = [createBasicTodo({ content: 'Task 3', sourceFile: '/notes/c.md' })];

      cache.set('/notes/a.md', todos1, 'hash1');
      cache.set('/notes/b.md', todos2, 'hash2');
      cache.set('/notes/c.md', todos3, 'hash3');

      expect(cache.size()).toBe(3);
      expect(cache.get('/notes/a.md', 'hash1')).toEqual(todos1);
      expect(cache.get('/notes/b.md', 'hash2')).toEqual(todos2);
      expect(cache.get('/notes/c.md', 'hash3')).toEqual(todos3);
    });

    it('updates timestamp when overwriting', () => {
      vi.useFakeTimers();

      const todos = [createBasicTodo({ content: 'Task 1' })];

      cache.set('/notes/test.md', todos, 'hash1');

      // Advance time by 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Update the entry
      cache.set('/notes/test.md', todos, 'hash2');

      // Advance by another 2 minutes (total 6 minutes from first set)
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Entry should still be valid because it was refreshed
      expect(cache.get('/notes/test.md', 'hash2')).toEqual(todos);
    });
  });

  describe('invalidate()', () => {
    it('clears specific file when path is provided', () => {
      const todos1 = [createBasicTodo({ content: 'Task 1', sourceFile: '/notes/a.md' })];
      const todos2 = [createBasicTodo({ content: 'Task 2', sourceFile: '/notes/b.md' })];

      cache.set('/notes/a.md', todos1, 'hash1');
      cache.set('/notes/b.md', todos2, 'hash2');

      cache.invalidate('/notes/a.md');

      expect(cache.size()).toBe(1);
      expect(cache.get('/notes/a.md', 'hash1')).toBeNull();
      expect(cache.get('/notes/b.md', 'hash2')).toEqual(todos2);
    });

    it('clears all cache when no path is given', () => {
      const todos1 = [createBasicTodo({ content: 'Task 1', sourceFile: '/notes/a.md' })];
      const todos2 = [createBasicTodo({ content: 'Task 2', sourceFile: '/notes/b.md' })];

      cache.set('/notes/a.md', todos1, 'hash1');
      cache.set('/notes/b.md', todos2, 'hash2');

      cache.invalidate();

      expect(cache.size()).toBe(0);
      expect(cache.getAllCached()).toEqual([]);
    });

    it('handles invalidating non-existent file gracefully', () => {
      const todos = [createBasicTodo({ content: 'Task 1' })];
      cache.set('/notes/test.md', todos, 'hash');

      // Should not throw
      cache.invalidate('/notes/nonexistent.md');

      expect(cache.size()).toBe(1);
    });

    it('handles invalidating empty cache gracefully', () => {
      // Should not throw
      cache.invalidate('/notes/test.md');
      cache.invalidate();

      expect(cache.size()).toBe(0);
    });
  });

  describe('getAllCached()', () => {
    it('returns all todos across all files', () => {
      const todos1 = [
        createBasicTodo({ content: 'Task 1', sourceFile: '/notes/a.md', lineNumber: 1 }),
        createBasicTodo({ content: 'Task 2', sourceFile: '/notes/a.md', lineNumber: 2 }),
      ];
      const todos2 = [
        createBasicTodo({ content: 'Task 3', sourceFile: '/notes/b.md', lineNumber: 1 }),
      ];

      cache.set('/notes/a.md', todos1, 'hash1');
      cache.set('/notes/b.md', todos2, 'hash2');

      const allTodos = cache.getAllCached();

      expect(allTodos).toHaveLength(3);
      expect(allTodos).toContainEqual(expect.objectContaining({ content: 'Task 1' }));
      expect(allTodos).toContainEqual(expect.objectContaining({ content: 'Task 2' }));
      expect(allTodos).toContainEqual(expect.objectContaining({ content: 'Task 3' }));
    });

    it('returns empty array when cache is empty', () => {
      expect(cache.getAllCached()).toEqual([]);
    });

    it('includes todos from files with empty todo arrays', () => {
      const todos = [createBasicTodo({ content: 'Task 1' })];

      cache.set('/notes/a.md', todos, 'hash1');
      cache.set('/notes/empty.md', [], 'hash2');

      const allTodos = cache.getAllCached();

      expect(allTodos).toHaveLength(1);
    });

    it('does not validate entries (includes potentially expired)', () => {
      vi.useFakeTimers();

      const todos = [createBasicTodo({ content: 'Task 1' })];
      cache.set('/notes/test.md', todos, 'hash');

      // Advance past expiration
      vi.advanceTimersByTime(6 * 60 * 1000);

      // getAllCached does not validate, so still returns the entry
      const allTodos = cache.getAllCached();
      expect(allTodos).toHaveLength(1);
    });
  });

  describe('getCachedFilePaths()', () => {
    it('returns list of file paths', () => {
      cache.set('/notes/a.md', [createBasicTodo()], 'hash1');
      cache.set('/notes/b.md', [createBasicTodo()], 'hash2');
      cache.set('/notes/c.md', [createBasicTodo()], 'hash3');

      const paths = cache.getCachedFilePaths();

      expect(paths).toHaveLength(3);
      expect(paths).toContain('/notes/a.md');
      expect(paths).toContain('/notes/b.md');
      expect(paths).toContain('/notes/c.md');
    });

    it('returns empty array when cache is empty', () => {
      expect(cache.getCachedFilePaths()).toEqual([]);
    });

    it('includes paths for files with empty todo arrays', () => {
      cache.set('/notes/empty.md', [], 'hash');

      expect(cache.getCachedFilePaths()).toEqual(['/notes/empty.md']);
    });
  });

  describe('size()', () => {
    it('returns correct count', () => {
      expect(cache.size()).toBe(0);

      cache.set('/notes/a.md', [createBasicTodo()], 'hash1');
      expect(cache.size()).toBe(1);

      cache.set('/notes/b.md', [createBasicTodo()], 'hash2');
      expect(cache.size()).toBe(2);

      cache.set('/notes/c.md', [createBasicTodo()], 'hash3');
      expect(cache.size()).toBe(3);
    });

    it('does not double count when overwriting', () => {
      cache.set('/notes/test.md', [createBasicTodo()], 'hash1');
      cache.set('/notes/test.md', [createBasicTodo()], 'hash2');

      expect(cache.size()).toBe(1);
    });

    it('decreases when entries are invalidated', () => {
      cache.set('/notes/a.md', [createBasicTodo()], 'hash1');
      cache.set('/notes/b.md', [createBasicTodo()], 'hash2');

      expect(cache.size()).toBe(2);

      cache.invalidate('/notes/a.md');
      expect(cache.size()).toBe(1);

      cache.invalidate();
      expect(cache.size()).toBe(0);
    });
  });

  describe('has()', () => {
    it('returns true for valid entry', () => {
      cache.set('/notes/test.md', [createBasicTodo()], 'hash');

      expect(cache.has('/notes/test.md')).toBe(true);
    });

    it('returns false for missing entry', () => {
      expect(cache.has('/notes/nonexistent.md')).toBe(false);
    });

    it('returns false for expired entry', () => {
      vi.useFakeTimers();

      cache.set('/notes/test.md', [createBasicTodo()], 'hash');

      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(cache.has('/notes/test.md')).toBe(false);
    });

    it('returns true for non-expired entry', () => {
      vi.useFakeTimers();

      cache.set('/notes/test.md', [createBasicTodo()], 'hash');

      vi.advanceTimersByTime(4 * 60 * 1000);

      expect(cache.has('/notes/test.md')).toBe(true);
    });

    it('does not check content hash (only timestamp)', () => {
      cache.set('/notes/test.md', [createBasicTodo()], 'hash1');

      // has() should return true regardless of hash
      expect(cache.has('/notes/test.md')).toBe(true);
    });
  });

  describe('getStats()', () => {
    it('returns correct statistics for empty cache', () => {
      const stats = cache.getStats();

      expect(stats).toEqual({
        fileCount: 0,
        totalTodos: 0,
        expiredCount: 0,
        maxAge: 5 * 60 * 1000,
      });
    });

    it('returns correct file count', () => {
      cache.set('/notes/a.md', [createBasicTodo()], 'hash1');
      cache.set('/notes/b.md', [createBasicTodo()], 'hash2');

      const stats = cache.getStats();

      expect(stats.fileCount).toBe(2);
    });

    it('returns correct total todos count', () => {
      cache.set('/notes/a.md', [
        createBasicTodo({ lineNumber: 1 }),
        createBasicTodo({ lineNumber: 2 }),
      ], 'hash1');
      cache.set('/notes/b.md', [
        createBasicTodo({ lineNumber: 1 }),
      ], 'hash2');

      const stats = cache.getStats();

      expect(stats.totalTodos).toBe(3);
    });

    it('returns correct expired count', () => {
      vi.useFakeTimers();

      cache.set('/notes/a.md', [createBasicTodo()], 'hash1');

      // Advance time past expiration
      vi.advanceTimersByTime(6 * 60 * 1000);

      cache.set('/notes/b.md', [createBasicTodo()], 'hash2');

      const stats = cache.getStats();

      expect(stats.expiredCount).toBe(1);
      expect(stats.fileCount).toBe(2);
    });

    it('returns configured maxAge', () => {
      const customCache = new TodoCache(10 * 60 * 1000);

      const stats = customCache.getStats();

      expect(stats.maxAge).toBe(10 * 60 * 1000);
    });

    it('includes todos from expired entries in totalTodos', () => {
      vi.useFakeTimers();

      cache.set('/notes/a.md', [
        createBasicTodo({ lineNumber: 1 }),
        createBasicTodo({ lineNumber: 2 }),
      ], 'hash1');

      vi.advanceTimersByTime(6 * 60 * 1000);

      const stats = cache.getStats();

      // Expired entries still count toward totalTodos
      expect(stats.totalTodos).toBe(2);
      expect(stats.expiredCount).toBe(1);
    });
  });
});

describe('hashContent()', () => {
  it('produces consistent hashes for same content', () => {
    const content = 'Hello, world!';

    const hash1 = hashContent(content);
    const hash2 = hashContent(content);

    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different content', () => {
    const hash1 = hashContent('Hello, world!');
    const hash2 = hashContent('Goodbye, world!');

    expect(hash1).not.toBe(hash2);
  });

  it('returns string hash', () => {
    const hash = hashContent('test content');

    expect(typeof hash).toBe('string');
  });

  it('produces base-36 encoded hash', () => {
    const hash = hashContent('test content');

    // Base-36 contains only alphanumeric characters and optional minus sign
    expect(hash).toMatch(/^-?[0-9a-z]+$/);
  });

  it('handles empty string', () => {
    const hash = hashContent('');

    expect(typeof hash).toBe('string');
    expect(hash).toBe('0'); // Empty string produces hash of 0
  });

  it('handles special characters', () => {
    const hash1 = hashContent('Hello\nWorld\t!');
    const hash2 = hashContent('Hello World!');

    expect(hash1).not.toBe(hash2);
  });

  it('handles unicode characters', () => {
    const hash1 = hashContent('Hello');
    const hash2 = hashContent('Hello');

    // Same emoji should produce same hash
    expect(hash1).toBe(hash2);
  });

  it('is case sensitive', () => {
    const hash1 = hashContent('Hello');
    const hash2 = hashContent('hello');

    expect(hash1).not.toBe(hash2);
  });

  it('handles whitespace differences', () => {
    const hash1 = hashContent('Hello World');
    const hash2 = hashContent('Hello  World');

    expect(hash1).not.toBe(hash2);
  });

  it('handles long content', () => {
    const longContent = 'a'.repeat(10000);
    const hash = hashContent(longContent);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('handles multiline markdown content', () => {
    const markdown = `# Title

- [ ] Task 1
- [x] Task 2
- [ ] Task 3

Some paragraph text.`;

    const hash1 = hashContent(markdown);
    const hash2 = hashContent(markdown);

    expect(hash1).toBe(hash2);
  });

  it('detects single character change', () => {
    const content1 = '- [ ] Buy groceries';
    const content2 = '- [x] Buy groceries';

    const hash1 = hashContent(content1);
    const hash2 = hashContent(content2);

    expect(hash1).not.toBe(hash2);
  });
});
