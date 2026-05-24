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
  SettingsService,
} from '$lib/ports/inbound';
import type { Todo } from '$lib/domain/entities/Todo';
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import type { TodoId } from '$lib/domain/values/TodoId';
import { DEFAULT_TODO_FILTER, hasActiveFilters } from '$lib/domain/values/TodoFilter';
import { sortCompletedTodosByCompletedAt, sortTodosWithCompletedLast } from '$lib/domain/entities/Todo';
import {
  DEFAULT_TODO_ADVANCED_FILTER,
  DEFAULT_TODO_WORKSPACE_PREFERENCE,
  normalizeTodoWorkspacePreference,
  type TodoAdvancedFilter,
  type TodoDateFilterField,
  type TodoDateFilterPreset,
  type TodoGroupMode,
  type TodoSortMode,
  type TodoWorkspacePreference,
} from '$lib/domain/entities/Settings';
import { getPriorityDisplayName, priorityOrder, type TodoPriority } from '$lib/domain/values/TodoPriority';
import {
  DEFAULT_TODO_VIEW,
  TODO_VIEWS,
  getTodoViewLabel,
  type TodoList,
  type TodoView,
} from '$lib/domain/values/TodoView';

export type {
  TodoAdvancedFilter,
  TodoDateFilterField,
  TodoDateFilterPreset,
  TodoGroupMode,
  TodoSortMode,
  TodoView,
  TodoWorkspacePreference,
};

export interface TodoViewInfo {
  id: TodoView;
  label: string;
  count: number;
}

export interface TodoGroup {
  label: string;
  todos: Todo[];
}

/**
 * TODO Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to TODO state and methods to
 * manage todos, filters, and panel visibility.
 */
class TodoStore {
  #service: TodoService | null = null;
  #settingsService: SettingsService | null = null;
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
  workspacePreferences = $state<Record<string, TodoWorkspacePreference>>({});

  /**
   * Initialize the store with a TodoService instance.
   * Must be called before using any other methods.
   *
   * @param service - The TodoService to use
   */
  init(service: TodoService, settingsService?: SettingsService) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;
    this.#settingsService = settingsService ?? null;
    this.workspacePreferences = cloneWorkspacePreferences(
      this.#settingsService?.current().taskWorkspacePreferences ?? {},
    );

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

  async setSortMode(sortMode: TodoSortMode): Promise<void> {
    await this.#updateCurrentPreference({ sortMode });
  }

  async setGroupMode(groupMode: TodoGroupMode): Promise<void> {
    await this.#updateCurrentPreference({ groupMode });
  }

  async setAdvancedFilter<K extends keyof TodoAdvancedFilter>(
    key: K,
    value: TodoAdvancedFilter[K],
  ): Promise<void> {
    await this.updateAdvancedFilters({ [key]: value } as Partial<TodoAdvancedFilter>);
  }

