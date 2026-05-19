/**
 * Integration tests for nested folder notes discovery
 *
 * This test verifies the FULL CHAIN from file system to notes service:
 * MemoryFileSystemAdapter → MarkdownAdapter → NotesServiceImpl
 *
 * No mocks - this tests the actual implementations to ensure notes
 * in subdirectories are properly discovered and displayed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import { MarkdownAdapter } from '$lib/adapters/markdown/MarkdownAdapter';
import { NotesServiceImpl } from '$lib/application/services/NotesServiceImpl';

/**
 * Create a valid markdown document with frontmatter
 */
function createMarkdownContent(title: string, body = ''): string {
  return `---
title: ${title}
id: doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}
createdAt: ${new Date().toISOString()}
updatedAt: ${new Date().toISOString()}
tags: []
pinned: false
---
# ${title}

${body}
`;
}

describe('Nested Folder Notes Discovery - Integration Test', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let notesService: NotesServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    notesService = new NotesServiceImpl(documentAdapter);
  });

  describe('MarkdownAdapter.list() recursion', () => {
    it('finds markdown files in root directory', async () => {
      fs.seed({
        '/notes/note1.md': createMarkdownContent('Note 1'),
        '/notes/note2.md': createMarkdownContent('Note 2'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('note1.md');
        expect(paths).toContain('note2.md');
      }
    });

    it('finds markdown files in ONE level of subdirectory', async () => {
      fs.seed({
        '/notes/root.md': createMarkdownContent('Root Note'),
        '/notes/subfolder/nested.md': createMarkdownContent('Nested Note'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('root.md');
        expect(paths).toContain('subfolder/nested.md');
      }
    });

    it('finds markdown files in MULTIPLE levels of subdirectories', async () => {
      fs.seed({
        '/notes/root.md': createMarkdownContent('Root'),
        '/notes/level1/note.md': createMarkdownContent('Level 1'),
        '/notes/level1/level2/note.md': createMarkdownContent('Level 2'),
        '/notes/level1/level2/level3/note.md': createMarkdownContent('Level 3'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(4);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('root.md');
        expect(paths).toContain('level1/note.md');
        expect(paths).toContain('level1/level2/note.md');
        expect(paths).toContain('level1/level2/level3/note.md');
      }
    });

    it('finds markdown files in SIBLING subdirectories', async () => {
      fs.seed({
        '/notes/work/project1.md': createMarkdownContent('Project 1'),
        '/notes/work/project2.md': createMarkdownContent('Project 2'),
        '/notes/personal/diary.md': createMarkdownContent('Diary'),
        '/notes/personal/ideas.md': createMarkdownContent('Ideas'),
        '/notes/archive/old-note.md': createMarkdownContent('Old Note'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(5);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('work/project1.md');
        expect(paths).toContain('work/project2.md');
        expect(paths).toContain('personal/diary.md');
        expect(paths).toContain('personal/ideas.md');
        expect(paths).toContain('archive/old-note.md');
      }
    });
  });

  describe('NotesServiceImpl.loadFolderTree() with nested folders', () => {
    it('builds correct tree structure from nested files', async () => {
      fs.seed({
        '/notes/root-note.md': createMarkdownContent('Root Note'),
        '/notes/work/project.md': createMarkdownContent('Project'),
        '/notes/work/deep/nested.md': createMarkdownContent('Nested'),
      });

      const result = await notesService.loadFolderTree();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have 2 top-level items: root-note.md and work folder
        expect(result.value.length).toBe(2);

        // Find the work folder
        const workFolder = result.value.find((item) => item.path === 'work');
        expect(workFolder).toBeDefined();
        expect(workFolder?.isFolder).toBe(true);
        expect(workFolder?.children?.length).toBe(2); // project.md and deep folder

        // Find the deep folder inside work
        const deepFolder = workFolder?.children?.find((item) => item.path === 'work/deep');
        expect(deepFolder).toBeDefined();
        expect(deepFolder?.isFolder).toBe(true);
        expect(deepFolder?.children?.length).toBe(1); // nested.md

        // Find the nested note
        const nestedNote = deepFolder?.children?.find((item) => item.path === 'work/deep/nested.md');
        expect(nestedNote).toBeDefined();
        expect(nestedNote?.isFolder).toBe(false);
        expect(nestedNote?.title).toBe('Nested');
      }
    });

    it('state contains all notes from nested folders', async () => {
      fs.seed({
        '/notes/a.md': createMarkdownContent('A'),
        '/notes/folder1/b.md': createMarkdownContent('B'),
        '/notes/folder1/folder2/c.md': createMarkdownContent('C'),
        '/notes/folder1/folder2/folder3/d.md': createMarkdownContent('D'),
        '/notes/other/e.md': createMarkdownContent('E'),
      });

      await notesService.loadFolderTree();
      const state = notesService.getState();

      // Flatten the tree to count notes
      function countNotes(items: typeof state.items): number {
        let count = 0;
        for (const item of items) {
          if (item.isFolder) {
            count += countNotes(item.children || []);
          } else {
            count++;
          }
        }
        return count;
      }

      expect(countNotes(state.items)).toBe(5);
    });

    it('REAL SCENARIO: simulates ~/notes with 5 nested notes', async () => {
      // This simulates the exact user scenario
      fs.seed({
        '/notes/Ideeën/startup-idee.md': createMarkdownContent('Startup Idee'),
        '/notes/Ideeën/app-concept.md': createMarkdownContent('App Concept'),
        '/notes/Dagboek/2026-01-15.md': createMarkdownContent('15 januari'),
        '/notes/Dagboek/2026-01-20.md': createMarkdownContent('20 januari'),
        '/notes/Werk/project-notes.md': createMarkdownContent('Project Notes'),
      });

      const result = await notesService.loadFolderTree();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have 3 folders at root level
        expect(result.value.length).toBe(3);
        expect(result.value.every((item) => item.isFolder)).toBe(true);

        // Get state and verify note count
        const state = notesService.getState();

        // Flatten to get all notes
        function getAllNotes(items: typeof state.items): string[] {
          const paths: string[] = [];
          for (const item of items) {
            if (item.isFolder) {
              paths.push(...getAllNotes(item.children || []));
            } else {
              paths.push(item.path);
            }
          }
          return paths;
        }

        const allNotePaths = getAllNotes(state.items);
        expect(allNotePaths).toHaveLength(5);
        expect(allNotePaths).toContain('Ideeën/startup-idee.md');
        expect(allNotePaths).toContain('Ideeën/app-concept.md');
        expect(allNotePaths).toContain('Dagboek/2026-01-15.md');
        expect(allNotePaths).toContain('Dagboek/2026-01-20.md');
        expect(allNotePaths).toContain('Werk/project-notes.md');
      }
    });
  });

  describe('Edge cases', () => {
    it('handles empty nested directories (no files, just folders)', async () => {
      // Create a directory structure where some folders are empty
      fs.seed({
        '/notes/filled/note.md': createMarkdownContent('Note'),
      });
      await fs.createDirectory('/notes/Test');
      await fs.createDirectory('/notes/empty/deep');

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('filled/note.md');
      }

      const folders = await documentAdapter.listFolders();
      expect(folders.ok).toBe(true);
      if (folders.ok) {
        expect(folders.value.map((folder) => folder.path)).toEqual(expect.arrayContaining([
          'Test',
          'empty',
          'empty/deep',
          'filled',
        ]));
        expect(folders.value).toHaveLength(4);
      }
    });

    it('shows externally-created empty folders in the notes tree after refresh', async () => {
      await fs.createDirectory('/notes/Test');

      const result = await notesService.loadFolderTree();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        path: 'Test',
        title: 'Test',
        isFolder: true,
        children: [],
      });
    });

    it('ignores non-markdown files in nested directories', async () => {
      fs.seed({
        '/notes/folder/note.md': createMarkdownContent('Note'),
        '/notes/folder/image.png': 'binary content',
        '/notes/folder/data.json': '{}',
        '/notes/folder/readme.txt': 'text',
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('folder/note.md');
      }
    });

    it('handles very deep nesting (10 levels)', async () => {
      fs.seed({
        '/notes/1/2/3/4/5/6/7/8/9/10/deep.md': createMarkdownContent('Deep Note'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('1/2/3/4/5/6/7/8/9/10/deep.md');
      }
    });

    it('handles folders with special characters in names', async () => {
      fs.seed({
        '/notes/folder with spaces/note.md': createMarkdownContent('Note'),
        '/notes/folder-with-dashes/note.md': createMarkdownContent('Note 2'),
        '/notes/folder_with_underscores/note.md': createMarkdownContent('Note 3'),
      });

      const result = await documentAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('folder with spaces/note.md');
        expect(paths).toContain('folder-with-dashes/note.md');
        expect(paths).toContain('folder_with_underscores/note.md');
      }
    });
  });
});
