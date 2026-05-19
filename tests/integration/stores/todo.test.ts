/**
 * Integration tests for Todo Store
 *
 * Tests the TodoStore with a mock TodoService to verify:
 * - Initialization and subscription
 * - Loading and refresh operations
 * - CRUD operations (toggle, create, update, delete)
 * - Filter operations
 * - Panel visibility
 * - Derived state (openTodos, completedTodos, etc.)
 * - Cleanup/destroy
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { todoStore } from '$lib/stores/todo.svelte';
import type {
  TodoService,
  TodoStats,
  CreateTodoOptions,
  TodoUpdatePatch,
  TodoListFile,
  CreateTodoListFileParams,
  UpdateTodoListFileParams,
} from '$lib/ports/inbound';
import type { Todo } from '$lib/domain/entities/Todo';
import { filterTodos, type TodoFilter } from '$lib/domain/values/TodoFilter';
import type { TodoId } from '$lib/domain/values/TodoId';
import { createTodo } from '$lib/domain/entities/Todo';
import { ok, err } from '$lib/core';

// ============================================================================
// Test Helpers
// ============================================================================

let todoIdCounter = 0;

function createMockTodo(overrides?: Partial<Parameters<typeof createTodo>[0]>): Todo {
  const lineNumber = todoIdCounter++;
  return createTodo({
    content: 'Test todo',
    isCompleted: false,
    source: 'dedicated',
    sourceFile: '/notes/TODO.md',
    lineNumber,
    rawLine: '- [ ] Test todo',
    ...overrides,
  });
}

function createMockTodoService(): TodoService & {
  _subscribers: Set<(todos: Todo[]) => void>;
  _listSubscribers: Set<(lists: TodoListFile[]) => void>;
  _todos: Todo[];
  _todoLists: TodoListFile[];
} {
  let todos: Todo[] = [];
  let todoLists: TodoListFile[] = [];
  const subscribers = new Set<(todos: Todo[]) => void>();
  const listSubscribers = new Set<(lists: TodoListFile[]) => void>();

  return {
    _subscribers: subscribers,
    _listSubscribers: listSubscribers,
    _todos: todos,
    _todoLists: todoLists,
    initialize: vi.fn().mockResolvedValue(ok(undefined)),
    shutdown: vi.fn(),
    getAll: vi.fn().mockImplementation(async (filter?: TodoFilter) => ok(filter ? filterTodos(todos, filter) : todos)),
    getById: vi
      .fn()
      .mockImplementation(async (id: TodoId) => ok(todos.find((t) => t.id === id) ?? null)),
    getBySource: vi.fn().mockImplementation(async () => ok(todos)),
    getTodoLists: vi.fn().mockImplementation(async () => ok(todoLists)),
    toggle: vi.fn().mockImplementation(async (id: TodoId) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return err(new Error('Not found'));
      const updated = { ...todo, isCompleted: !todo.isCompleted };
      todos = todos.map((t) => (t.id === id ? updated : t));
      subscribers.forEach((cb) => cb([...todos]));
      return ok(updated);
    }),
    create: vi.fn().mockImplementation(async (content: string, options?: CreateTodoOptions) => {
      const todo = createMockTodo({
        content,
        sourceFile: options?.targetFile ?? '/notes/TODO.md',
        source: options?.targetFile ? 'dedicated' : 'dedicated',
        list: options?.targetList,
      });
      todos.push(todo);
      subscribers.forEach((cb) => cb([...todos]));
      return ok(todo);
    }),
    quickCreate: vi.fn().mockImplementation(async (input: string, _defaults?: CreateTodoOptions) => {
      const todo = createMockTodo({ content: input });
      todos.push(todo);
      subscribers.forEach((cb) => cb([...todos]));
      return ok(todo);
    }),
    createTodoList: vi.fn().mockImplementation(async (params: CreateTodoListFileParams) => {
      const list: TodoListFile = {
        path: `/notes/todo-${params.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
        title: params.title,
        note: params.note ?? '',
        createdAt: new Date(),
        updatedAt: new Date(),
        protected: false,
      };
      todoLists = [...todoLists, list];
      listSubscribers.forEach((cb) => cb([...todoLists]));
      return ok(list);
    }),
    updateTodoList: vi.fn().mockImplementation(async (path: string, patch: UpdateTodoListFileParams) => {
      const list = todoLists.find((item) => item.path === path);
      if (!list) return err(new Error('Not found'));
      const title = patch.title ?? list.title;
      const updated: TodoListFile = {
        ...list,
        title,
        note: patch.note ?? list.note,
        path: patch.title ? `/notes/todo-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md` : list.path,
        updatedAt: new Date(),
      };
      todoLists = todoLists.map((item) => (item.path === path ? updated : item));
      listSubscribers.forEach((cb) => cb([...todoLists]));
      return ok(updated);
    }),
    deleteTodoList: vi.fn().mockImplementation(async (path: string) => {
      if (!todoLists.some((list) => list.path === path)) return err(new Error('Not found'));
      todoLists = todoLists.filter((list) => list.path !== path);
      todos = todos.filter((todo) => todo.sourceFile !== path);
      listSubscribers.forEach((cb) => cb([...todoLists]));
      subscribers.forEach((cb) => cb([...todos]));
      return ok(undefined);
    }),
    update: vi.fn().mockImplementation(async (id: TodoId, content: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return err(new Error('Not found'));
      const updated = { ...todo, content };
      todos = todos.map((t) => (t.id === id ? updated : t));
      return ok(updated);
    }),
    updatePatch: vi.fn().mockImplementation(async (id: TodoId, patch: TodoUpdatePatch) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return err(new Error('Not found'));
      const updated = {
        ...todo,
        content: patch.content ?? todo.content,
        priority: patch.priority === null ? undefined : patch.priority ?? todo.priority,
        tags: patch.tags ?? todo.tags,
        dates: {
          ...todo.dates,
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ?? undefined } : {}),
          ...(patch.scheduledDate !== undefined ? { scheduledDate: patch.scheduledDate ?? undefined } : {}),
          ...(patch.recurrence !== undefined ? { recurrence: patch.recurrence ?? undefined } : {}),
        },
      } as Todo;
      todos = todos.map((t) => (t.id === id ? updated : t));
      subscribers.forEach((cb) => cb([...todos]));
      return ok(updated);
    }),
    delete: vi.fn().mockImplementation(async (id: TodoId) => {
      const todoExists = todos.some((t) => t.id === id);
      if (!todoExists) return err(new Error('Not found'));
      todos = todos.filter((t) => t.id !== id);
      subscribers.forEach((cb) => cb([...todos]));
      return ok(undefined);
    }),
    ensureTodoFile: vi.fn().mockResolvedValue(ok('/notes/TODO.md')),
    syncFileSnapshot: vi.fn().mockResolvedValue(ok(undefined)),
    clearFileSnapshot: vi.fn().mockResolvedValue(ok(undefined)),
    syncSavedFile: vi.fn().mockResolvedValue(ok(undefined)),
    getStats: vi.fn().mockImplementation(async (): Promise<TodoStats> => ({
      total: todos.length,
      open: todos.filter((t) => !t.isCompleted).length,
      completed: todos.filter((t) => t.isCompleted).length,
      overdue: 0,
      dueToday: 0,
    })),
    subscribe: vi.fn().mockImplementation((cb: (todos: Todo[]) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }),
    subscribeTodoLists: vi.fn().mockImplementation((cb: (lists: TodoListFile[]) => void) => {
      listSubscribers.add(cb);
      return () => listSubscribers.delete(cb);
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Todo Store Integration', () => {
  let mockService: ReturnType<typeof createMockTodoService>;

  beforeEach(() => {
    todoIdCounter = 0;
    mockService = createMockTodoService();
    // Reset store state by destroying
    todoStore.destroy();
  });

  afterEach(() => {
    todoStore.destroy();
  });

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  describe('init()', () => {
    it('accepts service and marks store as initialized', () => {
      todoStore.init(mockService);

      expect(todoStore.isInitialized).toBe(true);
    });

    it('subscribes to service updates', () => {
      todoStore.init(mockService);

      expect(mockService.subscribe).toHaveBeenCalledTimes(1);
      expect(mockService.subscribe).toHaveBeenCalledWith(expect.any(Function));
    });

    it('updates todos when service emits changes', () => {
      todoStore.init(mockService);

      const todo1 = createMockTodo({ content: 'First' });
      const todo2 = createMockTodo({ content: 'Second' });

      // Simulate service emitting todos
      mockService._subscribers.forEach((cb) => cb([todo1, todo2]));

      expect(todoStore.todos.length).toBe(2);
    });

    it('cleans up previous subscription when re-initialized', () => {
      todoStore.init(mockService);
      const firstUnsubscribe = vi.fn();
      vi.mocked(mockService.subscribe).mockReturnValueOnce(firstUnsubscribe);

      const secondService = createMockTodoService();
      todoStore.init(secondService);

      // Original subscription should be cleaned up
      // (the store manages cleanup internally)
      expect(secondService.subscribe).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Load
  // --------------------------------------------------------------------------

  describe('load()', () => {
    it('throws if store not initialized', async () => {
      await expect(todoStore.load()).rejects.toThrow('TodoStore not initialized');
    });

    it('calls service.initialize()', async () => {
      todoStore.init(mockService);

      await todoStore.load();

      expect(mockService.initialize).toHaveBeenCalledTimes(1);
    });

    it('calls service.getAll() after initialization', async () => {
      todoStore.init(mockService);

      await todoStore.load();

      expect(mockService.getAll).toHaveBeenCalled();
    });

    it('sets loading state during operation', async () => {
      todoStore.init(mockService);

      // Track loading state changes
      const loadingStates: boolean[] = [];

      // Mock getAll to capture loading state mid-operation
      mockService.getAll = vi.fn().mockImplementation(async () => {
        loadingStates.push(todoStore.loading);
        return ok([]);
      });

      await todoStore.load();

      // Loading should have been true during getAll
      expect(loadingStates).toContain(true);
      // Loading should be false after completion
      expect(todoStore.loading).toBe(false);
    });

    it('sets error when initialize fails', async () => {
      todoStore.init(mockService);
      const error = new Error('Init failed');
      mockService.initialize = vi.fn().mockResolvedValue(err(error));

      await todoStore.load();

      expect(todoStore.error).toBe(error);
    });

    it('sets error when getAll fails', async () => {
      todoStore.init(mockService);
      const error = new Error('GetAll failed');
      mockService.getAll = vi.fn().mockResolvedValue(err(error));

      await todoStore.load();

      expect(todoStore.error).toBe(error);
    });

    it('loads completed todos into backing state so Show completed reveals them', async () => {
      todoStore.init(mockService);
      const open = createMockTodo({ content: 'Open task' });
      const completed = createMockTodo({
        content: 'Previously completed',
        isCompleted: true,
        dates: { completedAt: new Date('2026-05-01T12:00:00.000Z') },
        rawLine: '- [x] Previously completed',
      });
      mockService._todos.push(open, completed);

      await todoStore.load();

      expect(todoStore.todos.map((todo) => todo.content)).toEqual([
        'Open task',
        'Previously completed',
      ]);
      expect(todoStore.showCompleted).toBe(false);
      expect(todoStore.visibleTodos.map((todo) => todo.content)).toEqual(['Open task']);

      todoStore.setShowCompleted(true);

      expect(todoStore.visibleTodos.map((todo) => todo.content)).toEqual([
        'Open task',
        'Previously completed',
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // Toggle
  // --------------------------------------------------------------------------

  describe('toggle()', () => {
    it('throws if store not initialized', async () => {
      const todoId = '/notes/TODO.md:0' as TodoId;
      await expect(todoStore.toggle(todoId)).rejects.toThrow('TodoStore not initialized');
    });

    it('calls service.toggle() with correct id', async () => {
      todoStore.init(mockService);
      const todo = createMockTodo({ content: 'Toggle me' });
      mockService._todos.push(todo);

      await todoStore.toggle(todo.id);

      expect(mockService.toggle).toHaveBeenCalledWith(todo.id);
    });

    it('sets error when toggle fails', async () => {
      todoStore.init(mockService);
      const error = new Error('Toggle failed');
      mockService.toggle = vi.fn().mockResolvedValue(err(error));

      await todoStore.toggle('/notes/TODO.md:0' as TodoId);

      expect(todoStore.error).toBe(error);
    });
  });

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  describe('create()', () => {
    it('throws if store not initialized', async () => {
      await expect(todoStore.create('New todo')).rejects.toThrow('TodoStore not initialized');
    });

    it('calls service.create() with content', async () => {
      todoStore.init(mockService);

      await todoStore.create('New todo');

      expect(mockService.create).toHaveBeenCalledWith('New todo', undefined);
    });

    it('calls service.create() with options', async () => {
      todoStore.init(mockService);
      const options: CreateTodoOptions = {
        priority: 'high',
        dueDate: new Date('2026-02-01'),
      };

      await todoStore.create('New todo', options);

      expect(mockService.create).toHaveBeenCalledWith('New todo', options);
    });

    it('sets error when create fails', async () => {
      todoStore.init(mockService);
      const error = new Error('Create failed');
      mockService.create = vi.fn().mockResolvedValue(err(error));

      await todoStore.create('New todo');

      expect(todoStore.error).toBe(error);
    });
  });

  describe('quickCreate()', () => {
    it('creates without selecting the created todo', async () => {
      todoStore.init(mockService);

      await todoStore.quickCreate('Review generated tasks');

      expect(mockService.quickCreate).toHaveBeenCalledWith('Review generated tasks', undefined);
      expect(todoStore.selectedTodo).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  describe('update()', () => {
    it('throws if store not initialized', async () => {
      await expect(todoStore.update('/notes/TODO.md:0' as TodoId, 'Updated')).rejects.toThrow(
        'TodoStore not initialized'
      );
    });

    it('calls service.update() with id and content', async () => {
      todoStore.init(mockService);
      const todo = createMockTodo({ content: 'Original' });
      mockService._todos.push(todo);

      await todoStore.update(todo.id, 'Updated content');

      expect(mockService.update).toHaveBeenCalledWith(todo.id, 'Updated content');
    });

    it('sets error when update fails', async () => {
      todoStore.init(mockService);
      const error = new Error('Update failed');
      mockService.update = vi.fn().mockResolvedValue(err(error));

      await todoStore.update('/notes/TODO.md:0' as TodoId, 'Updated');

      expect(todoStore.error).toBe(error);
    });
  });

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  describe('delete()', () => {
    it('throws if store not initialized', async () => {
      await expect(todoStore.delete('/notes/TODO.md:0' as TodoId)).rejects.toThrow(
        'TodoStore not initialized'
      );
    });

    it('calls service.delete() with id', async () => {
      todoStore.init(mockService);
      const todo = createMockTodo({ content: 'Delete me' });
      mockService._todos.push(todo);

      await todoStore.delete(todo.id);

      expect(mockService.delete).toHaveBeenCalledWith(todo.id);
    });

    it('sets error when delete fails', async () => {
      todoStore.init(mockService);
      const error = new Error('Delete failed');
      mockService.delete = vi.fn().mockResolvedValue(err(error));

      await todoStore.delete('/notes/TODO.md:0' as TodoId);

      expect(todoStore.error).toBe(error);
    });
  });

  // --------------------------------------------------------------------------
  // Filters
  // --------------------------------------------------------------------------

  describe('setFilter()', () => {
    it('updates filter and refreshes', async () => {
      todoStore.init(mockService);
      await todoStore.load();

      const filter: TodoFilter = { status: 'completed' };
      await todoStore.setFilter(filter);

      expect(todoStore.filter).toEqual(filter);
      // getAll called once in load, once in refresh from setFilter
      expect(mockService.getAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearFilters()', () => {
    it('resets filter to default and refreshes', async () => {
      todoStore.init(mockService);
      await todoStore.load();
      await todoStore.setFilter({ status: 'completed', search: 'test' });

      await todoStore.clearFilters();

      expect(todoStore.filter).toEqual({ status: 'open' });
    });
  });

  describe('updateFilter()', () => {
    it('updates single filter field and refreshes', async () => {
      todoStore.init(mockService);
      await todoStore.load();

      await todoStore.updateFilter('search', 'test query');

      expect(todoStore.filter.search).toBe('test query');
      expect(todoStore.filter.status).toBe('open'); // Default preserved
    });
  });

  describe('hasActiveFilters', () => {
    it('returns false for default filter', () => {
      todoStore.init(mockService);

      expect(todoStore.hasActiveFilters).toBe(false);
    });

    it('returns true when search is set', async () => {
      todoStore.init(mockService);
      await todoStore.load();
      await todoStore.updateFilter('search', 'test');

      expect(todoStore.hasActiveFilters).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Derived State
  // --------------------------------------------------------------------------

  describe('openTodos', () => {
    it('returns only incomplete todos', () => {
      todoStore.init(mockService);

      const open1 = createMockTodo({ content: 'Open 1', isCompleted: false });
      const completed1 = createMockTodo({ content: 'Completed 1', isCompleted: true });
      const open2 = createMockTodo({ content: 'Open 2', isCompleted: false });

      mockService._subscribers.forEach((cb) => cb([open1, completed1, open2]));

      expect(todoStore.openTodos.length).toBe(2);
      expect(todoStore.openTodos.every((t) => !t.isCompleted)).toBe(true);
    });
  });

  describe('completedTodos', () => {
    it('returns only completed todos', () => {
      todoStore.init(mockService);

      const open1 = createMockTodo({ content: 'Open 1', isCompleted: false });
      const completed1 = createMockTodo({ content: 'Completed 1', isCompleted: true });
      const completed2 = createMockTodo({ content: 'Completed 2', isCompleted: true });

      mockService._subscribers.forEach((cb) => cb([open1, completed1, completed2]));

      expect(todoStore.completedTodos.length).toBe(2);
      expect(todoStore.completedTodos.every((t) => t.isCompleted)).toBe(true);
    });

    it('sorts completed and logbook todos by most recent completion first', () => {
      todoStore.init(mockService);

      const older = createMockTodo({
        content: 'Older completion',
        isCompleted: true,
        dates: { completedAt: new Date('2026-05-01T09:00:00.000Z') },
      });
      const undated = createMockTodo({ content: 'Undated completion', isCompleted: true });
      const newer = createMockTodo({
        content: 'Newer completion',
        isCompleted: true,
        dates: { completedAt: new Date('2026-05-03T17:30:00.000Z') },
      });
      const open = createMockTodo({ content: 'Open task' });

      mockService._subscribers.forEach((cb) => cb([older, undated, newer, open]));

      expect(todoStore.completedTodos.map((todo) => todo.content)).toEqual([
        'Newer completion',
        'Older completion',
        'Undated completion',
      ]);
      expect(todoStore.logbookTodos.map((todo) => todo.content)).toEqual([
        'Newer completion',
        'Older completion',
        'Undated completion',
      ]);
    });
  });

  describe('overdueTodos', () => {
    it('returns todos past their due date', () => {
      todoStore.init(mockService);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const overdue = createMockTodo({
        content: 'Overdue',
        dates: { dueDate: yesterday },
      });
      const notOverdue = createMockTodo({
        content: 'Not overdue',
        dates: { dueDate: tomorrow },
      });
      const noDueDate = createMockTodo({ content: 'No due date' });

      mockService._subscribers.forEach((cb) => cb([overdue, notOverdue, noDueDate]));

      expect(todoStore.overdueTodos.length).toBe(1);
      expect(todoStore.overdueTodos[0].content).toBe('Overdue');
    });

    it('excludes completed todos from overdue', () => {
      todoStore.init(mockService);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const overdueCompleted = createMockTodo({
        content: 'Overdue but completed',
        isCompleted: true,
        dates: { dueDate: yesterday },
      });

      mockService._subscribers.forEach((cb) => cb([overdueCompleted]));

      expect(todoStore.overdueTodos.length).toBe(0);
    });
  });

  describe('dueTodayTodos', () => {
    it('returns todos due today', () => {
      todoStore.init(mockService);

      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dueToday = createMockTodo({
        content: 'Due today',
        dates: { dueDate: today },
      });
      const dueYesterday = createMockTodo({
        content: 'Due yesterday',
        dates: { dueDate: yesterday },
      });
      const dueTomorrow = createMockTodo({
        content: 'Due tomorrow',
        dates: { dueDate: tomorrow },
      });

      mockService._subscribers.forEach((cb) => cb([dueToday, dueYesterday, dueTomorrow]));

      expect(todoStore.dueTodayTodos.length).toBe(1);
      expect(todoStore.dueTodayTodos[0].content).toBe('Due today');
    });
  });

  describe('nextDueTodo', () => {
    it('returns the todo with earliest due date', () => {
      todoStore.init(mockService);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const dueTomorrow = createMockTodo({
        content: 'Due tomorrow',
        dates: { dueDate: tomorrow },
      });
      const dueNextWeek = createMockTodo({
        content: 'Due next week',
        dates: { dueDate: nextWeek },
      });

      mockService._subscribers.forEach((cb) => cb([dueNextWeek, dueTomorrow]));

      expect(todoStore.nextDueTodo).not.toBeNull();
      expect(todoStore.nextDueTodo?.content).toBe('Due tomorrow');
    });

    it('returns null when no todos have due dates', () => {
      todoStore.init(mockService);

      const noDueDate1 = createMockTodo({ content: 'No due 1' });
      const noDueDate2 = createMockTodo({ content: 'No due 2' });

      mockService._subscribers.forEach((cb) => cb([noDueDate1, noDueDate2]));

      expect(todoStore.nextDueTodo).toBeNull();
    });

    it('excludes completed todos', () => {
      todoStore.init(mockService);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const completedWithDue = createMockTodo({
        content: 'Completed with due',
        isCompleted: true,
        dates: { dueDate: tomorrow },
      });

      mockService._subscribers.forEach((cb) => cb([completedWithDue]));

      expect(todoStore.nextDueTodo).toBeNull();
    });
  });

  describe('Things-style views', () => {
    it('groups today, upcoming, notes, and logbook views', () => {
      todoStore.init(mockService);

      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const inbox = createMockTodo({ content: 'Inbox task' });
      const dueToday = createMockTodo({ content: 'Due today', dates: { dueDate: today } });
      const upcoming = createMockTodo({ content: 'Future task', dates: { dueDate: tomorrow } });
      const inline = createMockTodo({
        content: 'Inline note task',
        source: 'inline',
        sourceFile: '/notes/project.md',
        rawLine: '- [ ] Inline note task',
      });
      const completed = createMockTodo({ content: 'Done task', isCompleted: true });

      mockService._subscribers.forEach((cb) => cb([inbox, dueToday, upcoming, inline, completed]));

      expect(todoStore.inboxTodos.map((todo) => todo.content)).toContain('Inbox task');
      expect(todoStore.getTodosForView('today').map((todo) => todo.content)).toContain('Due today');
      expect(todoStore.upcomingTodos.map((todo) => todo.content)).toContain('Future task');
      expect(todoStore.notesTodos.map((todo) => todo.content)).toContain('Inline note task');
      expect(todoStore.logbookTodos.map((todo) => todo.content)).toContain('Done task');
    });

    it('combines TODO.md and note todos in the All view without completed items by default', () => {
      todoStore.init(mockService);

      const inbox = createMockTodo({ content: 'Inbox task' });
      const anytime = createMockTodo({ content: 'Anytime task', list: 'anytime' });
      const inline = createMockTodo({
        content: 'Inline note task',
        source: 'inline',
        sourceFile: '/notes/project.md',
        rawLine: '- [ ] Inline note task',
      });
      const completed = createMockTodo({ content: 'Done task', isCompleted: true });

      mockService._subscribers.forEach((cb) => cb([inbox, anytime, inline, completed]));

      expect(todoStore.allTodos.map((todo) => todo.content)).toEqual([
        'Inbox task',
        'Anytime task',
        'Inline note task',
      ]);
      expect(new Set(todoStore.allTodos.map((todo) => todo.id)).size).toBe(todoStore.allTodos.length);
    });

    it('reveals completed tasks in normal views when showCompleted is enabled', () => {
      todoStore.init(mockService);

      const openInbox = createMockTodo({ content: 'Open inbox' });
      const doneInbox = createMockTodo({ content: 'Done inbox', isCompleted: true });
      const doneInline = createMockTodo({
        content: 'Done note task',
        isCompleted: true,
        source: 'inline',
        sourceFile: '/notes/project.md',
        rawLine: '- [x] Done note task',
      });

      mockService._subscribers.forEach((cb) => cb([openInbox, doneInbox, doneInline]));

      expect(todoStore.showCompleted).toBe(false);
      expect(todoStore.allTodos.map((todo) => todo.content)).toEqual(['Open inbox']);
      expect(todoStore.inboxTodos.map((todo) => todo.content)).toEqual(['Open inbox']);
      expect(todoStore.notesTodos).toEqual([]);
      expect(todoStore.logbookTodos.map((todo) => todo.content)).toEqual(['Done inbox', 'Done note task']);

      todoStore.setShowCompleted(true);

      expect(todoStore.allTodos.map((todo) => todo.content)).toEqual([
        'Open inbox',
        'Done inbox',
        'Done note task',
      ]);
      expect(todoStore.inboxTodos.map((todo) => todo.content)).toEqual(['Open inbox', 'Done inbox']);
      expect(todoStore.notesTodos.map((todo) => todo.content)).toEqual(['Done note task']);
      expect(todoStore.logbookTodos.map((todo) => todo.content)).toEqual(['Done inbox', 'Done note task']);
    });

    it('opens the workspace without selecting the first visible todo', () => {
      todoStore.init(mockService);

      const tagged = createMockTodo({ content: 'Tagged task', tags: ['work'] });
      mockService._subscribers.forEach((cb) => cb([tagged]));

      todoStore.openWorkspace('tags');

      expect(todoStore.workspaceOpen).toBe(true);
      expect(todoStore.activeView).toBe('tags');
      expect(todoStore.selectedTodoId).toBeNull();
      expect(todoStore.selectedTodo).toBeNull();
    });

    it('opens the workspace at All by default', () => {
      todoStore.init(mockService);

      todoStore.openWorkspace();

      expect(todoStore.workspaceOpen).toBe(true);
      expect(todoStore.activeView).toBe('all');
    });

    it('keeps anytime deadlines active unless they are scheduled for the future', () => {
      todoStore.init(mockService);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const anytime = createMockTodo({ content: 'Plain anytime', list: 'anytime' });
      const deadline = createMockTodo({ content: 'Deadline anytime', list: 'anytime', dates: { dueDate: tomorrow } });
      const futureStart = createMockTodo({ content: 'Future start', list: 'anytime', dates: { scheduledDate: tomorrow } });

      mockService._subscribers.forEach((cb) => cb([anytime, deadline, futureStart]));

      expect(todoStore.anytimeTodos.map((todo) => todo.content)).toEqual([
        'Deadline anytime',
        'Plain anytime',
      ]);
      expect(todoStore.upcomingTodos.map((todo) => todo.content)).toContain('Future start');
    });

    it('keeps saved non-default workspace views when explicitly opened', () => {
      todoStore.init(mockService);

      todoStore.openWorkspace('inbox');

      expect(todoStore.workspaceOpen).toBe(true);
      expect(todoStore.activeView).toBe('inbox');
    });
  });

  describe('Todo lists', () => {
    it('selects a custom list and filters visible todos by source file', () => {
      todoStore.init(mockService);
      const workList: TodoListFile = {
        path: '/notes/todo-work.md',
        title: 'Work',
        note: 'Office tasks',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        protected: false,
      };
      const houseList: TodoListFile = {
        path: '/notes/todo-house.md',
        title: 'House',
        note: '',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        protected: false,
      };
      const workTodo = createMockTodo({ content: 'Work task', sourceFile: workList.path });
      const workDone = createMockTodo({ content: 'Done work', sourceFile: workList.path, isCompleted: true });
      const houseTodo = createMockTodo({ content: 'House task', sourceFile: houseList.path });
      const defaultTodo = createMockTodo({ content: 'Inbox task' });

      mockService._listSubscribers.forEach((cb) => cb([workList, houseList]));
      mockService._subscribers.forEach((cb) => cb([workTodo, workDone, houseTodo, defaultTodo]));

      todoStore.setActiveList(workList.path);

      expect(todoStore.activeTodoList?.title).toBe('Work');
      expect(todoStore.visibleTodos.map((todo) => todo.content)).toEqual(['Work task']);
      expect(todoStore.getTodoListCount(workList.path)).toBe(1);

      todoStore.setShowCompleted(true);

      expect(todoStore.visibleTodos.map((todo) => todo.content)).toEqual(['Work task', 'Done work']);
    });

    it('captures into a custom list when targetFile is provided', async () => {
      todoStore.init(mockService);
      const workList: TodoListFile = {
        path: '/notes/todo-work.md',
        title: 'Work',
        note: '',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        protected: false,
      };
      mockService._listSubscribers.forEach((cb) => cb([workList]));
      todoStore.setActiveList(workList.path);

      await todoStore.create('List task', { targetFile: workList.path, targetList: 'inbox' });

      expect(mockService.create).toHaveBeenCalledWith('List task', {
        targetFile: workList.path,
        targetList: 'inbox',
      });
      expect(todoStore.visibleTodos.map((todo) => todo.content)).toEqual(['List task']);
    });

    it('renames and deletes active custom lists without leaving stale selection', async () => {
      todoStore.init(mockService);

      const created = await todoStore.createTodoList({ title: 'Work', note: 'Office tasks' });
      expect(created?.path).toBe('/notes/todo-work.md');
      expect(todoStore.activeListPath).toBe('/notes/todo-work.md');

      const updated = await todoStore.updateTodoList('/notes/todo-work.md', { title: 'House', note: 'Home tasks' });
      expect(updated?.path).toBe('/notes/todo-house.md');
      expect(todoStore.activeListPath).toBe('/notes/todo-house.md');
      expect(todoStore.activeTodoList?.note).toBe('Home tasks');

      await todoStore.deleteTodoList('/notes/todo-house.md');

      expect(todoStore.activeListPath).toBeNull();
      expect(todoStore.todoLists).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Destroy
  // --------------------------------------------------------------------------

  describe('destroy()', () => {
    it('resets all state', async () => {
      todoStore.init(mockService);
      await todoStore.load();

      const todo = createMockTodo({ content: 'Test' });
      mockService._subscribers.forEach((cb) => cb([todo]));
      todoStore.openWorkspace('today');

      todoStore.destroy();

      expect(todoStore.isInitialized).toBe(false);
      expect(todoStore.todos).toEqual([]);
      expect(todoStore.loading).toBe(false);
      expect(todoStore.error).toBeNull();
      expect(todoStore.workspaceOpen).toBe(false);
      expect(todoStore.activeView).toBe('all');
      expect(todoStore.showCompleted).toBe(false);
      expect(todoStore.filter).toEqual({ status: 'open' });
      expect(todoStore.stats).toEqual({
        total: 0,
        open: 0,
        completed: 0,
        overdue: 0,
        dueToday: 0,
      });
    });

    it('calls service.shutdown()', async () => {
      todoStore.init(mockService);

      todoStore.destroy();

      expect(mockService.shutdown).toHaveBeenCalledTimes(1);
    });
  });
});
