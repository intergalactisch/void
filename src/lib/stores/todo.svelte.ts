/**
 * TODO Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the TodoService application service.
 *
 * Provides reactive state for TODO management including:
 * - Loading and error states
 * - Filtered todo lists
 * - Statistics (open, completed, overdue)
 * - Dedicated workspace visibility state
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
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
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import type { TodoId } from '$lib/domain/values/TodoId';
import { DEFAULT_TODO_FILTER, hasActiveFilters } from '$lib/domain/values/TodoFilter';
import { sortCompletedTodosByCompletedAt, sortTodosWithCompletedLast } from '$lib/domain/entities/Todo';
import {
  DEFAULT_TODO_VIEW,
  TODO_VIEWS,
  getTodoViewLabel,
  type TodoList,
  type TodoView,
} from '$lib/domain/values/TodoView';

export type { TodoView };

export interface TodoViewInfo {
  id: TodoView;
  label: string;
  count: number;
}

/**
 * TODO Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to TODO state and methods to
 * manage todos, filters, and panel visibility.
 */
class TodoStore {
  #service: TodoService | null = null;
  #unsubscribe: (() => void) | null = null;
  #listUnsubscribe: (() => void) | null = null;

  // Reactive state
  todos = $state<Todo[]>([]);
  filter = $state<TodoFilter>(DEFAULT_TODO_FILTER);
  loading = $state(false);
  error = $state<Error | null>(null);
  stats = $state<TodoStats>({
    total: 0,
    open: 0,
    completed: 0,
    overdue: 0,
    dueToday: 0,
  });
  workspaceOpen = $state(false);
  activeView = $state<TodoView>(DEFAULT_TODO_VIEW);
  showCompleted = $state(false);
  selectedTodoId = $state<TodoId | null>(null);
  todoLists = $state<TodoListFile[]>([]);
  activeListPath = $state<string | null>(null);

  /**
   * Initialize the store with a TodoService instance.
   * Must be called before using any other methods.
   *
   * @param service - The TodoService to use
   */
  init(service: TodoService) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;