  async updateAdvancedFilters(patch: Partial<TodoAdvancedFilter>): Promise<void> {
    const preference = this.currentWorkspacePreference;
    await this.#updateCurrentPreference({
      filters: normalizeTodoWorkspacePreference({
        ...preference,
        filters: {
          ...preference.filters,
          ...patch,
        },
      }).filters,
    });
  }

  async resetCurrentWorkspacePreference(): Promise<void> {
    const key = this.currentPreferenceKey;
    const { [key]: _, ...rest } = this.workspacePreferences;
    this.workspacePreferences = rest;
    await this.#persistWorkspacePreferences();
  }

  async setCompletedSortMode(sortMode: TodoSortMode): Promise<void> {
    await this.#updateCompletedPreference({ sortMode });
  }

  async setCompletedGroupMode(groupMode: TodoGroupMode): Promise<void> {
    await this.#updateCompletedPreference({ groupMode });
  }

  async setCompletedAdvancedFilter<K extends keyof TodoAdvancedFilter>(
    key: K,
    value: TodoAdvancedFilter[K],
  ): Promise<void> {
    await this.updateCompletedAdvancedFilters({ [key]: value } as Partial<TodoAdvancedFilter>);
  }

  async updateCompletedAdvancedFilters(patch: Partial<TodoAdvancedFilter>): Promise<void> {
    const preference = this.currentCompletedWorkspacePreference;
    await this.#updateCompletedPreference({
      filters: normalizeTodoWorkspacePreference({
        ...preference,
        filters: {
          ...preference.filters,
          ...patch,
          status: 'completed',
        },
      }).filters,
    });
  }

  async resetCurrentCompletedWorkspacePreference(): Promise<void> {
    const key = this.currentCompletedPreferenceKey;
    const { [key]: _, ...rest } = this.workspacePreferences;
    this.workspacePreferences = rest;
    await this.#persistWorkspacePreferences();
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

  get currentPreferenceKey(): string {
    return this.activeListPath
      ? this.#preferenceKeyForList(this.activeListPath)
      : this.#preferenceKeyForView(this.activeView);
  }

  get currentWorkspacePreference(): TodoWorkspacePreference {
    return this.#preferenceForKey(this.currentPreferenceKey, this.activeView);
  }

  get currentCompletedPreferenceKey(): string {
    return `${this.currentPreferenceKey}:completed`;
  }

  get currentCompletedWorkspacePreference(): TodoWorkspacePreference {
    return this.#completedPreferenceForKey(this.currentCompletedPreferenceKey, this.activeView);
  }

  get currentAdvancedFilter(): TodoAdvancedFilter {
    return this.currentWorkspacePreference.filters;
  }

  get currentCompletedAdvancedFilter(): TodoAdvancedFilter {
    return this.currentCompletedWorkspacePreference.filters;
  }

  get activeAdvancedFilterCount(): number {
    return countActiveAdvancedFilters(
      this.currentAdvancedFilter,
      defaultPreferenceForView(this.activeView).filters,
    );
  }

  get activeCompletedFilterCount(): number {
    return countActiveAdvancedFilters(
      this.currentCompletedAdvancedFilter,
      defaultCompletedPreferenceForView(this.activeView).filters,
    );
  }

  get hasCurrentWorkspacePreference(): boolean {
    return this.currentPreferenceKey in this.workspacePreferences;
  }

  get hasCurrentCompletedWorkspacePreference(): boolean {
    return this.currentCompletedPreferenceKey in this.workspacePreferences;
  }

  /**
   * Tags found across all tasks.
   */
  get allTags(): string[] {
    return Array.from(new Set(this.todos.flatMap((todo) => todo.tags))).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  get groupedVisibleTodos(): TodoGroup[] {
    return this.getGroupsForTodos(this.visibleTodos);
  }

  get visibleOpenTodos(): Todo[] {
    if (this.activeView === 'logbook') return [];
    if (this.activeListPath) {
      return this.#presentTodos(
        this.todos.filter((todo) => todo.sourceFile === this.activeListPath && !todo.isCompleted),
        this.activeView,
        this.currentWorkspacePreference,
      );
    }
    return this.#presentTodos(
      this.#baseTodosForView(this.activeView, false).filter((todo) => !todo.isCompleted),
      this.activeView,
      this.currentWorkspacePreference,
    );
  }

  get visibleCompletedTodos(): Todo[] {
    if (this.activeView !== 'logbook' && !this.showCompleted) return [];
    if (this.activeListPath) {
      return this.#presentTodos(
        this.todos.filter((todo) => todo.sourceFile === this.activeListPath && todo.isCompleted),
        this.activeView,
        this.currentCompletedWorkspacePreference,
      );
    }
    return this.#presentTodos(
      this.#baseTodosForView(this.activeView, true).filter((todo) => todo.isCompleted),
      this.activeView,
      this.currentCompletedWorkspacePreference,
    );
  }

  get groupedVisibleOpenTodos(): TodoGroup[] {
    return this.getOpenGroupsForTodos(this.visibleOpenTodos);
  }

  get groupedVisibleCompletedTodos(): TodoGroup[] {
    return this.getCompletedGroupsForTodos(this.visibleCompletedTodos);
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
    return this.#presentTodos(
      this.#baseTodosForView(view, this.showCompleted),
      view,
      this.#preferenceForKey(this.#preferenceKeyForView(view), view),
    );
  }

  getTodosForListFile(path: string): Todo[] {
    return this.#presentTodos(
      this.todos.filter((todo) => todo.sourceFile === path && isVisibleByCompletion(todo, this.showCompleted)),
      this.activeView,
      this.#preferenceForKey(this.#preferenceKeyForList(path), this.activeView),
    );
  }

  getTodoListCount(path: string): number {
    return this.todos.filter((todo) => todo.sourceFile === path && !todo.isCompleted).length;
  }

  getGroupsForTodos(todos: Todo[]): TodoGroup[] {
    const preference = this.currentWorkspacePreference;
    return groupTodosForPresentation(
      todos,
      this.activeView,
      this.activeTodoList,
      preference.groupMode,
    );
  }

  getOpenGroupsForTodos(todos: Todo[]): TodoGroup[] {
    const preference = this.currentWorkspacePreference;
    return groupTodosForPresentation(
      todos,
      this.activeView,
      this.activeTodoList,
      preference.groupMode,
    );
  }

  getCompletedGroupsForTodos(todos: Todo[]): TodoGroup[] {
    const preference = this.currentCompletedWorkspacePreference;
    return groupTodosForPresentation(
      todos,
      this.activeView,
      this.activeTodoList,
      preference.groupMode,
    );
  }

  #baseTodosForView(view: TodoView, showCompleted: boolean): Todo[] {
    switch (view) {
      case 'all':
        return this.todos.filter((todo) => showCompleted || !todo.isCompleted);
      case 'inbox':
        return this.todos.filter(
          (todo) =>
            isVisibleByCompletion(todo, showCompleted) &&
            todo.source === 'dedicated' &&
            (todo.list ?? 'inbox') === 'inbox' &&
            !todo.dates.dueDate &&
            !todo.dates.scheduledDate,
        );
      case 'today':
        return this.todos.filter((todo) => isVisibleByCompletion(todo, showCompleted) && isAvailableToday(todo));
      case 'upcoming':
        return this.todos.filter((todo) => isVisibleByCompletion(todo, showCompleted) && isUpcoming(todo));
      case 'anytime':
        return this.todos.filter(
          (todo) =>
            isVisibleByCompletion(todo, showCompleted) &&
            todo.source === 'dedicated' &&
            getTaskList(todo) === 'anytime' &&
            !isAfterToday(todo.dates.scheduledDate),
        );
      case 'someday':
        return this.todos.filter(
          (todo) =>
            isVisibleByCompletion(todo, showCompleted) &&
            todo.source === 'dedicated' &&
            getTaskList(todo) === 'someday',
        );
      case 'notes':
        return this.todos.filter((todo) => isVisibleByCompletion(todo, showCompleted) && todo.source === 'inline');
      case 'tags':
        return this.todos.filter((todo) => isVisibleByCompletion(todo, showCompleted) && todo.tags.length > 0);
      case 'logbook':
        return sortCompletedTodosByCompletedAt(this.todos.filter((todo) => todo.isCompleted));
    }
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  #presentTodos(
    todos: Todo[],
    view: TodoView,
    preference: TodoWorkspacePreference,
  ): Todo[] {
    const filtered = applyAdvancedFilters(todos, preference.filters);
    return sortTodosForMode(filtered, resolveSortMode(preference.sortMode, view), view);
  }

  #preferenceForKey(key: string, view: TodoView): TodoWorkspacePreference {
    const saved = this.workspacePreferences[key];
    if (saved) return normalizeTodoWorkspacePreference(saved);
    return defaultPreferenceForView(view);
  }

  #completedPreferenceForKey(key: string, view: TodoView): TodoWorkspacePreference {
    const saved = this.workspacePreferences[key];
    if (saved) {
      return normalizeTodoWorkspacePreference({
        ...saved,
        filters: {
          ...saved.filters,
          status: 'completed',
        },
      });
    }
    return defaultCompletedPreferenceForView(view);
  }

  #preferenceKeyForView(view: TodoView): string {
    return `workspace:${this.#workspaceId()}:view:${view}`;
  }

  #preferenceKeyForList(path: string): string {
    return `workspace:${this.#workspaceId()}:list:${path}`;
  }

  #workspaceId(): string {
    return this.#settingsService?.current().activeWorkspaceId ?? 'default';
  }

  async #updateCurrentPreference(patch: Partial<TodoWorkspacePreference>): Promise<void> {
    const key = this.currentPreferenceKey;
    const next = normalizeTodoWorkspacePreference({
      ...this.currentWorkspacePreference,
      ...patch,
    });
    this.workspacePreferences = {
      ...this.workspacePreferences,
      [key]: next,
    };
    await this.#persistWorkspacePreferences();
  }

  async #updateCompletedPreference(patch: Partial<TodoWorkspacePreference>): Promise<void> {
    const key = this.currentCompletedPreferenceKey;
    const next = normalizeTodoWorkspacePreference({
      ...this.currentCompletedWorkspacePreference,
      ...patch,
      filters: {
        ...this.currentCompletedWorkspacePreference.filters,
        ...patch.filters,
        status: 'completed',
      },
    });
    this.workspacePreferences = {
      ...this.workspacePreferences,
      [key]: next,
    };
    await this.#persistWorkspacePreferences();
  }

  async #persistWorkspacePreferences(): Promise<void> {
    if (!this.#settingsService) return;
    const result = await this.#settingsService.set('taskWorkspacePreferences', this.workspacePreferences);
    if (!result.ok) {
      this.error = result.error;
    }
  }

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
    this.#settingsService = null;
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
    this.workspacePreferences = {};
  }
}

