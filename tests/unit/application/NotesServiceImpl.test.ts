/**
 * NotesServiceImpl Tests
 *
 * Tests for the notes service implementation, specifically the quick note creation
 * with collision handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesServiceImpl } from '$lib/application/services/NotesServiceImpl';
import type { DocumentPort } from '$lib/ports/outbound';
import type { Document } from '$lib/domain';
import { TODO_LIST_FRONTMATTER_TYPE } from '$lib/domain';
import { ok } from '$lib/core';

/**
 * Create a mock DocumentPort for testing.
 */
function createMockDocumentPort(existingPaths: Set<string> = new Set()): DocumentPort {
  return {
    load: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    trash: vi.fn().mockImplementation((path: string) => {
      existingPaths.delete(path);
      return Promise.resolve(ok({
        id: 'trash-1',
        originalPath: path,
        title: path.replace(/\.md$/i, ''),
        deletedAt: new Date(),
      }));
    }),
    listTrash: vi.fn().mockResolvedValue(ok([])),
    restoreFromTrash: vi.fn().mockImplementation((id: string) => Promise.resolve(ok({
      path: 'restored.md',
      meta: {
        id,
        title: 'Restored',
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        category: null,
        color: null,
        pinned: false,
        status: 'draft',
        intent: 'general',
        aiTouches: 0,
        custom: {},
      },
      blocks: [],
      isDirty: false,
    }))),
    deleteFromTrash: vi.fn().mockResolvedValue(ok(undefined)),
    list: vi.fn().mockResolvedValue(ok([])),
    listFolders: vi.fn().mockResolvedValue(ok([])),
    exists: vi.fn().mockImplementation((path: string) => Promise.resolve(ok(existingPaths.has(path)))),
    create: vi.fn().mockImplementation((path: string, title?: string) => {
      existingPaths.add(path);
      const doc: Document = {
        path,
        meta: {
          id: 'test-id',
          title: title || 'Untitled',
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          category: null,
          color: null,
          pinned: false,
          status: 'draft',
          intent: 'general',
          aiTouches: 0,
          custom: {},
        },
        blocks: [],
        isDirty: false,
      };
      return Promise.resolve(ok(doc));
    }),
    watch: vi.fn().mockReturnValue(() => {}),
  };
}

