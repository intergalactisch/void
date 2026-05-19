/**
 * Unit tests for MemoryFileSystemAdapter
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';

describe('MemoryFileSystemAdapter', () => {
  let adapter: MemoryFileSystemAdapter;

  beforeEach(() => {
    adapter = new MemoryFileSystemAdapter();
  });

  describe('readFile()', () => {
    it('reads seeded file content', async () => {
      adapter.seed({ '/notes/test.md': '# Hello World' });
      const result = await adapter.readFile('/notes/test.md');

      expect(result.ok).toBe(true);
      expect(result.value).toBe('# Hello World');
    });

    it('returns error for non-existent file', async () => {
      const result = await adapter.readFile('/nonexistent.md');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('not found');
    });

    it('returns error when reading directory as file', async () => {
      await adapter.createDirectory('/notes');
      const result = await adapter.readFile('/notes');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('directory');
    });

    it('normalizes paths', async () => {
      adapter.seed({ '/notes/test.md': 'content' });
      const result = await adapter.readFile('notes/test.md');

      expect(result.ok).toBe(true);
      expect(result.value).toBe('content');
    });
  });

  describe('writeFile()', () => {
    it('writes new file', async () => {
      const writeResult = await adapter.writeFile('/test.md', 'Hello');

      expect(writeResult.ok).toBe(true);

      const readResult = await adapter.readFile('/test.md');
      expect(readResult.ok).toBe(true);
      expect(readResult.value).toBe('Hello');
    });

    it('overwrites existing file', async () => {
      await adapter.writeFile('/test.md', 'Original');
      await adapter.writeFile('/test.md', 'Updated');

      const result = await adapter.readFile('/test.md');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('Updated');
    });

    it('creates parent directories automatically', async () => {
      await adapter.writeFile('/deep/nested/path/file.md', 'content');

      expect((await adapter.exists('/deep')).value).toBe(true);
      expect((await adapter.exists('/deep/nested')).value).toBe(true);
      expect((await adapter.exists('/deep/nested/path')).value).toBe(true);

      const result = await adapter.readFile('/deep/nested/path/file.md');
      expect(result.ok).toBe(true);
    });
  });

  describe('deleteFile()', () => {
    it('deletes existing file', async () => {
      adapter.seed({ '/test.md': 'content' });

      const result = await adapter.deleteFile('/test.md');
      expect(result.ok).toBe(true);

      expect((await adapter.exists('/test.md')).value).toBe(false);
    });

    it('returns error for non-existent file', async () => {
      const result = await adapter.deleteFile('/nonexistent.md');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('not found');
    });

    it('returns error when deleting directory', async () => {
      await adapter.createDirectory('/notes');
      const result = await adapter.deleteFile('/notes');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('directory');
    });
  });

  describe('listDirectory()', () => {
    it('lists directory contents', async () => {
      adapter.seed({
        '/notes/a.md': 'A',
        '/notes/b.md': 'B',
        '/notes/c.md': 'C',
      });

      const result = await adapter.listDirectory('/notes');

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(3);
      expect(result.value.map((e) => e.name).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('returns error for non-existent directory', async () => {
      const result = await adapter.listDirectory('/nonexistent');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('not found');
    });

    it('returns error for file path', async () => {
      adapter.seed({ '/test.md': 'content' });
      const result = await adapter.listDirectory('/test.md');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('not a directory');
    });

    it('only lists direct children, not nested', async () => {
      adapter.seed({
        '/notes/a.md': 'A',
        '/notes/sub/b.md': 'B',
      });

      const result = await adapter.listDirectory('/notes');

      expect(result.ok).toBe(true);
      // Should only see a.md and sub directory
      const names = result.value.map((e) => e.name);
      expect(names).toContain('a.md');
      expect(names).toContain('sub');
      expect(names).not.toContain('b.md');
    });

    it('includes file metadata', async () => {
      adapter.seed({ '/notes/test.md': 'Hello World' });

      const result = await adapter.listDirectory('/notes');

      expect(result.ok).toBe(true);
      const file = result.value.find((e) => e.name === 'test.md');
      expect(file).toBeDefined();
      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(file?.size).toBe(11);
      expect(file?.modifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('exists()', () => {
    it('returns true for existing file', async () => {
      adapter.seed({ '/test.md': 'content' });
      expect((await adapter.exists('/test.md')).value).toBe(true);
    });

    it('returns true for existing directory', async () => {
      await adapter.createDirectory('/notes');
      expect((await adapter.exists('/notes')).value).toBe(true);
    });

    it('returns false for non-existent path', async () => {
      expect((await adapter.exists('/nonexistent')).value).toBe(false);
    });

    it('returns true for root directory', async () => {
      expect((await adapter.exists('/')).value).toBe(true);
    });
  });

  describe('createDirectory()', () => {
    it('creates directory', async () => {
      const result = await adapter.createDirectory('/notes');

      expect(result.ok).toBe(true);
      expect((await adapter.exists('/notes')).value).toBe(true);
    });

    it('creates nested directories', async () => {
      await adapter.createDirectory('/a/b/c');

      expect((await adapter.exists('/a')).value).toBe(true);
      expect((await adapter.exists('/a/b')).value).toBe(true);
      expect((await adapter.exists('/a/b/c')).value).toBe(true);
    });

    it('is idempotent', async () => {
      await adapter.createDirectory('/notes');
      const result = await adapter.createDirectory('/notes');

      expect(result.ok).toBe(true);
    });

    it('returns error if path is a file', async () => {
      adapter.seed({ '/test': 'content' });
      const result = await adapter.createDirectory('/test');

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('file');
    });
  });

  describe('Testing utilities', () => {
    describe('seed()', () => {
      it('populates files', () => {
        adapter.seed({
          '/a.md': 'A',
          '/b.md': 'B',
        });

        expect(adapter.getPaths()).toContain('/a.md');
        expect(adapter.getPaths()).toContain('/b.md');
      });

      it('creates parent directories', () => {
        adapter.seed({ '/notes/sub/file.md': 'content' });

        expect(adapter.getPaths()).toContain('/notes');
        expect(adapter.getPaths()).toContain('/notes/sub');
      });
    });

    describe('clear()', () => {
      it('removes all files and directories', async () => {
        adapter.seed({ '/a.md': 'A', '/notes/b.md': 'B' });
        adapter.clear();

        expect((await adapter.exists('/a.md')).value).toBe(false);
        expect((await adapter.exists('/notes')).value).toBe(false);
        // Root should still exist
        expect((await adapter.exists('/')).value).toBe(true);
      });
    });

    describe('getPaths()', () => {
      it('returns all stored paths', () => {
        adapter.seed({
          '/a.md': 'A',
          '/notes/b.md': 'B',
        });

        const paths = adapter.getPaths();
        expect(paths).toContain('/a.md');
        expect(paths).toContain('/notes/b.md');
        expect(paths).toContain('/notes');
      });
    });
  });
});