export const todoStore = new TodoStore();

function cloneWorkspacePreferences(
  preferences: Record<string, TodoWorkspacePreference>,
): Record<string, TodoWorkspacePreference> {
  return Object.fromEntries(
    Object.entries(preferences).map(([key, preference]) => [
      key,
      normalizeTodoWorkspacePreference(preference),
    ]),
  );
}

function defaultPreferenceForView(view: TodoView): TodoWorkspacePreference {
  if (view === 'logbook') {
    return {
      ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
      sortMode: 'completedNewest',
      groupMode: 'completedDate',
      filters: { ...DEFAULT_TODO_ADVANCED_FILTER },
    };
  }
  return {
    ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
    filters: { ...DEFAULT_TODO_ADVANCED_FILTER },
  };
}

function defaultCompletedPreferenceForView(_view: TodoView): TodoWorkspacePreference {
  return {
    ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
    sortMode: 'completedNewest',
    groupMode: 'completedDate',
    filters: {
      ...DEFAULT_TODO_ADVANCED_FILTER,
      status: 'completed',
      dateField: 'completedAt',
    },
  };
}

function resolveSortMode(sortMode: TodoSortMode, view: TodoView): TodoSortMode {
  if (sortMode !== 'viewDefault') return sortMode;
  return view === 'logbook' ? 'completedNewest' : 'priority';
}