describe('NotesServiceImpl', () => {
  describe('loadFolderTree', () => {
    it('builds flat tag groups with an Untagged fallback', async () => {
      const mockPort = createMockDocumentPort();
      const updatedAt = new Date('2026-01-01T00:00:00.000Z');
      mockPort.list = vi.fn().mockResolvedValue(ok([
        {
          path: 'alpha.md',
          meta: {
            id: '1',
            title: 'Alpha',
            tags: ['work', 'ideas'],
            category: null,
            color: null,
            createdAt: updatedAt,
            updatedAt,
            pinned: false,
            status: 'draft',
            intent: 'general',
            aiTouches: 0,
            custom: {},
          },
        },
        {
          path: 'beta.md',
          meta: {
            id: '2',
            title: 'Beta',
            tags: ['work'],
            category: null,
            color: null,
            createdAt: updatedAt,
            updatedAt,
            pinned: false,
            status: 'draft',
            intent: 'general',
            aiTouches: 0,
            custom: {},
          },
        },
        {
          path: 'gamma.md',
          meta: {
            id: '3',
            title: 'Gamma',
            tags: [],
            category: null,
            color: null,
            createdAt: updatedAt,
            updatedAt,
            pinned: false,
            status: 'draft',
            intent: 'general',
            aiTouches: 0,
            custom: {},
          },
        },
      ]));
      const service = new NotesServiceImpl(mockPort);

      const result = await service.loadFolderTree();

      expect(result.ok).toBe(true);
      const groups = service.getState().tagGroups;
      expect(groups.map((group) => group.id)).toEqual(['ideas', 'work', '__untagged__']);
      expect(groups.find((group) => group.id === 'work')?.notes.map((note) => note.path)).toEqual(['alpha.md', 'beta.md']);
      expect(groups.find((group) => group.id === '__untagged__')?.notes.map((note) => note.path)).toEqual(['gamma.md']);
    });

    it('hides protected and custom todo list files from notes navigation', async () => {
      const mockPort = createMockDocumentPort();
      const updatedAt = new Date('2026-01-01T00:00:00.000Z');
      const meta = (
        id: string,
        title: string,
        tags: string[] = [],
        custom: Record<string, unknown> = {}
      ) => ({
        id,
        title,
        tags,
        category: null,
        color: null,
        createdAt: updatedAt,
        updatedAt,
        pinned: false,
        status: 'draft' as const,
        intent: 'general' as const,
        aiTouches: 0,
        custom,
      });
      mockPort.list = vi.fn().mockResolvedValue(ok([
        {
          path: 'TODO.md',
          meta: meta('todo', 'Todo', ['work']),
        },
        {
          path: 'todo-work.md',
          meta: meta('work-list', 'Work', ['work'], { void_type: TODO_LIST_FRONTMATTER_TYPE }),
        },
        {
          path: 'project.md',
          meta: meta('project', 'Project', ['work']),
        },
      ]));
      const service = new NotesServiceImpl(mockPort);

      const result = await service.loadFolderTree();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((item) => item.path)).toEqual(['project.md']);
      expect(service.getState().tagGroups.find((group) => group.id === 'work')?.notes.map((note) => note.path)).toEqual(['project.md']);
    });
  });

  describe('empty folders', () => {
    it('includes discovered folders even when they contain no notes', async () => {
      const mockPort = createMockDocumentPort();
      const modifiedAt = new Date('2026-05-11T08:00:00.000Z');
      mockPort.listFolders = vi.fn().mockResolvedValue(ok([
        { path: 'Test', name: 'Test', modifiedAt },
        { path: 'Research/Agents', name: 'Agents', modifiedAt },
      ]));
      const service = new NotesServiceImpl(mockPort);

      const result = await service.loadFolderTree();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const testFolder = result.value.find((item) => item.path === 'Test');
      expect(testFolder).toMatchObject({
        title: 'Test',
        isFolder: true,
        children: [],
      });
      const research = result.value.find((item) => item.path === 'Research');
      expect(research?.isFolder).toBe(true);
      expect(research?.children?.some((item) => item.path === 'Research/Agents')).toBe(true);
    });
  });

  describe('createQuickNote', () => {
    it('creates a note with datetime filename', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      const result = await service.createQuickNote();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Filename should match pattern: YYYY-MM-DD-HH-MM-SS.md
        expect(result.value.path).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
        // Title should be human readable
        expect(result.value.meta.title).toMatch(/\w+ \d+, \d{4} \d{2}:\d{2}/);
      }
    });

    it('adds suffix when file already exists', async () => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const existingFilename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.md`;

      const existingPaths = new Set([existingFilename]);
      const mockPort = createMockDocumentPort(existingPaths);
      const service = new NotesServiceImpl(mockPort);

      const result = await service.createQuickNote();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have -1 suffix
        expect(result.value.path).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-1\.md$/);
        // Title should include suffix
        expect(result.value.meta.title).toMatch(/\(1\)$/);
      }
    });

    it('increments suffix when multiple files exist', async () => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

      const existingPaths = new Set([
        `${base}.md`,
        `${base}-1.md`,
        `${base}-2.md`,
      ]);
      const mockPort = createMockDocumentPort(existingPaths);
      const service = new NotesServiceImpl(mockPort);

      const result = await service.createQuickNote();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have -3 suffix
        expect(result.value.path).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-3\.md$/);
        // Title should include suffix
        expect(result.value.meta.title).toMatch(/\(3\)$/);
      }
    });

    it('creates note in specified folder', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      const result = await service.createQuickNote('my-folder');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.path).toMatch(/^my-folder\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
      }
    });

    it('auto-selects the created note', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      // Check initial state
      expect(service.getSelectedPath()).toBeNull();

      const result = await service.createQuickNote();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // After creation, the note should be selected
        expect(service.getSelectedPath()).toBe(result.value.path);
      }
    });

    it('notifies subscribers when auto-selecting created note', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      // Track state changes via subscription
      const stateUpdates: string[] = [];
      service.subscribe((state) => {
        if (state.selectedPath) {
          stateUpdates.push(state.selectedPath);
        }
      });

      const result = await service.createQuickNote();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Subscription should have received the selection
        expect(stateUpdates).toContain(result.value.path);
      }
    });
  });

  describe('createNote', () => {
    it('auto-selects the created note', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      // Check initial state
      expect(service.getSelectedPath()).toBeNull();

      const result = await service.createNote('', 'My Test Note');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // After creation, the note should be selected
        expect(service.getSelectedPath()).toBe(result.value.path);
      }
    });

    it('notifies subscribers when auto-selecting created note', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      // Track state changes via subscription
      const stateUpdates: string[] = [];
      service.subscribe((state) => {
        if (state.selectedPath) {
          stateUpdates.push(state.selectedPath);
        }
      });

      const result = await service.createNote('', 'Subscriber Test Note');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Subscription should have received the selection
        expect(stateUpdates).toContain(result.value.path);
      }
    });
  });

  describe('trash operations', () => {
    it('moves deleted notes to recoverable Trash', async () => {
      const existingPaths = new Set(['old-note.md']);
      const mockPort = createMockDocumentPort(existingPaths);
      const service = new NotesServiceImpl(mockPort);

      const result = await service.deleteNote('old-note.md');

      expect(result.ok).toBe(true);
      expect(mockPort.trash).toHaveBeenCalledWith('old-note.md');
      expect(mockPort.delete).not.toHaveBeenCalled();
    });

    it('lists trashed notes through the document port', async () => {
      const deletedAt = new Date('2026-05-25T10:00:00.000Z');
      const mockPort = createMockDocumentPort();
      mockPort.listTrash = vi.fn().mockResolvedValue(ok([
        {
          id: 'trash-1',
          originalPath: 'old-note.md',
          title: 'Old Note',
          deletedAt,
        },
      ]));
      const service = new NotesServiceImpl(mockPort);

      const result = await service.listTrashedNotes();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([
        {
          id: 'trash-1',
          originalPath: 'old-note.md',
          title: 'Old Note',
          deletedAt,
        },
      ]);
    });

    it('restores a trashed note and refreshes the tree', async () => {
      const mockPort = createMockDocumentPort();
      const restored: Document = {
        path: 'old-note.md',
        meta: {
          id: 'restored',
          title: 'Old Note',
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          category: null,
          color: null,
          pinned: false,
          status: 'draft',
          intent: 'general',
          aiTouches: 0,
          custom: {},
        },
        blocks: [],
        isDirty: false,
      };
      mockPort.restoreFromTrash = vi.fn().mockResolvedValue(ok(restored));
      const service = new NotesServiceImpl(mockPort);

      const result = await service.restoreNoteFromTrash('trash-1');

      expect(result.ok).toBe(true);
      expect(mockPort.restoreFromTrash).toHaveBeenCalledWith('trash-1');
      expect(mockPort.list).toHaveBeenCalled();
    });
  });

  describe('selectNote', () => {
    it('does not notify subscribers when selecting same path twice', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      let callCount = 0;
      service.subscribe(() => {
        callCount++;
      });

      // Initial subscription call
      const initialCallCount = callCount;

      // Select a path
      service.selectNote('note.md');
      const afterFirstSelect = callCount;

      // Select same path again - should not notify
      service.selectNote('note.md');
      const afterSecondSelect = callCount;

      expect(afterFirstSelect).toBe(initialCallCount + 1);
      expect(afterSecondSelect).toBe(afterFirstSelect); // No additional notification
    });

    it('handles rapid selection changes', async () => {
      const mockPort = createMockDocumentPort();
      const service = new NotesServiceImpl(mockPort);

      const selections: (string | null)[] = [];
      service.subscribe((state) => {
        selections.push(state.selectedPath);
      });

      // Rapid selections
      service.selectNote('note1.md');
      service.selectNote('note2.md');
      service.selectNote('note3.md');
      service.selectNote(null);
      service.selectNote('note4.md');

      // Should track all unique selections
      // Initial null + all changes that are different from previous
      expect(selections).toContain('note1.md');
      expect(selections).toContain('note2.md');
      expect(selections).toContain('note3.md');
      expect(selections).toContain('note4.md');
      // Final state should be note4.md
      expect(service.getSelectedPath()).toBe('note4.md');
    });
  });
});
