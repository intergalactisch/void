/**
 * Unit tests for Todo entity
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTodo,
  toggleTodo,
  updateTodoContent,
  updateTodoPriority,
  updateTodoDueDate,
  updateTodoScheduledDate,
  addTodoTag,
  removeTodoTag,
  serializeTodo,
  sortTodos,
  sortTodosWithCompletedLast,
  groupTodosByFile,
  groupTodosByPriority,
  getAllTags,
  countTodosByStatus,
} from '$lib/domain/entities/Todo';
import type { Todo, CreateTodoParams } from '$lib/domain/entities/Todo';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';
import { DATE_MARKERS } from '$lib/domain/values/TodoDateMeta';

/**
 * Helper to create a basic todo for testing.
 */
function createBasicTodo(overrides: Partial<CreateTodoParams> = {}): Todo {
  return createTodo({
    content: 'Test task',
    source: 'inline',
    sourceFile: '/notes/test.md',
    lineNumber: 10,
    rawLine: '- [ ] Test task',
    ...overrides,
  });
}

describe('Todo entity', () => {
  describe('createTodo()', () => {
    it('creates todo with required fields', () => {
      const todo = createTodo({
        content: 'Buy groceries',
        source: 'dedicated',
        sourceFile: '/TODO.md',
        lineNumber: 5,
        rawLine: '- [ ] Buy groceries',
      });

      expect(todo.id).toBe('/TODO.md:5');
      expect(todo.content).toBe('Buy groceries');
      expect(todo.isCompleted).toBe(false);
      expect(todo.source).toBe('dedicated');
      expect(todo.sourceFile).toBe('/TODO.md');
      expect(todo.lineNumber).toBe(5);
      expect(todo.indent).toBe(0);
      expect(todo.dates).toEqual({});
      expect(todo.priority).toBeUndefined();
      expect(todo.tags).toEqual([]);
      expect(todo.rawLine).toBe('- [ ] Buy groceries');
    });

    it('creates todo with optional isCompleted true', () => {
      const todo = createBasicTodo({ isCompleted: true });
      expect(todo.isCompleted).toBe(true);
    });

    it('creates todo with indent level', () => {
      const todo = createBasicTodo({ indent: 2 });
      expect(todo.indent).toBe(2);
    });

    it('creates todo with dates', () => {
      const dueDate = new Date('2025-01-31');
      const scheduledDate = new Date('2025-01-28');
      const completedAt = new Date('2025-01-30T14:30:00');

      const todo = createBasicTodo({
        dates: {
          dueDate,
          scheduledDate,
          completedAt,
          recurrence: 'every week',
        },
      });

      expect(todo.dates.dueDate).toEqual(dueDate);
      expect(todo.dates.scheduledDate).toEqual(scheduledDate);
      expect(todo.dates.completedAt).toEqual(completedAt);
      expect(todo.dates.recurrence).toBe('every week');
    });

    it('creates todo with priority', () => {
      const highPriority = createBasicTodo({ priority: 'high' });
      const mediumPriority = createBasicTodo({ priority: 'medium' });
      const lowPriority = createBasicTodo({ priority: 'low' });

      expect(highPriority.priority).toBe('high');
      expect(mediumPriority.priority).toBe('medium');
      expect(lowPriority.priority).toBe('low');
    });

    it('creates todo without priority when undefined', () => {
      const todo = createBasicTodo({ priority: undefined });
      expect(todo.priority).toBeUndefined();
      expect('priority' in todo).toBe(false);
    });

    it('creates todo with tags', () => {
      const todo = createBasicTodo({ tags: ['work', 'urgent'] });
      expect(todo.tags).toEqual(['work', 'urgent']);
    });

    it('generates unique id from file path and line number', () => {
      const todo1 = createBasicTodo({ sourceFile: '/a.md', lineNumber: 1 });
      const todo2 = createBasicTodo({ sourceFile: '/a.md', lineNumber: 2 });
      const todo3 = createBasicTodo({ sourceFile: '/b.md', lineNumber: 1 });

      expect(todo1.id).toBe('/a.md:1');
      expect(todo2.id).toBe('/a.md:2');
      expect(todo3.id).toBe('/b.md:1');
      expect(todo1.id).not.toBe(todo2.id);
      expect(todo1.id).not.toBe(todo3.id);
    });

    it('handles inline source type', () => {
      const todo = createBasicTodo({ source: 'inline' });
      expect(todo.source).toBe('inline');
    });

    it('handles dedicated source type', () => {
      const todo = createBasicTodo({ source: 'dedicated' });
      expect(todo.source).toBe('dedicated');
    });
  });

  describe('toggleTodo()', () => {
    it('toggles incomplete todo to completed', () => {
      const todo = createBasicTodo({ isCompleted: false });
      const completedAt = new Date('2025-01-31T10:00:00');
      const toggled = toggleTodo(todo, completedAt);

      expect(toggled.isCompleted).toBe(true);
      expect(toggled.dates.completedAt).toEqual(completedAt);
    });

    it('toggles completed todo to incomplete', () => {
      const completedAt = new Date('2025-01-30T10:00:00');
      const todo = createBasicTodo({
        isCompleted: true,
        dates: { completedAt },
      });
      const toggled = toggleTodo(todo);

      expect(toggled.isCompleted).toBe(false);
      expect(toggled.dates.completedAt).toBeUndefined();
    });

    it('preserves other dates when toggling', () => {
      const dueDate = new Date('2025-02-15');
      const scheduledDate = new Date('2025-02-01');
      const todo = createBasicTodo({
        isCompleted: false,
        dates: { dueDate, scheduledDate, recurrence: 'every day' },
      });
      const toggled = toggleTodo(todo);

      expect(toggled.dates.dueDate).toEqual(dueDate);
      expect(toggled.dates.scheduledDate).toEqual(scheduledDate);
      expect(toggled.dates.recurrence).toBe('every day');
    });

    it('uses current date when no completedAt provided', () => {
      const before = new Date();
      const todo = createBasicTodo({ isCompleted: false });
      const toggled = toggleTodo(todo);
      const after = new Date();

      expect(toggled.isCompleted).toBe(true);
      expect(toggled.dates.completedAt).toBeDefined();
      expect(toggled.dates.completedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(toggled.dates.completedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('returns a new todo object (immutable)', () => {
      const todo = createBasicTodo({ isCompleted: false });
      const toggled = toggleTodo(todo);

      expect(toggled).not.toBe(todo);
      expect(todo.isCompleted).toBe(false);
      expect(toggled.isCompleted).toBe(true);
    });
  });

  describe('updateTodoContent()', () => {
    it('updates content', () => {
      const todo = createBasicTodo({ content: 'Original content' });
      const updated = updateTodoContent(todo, 'New content');

      expect(updated.content).toBe('New content');
    });

    it('returns new todo object (immutable)', () => {
      const todo = createBasicTodo({ content: 'Original' });
      const updated = updateTodoContent(todo, 'Updated');

      expect(updated).not.toBe(todo);
      expect(todo.content).toBe('Original');
    });

    it('preserves other fields', () => {
      const todo = createBasicTodo({
        content: 'Original',
        priority: 'high',
        tags: ['work'],
      });
      const updated = updateTodoContent(todo, 'Updated');

      expect(updated.priority).toBe('high');
      expect(updated.tags).toEqual(['work']);
      expect(updated.id).toBe(todo.id);
    });

    it('handles empty content', () => {
      const todo = createBasicTodo({ content: 'Some content' });
      const updated = updateTodoContent(todo, '');

      expect(updated.content).toBe('');
    });
  });

  describe('updateTodoPriority()', () => {
    it('sets priority to high', () => {
      const todo = createBasicTodo();
      const updated = updateTodoPriority(todo, 'high');

      expect(updated.priority).toBe('high');
    });

    it('sets priority to medium', () => {
      const todo = createBasicTodo();
      const updated = updateTodoPriority(todo, 'medium');

      expect(updated.priority).toBe('medium');
    });

    it('sets priority to low', () => {
      const todo = createBasicTodo();
      const updated = updateTodoPriority(todo, 'low');

      expect(updated.priority).toBe('low');
    });

    it('removes priority when set to undefined', () => {
      const todo = createBasicTodo({ priority: 'high' });
      const updated = updateTodoPriority(todo, undefined);

      expect(updated.priority).toBeUndefined();
      expect('priority' in updated).toBe(false);
    });

    it('changes existing priority', () => {
      const todo = createBasicTodo({ priority: 'low' });
      const updated = updateTodoPriority(todo, 'high');

      expect(updated.priority).toBe('high');
    });

    it('returns new todo object (immutable)', () => {
      const todo = createBasicTodo({ priority: 'low' });
      const updated = updateTodoPriority(todo, 'high');

      expect(updated).not.toBe(todo);
      expect(todo.priority).toBe('low');
    });
  });

  describe('updateTodoDueDate()', () => {
    it('sets due date', () => {
      const todo = createBasicTodo();
      const dueDate = new Date('2025-02-15');
      const updated = updateTodoDueDate(todo, dueDate);

      expect(updated.dates.dueDate).toEqual(dueDate);
    });

    it('removes due date when set to undefined', () => {
      const dueDate = new Date('2025-02-15');
      const todo = createBasicTodo({ dates: { dueDate } });
      const updated = updateTodoDueDate(todo, undefined);

      expect(updated.dates.dueDate).toBeUndefined();
    });

    it('preserves other dates', () => {
      const scheduledDate = new Date('2025-02-01');
      const completedAt = new Date('2025-02-10');
      const todo = createBasicTodo({
        dates: { scheduledDate, completedAt, recurrence: 'every month' },
      });
      const newDueDate = new Date('2025-02-20');
      const updated = updateTodoDueDate(todo, newDueDate);

      expect(updated.dates.dueDate).toEqual(newDueDate);
      expect(updated.dates.scheduledDate).toEqual(scheduledDate);
      expect(updated.dates.completedAt).toEqual(completedAt);
      expect(updated.dates.recurrence).toBe('every month');
    });

    it('returns new todo object (immutable)', () => {
      const dueDate = new Date('2025-02-15');
      const todo = createBasicTodo({ dates: { dueDate } });
      const updated = updateTodoDueDate(todo, new Date('2025-03-01'));

      expect(updated).not.toBe(todo);
      expect(todo.dates.dueDate).toEqual(dueDate);
    });
  });

  describe('updateTodoScheduledDate()', () => {
    it('sets scheduled date', () => {
      const todo = createBasicTodo();
      const scheduledDate = new Date('2025-02-01');
      const updated = updateTodoScheduledDate(todo, scheduledDate);

      expect(updated.dates.scheduledDate).toEqual(scheduledDate);
    });

    it('removes scheduled date when set to undefined', () => {
      const scheduledDate = new Date('2025-02-01');
      const todo = createBasicTodo({ dates: { scheduledDate } });
      const updated = updateTodoScheduledDate(todo, undefined);

      expect(updated.dates.scheduledDate).toBeUndefined();
    });

    it('preserves other dates', () => {
      const dueDate = new Date('2025-02-15');
      const completedAt = new Date('2025-02-10');
      const todo = createBasicTodo({
        dates: { dueDate, completedAt, recurrence: 'every week' },
      });
      const newScheduledDate = new Date('2025-02-05');
      const updated = updateTodoScheduledDate(todo, newScheduledDate);

      expect(updated.dates.scheduledDate).toEqual(newScheduledDate);
      expect(updated.dates.dueDate).toEqual(dueDate);
      expect(updated.dates.completedAt).toEqual(completedAt);
      expect(updated.dates.recurrence).toBe('every week');
    });

    it('returns new todo object (immutable)', () => {
      const scheduledDate = new Date('2025-02-01');
      const todo = createBasicTodo({ dates: { scheduledDate } });
      const updated = updateTodoScheduledDate(todo, new Date('2025-02-05'));

      expect(updated).not.toBe(todo);
      expect(todo.dates.scheduledDate).toEqual(scheduledDate);
    });
  });

  describe('addTodoTag()', () => {
    it('adds tag to empty tag list', () => {
      const todo = createBasicTodo({ tags: [] });
      const updated = addTodoTag(todo, 'work');

      expect(updated.tags).toEqual(['work']);
    });

    it('adds tag to existing tags', () => {
      const todo = createBasicTodo({ tags: ['work'] });
      const updated = addTodoTag(todo, 'urgent');

      expect(updated.tags).toEqual(['work', 'urgent']);
    });

    it('is idempotent - does not add duplicate tag', () => {
      const todo = createBasicTodo({ tags: ['work', 'urgent'] });
      const updated = addTodoTag(todo, 'work');

      expect(updated.tags).toEqual(['work', 'urgent']);
      expect(updated).toBe(todo); // Same reference when no change
    });

    it('returns new todo object when tag added', () => {
      const todo = createBasicTodo({ tags: ['work'] });
      const updated = addTodoTag(todo, 'urgent');

      expect(updated).not.toBe(todo);
      expect(todo.tags).toEqual(['work']);
    });
  });

  describe('removeTodoTag()', () => {
    it('removes existing tag', () => {
      const todo = createBasicTodo({ tags: ['work', 'urgent'] });
      const updated = removeTodoTag(todo, 'work');

      expect(updated.tags).toEqual(['urgent']);
    });

    it('handles non-existent tag gracefully', () => {
      const todo = createBasicTodo({ tags: ['work'] });
      const updated = removeTodoTag(todo, 'nonexistent');

      expect(updated.tags).toEqual(['work']);
    });

    it('removes last tag leaving empty array', () => {
      const todo = createBasicTodo({ tags: ['work'] });
      const updated = removeTodoTag(todo, 'work');

      expect(updated.tags).toEqual([]);
    });

    it('returns new todo object (immutable)', () => {
      const todo = createBasicTodo({ tags: ['work', 'urgent'] });
      const updated = removeTodoTag(todo, 'work');

      expect(updated).not.toBe(todo);
      expect(todo.tags).toEqual(['work', 'urgent']);
    });
  });

  describe('serializeTodo()', () => {
    it('serializes incomplete todo', () => {
      const todo = createBasicTodo({
        content: 'Buy groceries',
        isCompleted: false,
        rawLine: '- [ ] Buy groceries',
      });
      const result = serializeTodo(todo);

      expect(result).toBe('- [ ] Buy groceries');
    });

    it('serializes completed todo', () => {
      const todo = createBasicTodo({
        content: 'Buy groceries',
        isCompleted: true,
        rawLine: '- [x] Buy groceries',
      });
      const result = serializeTodo(todo);

      expect(result).toContain('[x]');
      expect(result).toContain('Buy groceries');
    });

    it('serializes with indentation', () => {
      const todo = createBasicTodo({
        content: 'Sub-task',
        indent: 2,
        rawLine: '    - [ ] Sub-task',
      });
      const result = serializeTodo(todo);

      expect(result).toBe('    - [ ] Sub-task');
    });

    it('preserves asterisk list marker', () => {
      const todo = createBasicTodo({
        content: 'Task',
        rawLine: '* [ ] Task',
      });
      const result = serializeTodo(todo);

      expect(result).toBe('* [ ] Task');
    });

    it('serializes with high priority', () => {
      const todo = createBasicTodo({
        content: 'Important task',
        priority: 'high',
        rawLine: '- [ ] Important task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.HIGH_PRIORITY);
    });

    it('serializes with medium priority', () => {
      const todo = createBasicTodo({
        content: 'Normal task',
        priority: 'medium',
        rawLine: '- [ ] Normal task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.MEDIUM_PRIORITY);
    });

    it('serializes with low priority', () => {
      const todo = createBasicTodo({
        content: 'Low priority task',
        priority: 'low',
        rawLine: '- [ ] Low priority task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.LOW_PRIORITY);
    });

    it('serializes with due date', () => {
      const dueDate = new Date('2025-02-15');
      const todo = createBasicTodo({
        content: 'Task with deadline',
        dates: { dueDate },
        rawLine: '- [ ] Task with deadline',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.DUE);
      expect(result).toContain('2025-02-15');
    });

    it('serializes with scheduled date', () => {
      const scheduledDate = new Date('2025-02-01');
      const todo = createBasicTodo({
        content: 'Scheduled task',
        dates: { scheduledDate },
        rawLine: '- [ ] Scheduled task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.SCHEDULED);
      expect(result).toContain('2025-02-01');
    });

    it('serializes with recurrence', () => {
      const todo = createBasicTodo({
        content: 'Recurring task',
        dates: { recurrence: 'every week' },
        rawLine: '- [ ] Recurring task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.RECURRENCE);
      expect(result).toContain('every week');
    });

    it('serializes completed with completedAt', () => {
      const completedAt = new Date('2025-01-30T14:30:00.000Z');
      const todo = createBasicTodo({
        content: 'Done task',
        isCompleted: true,
        dates: { completedAt },
        rawLine: '- [x] Done task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain(DATE_MARKERS.COMPLETED);
      expect(result).toContain('2025-01-30T14:30');
    });

    it('serializes with all metadata', () => {
      const dueDate = new Date('2025-02-15');
      const scheduledDate = new Date('2025-02-01');
      const completedAt = new Date('2025-02-10T10:00:00.000Z');
      const todo = createBasicTodo({
        content: 'Full task',
        isCompleted: true,
        priority: 'high',
        dates: { dueDate, scheduledDate, completedAt, recurrence: 'every day' },
        rawLine: '- [x] Full task',
      });
      const result = serializeTodo(todo);

      expect(result).toContain('[x]');
      expect(result).toContain('Full task');
      expect(result).toContain(DATE_MARKERS.HIGH_PRIORITY);
      expect(result).toContain(DATE_MARKERS.DUE);
      expect(result).toContain(DATE_MARKERS.SCHEDULED);
      expect(result).toContain(DATE_MARKERS.RECURRENCE);
      expect(result).toContain(DATE_MARKERS.COMPLETED);
    });
  });

  describe('sortTodos()', () => {
    it('sorts by priority (high first)', () => {
      const low = createBasicTodo({ priority: 'low', lineNumber: 1 });
      const high = createBasicTodo({ priority: 'high', lineNumber: 2 });
      const medium = createBasicTodo({ priority: 'medium', lineNumber: 3 });

      const sorted = sortTodos([low, high, medium]);

      expect(sorted[0]?.priority).toBe('high');
      expect(sorted[1]?.priority).toBe('medium');
      expect(sorted[2]?.priority).toBe('low');
    });

    it('puts no priority after explicit priorities', () => {
      const noPriority = createBasicTodo({ lineNumber: 1 });
      const low = createBasicTodo({ priority: 'low', lineNumber: 2 });

      const sorted = sortTodos([noPriority, low]);

      expect(sorted[0]?.priority).toBe('low');
      expect(sorted[1]?.priority).toBeUndefined();
    });

    it('sorts by due date when priority is equal', () => {
      const later = createBasicTodo({
        priority: 'high',
        dates: { dueDate: new Date('2025-03-01') },
        lineNumber: 1,
      });
      const sooner = createBasicTodo({
        priority: 'high',
        dates: { dueDate: new Date('2025-02-01') },
        lineNumber: 2,
      });

      const sorted = sortTodos([later, sooner]);

      expect(sorted[0]?.dates.dueDate?.toISOString().slice(0, 10)).toBe('2025-02-01');
      expect(sorted[1]?.dates.dueDate?.toISOString().slice(0, 10)).toBe('2025-03-01');
    });

    it('puts todos with due dates before those without', () => {
      const withDue = createBasicTodo({
        priority: 'high',
        dates: { dueDate: new Date('2025-02-01') },
        lineNumber: 2,
      });
      const withoutDue = createBasicTodo({
        priority: 'high',
        lineNumber: 1,
      });

      const sorted = sortTodos([withoutDue, withDue]);

      expect(sorted[0]?.dates.dueDate).toBeDefined();
      expect(sorted[1]?.dates.dueDate).toBeUndefined();
    });

    it('sorts by line number when priority and due date are equal', () => {
      const dueDate = new Date('2025-02-01');
      const first = createBasicTodo({ priority: 'high', dates: { dueDate }, lineNumber: 5 });
      const second = createBasicTodo({ priority: 'high', dates: { dueDate }, lineNumber: 10 });

      const sorted = sortTodos([second, first]);

      expect(sorted[0]?.lineNumber).toBe(5);
      expect(sorted[1]?.lineNumber).toBe(10);
    });

    it('returns new array (does not mutate original)', () => {
      const todos = [
        createBasicTodo({ priority: 'low', lineNumber: 1 }),
        createBasicTodo({ priority: 'high', lineNumber: 2 }),
      ];
      const original = [...todos];
      const sorted = sortTodos(todos);

      expect(sorted).not.toBe(todos);
      expect(todos).toEqual(original);
    });

    it('handles empty array', () => {
      const sorted = sortTodos([]);
      expect(sorted).toEqual([]);
    });
  });

  describe('sortTodosWithCompletedLast()', () => {
    it('puts completed todos at the end', () => {
      const completed = createBasicTodo({ isCompleted: true, lineNumber: 1 });
      const open = createBasicTodo({ isCompleted: false, lineNumber: 2 });

      const sorted = sortTodosWithCompletedLast([completed, open]);

      expect(sorted[0]?.isCompleted).toBe(false);
      expect(sorted[1]?.isCompleted).toBe(true);
    });

    it('sorts open todos by priority', () => {
      const lowOpen = createBasicTodo({ isCompleted: false, priority: 'low', lineNumber: 1 });
      const highOpen = createBasicTodo({ isCompleted: false, priority: 'high', lineNumber: 2 });
      const completed = createBasicTodo({ isCompleted: true, lineNumber: 3 });

      const sorted = sortTodosWithCompletedLast([lowOpen, completed, highOpen]);

      expect(sorted[0]?.priority).toBe('high');
      expect(sorted[1]?.priority).toBe('low');
      expect(sorted[2]?.isCompleted).toBe(true);
    });

    it('sorts completed todos by priority', () => {
      const open = createBasicTodo({ isCompleted: false, lineNumber: 1 });
      const lowCompleted = createBasicTodo({ isCompleted: true, priority: 'low', lineNumber: 2 });
      const highCompleted = createBasicTodo({ isCompleted: true, priority: 'high', lineNumber: 3 });

      const sorted = sortTodosWithCompletedLast([lowCompleted, open, highCompleted]);

      expect(sorted[0]?.isCompleted).toBe(false);
      expect(sorted[1]?.priority).toBe('high');
      expect(sorted[2]?.priority).toBe('low');
    });

    it('handles all completed todos', () => {
      const todos = [
        createBasicTodo({ isCompleted: true, priority: 'low', lineNumber: 1 }),
        createBasicTodo({ isCompleted: true, priority: 'high', lineNumber: 2 }),
      ];

      const sorted = sortTodosWithCompletedLast(todos);

      expect(sorted[0]?.priority).toBe('high');
      expect(sorted[1]?.priority).toBe('low');
    });

    it('handles all open todos', () => {
      const todos = [
        createBasicTodo({ isCompleted: false, priority: 'low', lineNumber: 1 }),
        createBasicTodo({ isCompleted: false, priority: 'high', lineNumber: 2 }),
      ];

      const sorted = sortTodosWithCompletedLast(todos);

      expect(sorted[0]?.priority).toBe('high');
      expect(sorted[1]?.priority).toBe('low');
    });
  });

  describe('groupTodosByFile()', () => {
    it('groups todos by source file', () => {
      const todoA1 = createBasicTodo({ sourceFile: '/notes/a.md', lineNumber: 1 });
      const todoA2 = createBasicTodo({ sourceFile: '/notes/a.md', lineNumber: 5 });
      const todoB = createBasicTodo({ sourceFile: '/notes/b.md', lineNumber: 2 });

      const groups = groupTodosByFile([todoA1, todoA2, todoB]);

      expect(groups.size).toBe(2);
      expect(groups.get('/notes/a.md')).toHaveLength(2);
      expect(groups.get('/notes/b.md')).toHaveLength(1);
    });

    it('returns empty map for empty array', () => {
      const groups = groupTodosByFile([]);
      expect(groups.size).toBe(0);
    });

    it('handles single todo', () => {
      const todo = createBasicTodo({ sourceFile: '/notes/test.md' });
      const groups = groupTodosByFile([todo]);

      expect(groups.size).toBe(1);
      expect(groups.get('/notes/test.md')).toHaveLength(1);
    });

    it('preserves order within groups', () => {
      const first = createBasicTodo({ sourceFile: '/notes/a.md', lineNumber: 1 });
      const second = createBasicTodo({ sourceFile: '/notes/a.md', lineNumber: 5 });

      const groups = groupTodosByFile([first, second]);
      const group = groups.get('/notes/a.md')!;

      expect(group[0]?.lineNumber).toBe(1);
      expect(group[1]?.lineNumber).toBe(5);
    });
  });

  describe('groupTodosByPriority()', () => {
    it('groups todos by priority level', () => {
      const high = createBasicTodo({ priority: 'high', lineNumber: 1 });
      const medium = createBasicTodo({ priority: 'medium', lineNumber: 2 });
      const low = createBasicTodo({ priority: 'low', lineNumber: 3 });
      const none = createBasicTodo({ lineNumber: 4 });

      const groups = groupTodosByPriority([high, medium, low, none]);

      expect(groups.size).toBe(4);
      expect(groups.get('high')).toHaveLength(1);
      expect(groups.get('medium')).toHaveLength(1);
      expect(groups.get('low')).toHaveLength(1);
      expect(groups.get('none')).toHaveLength(1);
    });

    it('groups todos without priority under "none"', () => {
      const withPriority = createBasicTodo({ priority: 'high', lineNumber: 1 });
      const withoutPriority1 = createBasicTodo({ lineNumber: 2 });
      const withoutPriority2 = createBasicTodo({ lineNumber: 3 });

      const groups = groupTodosByPriority([withPriority, withoutPriority1, withoutPriority2]);

      expect(groups.get('none')).toHaveLength(2);
      expect(groups.get('high')).toHaveLength(1);
    });

    it('returns empty map for empty array', () => {
      const groups = groupTodosByPriority([]);
      expect(groups.size).toBe(0);
    });

    it('handles all same priority', () => {
      const todos = [
        createBasicTodo({ priority: 'high', lineNumber: 1 }),
        createBasicTodo({ priority: 'high', lineNumber: 2 }),
        createBasicTodo({ priority: 'high', lineNumber: 3 }),
      ];

      const groups = groupTodosByPriority(todos);

      expect(groups.size).toBe(1);
      expect(groups.get('high')).toHaveLength(3);
    });
  });

  describe('getAllTags()', () => {
    it('extracts unique tags from todos', () => {
      const todos = [
        createBasicTodo({ tags: ['work', 'urgent'], lineNumber: 1 }),
        createBasicTodo({ tags: ['personal'], lineNumber: 2 }),
        createBasicTodo({ tags: ['work', 'meetings'], lineNumber: 3 }),
      ];

      const tags = getAllTags(todos);

      expect(tags).toHaveLength(4);
      expect(tags).toContain('work');
      expect(tags).toContain('urgent');
      expect(tags).toContain('personal');
      expect(tags).toContain('meetings');
    });

    it('returns sorted tags', () => {
      const todos = [
        createBasicTodo({ tags: ['zebra', 'alpha'], lineNumber: 1 }),
        createBasicTodo({ tags: ['beta'], lineNumber: 2 }),
      ];

      const tags = getAllTags(todos);

      expect(tags).toEqual(['alpha', 'beta', 'zebra']);
    });

    it('returns empty array for todos without tags', () => {
      const todos = [
        createBasicTodo({ tags: [], lineNumber: 1 }),
        createBasicTodo({ tags: [], lineNumber: 2 }),
      ];

      const tags = getAllTags(todos);

      expect(tags).toEqual([]);
    });

    it('returns empty array for empty todos array', () => {
      const tags = getAllTags([]);
      expect(tags).toEqual([]);
    });

    it('deduplicates tags across todos', () => {
      const todos = [
        createBasicTodo({ tags: ['work', 'work'], lineNumber: 1 }), // duplicate in same todo
        createBasicTodo({ tags: ['work'], lineNumber: 2 }), // duplicate across todos
      ];

      const tags = getAllTags(todos);

      expect(tags).toEqual(['work']);
    });
  });

  describe('countTodosByStatus()', () => {
    it('counts open, completed, and total', () => {
      const todos = [
        createBasicTodo({ isCompleted: false, lineNumber: 1 }),
        createBasicTodo({ isCompleted: true, lineNumber: 2 }),
        createBasicTodo({ isCompleted: false, lineNumber: 3 }),
        createBasicTodo({ isCompleted: true, lineNumber: 4 }),
        createBasicTodo({ isCompleted: true, lineNumber: 5 }),
      ];

      const counts = countTodosByStatus(todos);

      expect(counts.open).toBe(2);
      expect(counts.completed).toBe(3);
      expect(counts.total).toBe(5);
    });

    it('handles all open todos', () => {
      const todos = [
        createBasicTodo({ isCompleted: false, lineNumber: 1 }),
        createBasicTodo({ isCompleted: false, lineNumber: 2 }),
      ];

      const counts = countTodosByStatus(todos);

      expect(counts.open).toBe(2);
      expect(counts.completed).toBe(0);
      expect(counts.total).toBe(2);
    });

    it('handles all completed todos', () => {
      const todos = [
        createBasicTodo({ isCompleted: true, lineNumber: 1 }),
        createBasicTodo({ isCompleted: true, lineNumber: 2 }),
      ];

      const counts = countTodosByStatus(todos);

      expect(counts.open).toBe(0);
      expect(counts.completed).toBe(2);
      expect(counts.total).toBe(2);
    });

    it('handles empty array', () => {
      const counts = countTodosByStatus([]);

      expect(counts.open).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.total).toBe(0);
    });

    it('handles single todo', () => {
      const open = countTodosByStatus([createBasicTodo({ isCompleted: false })]);
      const completed = countTodosByStatus([createBasicTodo({ isCompleted: true })]);

      expect(open).toEqual({ open: 1, completed: 0, total: 1 });
      expect(completed).toEqual({ open: 0, completed: 1, total: 1 });
    });
  });
});