function applyAdvancedFilters(todos: Todo[], filters: TodoAdvancedFilter): Todo[] {
  const normalized = normalizeTodoWorkspacePreference({
    ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
    filters,
  }).filters;
  const range = resolveDateRange(normalized);
  const search = normalized.search?.trim().toLowerCase() ?? '';
  const tags = normalized.tags ?? [];
  const priorities = normalized.priority ?? [];

  return todos.filter((todo) => {
    if (normalized.status === 'open' && todo.isCompleted) return false;
    if (normalized.status === 'completed' && !todo.isCompleted) return false;
    if (normalized.source && normalized.source !== 'all' && todo.source !== normalized.source) return false;
    if (normalized.list && normalized.list !== 'all' && getTaskList(todo) !== normalized.list) return false;
    if (priorities.length > 0 && (!todo.priority || !priorities.includes(todo.priority))) return false;
    if (tags.length > 0) {
      const matches = tags.map((tag) => todo.tags.includes(tag));
      if (normalized.tagMode === 'all') {
        if (!matches.every(Boolean)) return false;
      } else if (!matches.some(Boolean)) {
        return false;
      }
    }
    if (normalized.recurrence === 'with' && !todo.dates.recurrence) return false;
    if (normalized.recurrence === 'without' && todo.dates.recurrence) return false;
    if (search) {
      const haystack = [
        todo.content,
        todo.sourceFile,
        todo.priority ?? '',
        todo.list ?? '',
        todo.dates.recurrence ?? '',
        ...todo.tags,
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (range) {
      const date = getDateForField(todo, normalized.dateField ?? 'smart');
      if (!date) return false;
      const day = stripTime(date).getTime();
      if (range.from && day < range.from.getTime()) return false;
      if (range.to && day > range.to.getTime()) return false;
    }
    return true;
  });
}

function sortTodosForMode(todos: Todo[], sortMode: TodoSortMode, view: TodoView): Todo[] {
  if (view === 'logbook' || sortMode === 'completedNewest') {
    return sortTodosWithCompletedLast(todos);
  }
  if (sortMode === 'priority') {
    return sortTodosWithCompletedLast(todos);
  }
  if (sortMode === 'createdNewest') {
    return [...todos].sort((a, b) =>
      compareDateDesc(a.dates.createdAt, b.dates.createdAt) ||
      compareTodoSourceOrder(a, b)
    );
  }
  if (sortMode === 'planningDateAsc') {
    return [...todos].sort((a, b) =>
      compareDateAsc(getPlanningDate(a), getPlanningDate(b)) ||
      priorityOrder(a.priority) - priorityOrder(b.priority) ||
      compareTodoSourceOrder(a, b)
    );
  }
  if (sortMode === 'sourceOrder') {
    return [...todos].sort(compareTodoSourceOrder);
  }
  return sortTodosWithCompletedLast(todos);
}

function groupTodosForPresentation(
  todos: Todo[],
  view: TodoView,
  activeList: TodoListFile | null,
  groupMode: TodoGroupMode,
): TodoGroup[] {
  const resolvedGroupMode = groupMode === 'viewDefault'
    ? (view === 'logbook' ? 'completedDate' : 'viewDefault')
    : groupMode;

  if (todos.length === 0) return [];
  if (resolvedGroupMode === 'none') {
    return [{ label: activeList?.title ?? getTodoViewLabel(view), todos }];
  }
  if (resolvedGroupMode === 'smartDate') return groupBySmartDate(todos);
  if (resolvedGroupMode === 'completedDate') return groupByDateField(todos, 'completedAt');
  if (resolvedGroupMode === 'createdDate') return groupByDateField(todos, 'createdAt');
  if (resolvedGroupMode === 'planningDate') return groupByPlanningDate(todos);
  if (resolvedGroupMode === 'sourceFile') return groupByString(todos, (todo) => getFileName(todo.sourceFile));
  if (resolvedGroupMode === 'priority') return groupByPriority(todos);
  if (resolvedGroupMode === 'tag') return groupByString(todos, (todo) => todo.tags[0] ? `#${todo.tags[0]}` : 'No tag');

  if (activeList || view === 'all') return groupAllTodos(todos);
  if (view === 'today') return groupTodayTodos(todos);
  if (view === 'upcoming') return groupUpcomingTodos(todos);
  if (view === 'anytime') return groupAnytimeTodos(todos);
  if (view === 'notes') return groupByString(todos, (todo) => getFileName(todo.sourceFile));
  if (view === 'tags') return groupByString(todos, (todo) => todo.tags[0] ? `#${todo.tags[0]}` : 'Tagged');
  if (view === 'logbook') return groupByDateField(todos, 'completedAt');
  return [{ label: getTodoViewLabel(view), todos }];
}

function countActiveAdvancedFilters(
  filters: TodoAdvancedFilter,
  defaults: TodoAdvancedFilter = DEFAULT_TODO_ADVANCED_FILTER,
): number {
  const normalized = normalizeTodoWorkspacePreference({
    ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
    filters,
  }).filters;
  const defaultFilters = normalizeTodoWorkspacePreference({
    ...DEFAULT_TODO_WORKSPACE_PREFERENCE,
    filters: defaults,
  }).filters;
  let count = 0;
  if ((normalized.search ?? '').trim() !== (defaultFilters.search ?? '').trim()) count++;
  if (normalized.status !== defaultFilters.status) count++;
  if (normalized.source !== defaultFilters.source) count++;
  if (normalized.list !== defaultFilters.list) count++;
  if (!sameStringSet(normalized.priority ?? [], defaultFilters.priority ?? [])) count++;
  if (!sameStringSet(normalized.tags ?? [], defaultFilters.tags ?? [])) count++;
  if (normalized.tagMode !== defaultFilters.tagMode) count++;
  if (normalized.recurrence !== defaultFilters.recurrence) count++;
  if (normalized.dateField !== defaultFilters.dateField) count++;
  if (
    normalized.datePreset !== defaultFilters.datePreset ||
    (normalized.dateFrom ?? '') !== (defaultFilters.dateFrom ?? '') ||
    (normalized.dateTo ?? '') !== (defaultFilters.dateTo ?? '')
  ) {
    count++;
  }
  return count;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const normalizedA = [...a].sort();
  const normalizedB = [...b].sort();
  return normalizedA.every((value, index) => value === normalizedB[index]);
}

function resolveDateRange(filters: TodoAdvancedFilter): { from?: Date; to?: Date } | null {
  const preset = filters.datePreset ?? 'any';
  const today = startOfToday();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === 'last7Days') return { from: addDays(today, -6), to: today };
  if (preset === 'last30Days') return { from: addDays(today, -29), to: today };

  const from = parseDateInput(filters.dateFrom);
  const to = parseDateInput(filters.dateTo);
  if (!from && !to) return null;
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function groupAllTodos(todos: Todo[]): TodoGroup[] {
  const openOrder = ['Overdue', 'Today', 'Upcoming', 'Inbox', 'Anytime', 'Someday', 'Notes'];
  const groups = new Map<string, Todo[]>();
  const completed: Todo[] = [];

  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    addToGroup(groups, getAllGroupLabel(todo), todo);
  }

  const result = openOrder
    .filter((label) => groups.has(label))
    .map((label) => ({ label, todos: groups.get(label)! }));

  return [...result, ...groupByDateField(completed, 'completedAt')];
}

function groupTodayTodos(todos: Todo[]): TodoGroup[] {
  const groups = new Map<string, Todo[]>();
  const completed: Todo[] = [];
  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    const label = isBeforeToday(todo.dates.dueDate) || isBeforeToday(todo.dates.scheduledDate)
      ? 'Overdue'
      : 'Today';
    addToGroup(groups, label, todo);
  }
  const open = ['Overdue', 'Today']
    .filter((label) => groups.has(label))
    .map((label) => ({ label, todos: groups.get(label)! }));
  return [...open, ...groupByDateField(completed, 'completedAt')];
}