    // Subscribe to service todo updates
    this.#unsubscribe = service.subscribe((todos: Todo[]) => {
      this.todos = sortTodosWithCompletedLast(todos);
      this.#refreshStatsLocal();
    });
    this.#listUnsubscribe = service.subscribeTodoLists((lists: TodoListFile[]) => {
      this.todoLists = lists;
      if (this.activeListPath && !lists.some((list) => list.path === this.activeListPath)) {
        this.activeListPath = null;
        this.selectedTodoId = null;
      }
    });
  }

  // =========================================================================
  // Lifecycle methods
  // =========================================================================

  /**
   * Load todos from the service.
   * Initializes the service if not already done.
   */
  async load(): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.loading = true;
    this.error = null;

    try {
      // Initialize the service (starts file watching)
      const initResult = await this.#service.initialize();
      if (!initResult.ok) {
        this.error = initResult.error;
        return;
      }

      // Load todos with current filter
      await this.refresh();
      await this.refreshTodoLists();
    } catch (e) {
      this.error = toError(e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Refresh todos from the service using current filter.
   */
  async refresh(): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.loading = true;
    this.error = null;

    try {
      const result = await this.#service.getAll(this.#backingFilter());
      if (result.ok) {
        this.todos = sortTodosWithCompletedLast(result.value);
        await this.#refreshStats();
      } else {
        this.error = result.error;
      }
    } catch (e) {
      this.error = toError(e);
    } finally {
      this.loading = false;
    }
  }

  async refreshTodoLists(): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    const result = await this.#service.getTodoLists();
    if (result.ok) {
      this.todoLists = result.value;
      if (this.activeListPath && !result.value.some((list) => list.path === this.activeListPath)) {
        this.activeListPath = null;
        this.selectedTodoId = null;
      }
    } else {
      this.error = result.error;
    }
  }

  // =========================================================================
  // Todo operations
  // =========================================================================

  /**
   * Toggle a todo from the editor (by content match within a file path).
   * Used when the user clicks a todo checkbox inside a note rather than
   * the task workspace.
   */
  async toggleFromEditor(
    blockId: string,
    content: string,
    checked: boolean,
    filePath: string,
  ): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');
    const result = await this.#service.toggleFromEditor(blockId, content, checked, filePath);
    if (!result.ok) {
      this.error = result.error;
    }
  }

  /**
   * Toggle the completion state of a todo.
   * Uses optimistic UI: flips state immediately, then persists in background.
   *
   * @param id - ID of the todo to toggle
   */
  async toggle(id: TodoId): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;

    // Optimistic update: flip locally first
    this.todos = sortTodosWithCompletedLast(
      this.todos.map((t) => (t.id === id ? { ...t, isCompleted: !t.isCompleted } : t))
    );
    this.#refreshStatsLocal();

    // Persist in background
    const result = await this.#service.toggle(id);
    if (!result.ok) {
      // Rollback on failure
      await this.refresh();
      this.error = result.error;
    }
  }

  /**
   * Create a new todo.
   *
   * @param content - Todo text content
   * @param options - Optional creation parameters
   */
  async create(content: string, options?: CreateTodoOptions): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;

    const result = await this.#service.create(content, options);
    if (!result.ok) {
      this.error = result.error;
    }
    // Todo list will be updated via subscription
  }

  /**
   * Create a todo from Todoist-style quick add text.
   */
  async quickCreate(input: string, defaults?: CreateTodoOptions): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;
    const result = await this.#service.quickCreate(input, defaults);
    if (!result.ok) {
      this.error = result.error;
    }
  }

  async createTodoList(params: CreateTodoListFileParams): Promise<TodoListFile | null> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;
    const result = await this.#service.createTodoList(params);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }

    await this.refreshTodoLists();
    this.setActiveList(result.value.path);
    return result.value;
  }

  async updateTodoList(path: string, patch: UpdateTodoListFileParams): Promise<TodoListFile | null> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;
    const wasActive = this.activeListPath === path;
    const result = await this.#service.updateTodoList(path, patch);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }

    await this.refreshTodoLists();
    await this.refresh();
    if (wasActive) {
      this.activeListPath = result.value.path;
    }
    return result.value;
  }

  async deleteTodoList(path: string): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;
    const result = await this.#service.deleteTodoList(path);
    if (!result.ok) {
      this.error = result.error;
      return;
    }

    if (this.activeListPath === path) {
      this.activeListPath = null;
      this.selectedTodoId = null;
    }
    await this.refreshTodoLists();
    await this.refresh();
  }

  /**
   * Update the content of a todo.
   *
   * @param id - ID of the todo to update
   * @param content - New content text
   */
  async update(id: TodoId, content: string): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;

    const result = await this.#service.update(id, content);
    if (!result.ok) {
      this.error = result.error;
    }
    // Todo list will be updated via subscription
  }

  /**
   * Update content and metadata in one markdown-preserving operation.
   */
  async updatePatch(id: TodoId, patch: TodoUpdatePatch): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;

    const result = await this.#service.updatePatch(id, patch);
    if (!result.ok) {
      this.error = result.error;
    } else {
      this.selectedTodoId = result.value.id;
    }
  }

  /**
   * Delete a todo.
   *
   * @param id - ID of the todo to delete
   */
  async delete(id: TodoId): Promise<void> {
    if (!this.#service) throw new Error('TodoStore not initialized');

    this.error = null;

    const result = await this.#service.delete(id);
    if (!result.ok) {
      this.error = result.error;
    }
    // Todo list will be updated via subscription
  }

  // =========================================================================
  // Filter operations
  // =========================================================================

  /**
   * Set the current filter and refresh todos.
   *
   * @param filter - New filter criteria
   */
  async setFilter(filter: TodoFilter): Promise<void> {
    this.filter = filter;
    await this.refresh();
  }

  /**
   * Clear all filter criteria (reset to default).
   */
  async clearFilters(): Promise<void> {
    this.filter = DEFAULT_TODO_FILTER;
    await this.refresh();
  }

  /**
   * Update a single filter field.
   *
   * @param key - Filter field to update
   * @param value - New value for the field
   */
  async updateFilter<K extends keyof TodoFilter>(
    key: K,
    value: TodoFilter[K]
  ): Promise<void> {
    this.filter = { ...this.filter, [key]: value };
    await this.refresh();
  }

  /**
   * Open the full Tasks workspace.
   */
  openWorkspace(view: TodoView = DEFAULT_TODO_VIEW): void {
    this.workspaceOpen = true;
    this.activeView = view;
    this.selectedTodoId = null;
  }

  /**
   * Close the full Tasks workspace.
   */
  closeWorkspace(): void {
    this.workspaceOpen = false;
  }

  /**
   * Select the active Things-style task view.
   */
  setView(view: TodoView): void {
    this.activeListPath = null;
    this.activeView = view;
    const visible = this.getTodosForView(view);
    if (this.selectedTodoId && visible.some((todo) => todo.id === this.selectedTodoId)) {
      return;
    }
    this.selectedTodoId = null;
  }

  /**
   * Select a task for the inspector.
   */
  selectTodo(id: TodoId | null): void {
    this.selectedTodoId = id;
  }

  setActiveList(path: string): void {
    this.activeListPath = path;
    const visible = this.getTodosForListFile(path);
    if (this.selectedTodoId && visible.some((todo) => todo.id === this.selectedTodoId)) {
      return;
    }
    this.selectedTodoId = null;
  }

  /**
   * Show or hide completed tasks in task views. Logbook is always completed-only.
   */
  setShowCompleted(showCompleted: boolean): void {
    this.showCompleted = showCompleted;
    const visible = this.visibleTodos;
    if (this.selectedTodoId && visible.some((todo) => todo.id === this.selectedTodoId)) {
      return;
    }
    this.selectedTodoId = null;
  }

  /**
   * Toggle completed task visibility in the workspace.
   */
  toggleShowCompleted(): void {
    this.setShowCompleted(!this.showCompleted);
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if any filters are active beyond the default.
   */
  get hasActiveFilters(): boolean {
    return hasActiveFilters(this.filter);
  }

  /**
   * Get only open (incomplete) todos from current list.
   */
  get openTodos(): Todo[] {
    return this.todos.filter((t) => !t.isCompleted);
  }

  /**
   * Get only completed todos from current list.
   */
  get completedTodos(): Todo[] {
    return sortCompletedTodosByCompletedAt(this.todos.filter((t) => t.isCompleted));
  }

  /**
   * Get todos that are overdue.
   */
  get overdueTodos(): Todo[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.todos.filter((t) => {
      if (t.isCompleted || !t.dates.dueDate) return false;
      return t.dates.dueDate < today;
    });
  }

  /**
   * Get todos due today.
   */
  get dueTodayTodos(): Todo[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return this.todos.filter((t) => {
      if (t.isCompleted || !t.dates.dueDate) return false;
      return t.dates.dueDate >= today && t.dates.dueDate < tomorrow;
    });
  }

  /**
   * Get the next due todo (earliest due date).
   */
  get nextDueTodo(): Todo | null {
    const openWithDue = this.todos.filter((t) => !t.isCompleted && t.dates.dueDate);
    if (openWithDue.length === 0) return null;

    return openWithDue.reduce((earliest, todo) => {
      if (!earliest.dates.dueDate) return todo;
      if (!todo.dates.dueDate) return earliest;
      return todo.dates.dueDate < earliest.dates.dueDate ? todo : earliest;
    });
  }

  /**
   * Current task selected in the workspace inspector.
   */
  get selectedTodo(): Todo | null {
    if (!this.selectedTodoId) return null;
    return this.todos.find((todo) => todo.id === this.selectedTodoId) ?? null;
  }

  get activeTodoList(): TodoListFile | null {
    if (!this.activeListPath) return null;
    return this.todoLists.find((list) => list.path === this.activeListPath) ?? null;
  }

  /**
   * Tags found across all tasks.
   */
  get allTags(): string[] {
    return Array.from(new Set(this.todos.flatMap((todo) => todo.tags))).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  /**
   * Things-style view metadata with live counts.
   */
  get views(): TodoViewInfo[] {
    return TODO_VIEWS.map((id) => ({
      id,
      label: getTodoViewLabel(id),
      count: this.getTodosForView(id).length,
    }));
  }

  /**
   * Todos for the currently selected workspace view.
   */
  get visibleTodos(): Todo[] {
    if (this.activeListPath) {
      return this.getTodosForListFile(this.activeListPath);
    }
    return this.getTodosForView(this.activeView);
  }

  get allTodos(): Todo[] {
    return this.getTodosForView('all');
  }

  get inboxTodos(): Todo[] {
    return this.getTodosForView('inbox');
  }

  get upcomingTodos(): Todo[] {
    return this.getTodosForView('upcoming');
  }

  get anytimeTodos(): Todo[] {
    return this.getTodosForView('anytime');
  }

  get somedayTodos(): Todo[] {
    return this.getTodosForView('someday');
  }

  get notesTodos(): Todo[] {
    return this.getTodosForView('notes');
  }

  get logbookTodos(): Todo[] {
    return this.getTodosForView('logbook');
  }

  /**
   * Return todos for a Things-style view.
   */
  getTodosForView(view: TodoView): Todo[] {
    switch (view) {
      case 'all':
        return sortTodosWithCompletedLast(
          this.todos.filter((todo) => this.showCompleted || !todo.isCompleted),
        );
      case 'inbox':
        return sortTodosWithCompletedLast(
          this.todos.filter(
            (todo) =>
              isVisibleByCompletion(todo, this.showCompleted) &&
              todo.source === 'dedicated' &&
              (todo.list ?? 'inbox') === 'inbox' &&
              !todo.dates.dueDate &&
              !todo.dates.scheduledDate,
          ),
        );
      case 'today':
        return sortTodosWithCompletedLast(
          this.todos.filter((todo) => isVisibleByCompletion(todo, this.showCompleted) && isAvailableToday(todo)),
        );
      case 'upcoming':
        return sortTodosWithCompletedLast(
          this.todos.filter((todo) => isVisibleByCompletion(todo, this.showCompleted) && isUpcoming(todo)),
        );
      case 'anytime':
        return sortTodosWithCompletedLast(
          this.todos.filter(
            (todo) =>
              isVisibleByCompletion(todo, this.showCompleted) &&
              todo.source === 'dedicated' &&
              getTaskList(todo) === 'anytime' &&
              !isAfterToday(todo.dates.scheduledDate),
          ),
        );
      case 'someday':
        return sortTodosWithCompletedLast(
          this.todos.filter(
            (todo) =>
              isVisibleByCompletion(todo, this.showCompleted) &&
              todo.source === 'dedicated' &&
              getTaskList(todo) === 'someday',
          ),
        );
      case 'notes':
        return sortTodosWithCompletedLast(
          this.todos.filter((todo) => isVisibleByCompletion(todo, this.showCompleted) && todo.source === 'inline'),
        );
      case 'tags':
        return sortTodosWithCompletedLast(
          this.todos.filter((todo) => isVisibleByCompletion(todo, this.showCompleted) && todo.tags.length > 0),
        );
      case 'logbook':
        return sortCompletedTodosByCompletedAt(this.todos.filter((todo) => todo.isCompleted));
    }
  }

  getTodosForListFile(path: string): Todo[] {
    return sortTodosWithCompletedLast(
      this.todos.filter((todo) => todo.sourceFile === path && isVisibleByCompletion(todo, this.showCompleted)),
    );
  }

  getTodoListCount(path: string): number {
    return this.todos.filter((todo) => todo.sourceFile === path && !todo.isCompleted).length;
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Refresh statistics from the service.
   */
  async #refreshStats(): Promise<void> {
    if (!this.#service) return;
    this.stats = await this.#service.getStats();
  }

  /**
   * Compute stats locally from the todos array (avoids re-scanning all files).
   */
  #refreshStatsLocal(): void {
    const todos = this.todos;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    let open = 0;
    let completed = 0;
    let overdue = 0;
    let dueToday = 0;

    for (const todo of todos) {
      if (todo.isCompleted) {
        completed++;
      } else {
        open++;
        if (todo.dates.dueDate) {
          if (todo.dates.dueDate < today) {
            overdue++;
          } else if (todo.dates.dueDate >= today && todo.dates.dueDate < tomorrow) {
            dueToday++;
          }
        }
      }
    }

    this.stats = { total: todos.length, open, completed, overdue, dueToday };
  }

  /**
   * The workspace keeps all completion states in memory. Visibility is handled
   * by showCompleted and view selectors, while non-status filters still limit
   * the backing collection.
   */
  #backingFilter(): TodoFilter {
    return { ...this.filter, status: 'all' };
  }

  /**
   * Cleanup subscriptions.
   */
  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    if (this.#listUnsubscribe) {
      this.#listUnsubscribe();
      this.#listUnsubscribe = null;
    }
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    if (this.#service) {
      this.#service.shutdown();
    }
    this.#cleanup();
    this.#service = null;
    this.todos = [];
    this.filter = DEFAULT_TODO_FILTER;
    this.loading = false;
    this.error = null;
    this.stats = {
      total: 0,
      open: 0,
      completed: 0,
      overdue: 0,
      dueToday: 0,
    };
    this.workspaceOpen = false;
    this.activeView = DEFAULT_TODO_VIEW;
    this.showCompleted = false;
    this.selectedTodoId = null;
    this.todoLists = [];
    this.activeListPath = null;
  }
}

export const todoStore = new TodoStore();

function isAvailableToday(todo: Todo): boolean {
  return isTodayOrEarlier(todo.dates.dueDate) || isTodayOrEarlier(todo.dates.scheduledDate);
}

function isUpcoming(todo: Todo): boolean {
  return isAfterToday(todo.dates.dueDate) || isAfterToday(todo.dates.scheduledDate);
}

function isVisibleByCompletion(todo: Todo, showCompleted: boolean): boolean {
  return showCompleted || !todo.isCompleted;
}

function isTodayOrEarlier(date: Date | undefined): boolean {
  if (!date) return false;
  const today = startOfToday();
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target <= today;
}

function isAfterToday(date: Date | undefined): boolean {
  if (!date) return false;
  const today = startOfToday();
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target > today;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getTaskList(todo: Todo): TodoList {
  return todo.list ?? 'inbox';
}

export { getTodoViewLabel };
