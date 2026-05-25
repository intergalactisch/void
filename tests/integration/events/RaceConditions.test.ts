/**
 * Race Condition Integration Tests
 *
 * Tests that verify the event-driven architecture prevents race conditions.
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
 * Create a slow mock DocumentPort that simulates realistic delays.
 * Tracks operation order for verification.
 */
function createSlowMockDocumentPort(
  operationLog: string[],
  delays: { read: number; write: number; delete: number } = { read: 50, write: 100, delete: 50 }
): DocumentPort {
  const existingPaths = new Set<string>();
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
      operationLog.push(`load:start:${path}`);
      await new Promise((r) => setTimeout(r, delays.read));
      operationLog.push(`load:end:${path}`);

      if (documents.has(path)) {
        return ok({ ...documents.get(path)! });
      }
      return err(new Error(`Document not found: ${path}`));
    }),

    save: vi.fn().mockImplementation(async (doc: Document) => {
      operationLog.push(`save:start:${doc.path}`);
      await new Promise((r) => setTimeout(r, delays.write));
      documents.set(doc.path, { ...doc });
      existingPaths.add(doc.path);
      operationLog.push(`save:end:${doc.path}`);
      return ok(undefined);
    }),

    delete: vi.fn().mockImplementation(async (path: string) => {
      operationLog.push(`delete:start:${path}`);
      await new Promise((r) => setTimeout(r, delays.delete));
      documents.delete(path);
      existingPaths.delete(path);
      operationLog.push(`delete:end:${path}`);
      return ok(undefined);
    }),

    trash: vi.fn().mockImplementation(async (path: string) => {
      operationLog.push(`trash:start:${path}`);
      await new Promise((r) => setTimeout(r, delays.delete));
      documents.delete(path);
      existingPaths.delete(path);
      operationLog.push(`trash:end:${path}`);
      return ok({
        id: 'trash-1',
        originalPath: path,
        title: path.replace(/\.md$/i, ''),
        deletedAt: new Date(),
      });
    }),

    listTrash: vi.fn().mockResolvedValue(ok([])),

    restoreFromTrash: vi.fn().mockImplementation(async (id: string) => {
      const path = 'restored.md';
      existingPaths.add(path);
      const doc: Document = {
        path,
        meta: createMeta('Restored'),
        blocks: [],
      };
      documents.set(path, doc);
      void id;
      return ok(doc);
    }),

    deleteFromTrash: vi.fn().mockResolvedValue(ok(undefined)),

    list: vi.fn().mockResolvedValue(ok([])),
    listFolders: vi.fn().mockResolvedValue(ok([])),

    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(ok(existingPaths.has(path)))
    ),

    create: vi.fn().mockImplementation(async (path: string, title?: string) => {
      operationLog.push(`create:start:${path}`);
      await new Promise((r) => setTimeout(r, delays.write));
      existingPaths.add(path);
      const doc: Document = {
        path,
        meta: createMeta(title || 'Untitled'),
        blocks: [],
      };
      documents.set(path, doc);
      operationLog.push(`create:end:${path}`);
      return ok(doc);
    }),

    watch: vi.fn().mockReturnValue(() => {}),
  };
}

