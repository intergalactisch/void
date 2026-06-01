/**
 * Unit tests for MarkdownTodoRepository
 *
 * Tests the repository implementation for TODO items stored in markdown files:
 * - getAll() - retrieves todos from all markdown files
 * - getById() - retrieves specific todo by ID
 * - getByFile() - retrieves todos from specific file with caching
 * - query() - filters todos matching criteria
 * - toggle() - toggles completion state
 * - updateContent() - updates todo text
 * - delete() - removes todo from file
 * - create() - creates new todo
 * - invalidate() - clears cache
 * - refresh() - re-scans all files
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarkdownTodoRepository } from '$lib/adapters/todo/MarkdownTodoRepository';
import { MarkdownTodoParser } from '$lib/adapters/todo/MarkdownTodoParser';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory/MemoryFileSystemAdapter';
import type { TodoId } from '$lib/domain/values/TodoId';
import { generateTodoId } from '$lib/domain/values/TodoId';
import { DATE_MARKERS } from '$lib/domain/values/TodoDateMeta';

// Emoji markers for readability
const DUE = DATE_MARKERS.DUE;
const SCHEDULED = DATE_MARKERS.SCHEDULED;
const COMPLETED = DATE_MARKERS.COMPLETED;
const HIGH = DATE_MARKERS.HIGH_PRIORITY;
const MEDIUM = DATE_MARKERS.MEDIUM_PRIORITY;

let fileSystem: MemoryFileSystemAdapter;
let parser: MarkdownTodoParser;
let repository: MarkdownTodoRepository;

beforeEach(() => {
  fileSystem = new MemoryFileSystemAdapter();
  parser = new MarkdownTodoParser();
  repository = new MarkdownTodoRepository(fileSystem, parser, {
    notesPath: '/notes',
  });
});

describe('MarkdownTodoRepository', () => {
  describe('getAll()', () => {
    it('returns todos from all markdown files', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '# TODO\n\n- [ ] Task 1\n- [x] Task 2',
        '/notes/project.md': '# Project\n\n- [ ] Inline todo',
      });

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value.map((t) => t.content)).toEqual(
          expect.arrayContaining(['Task 1', 'Task 2', 'Inline todo'])
        );
      }
    });

    it('returns empty array for empty directory', async () => {
      // Just create the notes directory without any files
      await fileSystem.createDirectory('/notes');

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('recursively scans subdirectories', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '- [ ] Root task',
        '/notes/projects/work.md': '- [ ] Work task',
        '/notes/projects/personal.md': '- [ ] Personal task',
      });

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('skips hidden directories', async () => {
      fileSystem.seed({
        '/notes/visible.md': '- [ ] Visible task',
        '/notes/.hidden/secret.md': '- [ ] Hidden task',
      });
      // Create the hidden directory
      await fileSystem.createDirectory('/notes/.hidden');

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Visible task');
      }
    });

    it('only includes .md files', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Markdown task',
        '/notes/notes.txt': '- [ ] Text file task',
        '/notes/data.json': '{ "task": "JSON task" }',
      });

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Markdown task');
      }
    });

    it('uses the file index to avoid reading unchanged cached files', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '- [ ] Indexed task',
      });
      const readSpy = vi.spyOn(fileSystem, 'readFile');

      await repository.getAll();
      readSpy.mockClear();
      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe('getById()', () => {
    it('returns specific todo by ID', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '# Tasks\n\n- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3',
      });

      const id = generateTodoId('/notes/tasks.md', 3);
      const result = await repository.getById(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value!.content).toBe('Task 2');
        expect(result.value!.lineNumber).toBe(3);
      }
    });

    it('returns null for non-existent todo', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '# Tasks\n\n- [ ] Task 1',
      });

      const id = generateTodoId('/notes/tasks.md', 99);
      const result = await repository.getById(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error for non-existent file', async () => {
      const id = generateTodoId('/notes/nonexistent.md', 0);
      const result = await repository.getById(id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('returns null when line exists but is not a todo', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '# Tasks\n\nJust some text\n- [ ] Task 1',
      });

      // Line 2 is "Just some text" - not a todo
      const id = generateTodoId('/notes/tasks.md', 2);
      const result = await repository.getById(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('getByFile()', () => {
    it('returns todos from specific file', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3',
        '/notes/other.md': '- [ ] Other task',
      });

      const result = await repository.getByFile('/notes/TODO.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0]!.content).toBe('Task 1');
        expect(result.value[1]!.content).toBe('Task 2');
        expect(result.value[2]!.content).toBe('Task 3');
      }
    });

    it('uses cache on second call (same content hash)', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Cached task',
      });

      // First call - parses the file
      const result1 = await repository.getByFile('/notes/tasks.md');
      // Second call - should use cache
      const result2 = await repository.getByFile('/notes/tasks.md');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        // Both should return the same cached array
        expect(result1.value).toBe(result2.value);
      }
    });

    it('re-parses when content changes', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Original task',
      });

      const result1 = await repository.getByFile('/notes/tasks.md');

      // Modify the file
      await fileSystem.writeFile('/notes/tasks.md', '- [ ] Updated task');

      const result2 = await repository.getByFile('/notes/tasks.md');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value[0]!.content).toBe('Original task');
        expect(result2.value[0]!.content).toBe('Updated task');
        // Should be different arrays (not from cache)
        expect(result1.value).not.toBe(result2.value);
      }
    });

    it('returns error for non-existent file', async () => {
      const result = await repository.getByFile('/notes/nonexistent.md');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('correctly identifies dedicated vs inline source', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '- [ ] Dedicated task',
        '/notes/project.md': '- [ ] Inline task',
      });

      const dedicatedResult = await repository.getByFile('/notes/TODO.md');
      const inlineResult = await repository.getByFile('/notes/project.md');

      expect(dedicatedResult.ok).toBe(true);
      expect(inlineResult.ok).toBe(true);
      if (dedicatedResult.ok && inlineResult.ok) {
        expect(dedicatedResult.value[0]!.source).toBe('dedicated');
        expect(inlineResult.value[0]!.source).toBe('inline');
      }
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      fileSystem.seed({
        '/notes/TODO.md': `# TODO

- [ ] Open task 1 #work
- [x] Completed task ${COMPLETED} 2024-01-15
- [ ] Open task 2 #personal
- [ ] High priority ${HIGH} #work`,
        '/notes/project.md': `# Project

- [ ] Inline task
- [x] Done inline`,
      });
    });

    it('filters by isCompleted (open only)', async () => {
      const result = await repository.query({ status: 'open' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.every((t) => !t.isCompleted)).toBe(true);
        expect(result.value.length).toBe(4);
      }
    });

    it('filters by isCompleted (completed only)', async () => {
      const result = await repository.query({ status: 'completed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.every((t) => t.isCompleted)).toBe(true);
        expect(result.value.length).toBe(2);
      }
    });

    it('filters by source type (dedicated)', async () => {
      const result = await repository.query({ source: 'dedicated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.every((t) => t.source === 'dedicated')).toBe(true);
        expect(result.value.length).toBe(4);
      }
    });

    it('filters by source type (inline)', async () => {
      const result = await repository.query({ source: 'inline' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.every((t) => t.source === 'inline')).toBe(true);
        expect(result.value.length).toBe(2);
      }
    });

    it('filters by tags', async () => {
      const result = await repository.query({ tags: ['work'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.every((t) => t.tags.includes('work'))).toBe(true);
        expect(result.value.length).toBe(2);
      }
    });

    it('filters by text search', async () => {
      const result = await repository.query({ search: 'inline' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value.every((t) => t.content.toLowerCase().includes('inline'))).toBe(true);
      }
    });

    it('filters by priority', async () => {
      const result = await repository.query({ priority: ['high'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.priority).toBe('high');
      }
    });

    it('combines multiple filters', async () => {
      const result = await repository.query({
        status: 'open',
        source: 'dedicated',
        tags: ['work'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value.every((t) => !t.isCompleted && t.source === 'dedicated' && t.tags.includes('work'))).toBe(
          true
        );
      }
    });

    it('returns all todos with status: all', async () => {
      const result = await repository.query({ status: 'all' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(6);
      }
    });
  });

  describe('toggle()', () => {
    it('toggles incomplete todo to complete', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task to complete',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isCompleted).toBe(true);
        expect(result.value.rawLine).toContain('[x]');
      }

      // Verify file was updated
      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('[x]');
      }
    });

    it('toggles complete todo to incomplete', async () => {
      fileSystem.seed({
        '/notes/tasks.md': `- [x] Task to uncomplete ${COMPLETED} 2024-01-15T10:00`,
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isCompleted).toBe(false);
        expect(result.value.rawLine).toContain('[ ]');
        expect(result.value.rawLine).not.toContain(COMPLETED);
      }
    });

    it('adds completion timestamp when completing', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task to complete',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dates.completedAt).toBeDefined();
        expect(result.value.rawLine).toContain(COMPLETED);
      }
    });

    it('removes completion timestamp when uncompleting', async () => {
      fileSystem.seed({
        '/notes/tasks.md': `- [x] Task ${COMPLETED} 2024-01-15T10:00`,
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rawLine).not.toContain(COMPLETED);
      }
    });

    it('returns error for invalid todo ID', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '# Just a heading',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not a valid todo');
      }
    });

    it('returns error for out of bounds line', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Only task',
      });

      const id = generateTodoId('/notes/tasks.md', 99);
      const result = await repository.toggle(id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('out of bounds');
      }
    });

    it('invalidates cache after toggle', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task',
      });

      // Prime the cache
      await repository.getByFile('/notes/tasks.md');

      // Toggle
      const id = generateTodoId('/notes/tasks.md', 0);
      await repository.toggle(id);

      // Get should return updated todo
      const result = await repository.getByFile('/notes/tasks.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]!.isCompleted).toBe(true);
      }
    });
  });

  describe('updateContent()', () => {
    it('updates todo text content', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Original content',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.updateContent(id, 'Updated content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Updated content');
      }

      // Verify file was updated
      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('Updated content');
        expect(fileResult.value).not.toContain('Original content');
      }
    });

    it('preserves completion state when updating content', async () => {
      fileSystem.seed({
        '/notes/tasks.md': `- [x] Original ${COMPLETED} 2024-01-15T10:00`,
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.updateContent(id, 'Updated');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isCompleted).toBe(true);
        expect(result.value.rawLine).toContain('[x]');
      }
    });

    it('preserves metadata when updating content', async () => {
      fileSystem.seed({
        '/notes/tasks.md': `- [ ] Original ${HIGH} ${DUE} 2024-01-20 #work`,
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.updateContent(id, 'Updated');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.priority).toBe('high');
        expect(result.value.dates.dueDate).toBeDefined();
        expect(result.value.tags).toContain('work');
      }
    });

    it('returns error for non-todo line', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '# Heading\n- [ ] Task',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.updateContent(id, 'Updated');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not a valid todo');
      }
    });

    it('invalidates cache after update', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Original',
      });

      // Prime cache
      await repository.getByFile('/notes/tasks.md');

      // Update
      const id = generateTodoId('/notes/tasks.md', 0);
      await repository.updateContent(id, 'Updated');

      // Get should return updated content
      const result = await repository.getByFile('/notes/tasks.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]!.content).toBe('Updated');
      }
    });
  });

  describe('delete()', () => {
    it('removes todo line from file', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3',
      });

      const id = generateTodoId('/notes/tasks.md', 1);
      const result = await repository.delete(id);

      expect(result.ok).toBe(true);

      // Verify file was updated
      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toBe('- [ ] Task 1\n- [ ] Task 3');
      }
    });

    it('can delete first line', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] First\n- [ ] Second',
      });

      const id = generateTodoId('/notes/tasks.md', 0);
      const result = await repository.delete(id);

      expect(result.ok).toBe(true);

      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toBe('- [ ] Second');
      }
    });

    it('can delete last line', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] First\n- [ ] Last',
      });

      const id = generateTodoId('/notes/tasks.md', 1);
      const result = await repository.delete(id);

      expect(result.ok).toBe(true);

      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toBe('- [ ] First');
      }
    });

    it('returns error for non-existent file', async () => {
      const id = generateTodoId('/notes/nonexistent.md', 0);
      const result = await repository.delete(id);

      expect(result.ok).toBe(false);
    });

    it('invalidates cache after delete', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task 1\n- [ ] Task 2',
      });

      // Prime cache
      await repository.getByFile('/notes/tasks.md');

      // Delete
      const id = generateTodoId('/notes/tasks.md', 0);
      await repository.delete(id);

      // Get should return remaining task
      const result = await repository.getByFile('/notes/tasks.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Task 2');
      }
    });
  });

  describe('create()', () => {
    it('appends new todo to specified file', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Existing task',
      });

      const result = await repository.create(
        {
          content: 'New task',
          source: 'inline',
          sourceFile: '/notes/tasks.md',
          lineNumber: 0, // Will be overwritten
          rawLine: '', // Will be generated
        },
        '/notes/tasks.md'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('New task');
        expect(result.value.isCompleted).toBe(false);
      }

      // Verify file was updated
      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('- [ ] Existing task');
        expect(fileResult.value).toContain('- [ ] New task');
      }
    });

    it('creates file if not exists', async () => {
      // Ensure the notes directory exists
      await fileSystem.createDirectory('/notes');

      const result = await repository.create(
        {
          content: 'First task',
          source: 'inline',
          sourceFile: '/notes/new-file.md',
          lineNumber: 0,
          rawLine: '',
        },
        '/notes/new-file.md'
      );

      expect(result.ok).toBe(true);

      // Verify file was created
      const _exists_r = await fileSystem.exists('/notes/new-file.md');
      const exists = _exists_r.ok && _exists_r.value;
      expect(exists).toBe(true);

      const fileResult = await fileSystem.readFile('/notes/new-file.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('- [ ] First task');
      }
    });

    it('uses default TODO.md when no target specified', async () => {
      await fileSystem.createDirectory('/notes');

      const result = await repository.create({
        content: 'Default file task',
        source: 'dedicated',
        sourceFile: '/notes/TODO.md',
        lineNumber: 0,
        rawLine: '',
      });

      expect(result.ok).toBe(true);

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('Default file task');
      }
    });

    it('creates todo with priority', async () => {
      await fileSystem.createDirectory('/notes');

      const result = await repository.create(
        {
          content: 'Priority task',
          source: 'dedicated',
          sourceFile: '/notes/TODO.md',
          lineNumber: 0,
          rawLine: '',
          priority: 'high',
        },
        '/notes/TODO.md'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.priority).toBe('high');
      }

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain(HIGH);
      }
    });

    it('creates todo with due date', async () => {
      await fileSystem.createDirectory('/notes');

      const dueDate = new Date('2024-02-15');

      const result = await repository.create(
        {
          content: 'Due task',
          source: 'dedicated',
          sourceFile: '/notes/TODO.md',
          lineNumber: 0,
          rawLine: '',
          dates: { dueDate },
        },
        '/notes/TODO.md'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dates.dueDate).toBeDefined();
      }

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain(DUE);
        expect(fileResult.value).toContain('2024-02-15');
      }
    });

    it('creates todo with tags', async () => {
      await fileSystem.createDirectory('/notes');

      const result = await repository.create(
        {
          content: 'Tagged task',
          source: 'dedicated',
          sourceFile: '/notes/TODO.md',
          lineNumber: 0,
          rawLine: '',
          tags: ['work', 'urgent'],
        },
        '/notes/TODO.md'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual(['work', 'urgent']);
      }

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('#work');
        expect(fileResult.value).toContain('#urgent');
      }
    });

    it('creates dedicated todos under the requested TODO.md section', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '# TODO\n\n## Inbox\n\n## Anytime\n\n## Someday\n',
      });

      const result = await repository.create(
        {
          content: 'Later task',
          source: 'dedicated',
          sourceFile: '/notes/TODO.md',
          lineNumber: 0,
          rawLine: '',
          list: 'someday',
        },
        '/notes/TODO.md',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.list).toBe('someday');
        expect(result.value.section).toBe('Someday');
      }

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      expect(fileResult.ok).toBe(true);
      if (fileResult.ok) {
        expect(fileResult.value).toContain('## Someday\n\n- [ ] Later task');
      }
    });

    it('moves dedicated todos between TODO.md sections with updatePatch', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '# TODO\n\n## Inbox\n\n- [ ] Capture this\n\n## Anytime\n\n## Someday\n',
      });

      const result = await repository.updatePatch('/notes/TODO.md:4', {
        targetList: 'anytime',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.list).toBe('anytime');
        expect(result.value.section).toBe('Anytime');
        expect(result.value.id).not.toBe('/notes/TODO.md:4');
      }

      const fileResult = await fileSystem.readFile('/notes/TODO.md');
      expect(fileResult.ok).toBe(true);
      if (fileResult.ok) {
        expect(fileResult.value).toContain('## Anytime\n\n- [ ] Capture this');
      }
    });

    it('creates todo with indentation', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Parent task',
      });

      const result = await repository.create(
        {
          content: 'Child task',
          source: 'inline',
          sourceFile: '/notes/tasks.md',
          lineNumber: 0,
          rawLine: '',
          indent: 1,
        },
        '/notes/tasks.md'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.indent).toBe(1);
      }

      const fileResult = await fileSystem.readFile('/notes/tasks.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('  - [ ] Child task');
      }
    });

    it('invalidates cache after create', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Existing',
      });

      // Prime cache
      await repository.getByFile('/notes/tasks.md');

      // Create
      await repository.create(
        {
          content: 'New task',
          source: 'inline',
          sourceFile: '/notes/tasks.md',
          lineNumber: 0,
          rawLine: '',
        },
        '/notes/tasks.md'
      );

      // Get should include new task
      const result = await repository.getByFile('/notes/tasks.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });
  });

  describe('todo list files', () => {
    it('creates custom todo-list files with the todo prefix and marker', async () => {
      await fileSystem.createDirectory('/notes');

      const result = await repository.createTodoList({
        title: 'Work',
        note: 'Office context',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.path).toBe('/notes/todo-work.md');
      expect(result.value.title).toBe('Work');
      expect(result.value.note).toBe('Office context');

      const fileResult = await fileSystem.readFile('/notes/todo-work.md');
      expect(fileResult.ok).toBe(true);
      if (fileResult.ok) {
        expect(fileResult.value).toContain('void_type: todo-list');
        expect(fileResult.value).toContain('# Work');
        expect(fileResult.value).toContain('## Inbox');
      }
    });

    it('treats marked todo-list files as dedicated and normal notes as inline', async () => {
      await fileSystem.createDirectory('/notes');
      await repository.createTodoList({ title: 'Work' });
      await repository.create(
        {
          content: 'Dedicated work task',
          source: 'dedicated',
          sourceFile: '/notes/todo-work.md',
          lineNumber: 0,
          rawLine: '',
          list: 'inbox',
        },
        '/notes/todo-work.md',
      );
      fileSystem.seed({
        '/notes/project.md': '- [ ] Inline task',
      });

      const dedicated = await repository.getByFile('/notes/todo-work.md');
      const inline = await repository.getByFile('/notes/project.md');

      expect(dedicated.ok).toBe(true);
      expect(inline.ok).toBe(true);
      if (dedicated.ok && inline.ok) {
        expect(dedicated.value[0]!.source).toBe('dedicated');
        expect(dedicated.value[0]!.list).toBe('inbox');
        expect(inline.value[0]!.source).toBe('inline');
      }
    });

    it('renames custom todo-list files to the prefixed slug and preserves tasks', async () => {
      await fileSystem.createDirectory('/notes');
      await repository.createTodoList({ title: 'Work', note: 'Old note' });
      await repository.create(
        {
          content: 'Keep this',
          source: 'dedicated',
          sourceFile: '/notes/todo-work.md',
          lineNumber: 0,
          rawLine: '',
          list: 'anytime',
        },
        '/notes/todo-work.md',
      );

      const result = await repository.updateTodoList('/notes/todo-work.md', {
        title: 'House',
        note: 'New note',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.path).toBe('/notes/todo-house.md');
      expect(result.value.title).toBe('House');

      const oldExists = await fileSystem.exists('/notes/todo-work.md');
      const newFile = await fileSystem.readFile('/notes/todo-house.md');
      expect(oldExists.ok && oldExists.value).toBe(false);
      expect(newFile.ok).toBe(true);
      if (newFile.ok) {
        expect(newFile.value).toContain('# House');
        expect(newFile.value).toContain('New note');
        expect(newFile.value).toContain('- [ ] Keep this');
      }
    });

    it('refuses to rename custom todo-list files over an existing file', async () => {
      await fileSystem.createDirectory('/notes');
      await repository.createTodoList({ title: 'Work' });
      await repository.createTodoList({ title: 'House' });

      const result = await repository.updateTodoList('/notes/todo-work.md', {
        title: 'House',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('already exists');
      }
    });

    it('refuses to manage the protected TODO.md file as a custom list', async () => {
      fileSystem.seed({
        '/notes/TODO.md': '# TODO\n\n## Inbox\n',
      });

      const update = await repository.updateTodoList('/notes/TODO.md', { title: 'Work' });
      const remove = await repository.deleteTodoList('/notes/TODO.md');

      expect(update.ok).toBe(false);
      expect(remove.ok).toBe(false);
    });

    it('accepts normalized file-system paths when the configured notes root uses a tilde', async () => {
      const tildeRepository = new MarkdownTodoRepository(fileSystem, parser, {
        notesPath: '~/Documents/void',
      });
      await fileSystem.createDirectory('~/Documents/void');

      const created = await tildeRepository.createTodoList({ title: 'Work' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.path).toBe('/~/Documents/void/todo-work.md');

      const renamed = await tildeRepository.updateTodoList(created.value.path, { title: 'House' });

      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.value.path).toBe('/~/Documents/void/todo-house.md');

      const deleted = await tildeRepository.deleteTodoList(renamed.value.path);
      const exists = await fileSystem.exists('/~/Documents/void/todo-house.md');

      expect(deleted.ok).toBe(true);
      expect(exists.ok && exists.value).toBe(false);
    });

    it('lists empty and populated markdown sections with todo counts', async () => {
      fileSystem.seed({
        '/notes/todo-work.md': [
          '---',
          'title: Work',
          'void_type: todo-list',
          '---',
          '',
          '# Work',
          '',
          '## Inbox',
          '',
          '- [ ] First task',
          '## Launch',
          '',
          '## Ops',
          '- [x] Done task',
        ].join('\n'),
      });

      const sections = await repository.getSections('/notes/todo-work.md');

      expect(sections.ok).toBe(true);
      if (!sections.ok) return;
      expect(sections.value.map((section) => ({
        title: section.title,
        todoCount: section.todoCount,
      }))).toEqual([
        { title: 'Inbox', todoCount: 1 },
        { title: 'Launch', todoCount: 0 },
        { title: 'Ops', todoCount: 1 },
      ]);
    });

    it('creates and renames custom sections while rejecting invalid titles', async () => {
      await fileSystem.createDirectory('/notes');
      await repository.createTodoList({ title: 'Work' });

      const created = await repository.createSection('/notes/todo-work.md', 'Launch');
      const duplicate = await repository.createSection('/notes/todo-work.md', 'launch');
      const empty = await repository.createSection('/notes/todo-work.md', '   ');
      const renamed = await repository.renameSection('/notes/todo-work.md', 'Launch', 'Shipped');

      expect(created.ok).toBe(true);
      expect(duplicate.ok).toBe(false);
      expect(empty.ok).toBe(false);
      expect(renamed.ok).toBe(true);

      const file = await fileSystem.readFile('/notes/todo-work.md');
      expect(file.ok).toBe(true);
      if (file.ok) {
        expect(file.value).toContain('## Shipped');
        expect(file.value).not.toContain('## Launch');
      }
    });

    it('moves todos before and after other todos in source order', async () => {
      fileSystem.seed({
        '/notes/todo-work.md': [
          '---',
          'title: Work',
          'void_type: todo-list',
          '---',
          '',
          '# Work',
          '',
          '## Inbox',
          '',
          '- [ ] First task',
          '- [ ] Second task',
          '',
          '## Launch',
          '',
          `- [ ] Third task ${DUE} 2026-06-01`,
        ].join('\n'),
      });

      const moved = await repository.move(
        generateTodoId('/notes/todo-work.md', 14),
        {
          kind: 'todo',
          targetId: generateTodoId('/notes/todo-work.md', 9),
          position: 'before',
        },
      );

      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.value.lineNumber).toBe(9);
      expect(moved.value.section).toBe('Inbox');

      const file = await fileSystem.readFile('/notes/todo-work.md');
      expect(file.ok).toBe(true);
      if (file.ok) {
        expect(file.value).toContain(`- [ ] Third task ${DUE} 2026-06-01\n- [ ] First task\n- [ ] Second task`);
      }
    });

    it('moves todos into empty sections and preserves raw metadata', async () => {
      fileSystem.seed({
        '/notes/todo-work.md': [
          '---',
          'title: Work',
          'void_type: todo-list',
          '---',
          '',
          '# Work',
          '',
          '## Inbox',
          '',
          `- [ ] First task ${HIGH} #alpha`,
          '',
          '## Launch',
        ].join('\n'),
      });

      const moved = await repository.move(
        generateTodoId('/notes/todo-work.md', 9),
        {
          kind: 'section',
          filePath: '/notes/todo-work.md',
          section: 'Launch',
        },
      );

      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.value.section).toBe('Launch');
      expect(moved.value.priority).toBe('high');
      expect(moved.value.tags).toEqual(['alpha']);

      const file = await fileSystem.readFile('/notes/todo-work.md');
      expect(file.ok).toBe(true);
      if (file.ok) {
        expect(file.value).toContain(`## Launch\n\n- [ ] First task ${HIGH} #alpha`);
      }
    });

    it('moves whole sections before and after other sections while preserving content', async () => {
      fileSystem.seed({
        '/notes/todo-work.md': [
          '---',
          'title: Work',
          'void_type: todo-list',
          '---',
          '',
          '# Work',
          '',
          '## Inbox',
          'Inbox note',
          '- [ ] First task',
          '',
          '## Launch',
          'Keep this prose.',
          `- [ ] Ship release ${HIGH} #alpha`,
          '',
          '### Checklist',
          '- [ ] Nested follow-up',
          '',
          '## Ops',
          '- [x] Done task',
        ].join('\n'),
      });

      const movedBefore = await repository.moveSection('/notes/todo-work.md', 'Launch', 'Inbox', 'before');

      expect(movedBefore.ok).toBe(true);
      if (!movedBefore.ok) return;
      expect(movedBefore.value.map((section) => section.title)).toEqual(['Launch', 'Inbox', 'Ops']);

      let file = await fileSystem.readFile('/notes/todo-work.md');
      expect(file.ok).toBe(true);
      if (!file.ok) return;
      expect(file.value).toContain([
        '## Launch',
        'Keep this prose.',
        `- [ ] Ship release ${HIGH} #alpha`,
        '',
        '### Checklist',
        '- [ ] Nested follow-up',
        '',
        '## Inbox',
      ].join('\n'));

      const movedAfter = await repository.moveSection('/notes/todo-work.md', 'Launch', 'Ops', 'after');

      expect(movedAfter.ok).toBe(true);
      if (!movedAfter.ok) return;
      expect(movedAfter.value.map((section) => section.title)).toEqual(['Inbox', 'Ops', 'Launch']);
      file = await fileSystem.readFile('/notes/todo-work.md');
      expect(file.ok).toBe(true);
      if (!file.ok) return;
      expect(file.value.trimEnd().endsWith([
        '## Launch',
        'Keep this prose.',
        `- [ ] Ship release ${HIGH} #alpha`,
        '',
        '### Checklist',
        '- [ ] Nested follow-up',
      ].join('\n'))).toBe(true);
    });

    it('rejects invalid section moves', async () => {
      fileSystem.seed({
        '/notes/todo-work.md': [
          '---',
          'title: Work',
          'void_type: todo-list',
          '---',
          '',
          '# Work',
          '',
          '## Inbox',
          '- [ ] First task',
          '',
          '## inbox',
          '- [ ] Duplicate task',
          '',
          '## Launch',
          '- [ ] Ship release',
        ].join('\n'),
        '/notes/regular.md': [
          '# Regular',
          '',
          '## Inbox',
          '- [ ] Inline task',
        ].join('\n'),
      });

      const duplicate = await repository.moveSection('/notes/todo-work.md', 'Launch', 'Inbox', 'before');
      const missing = await repository.moveSection('/notes/todo-work.md', 'Missing', 'Launch', 'before');
      const self = await repository.moveSection('/notes/todo-work.md', 'Launch', 'Launch', 'after');
      const inline = await repository.moveSection('/notes/regular.md', 'Inbox', 'Launch', 'before');

      expect(duplicate.ok).toBe(false);
      expect(missing.ok).toBe(false);
      expect(self.ok).toBe(false);
      expect(inline.ok).toBe(false);
    });
  });

  describe('invalidate()', () => {
    it('clears cache for specific file', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Task',
      });

      // Prime cache
      const result1 = await repository.getByFile('/notes/tasks.md');

      // Get again without changes - should return cached array (same reference)
      const result2 = await repository.getByFile('/notes/tasks.md');
      expect(result1.ok && result2.ok && result1.value === result2.value).toBe(true);

      // Invalidate clears the cache
      repository.invalidate('/notes/tasks.md');

      // Get again - should parse fresh (different array reference)
      const result3 = await repository.getByFile('/notes/tasks.md');
      expect(result3.ok).toBe(true);
      if (result1.ok && result3.ok) {
        // Content is the same, but it's a new array from re-parsing
        expect(result1.value).not.toBe(result3.value);
        expect(result3.value[0]!.content).toBe('Task');
      }
    });

    it('clears all cache when no path specified', async () => {
      fileSystem.seed({
        '/notes/file1.md': '- [ ] Task 1',
        '/notes/file2.md': '- [ ] Task 2',
      });

      // Prime cache for both files
      await repository.getByFile('/notes/file1.md');
      await repository.getByFile('/notes/file2.md');

      // Update both files
      await fileSystem.writeFile('/notes/file1.md', '- [ ] Updated 1');
      await fileSystem.writeFile('/notes/file2.md', '- [ ] Updated 2');

      // Invalidate all
      repository.invalidate();

      // Both should return fresh data
      const result1 = await repository.getByFile('/notes/file1.md');
      const result2 = await repository.getByFile('/notes/file2.md');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value[0]!.content).toBe('Updated 1');
        expect(result2.value[0]!.content).toBe('Updated 2');
      }
    });
  });

  describe('refresh()', () => {
    it('clears cache and re-scans all files', async () => {
      fileSystem.seed({
        '/notes/tasks.md': '- [ ] Original task',
      });

      // Prime cache
      await repository.getAll();

      // Modify file
      await fileSystem.writeFile('/notes/tasks.md', '- [ ] Refreshed task');

      // Refresh
      const refreshResult = await repository.refresh();
      expect(refreshResult.ok).toBe(true);

      // Get should return fresh data
      const result = await repository.getByFile('/notes/tasks.md');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]!.content).toBe('Refreshed task');
      }
    });

    it('populates cache for all files', async () => {
      fileSystem.seed({
        '/notes/file1.md': '- [ ] Task 1',
        '/notes/file2.md': '- [ ] Task 2',
      });

      // Refresh populates cache
      await repository.refresh();

      // Subsequent getByFile calls should use cache
      const result1a = await repository.getByFile('/notes/file1.md');
      const result1b = await repository.getByFile('/notes/file1.md');

      expect(result1a.ok && result1b.ok && result1a.value === result1b.value).toBe(true);
    });

    it('returns error if scan fails', async () => {
      // Create repository with non-existent path
      const badRepo = new MarkdownTodoRepository(fileSystem, parser, {
        notesPath: '/nonexistent',
      });

      const result = await badRepo.refresh();

      expect(result.ok).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty files', async () => {
      fileSystem.seed({
        '/notes/empty.md': '',
      });

      const result = await repository.getByFile('/notes/empty.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('handles files with only non-todo content', async () => {
      fileSystem.seed({
        '/notes/text.md': '# Heading\n\nSome paragraph text.\n\n- Regular list item',
      });

      const result = await repository.getByFile('/notes/text.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('handles deeply nested directories', async () => {
      fileSystem.seed({
        '/notes/a/b/c/deep.md': '- [ ] Deep task',
      });

      const result = await repository.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.content).toBe('Deep task');
      }
    });

    it('handles special characters in file paths', async () => {
      fileSystem.seed({
        '/notes/meeting (2024-01-15).md': '- [ ] Task with special chars',
      });

      const result = await repository.getByFile('/notes/meeting (2024-01-15).md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });

    it('handles unicode in todo content', async () => {
      fileSystem.seed({
        '/notes/unicode.md': '- [ ] Review documentation',
      });

      const result = await repository.getByFile('/notes/unicode.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]!.content).toBe('Review documentation');
      }
    });

    it('preserves other lines when modifying a todo', async () => {
      fileSystem.seed({
        '/notes/mixed.md': '# Tasks\n\n- [ ] Task 1\n\nSome text\n\n- [ ] Task 2',
      });

      const id = generateTodoId('/notes/mixed.md', 2);
      await repository.toggle(id);

      const fileResult = await fileSystem.readFile('/notes/mixed.md');
      if (fileResult.ok) {
        expect(fileResult.value).toContain('# Tasks');
        expect(fileResult.value).toContain('Some text');
        expect(fileResult.value).toContain('- [ ] Task 2');
      }
    });
  });
});
