/**
 * FileServiceImpl Tests
 *
 * Unit tests for the FileServiceImpl application service.
 * Uses MemoryFileSystemAdapter for testing file operations without Tauri.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import { FileServiceImpl } from '$lib/application/services';

describe('FileServiceImpl', () => {
  let adapter: MemoryFileSystemAdapter;
  let service: FileServiceImpl;

  beforeEach(() => {
    adapter = new MemoryFileSystemAdapter();
    service = new FileServiceImpl(adapter);
  });

  describe('read()', () => {
    it('reads file content successfully', async () => {
      adapter.seed({
        '/notes/test.md': '# Test Content',
      });

      const result = await service.read('/notes/test.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('# Test Content');
      }
    });

    it('reads file with empty content', async () => {
      adapter.seed({
        '/notes/empty.md': '',
      });

      const result = await service.read('/notes/empty.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('reads file with multiline content', async () => {
      const content = '# Title\n\nParagraph 1\n\nParagraph 2';
      adapter.seed({
        '/notes/multiline.md': content,
      });

      const result = await service.read('/notes/multiline.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(content);
      }
    });

    it('returns error when file not found', async () => {
      const result = await service.read('/nonexistent/file.md');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('File not found');
        expect(result.error.message).toContain('/nonexistent/file.md');
      }
    });

    it('returns error when reading a directory', async () => {
      await service.createDirectory('/notes');

      const result = await service.read('/notes');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('directory');
      }
    });
  });

  describe('write()', () => {
    it('creates a new file', async () => {
      const result = await service.write('/notes/new.md', '# New File');

      expect(result.ok).toBe(true);

      // Verify file was created
      const readResult = await service.read('/notes/new.md');
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBe('# New File');
      }
    });

    it('overwrites existing file', async () => {
      adapter.seed({
        '/notes/existing.md': '# Old Content',
      });

      const result = await service.write('/notes/existing.md', '# New Content');

      expect(result.ok).toBe(true);

      // Verify content was overwritten
      const readResult = await service.read('/notes/existing.md');
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBe('# New Content');
      }
    });

    it('creates parent directories automatically', async () => {
      const result = await service.write('/deep/nested/path/file.md', 'content');

      expect(result.ok).toBe(true);

      // Verify file exists
      const _exists_r = await service.exists('/deep/nested/path/file.md');
      const exists = _exists_r.ok && _exists_r.value;
      expect(exists).toBe(true);

      // Verify parent directories exist
      const _deepExists_r = await service.exists('/deep');
      const deepExists = _deepExists_r.ok && _deepExists_r.value;
      const _nestedExists_r = await service.exists('/deep/nested');
      const nestedExists = _nestedExists_r.ok && _nestedExists_r.value;
      const _pathExists_r = await service.exists('/deep/nested/path');
      const pathExists = _pathExists_r.ok && _pathExists_r.value;
      expect(deepExists).toBe(true);
      expect(nestedExists).toBe(true);
      expect(pathExists).toBe(true);
    });

    it('writes empty content', async () => {
      const result = await service.write('/notes/empty.md', '');

      expect(result.ok).toBe(true);

      const readResult = await service.read('/notes/empty.md');
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBe('');
      }
    });

    it('writes content with special characters', async () => {
      const content = '# Special: <>&"\' chars\n\nUnicode: \u4e2d\u6587\n\nEmoji: \u{1F680}';

      const result = await service.write('/notes/special.md', content);

      expect(result.ok).toBe(true);

      const readResult = await service.read('/notes/special.md');
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBe(content);
      }
    });
  });

  describe('delete()', () => {
    it('deletes an existing file', async () => {
      adapter.seed({
        '/notes/to-delete.md': '# Delete Me',
      });

      const result = await service.delete('/notes/to-delete.md');

      expect(result.ok).toBe(true);

      // Verify file no longer exists
      const _exists_r = await service.exists('/notes/to-delete.md');
      const exists = _exists_r.ok && _exists_r.value;
      expect(exists).toBe(false);
    });

    it('returns error when file not found', async () => {
      const result = await service.delete('/nonexistent/file.md');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('File not found');
        expect(result.error.message).toContain('/nonexistent/file.md');
      }
    });

    it('returns error when trying to delete a directory', async () => {
      await service.createDirectory('/notes/folder');

      const result = await service.delete('/notes/folder');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('directory');
      }
    });

    it('does not affect other files when deleting', async () => {
      adapter.seed({
        '/notes/keep.md': '# Keep Me',
        '/notes/delete.md': '# Delete Me',
      });

      await service.delete('/notes/delete.md');

      // Other file should still exist
      const _keepExists_r = await service.exists('/notes/keep.md');
      const keepExists = _keepExists_r.ok && _keepExists_r.value;
      expect(keepExists).toBe(true);

      const readResult = await service.read('/notes/keep.md');
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBe('# Keep Me');
      }
    });
  });

  describe('list()', () => {
    it('lists directory contents', async () => {
      adapter.seed({
        '/notes/file1.md': '# File 1',
        '/notes/file2.md': '# File 2',
        '/notes/file3.md': '# File 3',
      });

      const result = await service.list('/notes');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const names = result.value.map((entry) => entry.name).sort();
        expect(names).toEqual(['file1.md', 'file2.md', 'file3.md']);
      }
    });

    it('lists files and directories', async () => {
      adapter.seed({
        '/notes/file.md': '# File',
      });
      await service.createDirectory('/notes/subfolder');

      const result = await service.list('/notes');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);

        const file = result.value.find((e) => e.name === 'file.md');
        const folder = result.value.find((e) => e.name === 'subfolder');

        expect(file).toBeDefined();
        expect(file?.isFile).toBe(true);
        expect(file?.isDirectory).toBe(false);

        expect(folder).toBeDefined();
        expect(folder?.isFile).toBe(false);
        expect(folder?.isDirectory).toBe(true);
      }
    });

    it('returns empty array for empty directory', async () => {
      await service.createDirectory('/empty');

      const result = await service.list('/empty');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('only lists direct children, not nested', async () => {
      adapter.seed({
        '/notes/direct.md': '# Direct',
        '/notes/sub/nested.md': '# Nested',
      });

      const result = await service.list('/notes');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const names = result.value.map((entry) => entry.name);
        expect(names).toContain('direct.md');
        expect(names).toContain('sub');
        expect(names).not.toContain('nested.md');
      }
    });

    it('returns error when directory not found', async () => {
      const result = await service.list('/nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Directory not found');
      }
    });

    it('returns error when listing a file', async () => {
      adapter.seed({
        '/notes/file.md': '# File',
      });

      const result = await service.list('/notes/file.md');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not a directory');
      }
    });

    it('includes file size for files', async () => {
      const content = '# Test Content';
      adapter.seed({
        '/notes/test.md': content,
      });

      const result = await service.list('/notes');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const file = result.value.find((e) => e.name === 'test.md');
        expect(file).toBeDefined();
        expect(file?.size).toBe(content.length);
      }
    });

    it('includes modification date', async () => {
      adapter.seed({
        '/notes/test.md': '# Test',
      });

      const result = await service.list('/notes');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const file = result.value.find((e) => e.name === 'test.md');
        expect(file).toBeDefined();
        expect(file?.modifiedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('exists()', () => {
    it('returns true for existing file', async () => {
      adapter.seed({
        '/notes/exists.md': '# Exists',
      });

      const _exists_r = await service.exists('/notes/exists.md');
      const exists = _exists_r.ok && _exists_r.value;

      expect(exists).toBe(true);
    });

    it('returns true for existing directory', async () => {
      await service.createDirectory('/notes');

      const _exists_r = await service.exists('/notes');
      const exists = _exists_r.ok && _exists_r.value;

      expect(exists).toBe(true);
    });

    it('returns false for non-existing path', async () => {
      const _exists_r = await service.exists('/nonexistent/path');
      const exists = _exists_r.ok && _exists_r.value;

      expect(exists).toBe(false);
    });

    it('returns true for root directory', async () => {
      const _exists_r = await service.exists('/');
      const exists = _exists_r.ok && _exists_r.value;

      expect(exists).toBe(true);
    });

    it('handles paths with trailing slashes', async () => {
      adapter.seed({
        '/notes/test.md': '# Test',
      });

      const _fileExists_r = await service.exists('/notes/test.md/');
      const fileExists = _fileExists_r.ok && _fileExists_r.value;
      const _dirExists_r = await service.exists('/notes/');
      const dirExists = _dirExists_r.ok && _dirExists_r.value;

      expect(fileExists).toBe(true);
      expect(dirExists).toBe(true);
    });
  });

  describe('createDirectory()', () => {
    it('creates a new directory', async () => {
      const result = await service.createDirectory('/new-folder');

      expect(result.ok).toBe(true);

      const _exists_r = await service.exists('/new-folder');
      const exists = _exists_r.ok && _exists_r.value;
      expect(exists).toBe(true);
    });

    it('creates nested directories recursively', async () => {
      const result = await service.createDirectory('/a/b/c/d');

      expect(result.ok).toBe(true);

      // All directories should exist
      expect((await service.exists('/a')).value).toBe(true);
      expect((await service.exists('/a/b')).value).toBe(true);
      expect((await service.exists('/a/b/c')).value).toBe(true);
      expect((await service.exists('/a/b/c/d')).value).toBe(true);
    });

    it('succeeds when directory already exists', async () => {
      await service.createDirectory('/existing');

      const result = await service.createDirectory('/existing');

      expect(result.ok).toBe(true);
    });

    it('returns error when path exists as a file', async () => {
      adapter.seed({
        '/file-not-dir': 'content',
      });

      const result = await service.createDirectory('/file-not-dir');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('exists as a file');
      }
    });

    it('can list newly created empty directory', async () => {
      await service.createDirectory('/new-empty');

      const listResult = await service.list('/new-empty');

      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });
  });

  describe('integration scenarios', () => {
    it('can create, read, update, and delete a file (CRUD)', async () => {
      // Create
      const createResult = await service.write('/crud/test.md', '# Initial');
      expect(createResult.ok).toBe(true);

      // Read
      const readResult1 = await service.read('/crud/test.md');
      expect(readResult1.ok).toBe(true);
      if (readResult1.ok) {
        expect(readResult1.value).toBe('# Initial');
      }

      // Update
      const updateResult = await service.write('/crud/test.md', '# Updated');
      expect(updateResult.ok).toBe(true);

      const readResult2 = await service.read('/crud/test.md');
      expect(readResult2.ok).toBe(true);
      if (readResult2.ok) {
        expect(readResult2.value).toBe('# Updated');
      }

      // Delete
      const deleteResult = await service.delete('/crud/test.md');
      expect(deleteResult.ok).toBe(true);

      const _existsAfterDelete_r = await service.exists('/crud/test.md');
      const existsAfterDelete = _existsAfterDelete_r.ok && _existsAfterDelete_r.value;
      expect(existsAfterDelete).toBe(false);
    });

    it('can organize files into folders', async () => {
      // Create folder structure
      await service.createDirectory('/projects/project-a');
      await service.createDirectory('/projects/project-b');

      // Add files to each project
      await service.write('/projects/project-a/readme.md', '# Project A');
      await service.write('/projects/project-a/notes.md', 'Notes for A');
      await service.write('/projects/project-b/readme.md', '# Project B');

      // List projects folder
      const projectsResult = await service.list('/projects');
      expect(projectsResult.ok).toBe(true);
      if (projectsResult.ok) {
        expect(projectsResult.value).toHaveLength(2);
        expect(projectsResult.value.every((e) => e.isDirectory)).toBe(true);
      }

      // List project-a files
      const projectAResult = await service.list('/projects/project-a');
      expect(projectAResult.ok).toBe(true);
      if (projectAResult.ok) {
        expect(projectAResult.value).toHaveLength(2);
        const names = projectAResult.value.map((e) => e.name).sort();
        expect(names).toEqual(['notes.md', 'readme.md']);
      }
    });

    it('handles path normalization consistently', async () => {
      // Write with various path formats
      await service.write('/notes/test.md', 'content');

      // All these should find the file
      expect((await service.exists('/notes/test.md')).value).toBe(true);
      expect((await service.exists('/notes/test.md/')).value).toBe(true);
      expect((await service.exists('notes/test.md')).value).toBe(true);

      // Read should work with normalized paths
      const result = await service.read('notes/test.md');
      expect(result.ok).toBe(true);
    });
  });
});