function groupUpcomingTodos(todos: Todo[]): TodoGroup[] {
  const groups = new Map<string, { order: number; todos: Todo[] }>();
  const completed: Todo[] = [];
  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    const date = getPlanningDate(todo);
    const label = date ? getUpcomingGroupLabel(date) : 'Later';
    const order = date ? stripTime(date).getTime() : Number.MAX_SAFE_INTEGER;
    const group = groups.get(label) ?? { order, todos: [] };
    group.order = Math.min(group.order, order);
    group.todos = [...group.todos, todo];
    groups.set(label, group);
  }
  const open = Array.from(groups.entries())
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([label, group]) => ({ label, todos: group.todos }));
  return [...open, ...groupByDateField(completed, 'completedAt')];
}

function groupAnytimeTodos(todos: Todo[]): TodoGroup[] {
  const groups = new Map<string, Todo[]>();
  const completed: Todo[] = [];
  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    const label = isToday(todo.dates.dueDate) || isToday(todo.dates.scheduledDate)
      ? 'Today'
      : todo.dates.dueDate
        ? 'Deadlines'
        : 'Anytime';
    addToGroup(groups, label, todo);
  }
  const open = ['Today', 'Deadlines', 'Anytime']
    .filter((label) => groups.has(label))
    .map((label) => ({ label, todos: groups.get(label)! }));
  return [...open, ...groupByDateField(completed, 'completedAt')];
}

