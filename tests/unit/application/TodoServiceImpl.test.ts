/**
 * TodoServiceImpl Tests
 *
 * Comprehensive unit tests for the TodoServiceImpl application service.
 * Tests the orchestration of TODO operations including:
 * - Lifecycle (initialize, shutdown)
 * - CRUD operations (getAll, getById, toggle, create, update, delete)
 * - File management (ensureTodoFile)
 * - Statistics (getStats)
 * - Subscriptions (subscribe)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TodoServiceImpl } from '$lib/application/services';
import { MarkdownTodoRepository, MarkdownTodoParser, MemoryTodoWatcher } from '$lib/adapters/todo';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import type { Todo } from '$lib/domain/entities/Todo';
import { DATE_MARKERS } from '$lib/domain/values/TodoDateMeta';
import { events } from '$lib/events';
import { resourceLock } from '$lib/events/queue/ResourceLock';

let fileSystem: MemoryFileSystemAdapter;
let parser: MarkdownTodoParser;
let repository: MarkdownTodoRepository;
let watcher: MemoryTodoWatcher;
let service: TodoServiceImpl;

beforeEach(async () => {
  resourceLock.clear();
  fileSystem = new MemoryFileSystemAdapter();
  parser = new MarkdownTodoParser();
  repository = new MarkdownTodoRepository(fileSystem, parser, {
    notesPath: '/notes',
  });
  watcher = new MemoryTodoWatcher();
  service = new TodoServiceImpl(repository, watcher, fileSystem, {
    notesPath: '/notes',
  });

  // Seed test data
  fileSystem.seed({
    '/notes/TODO.md': '# TODO\n\n- [ ] Task 1\n- [x] Task 2',
  });
});

afterEach(() => {
  service.shutdown();
  resourceLock.clear();
});

describe('TodoServiceImpl', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('starts file watching', async () => {
      expect(watcher.isWatching()).toBe(false);

      const result = await service.initialize();

      expect(result.ok).toBe(true);
      expect(watcher.isWatching()).toBe(true);
      expect(watcher.getWatchPath()).toBe('/notes');
    });

    it('performs initial scan', async () => {
      await service.initialize();

      const todosResult = await service.getAll();
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value).toHaveLength(2);
      }
    });

    it('registers file change callbacks', async () => {
      await service.initialize();

      const counts = watcher.getCallbackCounts();
      expect(counts.change).toBe(1);
      expect(counts.create).toBe(1);
      expect(counts.delete).toBe(1);
    });

    it('returns ok when called multiple times', async () => {
      const result1 = await service.initialize();
      const result2 = await service.initialize();

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('stops file watching', async () => {
      await service.initialize();
      expect(watcher.isWatching()).toBe(true);

      service.shutdown();

      expect(watcher.isWatching()).toBe(false);
    });

    it('clears subscribers', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      service.shutdown();

      // After shutdown, the callback should not be called
      // We need to reinitialize to test this properly
      await service.initialize();
      await service.toggle('/notes/TODO.md:2');
      expect(callback).not.toHaveBeenCalled();
    });

    it('unregisters watcher callbacks', async () => {
      await service.initialize();
      expect(watcher.getCallbackCounts().change).toBe(1);

      service.shutdown();

      expect(watcher.getCallbackCounts().change).toBe(0);
      expect(watcher.getCallbackCounts().create).toBe(0);
      expect(watcher.getCallbackCounts().delete).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Read Operations
  // ──────────────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns all todos without filter', async () => {
      await service.initialize();

      const result = await service.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.content).toBe('Task 1');
        expect(result.value[1]!.content).toBe('Task 2');
      }
    });

    it('applies status filter', async () => {
      await service.initialize();

      const openResult = await service.getAll({ status: 'open' });
      const completedResult = await service.getAll({ status: 'completed' });

      expect(openResult.ok).toBe(true);
      expect(completedResult.ok).toBe(true);
      if (openResult.ok && completedResult.ok) {
        expect(openResult.value).toHaveLength(1);
        expect(openResult.value[0]!.content).toBe('Task 1');
        expect(completedResult.value).toHaveLength(1);
        expect(completedResult.value[0]!.content).toBe('Task 2');
      }
    });

    it('applies search filter', async () => {
      await service.initialize();

      const result = await service.getAll({ search: 'Task 1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Task 1');
      }
    });

    it('returns empty array for no matches', async () => {
      await service.initialize();

      const result = await service.getAll({ search: 'nonexistent' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('getById', () => {
    it('returns specific todo', async () => {
      await service.initialize();

      const result = await service.getById('/notes/TODO.md:2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value!.content).toBe('Task 1');
      }
    });

    it('returns null for non-existent id', async () => {
      await service.initialize();

      const result = await service.getById('/notes/TODO.md:999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('getBySource', () => {
    it('filters by dedicated source', async () => {
      await service.initialize();

      const result = await service.getBySource('dedicated');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((t) => t.source === 'dedicated')).toBe(true);
      }
    });

    it('filters by inline source', async () => {
      // Add an inline todo in another file
      fileSystem.seed({
        '/notes/other.md': '# Notes\n\n- [ ] Inline task',
      });
      await service.initialize();

      const result = await service.getBySource('inline');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Inline task');
        expect(result.value[0]!.source).toBe('inline');
      }
    });

    it('returns empty array when no todos match source', async () => {
      await service.initialize();

      const result = await service.getBySource('inline');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('live editor snapshots', () => {
    it('shows todos from an unsaved editor snapshot immediately', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Saved task',
      });
      await service.initialize();

      const syncResult = await service.syncFileSnapshot(
        '/notes/project.md',
        '# Project\n\n- [ ] Saved task\n- [ ] Unsaved task',
      );
      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });

      expect(syncResult.ok).toBe(true);
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value.map((todo) => todo.content)).toEqual([
          'Saved task',
          'Unsaved task',
        ]);
      }
    });

    it('replaces stale disk todos for a file while a snapshot is active', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Old disk task',
      });
      await service.initialize();

      await service.syncFileSnapshot('/notes/project.md', '# Project\n\n- [ ] Fresh editor task');

      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value).toHaveLength(1);
        expect(todosResult.value[0]!.content).toBe('Fresh editor task');
      }
    });

    it('falls back to disk todos after clearing a snapshot', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Disk task',
      });
      await service.initialize();

      await service.syncFileSnapshot('/notes/project.md', '# Project\n\n- [ ] Editor task');
      await service.clearFileSnapshot('/notes/project.md');

      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value).toHaveLength(1);
        expect(todosResult.value[0]!.content).toBe('Disk task');
      }
    });

    it('syncs a saved relative note path and clears a stale snapshot', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Disk task',
      });
      await service.initialize();
      await service.syncFileSnapshot('/notes/project.md', '# Project\n\n- [ ] Draft task');
      await fileSystem.writeFile('/notes/project.md', '# Project\n\n- [ ] Saved task');

      const syncResult = await service.syncSavedFile('project.md');
      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });

      expect(syncResult.ok).toBe(true);
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value.map((todo) => todo.content)).toEqual(['Saved task']);
      }
    });

    it('invalidates stale disk cache when syncing a saved absolute path', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Old cached task',
      });
      await service.initialize();
      await service.getAll({ sourceFile: '/notes/project.md' });
      await fileSystem.writeFile('/notes/project.md', '# Project\n\n- [ ] Fresh saved task');

      const syncResult = await service.syncSavedFile('/notes/project.md');
      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });

      expect(syncResult.ok).toBe(true);
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value.map((todo) => todo.content)).toEqual(['Fresh saved task']);
      }
    });

    it('notifies subscribers after syncing a saved file', async () => {
      fileSystem.seed({
        '/notes/project.md': '# Project\n\n- [ ] Synced task',
      });
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      const syncResult = await service.syncSavedFile('/notes/project.md');

      expect(syncResult.ok).toBe(true);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'Synced task', sourceFile: '/notes/project.md' }),
        ]),
      );
    });

    it('updates a live snapshot task before autosave', async () => {
      await service.initialize();
      await service.syncFileSnapshot('/notes/project.md', '# Project\n\n- [ ] Draft task');

      const result = await service.updatePatch('/notes/project.md:2', {
        content: 'Draft task polished',
        dueDate: new Date('2026-05-05'),
        priority: 'high',
        tags: ['work'],
      });

      expect(result.ok).toBe(true);
      const todosResult = await service.getAll({ sourceFile: '/notes/project.md' });
      expect(todosResult.ok).toBe(true);
      if (todosResult.ok) {
        expect(todosResult.value[0]!.content).toBe('Draft task polished');
        expect(todosResult.value[0]!.priority).toBe('high');
        expect(todosResult.value[0]!.tags).toEqual(['work']);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Write Operations
  // ──────────────────────────────────────────────────────────────────────────

  describe('toggle', () => {
    it('toggles completion state', async () => {
      await service.initialize();

      // Toggle task 1 (currently incomplete)
      const result = await service.toggle('/notes/TODO.md:2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isCompleted).toBe(true);
        expect(result.value.dates.completedAt).toBeDefined();
      }
    });

    it('notifies subscribers after toggle', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      await service.toggle('/notes/TODO.md:2');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.any(Array));
    });

    it('persists changes to file', async () => {
      await service.initialize();

      await service.toggle('/notes/TODO.md:2');

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('[x] Task 1');
      }
    });

    it('returns error for non-existent todo', async () => {
      await service.initialize();

      const result = await service.toggle('/notes/TODO.md:999');

      expect(result.ok).toBe(false);
    });
  });

  describe('editor:self-write coordination', () => {
    it('emits editor:self-write before fileSystem.writeFile during a toggle', async () => {
      await service.initialize();

      // Order-of-emission probe: spy on writeFile and capture event order.
      const order: string[] = [];
      const writeSpy = vi.spyOn(fileSystem, 'writeFile').mockImplementation(async (p, c) => {
        order.push(`writeFile:${p}`);
        return { ok: true, value: undefined };
      });
      const handler = (p: { path: string }) => order.push(`self-write:${p.path}`);
      events.on('editor:self-write', handler);

      await service.toggle('/notes/TODO.md:2');

      events.off('editor:self-write', handler);
      writeSpy.mockRestore();

      // The self-write event must precede the actual writeFile call so the
      // editor's grace window is stamped before the watcher could fire.
      const selfWriteIdx = order.indexOf('self-write:/notes/TODO.md');
      const writeFileIdx = order.indexOf('writeFile:/notes/TODO.md');
      expect(selfWriteIdx).toBeGreaterThanOrEqual(0);
      expect(writeFileIdx).toBeGreaterThanOrEqual(0);
      expect(selfWriteIdx).toBeLessThan(writeFileIdx);
    });

    it('toggleFromEditor emits editor:self-write and never raises a conflict', async () => {
      await service.initialize();

      const writes: string[] = [];
      const conflicts: unknown[] = [];
      const saveFails: unknown[] = [];
      const writeHandler = (p: { path: string }) => writes.push(p.path);
      const conflictHandler = (p: unknown) => conflicts.push(p);
      const saveFailHandler = (p: unknown) => saveFails.push(p);
      events.on('editor:self-write', writeHandler);
      events.on('editor:conflict', conflictHandler);
      events.on('document:save-failed', saveFailHandler);

      // The original bug repro: toggle a todo by editor-driven match.
      const result = await service.toggleFromEditor(
        'block-id-ignored',
        'Task 1',
        true,
        '/notes/TODO.md',
      );

      events.off('editor:self-write', writeHandler);
      events.off('editor:conflict', conflictHandler);
      events.off('document:save-failed', saveFailHandler);

      expect(result.ok).toBe(true);
      expect(writes).toContain('/notes/TODO.md');
      expect(conflicts).toEqual([]);
      expect(saveFails).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates new todo', async () => {
      await service.initialize();

      const result = await service.create('New task');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('New task');
        expect(result.value.isCompleted).toBe(false);
        expect(result.value.source).toBe('dedicated');
      }
    });

    it('creates todo with priority option', async () => {
      await service.initialize();

      const result = await service.create('High priority task', { priority: 'high' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.priority).toBe('high');
      }
    });

    it('creates todo with tags option', async () => {
      await service.initialize();

      const result = await service.create('Tagged task', { tags: ['work', 'urgent'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toContain('work');
        expect(result.value.tags).toContain('urgent');
      }
    });

    it('creates todo with due date option', async () => {
      await service.initialize();
      const dueDate = new Date('2025-12-31');

      const result = await service.create('Due task', { dueDate });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dates.dueDate).toBeDefined();
        expect(result.value.dates.dueDate!.toISOString().slice(0, 10)).toBe('2025-12-31');
      }
    });

    it('creates todo with scheduled date option', async () => {
      await service.initialize();
      const scheduledDate = new Date('2025-06-15');

      const result = await service.create('Scheduled task', { scheduledDate });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dates.scheduledDate).toBeDefined();
        expect(result.value.dates.scheduledDate!.toISOString().slice(0, 10)).toBe('2025-06-15');
      }
    });

    it('creates todo in custom target file', async () => {
      await service.initialize();

      const result = await service.create('Custom file task', {
        targetFile: '/notes/custom.md',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sourceFile).toBe('/notes/custom.md');
        expect(result.value.source).toBe('inline');
      }
    });

    it('notifies subscribers after create', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      await service.create('New task');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('persists to file', async () => {
      await service.initialize();

      await service.create('Persisted task');

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('Persisted task');
      }
    });

    it('serializes concurrent creates in the same markdown file', async () => {
      await service.initialize();
      const order: string[] = [];
      const originalCreate = repository.create.bind(repository);

      vi.spyOn(repository, 'create').mockImplementation(async (params, targetFile) => {
        order.push(`start:${params.content}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await originalCreate(params, targetFile);
        order.push(`end:${params.content}`);
        return result;
      });

      const results = await Promise.all([
        service.create('First concurrent task'),
        service.create('Second concurrent task'),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order).toEqual([
        'start:First concurrent task',
        'end:First concurrent task',
        'start:Second concurrent task',
        'end:Second concurrent task',
      ]);

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('First concurrent task');
        expect(contentResult.value).toContain('Second concurrent task');
      }
    });

    it('allows concurrent creates in different markdown files', async () => {
      fileSystem.seed({
        '/notes/a.md': '# A\n',
        '/notes/b.md': '# B\n',
      });
      await service.initialize();
      const order: string[] = [];
      const originalCreate = repository.create.bind(repository);

      vi.spyOn(repository, 'create').mockImplementation(async (params, targetFile) => {
        order.push(`start:${params.content}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await originalCreate(params, targetFile);
        order.push(`end:${params.content}`);
        return result;
      });

      const results = await Promise.all([
        service.create('A file task', { targetFile: '/notes/a.md' }),
        service.create('B file task', { targetFile: '/notes/b.md' }),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order.slice(0, 2)).toEqual(['start:A file task', 'start:B file task']);
    });
  });

  describe('update', () => {
    it('updates todo content', async () => {
      await service.initialize();

      const result = await service.update('/notes/TODO.md:2', 'Updated task');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Updated task');
      }
    });

    it('notifies subscribers after update', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      await service.update('/notes/TODO.md:2', 'Updated task');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('persists changes to file', async () => {
      await service.initialize();

      await service.update('/notes/TODO.md:2', 'Updated task');

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('Updated task');
        expect(contentResult.value).not.toContain('Task 1');
      }
    });

    it('returns error for non-existent todo', async () => {
      await service.initialize();

      const result = await service.update('/notes/TODO.md:999', 'Updated');

      expect(result.ok).toBe(false);
    });

    it('serializes concurrent updates to the same todo item', async () => {
      await service.initialize();
      const order: string[] = [];
      const originalUpdate = repository.updateContent.bind(repository);

      vi.spyOn(repository, 'updateContent').mockImplementation(async (id, content, expected) => {
        order.push(`start:${content}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await originalUpdate(id, content, expected);
        order.push(`end:${content}`);
        return result;
      });

      const results = await Promise.all([
        service.update('/notes/TODO.md:2', 'First same-item update'),
        service.update('/notes/TODO.md:2', 'Second same-item update'),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order).toEqual([
        'start:First same-item update',
        'end:First same-item update',
        'start:Second same-item update',
        'end:Second same-item update',
      ]);
    });

    it('lets different todo item lanes prepare while file saves stay ordered', async () => {
      await service.initialize();
      const order: string[] = [];
      const originalGetById = repository.getById.bind(repository);
      const originalUpdate = repository.updateContent.bind(repository);

      vi.spyOn(repository, 'getById').mockImplementation(async (id) => {
        order.push(`lookup-start:${id}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await originalGetById(id);
        order.push(`lookup-end:${id}`);
        return result;
      });
      vi.spyOn(repository, 'updateContent').mockImplementation(async (id, content, expected) => {
        order.push(`save-start:${content}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await originalUpdate(id, content, expected);
        order.push(`save-end:${content}`);
        return result;
      });

      const results = await Promise.all([
        service.update('/notes/TODO.md:2', 'Updated task 1'),
        service.update('/notes/TODO.md:3', 'Updated task 2'),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order.slice(0, 2)).toEqual([
        'lookup-start:/notes/TODO.md:2',
        'lookup-start:/notes/TODO.md:3',
      ]);
      expect(order.filter((entry) => entry.startsWith('save-'))).toEqual([
        'save-start:Updated task 1',
        'save-end:Updated task 1',
        'save-start:Updated task 2',
        'save-end:Updated task 2',
      ]);
    });

    it('rebases an item update when another item delete shifts line numbers first', async () => {
      await service.initialize();

      const [deleteResult, updateResult] = await Promise.all([
        service.delete('/notes/TODO.md:2'),
        service.update('/notes/TODO.md:3', 'Task 2 after line shift'),
      ]);

      expect(deleteResult.ok).toBe(true);
      expect(updateResult.ok).toBe(true);

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).not.toContain('Task 1');
        expect(contentResult.value).toContain('Task 2 after line shift');
      }
    });
  });

  describe('updatePatch', () => {
    it('updates todo metadata and preserves markdown storage', async () => {
      await service.initialize();

      const result = await service.updatePatch('/notes/TODO.md:2', {
        content: 'Updated rich task',
        dueDate: new Date('2026-05-05'),
        scheduledDate: new Date('2026-05-03'),
        priority: 'high',
        tags: ['work', 'focus'],
        recurrence: 'every week',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Updated rich task');
        expect(result.value.priority).toBe('high');
        expect(result.value.tags).toEqual(['work', 'focus']);
        expect(result.value.dates.recurrence).toBe('every week');
      }

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('Updated rich task');
        expect(contentResult.value).toContain(`${DATE_MARKERS.DUE} 2026-05-05`);
        expect(contentResult.value).toContain(`${DATE_MARKERS.SCHEDULED} 2026-05-03`);
        expect(contentResult.value).toContain(DATE_MARKERS.HIGH_PRIORITY);
        expect(contentResult.value).toContain(`${DATE_MARKERS.RECURRENCE} every week`);
        expect(contentResult.value).toContain('#work');
        expect(contentResult.value).toContain('#focus');
      }
    });
  });

  describe('quickCreate', () => {
    it('creates todos from natural language capture', async () => {
      await service.initialize();

      const result = await service.quickCreate(
        'Review release notes tomorrow p1 #work +anytime',
        undefined,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Review release notes');
        expect(result.value.priority).toBe('high');
        expect(result.value.tags).toEqual(['work']);
        expect(result.value.list).toBe('anytime');
      }
    });

    it('creates the next recurring instance when completing a recurring task', async () => {
      fileSystem.seed({
        '/notes/TODO.md': `# TODO\n\n- [ ] Weekly review ${DATE_MARKERS.DUE} 2026-05-04 ${DATE_MARKERS.RECURRENCE} every week`,
      });
      await service.initialize();

      const result = await service.toggle('/notes/TODO.md:2');
      expect(result.ok).toBe(true);

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain(`[x] Weekly review ${DATE_MARKERS.DUE} 2026-05-04`);
        expect(contentResult.value).toContain(`[ ] Weekly review ${DATE_MARKERS.DUE} 2026-05-11`);
      }
    });
  });

  describe('todo list files', () => {
    it('creates custom todo lists and captures tasks into them as dedicated todos', async () => {
      await service.initialize();

      const listResult = await service.createTodoList({
        title: 'Work',
        note: 'Office context',
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value.path).toBe('/notes/todo-work.md');

      const taskResult = await service.create('Review roadmap', {
        targetFile: listResult.value.path,
        targetList: 'inbox',
      });

      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;
      expect(taskResult.value.source).toBe('dedicated');
      expect(taskResult.value.sourceFile).toBe('/notes/todo-work.md');
      expect(taskResult.value.list).toBe('inbox');

      const contentResult = await fileSystem.readFile('/notes/todo-work.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('void_type: todo-list');
        expect(contentResult.value).toContain('- [ ] Review roadmap');
      }
    });

    it('updates and deletes custom todo lists but protects TODO.md', async () => {
      await service.initialize();

      const created = await service.createTodoList({ title: 'Work' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await service.updateTodoList(created.value.path, {
        title: 'House',
        note: 'Home context',
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.path).toBe('/notes/todo-house.md');

      const protectedUpdate = await service.updateTodoList('/notes/TODO.md', { title: 'Nope' });
      const protectedDelete = await service.deleteTodoList('/notes/TODO.md');
      expect(protectedUpdate.ok).toBe(false);
      expect(protectedDelete.ok).toBe(false);

      const deleted = await service.deleteTodoList(updated.value.path);
      expect(deleted.ok).toBe(true);
      const exists = await fileSystem.exists('/notes/todo-house.md');
      expect(exists.ok && exists.value).toBe(false);
    });

    it('creates, renames, and lists custom sections', async () => {
      await service.initialize();
      const created = await service.createTodoList({ title: 'Work' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const section = await service.createSection(created.value.path, 'Launch');
      expect(section.ok).toBe(true);
      const renamed = await service.renameSection(created.value.path, 'Launch', 'Shipped');
      expect(renamed.ok).toBe(true);

      const sections = await service.getSections(created.value.path);
      expect(sections.ok).toBe(true);
      if (sections.ok) {
        expect(sections.value.map((item) => item.title)).toContain('Shipped');
        expect(sections.value.map((item) => item.title)).not.toContain('Launch');
      }
    });

    it('moves sections and notifies subscribers', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      const created = await service.createTodoList({ title: 'Work' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await service.createSection(created.value.path, 'Launch');
      await service.createSection(created.value.path, 'Ops');

      callback.mockClear();
      const moved = await service.moveSection(created.value.path, 'Launch', 'Inbox', 'before');

      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.value.map((section) => section.title)).toEqual([
        'Launch',
        'Inbox',
        'Anytime',
        'Someday',
        'Ops',
      ]);
      expect(callback).toHaveBeenCalled();
    });

    it('moves todos across sections, rebases line ids, and notifies subscribers', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      const list = await service.createTodoList({ title: 'Work' });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      await service.createSection(list.value.path, 'Launch');
      const task = await service.create('Ship release', {
        targetFile: list.value.path,
        targetList: 'inbox',
      });
      expect(task.ok).toBe(true);
      if (!task.ok) return;

      callback.mockClear();
      const moved = await service.move(task.value.id, {
        kind: 'section',
        filePath: list.value.path,
        section: 'Launch',
      });

      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.value.section).toBe('Launch');
      expect(moved.value.id).not.toBe(task.value.id);
      expect(callback).toHaveBeenCalled();

      const content = await fileSystem.readFile(list.value.path);
      expect(content.ok).toBe(true);
      if (content.ok) {
        expect(content.value).toContain('## Launch\n\n- [ ] Ship release');
      }
    });
  });

  describe('delete', () => {
    it('removes todo', async () => {
      await service.initialize();

      const result = await service.delete('/notes/TODO.md:2');

      expect(result.ok).toBe(true);

      const todosResult = await service.getAll();
      if (todosResult.ok) {
        expect(todosResult.value).toHaveLength(1);
        expect(todosResult.value[0]!.content).toBe('Task 2');
      }
    });

    it('notifies subscribers after delete', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      await service.delete('/notes/TODO.md:2');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('persists deletion to file', async () => {
      await service.initialize();

      await service.delete('/notes/TODO.md:2');

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).not.toContain('Task 1');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // File Management
  // ──────────────────────────────────────────────────────────────────────────

  describe('ensureTodoFile', () => {
    it('returns path when file exists', async () => {
      await service.initialize();

      const result = await service.ensureTodoFile();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('/notes/TODO.md');
      }
    });

    it('creates TODO.md if not exists', async () => {
      // Clear the filesystem and remove TODO.md
      fileSystem.clear();
      await fileSystem.createDirectory('/notes');
      service = new TodoServiceImpl(repository, watcher, fileSystem, {
        notesPath: '/notes',
      });

      const result = await service.ensureTodoFile();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('/notes/TODO.md');
      }

      const _exists_r = await fileSystem.exists('/notes/TODO.md');
      const exists = _exists_r.ok && _exists_r.value;
      expect(exists).toBe(true);
    });

    it('creates file with default content', async () => {
      // Clear and setup fresh filesystem
      fileSystem.clear();
      await fileSystem.createDirectory('/notes');
      service = new TodoServiceImpl(repository, watcher, fileSystem, {
        notesPath: '/notes',
      });

      await service.ensureTodoFile();

      const contentResult = await fileSystem.readFile('/notes/TODO.md');
      expect(contentResult.ok).toBe(true);
      if (contentResult.ok) {
        expect(contentResult.value).toContain('# TODO');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Statistics
  // ──────────────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct basic statistics', async () => {
      await service.initialize();

      const stats = await service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.open).toBe(1);
      expect(stats.completed).toBe(1);
    });

    it('returns zero stats when no todos', async () => {
      fileSystem.clear();
      await fileSystem.createDirectory('/notes');
      await fileSystem.writeFile('/notes/TODO.md', '# TODO\n\n');
      service = new TodoServiceImpl(repository, watcher, fileSystem, {
        notesPath: '/notes',
      });
      await service.initialize();

      const stats = await service.getStats();

      expect(stats.total).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.overdue).toBe(0);
      expect(stats.dueToday).toBe(0);
    });

    it('calculates overdue correctly', async () => {
      // Create a todo with a past due date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);

      fileSystem.seed({
        '/notes/TODO.md': `# TODO\n\n- [ ] Overdue task \ud83d\udcc5 ${dateStr}`,
      });
      await service.initialize();

      const stats = await service.getStats();

      expect(stats.overdue).toBe(1);
    });

    it('calculates dueToday correctly', async () => {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);

      fileSystem.seed({
        '/notes/TODO.md': `# TODO\n\n- [ ] Due today task \ud83d\udcc5 ${dateStr}`,
      });
      await service.initialize();

      const stats = await service.getStats();

      expect(stats.dueToday).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Subscriptions
  // ──────────────────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('calls callback on changes', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      await service.toggle('/notes/TODO.md:2');

      expect(callback).toHaveBeenCalled();
    });

    it('passes todos array to callback', async () => {
      await service.initialize();
      let receivedTodos: Todo[] = [];
      service.subscribe((todos) => {
        receivedTodos = todos;
      });

      await service.toggle('/notes/TODO.md:2');

      expect(receivedTodos.length).toBeGreaterThan(0);
    });

    it('returns unsubscribe function', async () => {
      await service.initialize();
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      unsubscribe();
      await service.toggle('/notes/TODO.md:2');

      expect(callback).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers', async () => {
      await service.initialize();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      service.subscribe(callback1);
      service.subscribe(callback2);

      await service.toggle('/notes/TODO.md:2');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('handles callback errors gracefully', async () => {
      await service.initialize();
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();
      service.subscribe(errorCallback);
      service.subscribe(normalCallback);

      // Should not throw and other callbacks should still be called
      await expect(service.toggle('/notes/TODO.md:2')).resolves.not.toThrow();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // File Watcher Events
  // ──────────────────────────────────────────────────────────────────────────

  describe('watcher events', () => {
    it('notifies subscribers on file change', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      // Simulate file change via watcher
      watcher.simulateChange('/notes/TODO.md');

      // Wait for async notification
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalled();
    });

    it('notifies subscribers on file create', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      watcher.simulateCreate('/notes/new.md');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalled();
    });

    it('notifies subscribers on file delete', async () => {
      await service.initialize();
      const callback = vi.fn();
      service.subscribe(callback);

      watcher.simulateDelete('/notes/TODO.md');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalled();
    });
  });
});