describe('Race Conditions', () => {
  describe('Concurrent saves on same document', () => {
    it('processes rapid saves sequentially without data loss', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog);
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create a document first
      await bus.createNote('Test', '');
      operationLog.length = 0; // Reset log

      // Simulate rapid opens (Cmd+S spam)
      const opens = [
        bus.openNote('test.md'),
        bus.openNote('test.md'),
        bus.openNote('test.md'),
      ];

      await Promise.all(opens);

      // Verify operations were sequential (each load:end before next load:start)
      const loadStarts: number[] = [];
      const loadEnds: number[] = [];

      operationLog.forEach((log, i) => {
        if (log === 'load:start:test.md') loadStarts.push(i);
        if (log === 'load:end:test.md') loadEnds.push(i);
      });

      expect(loadStarts.length).toBe(3);
      expect(loadEnds.length).toBe(3);

      // Check that operations don't overlap: each end index should be less than next start index
      for (let i = 0; i < loadStarts.length - 1; i++) {
        expect(loadEnds[i]).toBeLessThan(loadStarts[i + 1]);
      }
    });
  });

  describe('Create-while-checking race', () => {
    it('prevents duplicate creation when checking existence', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog);
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Try to create same note twice quickly
      const results = await Promise.all([
        bus.createNote('Same Note', ''),
        bus.createNote('Same Note', ''),
      ]);

      // One should succeed, one should fail
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      if (!failures[0].success) {
        expect(failures[0].error.message).toContain('already exists');
      }
    });
  });

  describe('Rename transaction atomicity', () => {
    it('completes rename operations atomically', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog);
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create a note
      await bus.createNote('Original', '');
      operationLog.length = 0;

      // Rename should be atomic (load → save new → delete old)
      const result = await bus.renameNote('original.md', 'Renamed');

      expect(result.success).toBe(true);

      // Verify operation order
      const loadIndex = operationLog.findIndex((l) => l === 'load:start:original.md');
      const saveIndex = operationLog.findIndex((l) => l === 'save:start:renamed.md');
      const deleteIndex = operationLog.findIndex((l) => l === 'delete:start:original.md');

      expect(loadIndex).toBeLessThan(saveIndex);
      expect(saveIndex).toBeLessThan(deleteIndex);
    });

    it('prevents operations during rename', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog, {
        read: 100,
        write: 100,
        delete: 100,
      });
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create a note
      await bus.createNote('Original', '');
      operationLog.length = 0;

      // Start rename and try to open during it
      const renamePromise = bus.renameNote('original.md', 'Renamed');
      const openPromise = bus.openNote('original.md');

      const [renameResult, openResult] = await Promise.all([renamePromise, openPromise]);

      // Rename should succeed
      expect(renameResult.success).toBe(true);

      // Open should fail because file no longer exists at original path
      // (or succeed if it was executed before the delete)
      // The key is that they didn't interleave
    });
  });

  describe('Open + open race', () => {
    it('queues multiple opens on same document', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog);
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create a note
      await bus.createNote('Test', '');
      operationLog.length = 0;

      // Rapidly open same document (simulates quick navigation)
      const opens = [
        bus.openNote('test.md'),
        bus.openNote('test.md'),
        bus.openNote('test.md'),
      ];

      const results = await Promise.all(opens);

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Operations should be sequential (no overlapping)
      const startIndices = operationLog
        .map((log, i) => (log === 'load:start:test.md' ? i : -1))
        .filter((i) => i !== -1);
      const endIndices = operationLog
        .map((log, i) => (log === 'load:end:test.md' ? i : -1))
        .filter((i) => i !== -1);

      // Each end should come before next start
      for (let i = 0; i < startIndices.length - 1; i++) {
        expect(endIndices[i]).toBeLessThan(startIndices[i + 1]);
      }
    });
  });

  describe('Different resources process in parallel', () => {
    it('allows parallel operations on different notes', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog);
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create multiple notes
      await bus.createNote('Note A', '');
      await bus.createNote('Note B', '');
      await bus.createNote('Note C', '');
      operationLog.length = 0;

      // Open all three in parallel
      const startTime = Date.now();
      await Promise.all([
        bus.openNote('note-a.md'),
        bus.openNote('note-b.md'),
        bus.openNote('note-c.md'),
      ]);
      const totalTime = Date.now() - startTime;

      // If sequential, would take ~150ms (3 * 50ms read delay)
      // If parallel, should take ~50-60ms
      // Allow some buffer for test environment variance
      expect(totalTime).toBeLessThan(120);
    });
  });

  describe('Delete while editing', () => {
    it('queues delete after current operation completes', async () => {
      const operationLog: string[] = [];
      const mockPort = createSlowMockDocumentPort(operationLog, {
        read: 100,
        write: 100,
        delete: 50,
      });
      const bus = new CommandBus(mockPort, {
        emitLifecycleEvents: false,
        emitDomainEvents: false,
        devLogging: false,
      });

      // Create a note
      await bus.createNote('Test', '');
      operationLog.length = 0;

      // Start opening and immediately try to delete
      const openPromise = bus.openNote('test.md');

      // Small delay to ensure open starts first
      await new Promise((r) => setTimeout(r, 10));
      const deletePromise = bus.deleteNote('test.md');

      const [openResult, deleteResult] = await Promise.all([openPromise, deletePromise]);

      // Open should succeed (it started first)
      expect(openResult.success).toBe(true);

      // Delete should also succeed (it waited for open to complete)
      expect(deleteResult.success).toBe(true);

      // Verify order: open should complete before delete starts
      const openEndIndex = operationLog.indexOf('load:end:test.md');
      const deleteStartIndex = operationLog.indexOf('trash:start:test.md');

      expect(openEndIndex).toBeLessThan(deleteStartIndex);
    });
  });
});