function groupBySmartDate(todos: Todo[]): TodoGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (todo.isCompleted) {
      addToGroup(groups, todo.dates.completedAt ? getCompletedGroupLabel(todo.dates.completedAt) : 'No completion date', todo);
      continue;
    }
    const date = getDateForField(todo, 'smart');
    addToGroup(groups, date ? getGenericDateGroupLabel(date) : 'No date', todo);
  }
  return mapGroups(groups);
}

function groupByDateField(todos: Todo[], field: TodoDateFilterField): TodoGroup[] {
  if (todos.length === 0) return [];
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    const date = getDateForField(todo, field);
    const label = date
      ? field === 'completedAt'
        ? getCompletedGroupLabel(date)
        : getGenericDateGroupLabel(date)
      : field === 'completedAt'
        ? 'No completion date'
        : 'No date';
    addToGroup(groups, label, todo);
  }
  return mapGroups(groups);
}

function groupByPlanningDate(todos: Todo[]): TodoGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    const date = getPlanningDate(todo);
    addToGroup(groups, date ? getGenericDateGroupLabel(date) : 'No planning date', todo);
  }
  return mapGroups(groups);
}

function groupByPriority(todos: Todo[]): TodoGroup[] {
  const order: Array<TodoPriority | 'none'> = ['high', 'medium', 'low', 'none'];
  const groups = new Map<TodoPriority | 'none', Todo[]>();
  for (const todo of todos) {
    const key = todo.priority ?? 'none';
    groups.set(key, [...(groups.get(key) ?? []), todo]);
  }
  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      label: key === 'none' ? 'No priority' : getPriorityDisplayName(key),
      todos: groups.get(key)!,
    }));
}

