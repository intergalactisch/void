/**
 * CommandBus Unit Tests
 *
 * Tests for the high-level command dispatch API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandBus } from '$lib/events/CommandBus';
import type { DocumentPort } from '$lib/ports/outbound';
import type { Document, DocumentMeta } from '$lib/domain';
import { ok, err } from '$lib/core';

// Mock the events module
vi.mock('$lib/events/bus', () => ({
  events: {
    emit: vi.fn(),
  },
}));

/**
 * Create a mock DocumentPort for testing.
 */
function createMockDocumentPort(existingPaths: Set<string> = new Set()): DocumentPort {
  const documents = new Map<string, Document>();

  const createMeta = (title: string): DocumentMeta => ({
    id: crypto.randomUUID(),
    title,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    category: null,
    color: null,
    pinned: false,
    custom: {},
  });

  return {
    load: vi.fn().mockImplementation(async (path: string) => {
      if (documents.has(path)) {
        return ok(documents.get(path)!);
      }
      return err(new Error(`Document not found: ${path}`));
    }),
    save: vi.fn().mockImplementation(async (doc: Document) => {
      documents.set(doc.path, doc);
      return ok(undefined);
    }),
    delete: vi.fn().mockImplementation(async (path: string) => {
      documents.delete(path);
      existingPaths.delete(path);
      return ok(undefined);
    }),
    trash: vi.fn().mockImplementation(async (path: string) => {
      documents.delete(path);
      existingPaths.delete(path);
      return ok({
        id: 'trash-1',
        originalPath: path,
        title: path.replace(/\.md$/i, ''),
        deletedAt: new Date(),
      });
    }),
    listTrash: vi.fn().mockResolvedValue(ok([])),
    restoreFromTrash: vi.fn().mockImplementation(async (id: string) => {
      const doc: Document = {
        path: 'restored.md',
        meta: createMeta('Restored'),
        blocks: [],
      };
      documents.set(doc.path, doc);
      existingPaths.add(doc.path);
      void id;
      return ok(doc);
    }),
    deleteFromTrash: vi.fn().mockResolvedValue(ok(undefined)),
    list: vi.fn().mockResolvedValue(ok([])),
    listFolders: vi.fn().mockResolvedValue(ok([])),
    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(ok(existingPaths.has(path) || documents.has(path)))
    ),
    create: vi.fn().mockImplementation(async (path: string, title?: string) => {
      existingPaths.add(path);
      const doc: Document = {
        path,
        meta: createMeta(title || 'Untitled'),
        blocks: [],
      };
      documents.set(path, doc);
      return ok(doc);
    }),
    watch: vi.fn().mockReturnValue(() => {}),
  };
}

describe('CommandBus', () => {
  let bus: CommandBus;
  let mockPort: DocumentPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPort = createMockDocumentPort();
    bus = new CommandBus(mockPort, {
      emitLifecycleEvents: false,
      emitDomainEvents: false,
      devLogging: false,
    });
  });

  describe('createNote', () => {
    it('creates a note successfully', async () => {
      const result = await bus.createNote('My Note', '');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.path).toBe('my-note.md');
        expect(result.value.meta.title).toBe('My Note');
      }
    });

    it('creates note in specified folder', async () => {
      const result = await bus.createNote('My Note', 'subfolder');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.path).toBe('subfolder/my-note.md');
      }
    });

    it('fails when note already exists', async () => {
      await bus.createNote('My Note', '');

      const result = await bus.createNote('My Note', '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('already exists');
      }
    });
  });

  describe('createQuickNote', () => {
    it('creates a note with datetime filename', async () => {
      const result = await bus.createQuickNote('');

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have datetime pattern
        expect(result.value.path).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
      }
    });

    it('handles collision by adding suffix', async () => {
      const result1 = await bus.createQuickNote('');
      expect(result1.success).toBe(true);

      // Create another immediately - might collide
      const result2 = await bus.createQuickNote('');
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        // Paths should be different (suffix added if same second)
        expect(result1.value.path).not.toBe(result2.value.path);
      }
    });
  });

  describe('deleteNote', () => {
    it('deletes a note successfully', async () => {
      await bus.createNote('To Delete', '');

      const result = await bus.deleteNote('to-delete.md');

      expect(result.success).toBe(true);
      expect(mockPort.trash).toHaveBeenCalledWith('to-delete.md');
    });

    it('restores a note from trash', async () => {
      const result = await bus.restoreNoteFromTrash('trash-1');

      expect(result.success).toBe(true);
      expect(mockPort.restoreFromTrash).toHaveBeenCalledWith('trash-1');
      if (result.success) {
        expect(result.value.path).toBe('restored.md');
      }
    });
  });

  describe('renameNote', () => {
    it('renames a note successfully', async () => {
      await bus.createNote('Old Name', '');

      const result = await bus.renameNote('old-name.md', 'New Name');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('new-name.md');
      }
    });

    it('keeps same path if title generates same filename', async () => {
      await bus.createNote('Test', '');

      // Rename to same title (different case, same filename)
      const result = await bus.renameNote('test.md', 'TEST');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('test.md');
      }
    });

    it('refuses to overwrite an existing rename target', async () => {
      await bus.createNote('Old Name', '');
      await bus.createNote('New Name', '');
      vi.mocked(mockPort.save).mockClear();
      vi.mocked(mockPort.delete).mockClear();

      const result = await bus.renameNote('old-name.md', 'New Name');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('already exists');
      }
      expect(mockPort.save).not.toHaveBeenCalled();
      expect(mockPort.delete).not.toHaveBeenCalled();
    });
  });

  describe('openNote', () => {
    it('opens an existing note', async () => {
      await bus.createNote('To Open', '');

      const result = await bus.openNote('to-open.md');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.path).toBe('to-open.md');
      }
    });

    it('fails for non-existent note', async () => {
      const result = await bus.openNote('nonexistent.md');

      expect(result.success).toBe(false);
    });
  });

  describe('closeNote', () => {
    it('closes a note successfully', async () => {
      const result = await bus.closeNote('any.md');

      expect(result.success).toBe(true);
    });
  });

  describe('status methods', () => {
    it('reports resource lock status', async () => {
      expect(bus.isResourceLocked('test.md')).toBe(false);
    });

    it('reports pending count', () => {
      expect(bus.pendingCount).toBe(0);
    });

    it('reports pending for resource', () => {
      expect(bus.pendingForResource('test.md')).toBe(0);
    });

    it('reports handler existence', () => {
      expect(bus.hasHandler('note:create')).toBe(true);
      expect(bus.hasHandler('unknown:command')).toBe(false);
    });
  });

  describe('sequential processing', () => {
    it('processes operations on same note sequentially', async () => {
      const executionOrder: string[] = [];

      // Create a note first
      await bus.createNote('Test', '');

      // Queue multiple operations on the same path
      // Note: These use the same resourceId so they should be sequential
      const p1 = bus.openNote('test.md').then((r) => {
        executionOrder.push('open');
        return r;
      });
      const p2 = bus.openNote('test.md').then((r) => {
        executionOrder.push('open2');
        return r;
      });
      const p3 = bus.openNote('test.md').then((r) => {
        executionOrder.push('open3');
        return r;
      });

      await Promise.all([p1, p2, p3]);

      // Should maintain order
      expect(executionOrder).toEqual(['open', 'open2', 'open3']);
    });
  });
});
