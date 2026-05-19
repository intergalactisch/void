<script lang="ts">
  import {
    Archive,
    ArrowLeft,
    CalendarDays,
    ChevronRight,
    Clock3,
    Edit3,
    Inbox,
    Layers,
    ListChecks,
    Plus,
    Search,
    StickyNote,
    Tag,
    Trash2,
    X,
  } from '@lucide/svelte';
  import type { Todo } from '$lib/domain/entities/Todo';
  import type { CreateTodoOptions, TodoListFile } from '$lib/ports/inbound';
  import { getTodoViewLabel, todoStore, type TodoView } from '$lib/stores/todo.svelte';
  import type { TodoList } from '$lib/domain/values/TodoView';
  import TodoInspector from './TodoInspector.svelte';
  import TodoTaskRow from './TodoTaskRow.svelte';

  interface Props {
    onClose?: () => void;
    onNavigateToFile?: (filePath: string) => void;
  }

  let { onClose, onNavigateToFile }: Props = $props();

  let capture = $state('');
  let captureDueDate = $state('');
  let capturePriority = $state<'none' | 'low' | 'medium' | 'high'>('none');
  let searchQuery = $state('');
  let captureInput = $state<HTMLInputElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let renderLimit = $state(100);
  let triageDueDate = $state('');
  let listDialogMode = $state<'create' | 'edit' | null>(null);
  let listDialogPath = $state<string | null>(null);
  let listDraftTitle = $state('');
  let listDraftNote = $state('');
  let listTitleInput = $state<HTMLInputElement | null>(null);
  let deleteListTarget = $state<TodoListFile | null>(null);

  const navSections: Array<{ label: string; views: TodoView[] }> = [
    { label: 'Plan', views: ['inbox', 'today', 'upcoming', 'anytime', 'someday'] },
    { label: 'Library', views: ['all', 'notes', 'tags'] },
    { label: 'Archive', views: ['logbook'] },
  ];

  const visibleTodos = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const todos = todoStore.visibleTodos;
    if (!query) return todos;
    return todos.filter((todo) => {
      const haystack = [
        todo.content,
        todo.sourceFile,
        todo.priority ?? '',
        ...todo.tags,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  });

  const renderedTodos = $derived(visibleTodos.slice(0, renderLimit));
  const groupedTodos = $derived.by(() => groupTodos(todoStore.activeView, renderedTodos, todoStore.activeTodoList));
  const hasMoreTodos = $derived(visibleTodos.length > renderLimit);

  export function focusCapture() {
    requestAnimationFrame(() => {
      captureInput?.focus();
      captureInput?.select();
    });
  }

  async function createTask(event: Event) {
    event.preventDefault();
    const content = capture.trim();
    if (!content) return;

    const options: CreateTodoOptions = {};
    const activeList = todoStore.activeTodoList;
    if (activeList) {
      options.targetFile = activeList.path;
      options.targetList = 'inbox';
    }

    if (captureDueDate) options.dueDate = parseDateInput(captureDueDate);
    if (!activeList && !captureDueDate && todoStore.activeView === 'today') options.scheduledDate = startOfToday();
    if (capturePriority !== 'none') options.priority = capturePriority;
    if (!activeList) {
      const targetList = getCaptureTargetList(todoStore.activeView);
      if (targetList) options.targetList = targetList;
    }

    await todoStore.quickCreate(content, options);
    capture = '';
    captureDueDate = '';
    capturePriority = 'none';
  }

  function setView(view: TodoView) {
    todoStore.setView(view);
    searchQuery = '';
    renderLimit = 100;
  }

  function setActiveList(path: string) {
    todoStore.setActiveList(path);
    searchQuery = '';
    renderLimit = 100;
  }

  function navigateToFile(filePath: string) {
    onNavigateToFile?.(filePath);
  }

  function parseDateInput(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year!, month! - 1, day);
  }

  function getViewDescription(view: TodoView): string {
    switch (view) {
      case 'all':
        return 'Everything actionable across TODO.md and note checkboxes.';
      case 'inbox':
        return 'Unprocessed tasks waiting for a date, list, or context.';
      case 'today':
        return 'Overdue and scheduled work ready before the day ends.';
      case 'upcoming':
        return 'Future dates grouped into the next week and later.';
      case 'anytime':
        return 'Active tasks you can start now, including open deadlines.';
      case 'someday':
        return 'Maybe-later work kept out of the active plan.';
      case 'notes':
        return 'Markdown checkboxes living inside notes.';
      case 'tags':
        return 'Tagged tasks grouped by their first tag.';
      case 'logbook':
        return 'Completed tasks kept as a reference trail.';
    }
  }

  function getWorkspaceTitle(): string {
    return todoStore.activeTodoList?.title ?? getTodoViewLabel(todoStore.activeView);
  }

  function getWorkspaceDescription(): string {
    const activeList = todoStore.activeTodoList;
    if (activeList) {
      return activeList.note || `Tasks stored in ${getFileName(activeList.path)}.`;
    }
    return getViewDescription(todoStore.activeView);
  }

  function getCapturePlaceholder(view: TodoView): string {
    const activeList = todoStore.activeTodoList;
    if (activeList) return `Add to ${activeList.title}`;
    switch (view) {
      case 'today':
        return 'Add a task for today';
      case 'upcoming':
        return 'Add task with a date';
      case 'anytime':
        return 'Add anytime task';
      case 'someday':
        return 'Add someday task';
      case 'notes':
        return 'Capture to Inbox';
      case 'tags':
        return 'Add task with #tag';
      case 'logbook':
        return 'Capture to Inbox';
      case 'inbox':
        return 'Add to Inbox';
      case 'all':
        return 'Add task: Review PR tomorrow p1 #work';
    }
  }

  function groupTodos(view: TodoView, todos: Todo[], activeList: TodoListFile | null): Array<{ label: string; todos: Todo[] }> {
    if (todos.length === 0) return [];

    if (activeList) {
      return groupAllTodos(todos);
    }

    if (view === 'all') {
      return groupAllTodos(todos);
    }

    if (view === 'today') {
      return groupTodayTodos(todos);
    }

    if (view === 'upcoming') {
      return groupUpcomingTodos(todos);
    }

    if (view === 'anytime') {
      return groupAnytimeTodos(todos);
    }

    if (view === 'notes') {
      const groups = new Map<string, Todo[]>();
      for (const todo of todos) {
        const label = getFileName(todo.sourceFile);
        groups.set(label, [...(groups.get(label) ?? []), todo]);
      }
      return Array.from(groups.entries()).map(([label, group]) => ({ label, todos: group }));
    }

    if (view === 'tags') {
      const groups = new Map<string, Todo[]>();
      for (const todo of todos) {
        const firstTag = todo.tags[0] ?? 'Tagged';
        groups.set(firstTag, [...(groups.get(firstTag) ?? []), todo]);
      }
      return Array.from(groups.entries()).map(([label, group]) => ({ label: `#${label}`, todos: group }));
    }

    if (view === 'logbook') {
      return groupCompletedTodos(todos);
    }

    return [{ label: getTodoViewLabel(view), todos }];
  }

  function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? path;
  }

  function getCaptureTargetList(view: TodoView): TodoList | undefined {
    if (view === 'all') return 'inbox';
    if (view === 'inbox' || view === 'anytime' || view === 'someday') return view;
    return undefined;
  }

  function getViewCount(view: TodoView): number {
    return todoStore.views.find((item) => item.id === view)?.count ?? 0;
  }

  function openCreateListDialog() {
    listDialogMode = 'create';
    listDialogPath = null;
    listDraftTitle = '';
    listDraftNote = '';
    requestAnimationFrame(() => listTitleInput?.focus());
  }

  function openEditListDialog(list: TodoListFile, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    listDialogMode = 'edit';
    listDialogPath = list.path;
    listDraftTitle = list.title;
    listDraftNote = list.note;
    requestAnimationFrame(() => listTitleInput?.focus());
  }

  function closeListDialog() {
    listDialogMode = null;
    listDialogPath = null;
    listDraftTitle = '';
    listDraftNote = '';
  }

  async function saveListDialog(event: Event) {
    event.preventDefault();
    const title = listDraftTitle.trim();
    if (!title) return;

    if (listDialogMode === 'edit' && listDialogPath) {
      await todoStore.updateTodoList(listDialogPath, {
        title,
        note: listDraftNote,
      });
    } else {
      await todoStore.createTodoList({
        title,
        note: listDraftNote,
      });
    }

    if (!todoStore.error) {
      closeListDialog();
    }
  }

  function requestDeleteList(list: TodoListFile, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    deleteListTarget = list;
  }

  async function confirmDeleteList() {
    if (!deleteListTarget) return;
    const path = deleteListTarget.path;
    deleteListTarget = null;
    await todoStore.deleteTodoList(path);
  }

  function hasSelectedOpenTodo(): boolean {
    return !!todoStore.selectedTodo && !todoStore.selectedTodo.isCompleted;
  }

  async function moveSelectedToToday() {
    const todo = todoStore.selectedTodo;
    if (!todo) return;
    await todoStore.updatePatch(todo.id, {
      scheduledDate: startOfToday(),
      targetList: 'anytime',
    });
  }

  async function moveSelectedToList(list: TodoList) {
    const todo = todoStore.selectedTodo;
    if (!todo) return;
    await todoStore.updatePatch(todo.id, {
      dueDate: null,
      scheduledDate: null,
      targetList: list,
    });
  }

  async function applySelectedDeadline() {
    const todo = todoStore.selectedTodo;
    if (!todo || !triageDueDate) return;
    await todoStore.updatePatch(todo.id, {
      dueDate: parseDateInput(triageDueDate),
      targetList: 'anytime',
    });
    triageDueDate = '';
  }

  function selectByOffset(offset: number) {
    if (visibleTodos.length === 0) return;
    const currentIndex = visibleTodos.findIndex((todo) => todo.id === todoStore.selectedTodoId);
    if (currentIndex === -1) {
      todoStore.selectTodo(visibleTodos[offset < 0 ? visibleTodos.length - 1 : 0]!.id);
      return;
    }
    const nextIndex = Math.min(visibleTodos.length - 1, Math.max(0, currentIndex + offset));
    todoStore.selectTodo(visibleTodos[nextIndex]!.id);
  }

  function setCompletedVisibility(event: Event) {
    todoStore.setShowCompleted((event.currentTarget as HTMLInputElement).checked);
  }

  async function handleWorkspaceKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');

    if (isMod && /^[1-9]$/.test(event.key)) {
      const view = todoStore.views[Number(event.key) - 1]?.id;
      if (view) {
        event.preventDefault();
        setView(view);
      }
      return;
    }

    if (isMod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }

    if (isMod && event.key.toLowerCase() === 'k' && todoStore.selectedTodo) {
      event.preventDefault();
      await todoStore.toggle(todoStore.selectedTodo.id);
      return;
    }

    if (typing) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectByOffset(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectByOffset(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector<HTMLTextAreaElement>('.inspector textarea[name="task-title"]')?.focus();
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && todoStore.selectedTodo) {
      event.preventDefault();
      await todoStore.delete(todoStore.selectedTodo.id);
      todoStore.selectTodo(visibleTodos[0]?.id ?? null);
    }
  }

  function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function groupAllTodos(todos: Todo[]): Array<{ label: string; todos: Todo[] }> {
    const order = ['Overdue', 'Today', 'Upcoming', 'Inbox', 'Anytime', 'Someday', 'Notes', 'Completed'];
    const groups = new Map<string, Todo[]>();

    for (const todo of todos) {
      const label = getAllGroupLabel(todo);
      groups.set(label, [...(groups.get(label) ?? []), todo]);
    }

    return order
      .filter((label) => groups.has(label))
      .map((label) => ({ label, todos: groups.get(label)! }));
  }

  function groupTodayTodos(todos: Todo[]): Array<{ label: string; todos: Todo[] }> {
    const groups = new Map<string, Todo[]>();

    for (const todo of todos) {
      const label = isBeforeToday(todo.dates.dueDate) || isBeforeToday(todo.dates.scheduledDate)
        ? 'Overdue'
        : 'Today';
      groups.set(label, [...(groups.get(label) ?? []), todo]);
    }

    return ['Overdue', 'Today']
      .filter((label) => groups.has(label))
      .map((label) => ({ label, todos: groups.get(label)! }));
  }

  function groupUpcomingTodos(todos: Todo[]): Array<{ label: string; todos: Todo[] }> {
    const groups = new Map<string, { order: number; todos: Todo[] }>();

    for (const todo of todos) {
      const date = getPlanningDate(todo);
      const label = date ? getUpcomingGroupLabel(date) : 'Later';
      const order = date ? stripTime(date).getTime() : Number.MAX_SAFE_INTEGER;
      const group = groups.get(label) ?? { order, todos: [] };
      group.order = Math.min(group.order, order);
      group.todos = [...group.todos, todo];
      groups.set(label, group);
    }

    return Array.from(groups.entries())
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([label, group]) => ({ label, todos: group.todos }));
  }

  function groupAnytimeTodos(todos: Todo[]): Array<{ label: string; todos: Todo[] }> {
    const groups = new Map<string, Todo[]>();

    for (const todo of todos) {
      const label = isToday(todo.dates.dueDate) || isToday(todo.dates.scheduledDate)
        ? 'Today'
        : todo.dates.dueDate
          ? 'Deadlines'
          : 'Anytime';
      groups.set(label, [...(groups.get(label) ?? []), todo]);
    }

    return ['Today', 'Deadlines', 'Anytime']
      .filter((label) => groups.has(label))
      .map((label) => ({ label, todos: groups.get(label)! }));
  }

  function groupCompletedTodos(todos: Todo[]): Array<{ label: string; todos: Todo[] }> {
    const groups = new Map<string, Todo[]>();

    for (const todo of todos) {
      const label = todo.dates.completedAt ? getCompletedGroupLabel(todo.dates.completedAt) : 'No completion date';
      groups.set(label, [...(groups.get(label) ?? []), todo]);
    }

    return Array.from(groups.entries()).map(([label, group]) => ({ label, todos: group }));
  }

  function getAllGroupLabel(todo: Todo): string {
    if (todo.isCompleted) return 'Completed';
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

  function isBeforeToday(date: Date | undefined): boolean {
    if (!date) return false;
    const target = stripTime(date);
    return target < startOfToday();
  }

  function isToday(date: Date | undefined): boolean {
    if (!date) return false;
    const target = stripTime(date);
    return target.getTime() === startOfToday().getTime();
  }

  function isAfterToday(date: Date | undefined): boolean {
    if (!date) return false;
    const target = stripTime(date);
    return target > startOfToday();
  }

  function stripTime(date: Date): Date {
    const target = new Date(date);
    return new Date(target.getFullYear(), target.getMonth(), target.getDate());
  }
</script>

<svelte:window onkeydown={handleWorkspaceKeydown} />

<section class="tasks-workspace" aria-label="Tasks workspace">
  <nav class="task-nav" aria-label="Task views">
    <div class="nav-title">
      <div>
        <ListChecks size={16} strokeWidth={2} />
        <span>Tasks</span>
      </div>
      <button type="button" class="notes-return" onclick={() => onClose?.()} title="Back to notes" aria-label="Back to notes">
        <ArrowLeft size={15} strokeWidth={2} />
        <span>Notes</span>
      </button>
    </div>

    <div class="nav-list">
      {#each navSections as section (section.label)}
        <section class="nav-section" aria-label={section.label}>
          <div class="nav-section-label">{section.label}</div>
          <div role="list">
            {#each section.views as view (view)}
              <button
                type="button"
                class:active={todoStore.activeListPath === null && todoStore.activeView === view}
                aria-current={todoStore.activeListPath === null && todoStore.activeView === view ? 'page' : undefined}
                onclick={() => setView(view)}
              >
                {#if view === 'all'}
                  <ListChecks size={15} strokeWidth={2} />
                {:else if view === 'inbox'}
                  <Inbox size={15} strokeWidth={2} />
                {:else if view === 'today'}
                  <CalendarDays size={15} strokeWidth={2} />
                {:else if view === 'upcoming'}
                  <ChevronRight size={15} strokeWidth={2} />
                {:else if view === 'anytime'}
                  <Layers size={15} strokeWidth={2} />
                {:else if view === 'someday'}
                  <Clock3 size={15} strokeWidth={2} />
                {:else if view === 'notes'}
                  <StickyNote size={15} strokeWidth={2} />
                {:else if view === 'tags'}
                  <Tag size={15} strokeWidth={2} />
                {:else}
                  <Archive size={15} strokeWidth={2} />
                {/if}
                <span>{getTodoViewLabel(view)}</span>
                <strong>{getViewCount(view)}</strong>
              </button>
            {/each}
          </div>
        </section>
        {#if section.label === 'Plan'}
          <section class="nav-section" aria-label="Todo lists">
            <div class="nav-section-heading">
              <div class="nav-section-label">Lists</div>
              <button type="button" class="nav-add-button" onclick={openCreateListDialog} title="New todo list" aria-label="New todo list">
                <Plus size={14} strokeWidth={2.2} />
              </button>
            </div>
            <div role="list" class="todo-list-nav">
              {#each todoStore.todoLists as list (list.path)}
                <div class="todo-list-row" class:active={todoStore.activeListPath === list.path}>
                  <button
                    type="button"
                    class="todo-list-main"
                    aria-current={todoStore.activeListPath === list.path ? 'page' : undefined}
                    onclick={() => setActiveList(list.path)}
                  >
                    <ListChecks size={15} strokeWidth={2} />
                    <span>{list.title}</span>
                    <strong>{todoStore.getTodoListCount(list.path)}</strong>
                  </button>
                  <div class="todo-list-actions">
                    <button type="button" onclick={(event) => openEditListDialog(list, event)} title="Edit list" aria-label={`Edit ${list.title}`}>
                      <Edit3 size={13} strokeWidth={2} />
                    </button>
                    <button type="button" class="danger" onclick={(event) => requestDeleteList(list, event)} title="Delete list" aria-label={`Delete ${list.title}`}>
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    </div>
  </nav>

  <main class="task-main">
    <header class="task-header">
      <div>
        <p class="eyebrow">Tasks</p>
        <h1>{getWorkspaceTitle()}</h1>
        <p>{getWorkspaceDescription()}</p>
        <div class="view-stats" aria-label="Task counts">
          <span><strong>{todoStore.stats.open}</strong> Open</span>
          <span class:warn={todoStore.stats.dueToday > 0}><strong>{todoStore.stats.dueToday}</strong> Today</span>
          <span class:error={todoStore.stats.overdue > 0}><strong>{todoStore.stats.overdue}</strong> Overdue</span>
        </div>
      </div>

      <div class="header-tools">
        <label class="completed-toggle">
          <input
            type="checkbox"
            name="task-show-completed"
            checked={todoStore.showCompleted}
            onchange={setCompletedVisibility}
          />
          <span>Show completed</span>
        </label>

        <div class="search-box">
          <Search size={15} strokeWidth={2} />
          <input bind:this={searchInput} type="search" name="task-search" placeholder="Search tasks" bind:value={searchQuery} aria-label="Search tasks" />
        </div>
      </div>
    </header>

    <form class="capture-bar" onsubmit={createTask}>
      <Plus size={16} strokeWidth={2.2} />
      <input
        bind:this={captureInput}
        type="text"
        name="task-capture"
        placeholder={getCapturePlaceholder(todoStore.activeView)}
        bind:value={capture}
        aria-label="Add a task"
      />
      <input type="date" name="task-capture-due" bind:value={captureDueDate} aria-label="Due date" />
      <select name="task-capture-priority" bind:value={capturePriority} aria-label="Priority">
        <option value="none">Priority</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <button type="submit" disabled={!capture.trim()}>Add</button>
    </form>

    {#if !todoStore.activeListPath && (todoStore.activeView === 'inbox' || todoStore.activeView === 'all') && hasSelectedOpenTodo()}
      <div class="triage-bar" aria-label="Inbox triage actions">
        <span>Triage selected</span>
        <button type="button" onclick={moveSelectedToToday}>Today</button>
        <button type="button" onclick={() => moveSelectedToList('anytime')}>Anytime</button>
        <button type="button" onclick={() => moveSelectedToList('someday')}>Someday</button>
        <input type="date" name="triage-deadline" bind:value={triageDueDate} aria-label="Deadline" onchange={applySelectedDeadline} />
      </div>
    {/if}

    <div class="task-list" aria-live="polite">
      {#if todoStore.loading}
        <div class="state-line">Loading tasks...</div>
      {:else if todoStore.error}
        <div class="state-line error">
          <span>{todoStore.error.message}</span>
          <button type="button" onclick={() => todoStore.refresh()}>Retry</button>
        </div>
      {:else if visibleTodos.length === 0}
        <div class="empty-state">
          <h2>No tasks here</h2>
          <p>{searchQuery ? 'No task matches your search.' : 'This view is clear.'}</p>
        </div>
      {:else}
        {#each groupedTodos as group (group.label)}
          <section class="task-group" aria-label={group.label}>
            <div class="group-header">
              <span>{group.label}</span>
              <strong>{group.todos.length}</strong>
            </div>
            {#each group.todos as todo (todo.id)}
              <TodoTaskRow
                {todo}
                selected={todoStore.selectedTodoId === todo.id}
                onSelect={(selectedTodo) => todoStore.selectTodo(selectedTodo.id)}
                onNavigateToFile={navigateToFile}
              />
            {/each}
          </section>
        {/each}
        {#if hasMoreTodos}
          <button type="button" class="load-more" onclick={() => { renderLimit += 100; }}>
            Show next {Math.min(100, visibleTodos.length - renderLimit)} tasks
          </button>
        {/if}
      {/if}
    </div>
  </main>

  {#if todoStore.selectedTodo}
    <TodoInspector
      todo={todoStore.selectedTodo}
      onNavigateToFile={navigateToFile}
      onClose={() => todoStore.selectTodo(null)}
    />
  {/if}

  {#if listDialogMode}
    <div class="modal-backdrop" role="presentation">
      <div class="list-dialog" role="dialog" aria-modal="true" aria-label={listDialogMode === 'edit' ? 'Edit todo list' : 'New todo list'} tabindex="-1">
        <form class="list-dialog-form" onsubmit={saveListDialog}>
          <div class="dialog-header">
            <div>
              <p class="eyebrow">List</p>
              <h2>{listDialogMode === 'edit' ? 'Edit list' : 'New list'}</h2>
            </div>
            <button type="button" class="dialog-close" onclick={closeListDialog} title="Close" aria-label="Close">
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          <label>
            <span>Name</span>
            <input bind:this={listTitleInput} type="text" name="todo-list-title" bind:value={listDraftTitle} placeholder="Work" autocomplete="off" />
          </label>

          <label>
            <span>Note</span>
            <textarea name="todo-list-note" rows="4" bind:value={listDraftNote} placeholder="Optional context for this list"></textarea>
          </label>

          <div class="dialog-actions">
            <button type="button" class="secondary" onclick={closeListDialog}>Cancel</button>
            <button type="submit" class="primary" disabled={!listDraftTitle.trim()}>{listDialogMode === 'edit' ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if deleteListTarget}
    <div class="modal-backdrop" role="presentation">
      <div class="list-dialog delete-dialog" role="dialog" aria-modal="true" aria-label="Delete todo list" tabindex="-1">
        <div class="dialog-header">
          <div>
            <p class="eyebrow">Delete</p>
            <h2>{deleteListTarget.title}</h2>
          </div>
          <button type="button" class="dialog-close" onclick={() => { deleteListTarget = null; }} title="Close" aria-label="Close">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <p class="delete-copy">This removes {getFileName(deleteListTarget.path)} and every task inside it.</p>
        <div class="dialog-actions">
          <button type="button" class="secondary" onclick={() => { deleteListTarget = null; }}>Cancel</button>
          <button type="button" class="danger-action" onclick={confirmDeleteList}>Delete</button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .tasks-workspace {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    min-width: 0;
    height: 100%;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    background: var(--bg-app);
  }

  .task-nav {
    min-height: 0;
    border-right: 1px solid var(--border-light);
    background: var(--bg-sidebar);
    padding: 14px 10px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .nav-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 8px 14px;
    color: var(--text-primary);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .nav-title > div,
  .notes-return {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .notes-return {
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 9px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .notes-return:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .notes-return:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .nav-list {
    display: grid;
    gap: 14px;
  }

  .nav-section {
    display: grid;
    gap: 3px;
  }

  .nav-section-label {
    padding: 0 8px 2px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
  }

  .nav-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .nav-add-button {
    display: grid !important;
    grid-template-columns: 1fr !important;
    place-items: center;
    width: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
    color: var(--text-tertiary) !important;
  }

  .nav-section > div[role='list'] {
    display: grid;
    gap: 1px;
  }

  .nav-list button {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 31px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    padding: 5px 8px;
    text-align: left;
    cursor: pointer;
  }

  .nav-list button:hover,
  .nav-list button.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-list button.active {
    background: var(--bg-card);
    box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--border-light);
  }

  .nav-list strong {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .todo-list-nav {
    gap: 1px;
  }

  .todo-list-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border-radius: var(--radius-sm);
  }

  .todo-list-row:hover,
  .todo-list-row.active {
    background: var(--bg-hover);
  }

  .todo-list-row.active {
    background: var(--bg-card);
    box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--border-light);
  }

  .todo-list-main {
    min-width: 0;
    box-shadow: none !important;
  }

  .todo-list-row.active .todo-list-main {
    color: var(--text-primary);
  }

  .todo-list-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    padding-right: 4px;
    opacity: 0;
  }

  .todo-list-row:hover .todo-list-actions,
  .todo-list-row.active .todo-list-actions {
    opacity: 1;
  }

  .todo-list-actions button {
    display: grid !important;
    grid-template-columns: 1fr !important;
    place-items: center;
    width: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
    color: var(--text-tertiary) !important;
  }

  .todo-list-actions button:hover {
    color: var(--text-primary) !important;
  }

  .todo-list-actions button.danger:hover {
    color: var(--color-error) !important;
  }

  .task-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-editor);
  }

  .task-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding: 26px 34px 18px;
    border-bottom: 1px solid var(--border-faint);
  }

  .task-header > div:first-child {
    min-width: 0;
  }

  .eyebrow {
    margin: 0 0 4px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
  }

  h1 {
    margin: 0;
    color: var(--text-primary);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: var(--text-h1-tracking);
  }

  .task-header p:last-child {
    margin: 5px 0 0;
    color: var(--text-secondary);
    font-size: var(--text-body);
  }

  .view-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .view-stats span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    padding: 0 7px;
  }

  .view-stats strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .view-stats .warn {
    color: var(--color-warning);
    background: var(--color-warning-bg);
    border-color: color-mix(in srgb, var(--color-warning) 22%, transparent);
  }

  .view-stats .error {
    color: var(--color-error);
    background: var(--color-error-bg);
    border-color: color-mix(in srgb, var(--color-error) 22%, transparent);
  }

  .header-tools {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: min(460px, 45vw);
    justify-content: flex-end;
  }

  .completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 32px;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-small);
    cursor: pointer;
  }

  .completed-toggle input {
    width: 15px;
    height: 15px;
    accent-color: var(--accent-primary);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(280px, 35vw);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-tertiary);
    padding: 7px 10px;
  }

  .search-box input {
    min-width: 0;
    width: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
  }

  .capture-bar {
    display: grid;
    grid-template-columns: 18px minmax(180px, 1fr) 142px 112px auto;
    gap: 8px;
    align-items: center;
    margin: 16px 34px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    padding: 8px 8px 8px 12px;
    color: var(--text-tertiary);
  }

  .capture-bar input,
  .capture-bar select {
    min-width: 0;
    border: 0;
    border-left: 1px solid var(--border-faint);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    outline: none;
    padding: 6px 8px;
  }

  .capture-bar input:focus,
  .capture-bar select:focus {
    box-shadow: none;
  }

  .capture-bar input[name='task-capture'] {
    border-left: 0;
  }

  .capture-bar button {
    min-height: 30px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-inverse);
    padding: 0 12px;
    font-size: var(--text-small);
    cursor: pointer;
  }

  .capture-bar button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .triage-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -2px 34px 16px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    padding: 7px 8px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .triage-bar span {
    margin-right: 4px;
    font-weight: 600;
  }

  .triage-bar button,
  .triage-bar input,
  .load-more {
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 9px;
    font: inherit;
  }

  .triage-bar button:hover,
  .load-more:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .task-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0 34px 34px;
  }

  .load-more {
    display: block;
    margin: 14px auto 0;
    cursor: pointer;
  }

  .task-group {
    border-top: 1px solid var(--border-light);
  }

  .task-group + .task-group {
    margin-top: 14px;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 10px 2px 6px;
    background: var(--bg-editor);
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .group-header strong {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .state-line,
  .empty-state {
    display: grid;
    place-items: center;
    min-height: 280px;
    color: var(--text-tertiary);
  }

  .state-line.error {
    gap: 12px;
    color: var(--color-error);
  }

  .state-line button {
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    padding: 6px 10px;
  }

  .empty-state {
    align-content: center;
    gap: 6px;
  }

  .empty-state h2 {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-h3);
    font-weight: 600;
  }

  .empty-state p {
    margin: 0;
    font-size: var(--text-body);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg-app) 72%, transparent);
    padding: 18px;
  }

  .list-dialog {
    display: grid;
    gap: 14px;
    width: min(420px, 100%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    padding: 18px;
  }

  .list-dialog-form {
    display: grid;
    gap: 14px;
  }

  .dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .dialog-header h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-h2);
    font-weight: var(--text-h2-weight);
  }

  .dialog-close {
    display: grid;
    place-items: center;
    width: 28px;
    min-height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .dialog-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .list-dialog label {
    display: grid;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--text-small);
  }

  .list-dialog input,
  .list-dialog textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    outline: none;
    padding: 8px 9px;
  }

  .list-dialog textarea {
    resize: vertical;
  }

  .list-dialog input:focus,
  .list-dialog textarea:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .dialog-actions button {
    min-height: 32px;
    border-radius: var(--radius-md);
    padding: 0 11px;
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
  }

  .dialog-actions .secondary {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
  }

  .dialog-actions .primary {
    border: 1px solid var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-inverse);
  }

  .dialog-actions .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .danger-action {
    border: 1px solid color-mix(in srgb, var(--color-error) 26%, var(--border-light));
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .delete-copy {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-body);
  }

  @media (max-width: 1180px) {
    .capture-bar {
      grid-template-columns: 18px minmax(0, 1fr) auto;
    }

    .capture-bar input[name='task-capture-due'],
    .capture-bar select {
      grid-column: 2;
      border-left: 0;
    }
  }

  @media (max-width: 900px) {
    .tasks-workspace {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .task-nav {
      border-right: 0;
      border-bottom: 1px solid var(--border-light);
      padding: 10px;
    }

    .nav-list {
      display: flex;
      gap: 10px;
      overflow-x: auto;
    }

    .nav-section {
      min-width: max-content;
    }

    .nav-section-label {
      padding-left: 4px;
    }

    .nav-section > div[role='list'] {
      display: flex;
      gap: 2px;
    }

    .nav-title {
      padding-bottom: 8px;
    }

    .nav-list button {
      min-width: max-content;
      grid-template-columns: 18px auto auto;
    }

    .task-header {
      display: grid;
      padding: 18px;
    }

    .search-box {
      width: 100%;
    }

    .header-tools {
      width: 100%;
      min-width: 0;
      justify-content: stretch;
      flex-wrap: wrap;
    }

    .completed-toggle {
      min-height: 28px;
    }

    .capture-bar {
      grid-template-columns: 18px minmax(0, 1fr);
      margin: 12px 18px;
    }

    .triage-bar {
      flex-wrap: wrap;
      margin: 0 18px 12px;
    }

    .capture-bar input,
    .capture-bar select,
    .capture-bar button {
      grid-column: 2;
      border-left: 0;
    }

    .task-list {
      padding: 0 18px 24px;
    }
  }
</style>