function groupByString(todos: Todo[], getLabel: (todo: Todo) => string): TodoGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    addToGroup(groups, getLabel(todo), todo);
  }
  return mapGroups(groups);
}

function addToGroup(groups: Map<string, Todo[]>, label: string, todo: Todo): void {
  groups.set(label, [...(groups.get(label) ?? []), todo]);
}

function mapGroups(groups: Map<string, Todo[]>): TodoGroup[] {
  return Array.from(groups.entries()).map(([label, group]) => ({ label, todos: group }));
}

function getAllGroupLabel(todo: Todo): string {
  if (isBeforeToday(todo.dates.dueDate) || isBeforeToday(todo.dates.scheduledDate)) return 'Overdue';
  if (isToday(todo.dates.dueDate) || isToday(todo.dates.scheduledDate)) return 'Today';
  if (isAfterToday(todo.dates.dueDate) || isAfterToday(todo.dates.scheduledDate)) return 'Upcoming';
  if (todo.source === 'inline') return 'Notes';
  switch (todo.list ?? 'inbox') {
    case 'anytime':
      return 'Anytime';
    case 'someday':
      return 'Someday';
    case 'inbox':
      return 'Inbox';
  }
}

function getDateForField(todo: Todo, field: TodoDateFilterField): Date | undefined {
  if (field === 'createdAt') return todo.dates.createdAt;
  if (field === 'dueDate') return todo.dates.dueDate;
  if (field === 'scheduledDate') return todo.dates.scheduledDate;
  if (field === 'completedAt') return todo.dates.completedAt;
  if (todo.isCompleted) return todo.dates.completedAt;
  return todo.dates.scheduledDate ?? todo.dates.dueDate ?? todo.dates.createdAt;
}

function getPlanningDate(todo: Todo): Date | undefined {
  const scheduled = todo.dates.scheduledDate;
  const due = todo.dates.dueDate;
  if (scheduled && due) return scheduled < due ? scheduled : due;
  return scheduled ?? due;
}

function getUpcomingGroupLabel(date: Date): string {
  const today = startOfToday();
  const target = stripTime(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) {
    return target.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  return target.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getCompletedGroupLabel(date: Date): string {
  const today = startOfToday();
  const target = stripTime(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Completed today';
  if (diffDays === -1) return 'Completed yesterday';
  return target.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function getGenericDateGroupLabel(date: Date): string {
  const today = startOfToday();
  const target = stripTime(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) {
    return target.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  return target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function compareDateDesc(a: Date | undefined, b: Date | undefined): number {
  if (a && b) return b.getTime() - a.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function compareDateAsc(a: Date | undefined, b: Date | undefined): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function compareTodoSourceOrder(a: Todo, b: Todo): number {
  return a.sourceFile.localeCompare(b.sourceFile) || a.lineNumber - b.lineNumber;
}

function parseDateInput(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isBeforeToday(date: Date | undefined): boolean {
  if (!date) return false;
  return stripTime(date) < startOfToday();
}

function isToday(date: Date | undefined): boolean {
  if (!date) return false;
  return stripTime(date).getTime() === startOfToday().getTime();
}

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

function stripTime(date: Date): Date {
  const target = new Date(date);
  return new Date(target.getFullYear(), target.getMonth(), target.getDate());
}

function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

function getTaskList(todo: Todo): TodoList {
  return todo.list ?? 'inbox';
}

export { getTodoViewLabel };
