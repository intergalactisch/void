<script lang="ts">
  import {
    Archive,
    ArrowLeft,
    ArrowDownWideNarrow,
    CalendarDays,
    CalendarRange,
    ChevronRight,
    Clock3,
    Edit3,
    Filter,
    Inbox,
    Layers,
    ListChecks,
    Plus,
    RotateCcw,
    Search,
    SlidersHorizontal,
    StickyNote,
    Tag,
    Trash2,
    X,
  } from '@lucide/svelte';
  import type { CreateTodoOptions, TodoListFile } from '$lib/ports/inbound';
  import {
    getTodoViewLabel,
    todoStore,
    type TodoDateFilterField,
    type TodoDateFilterPreset,
    type TodoGroupMode,
    type TodoSortMode,
    type TodoView,
  } from '$lib/stores/todo.svelte';
  import type { TodoList } from '$lib/domain/values/TodoView';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import { InfoPopover, SelectShell } from '$lib/components/shared';
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
  let captureInput = $state<HTMLInputElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let openRenderLimit = $state(100);
  let completedRenderLimit = $state(100);
  let filtersExpanded = $state(false);
  let completedFiltersExpanded = $state(false);
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
  const priorityOptions: TodoPriority[] = ['high', 'medium', 'low'];

  const openTodos = $derived(todoStore.visibleOpenTodos);
  const completedTodos = $derived(todoStore.visibleCompletedTodos);
  const renderedOpenTodos = $derived(openTodos.slice(0, openRenderLimit));
  const renderedCompletedTodos = $derived(completedTodos.slice(0, completedRenderLimit));
  const groupedOpenTodos = $derived.by(() => todoStore.getOpenGroupsForTodos(renderedOpenTodos));
  const groupedCompletedTodos = $derived.by(() => todoStore.getCompletedGroupsForTodos(renderedCompletedTodos));
  const hasMoreOpenTodos = $derived(openTodos.length > openRenderLimit);
  const hasMoreCompletedTodos = $derived(completedTodos.length > completedRenderLimit);
  const showOpenSurface = $derived(todoStore.activeView !== 'logbook');
  const showCompletedSurface = $derived(todoStore.activeView === 'logbook' || todoStore.showCompleted);
  const currentPreference = $derived(todoStore.currentWorkspacePreference);
  const currentFilters = $derived(currentPreference.filters);
  const completedPreference = $derived(todoStore.currentCompletedWorkspacePreference);
  const completedFilters = $derived(completedPreference.filters);
  const priorityFilters = $derived(currentFilters.priority ?? []);
  const completedPriorityFilters = $derived(completedFilters.priority ?? []);
  const tagFilterInput = $derived((currentFilters.tags ?? []).join(', '));
  const completedTagFilterInput = $derived((completedFilters.tags ?? []).join(', '));

  export function focusCapture() {
    requestAnimationFrame(() => {
      captureInput?.focus();
      captureInput?.select();
    });
  }

  export function focusSearch() {
    requestAnimationFrame(() => {
      searchInput?.focus();
      searchInput?.select();
    });
  }

  export function focusSelectedTitle() {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('.inspector textarea[name="task-title"]')?.focus();
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
    resetRenderLimits();
  }

  function setActiveList(path: string) {
    todoStore.setActiveList(path);
    resetRenderLimits();
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

  function setCompletedVisibility(event: Event) {
    todoStore.setShowCompleted((event.currentTarget as HTMLInputElement).checked);
    completedRenderLimit = 100;
  }

  async function setSearchFilter(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter('search', value);
  }

  async function setStatusFilter(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'status',
      (event.currentTarget as HTMLSelectElement).value as 'all' | 'open' | 'completed',
    );
  }

  async function setSourceFilter(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'source',
      (event.currentTarget as HTMLSelectElement).value as 'all' | 'dedicated' | 'inline',
    );
  }

  async function setListFilter(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'list',
      (event.currentTarget as HTMLSelectElement).value as 'all' | TodoList,
    );
  }

  async function setRecurrenceFilter(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'recurrence',
      (event.currentTarget as HTMLSelectElement).value as 'all' | 'with' | 'without',
    );
  }

  async function setSortMode(event: Event) {
    openRenderLimit = 100;
    await todoStore.setSortMode((event.currentTarget as HTMLSelectElement).value as TodoSortMode);
  }

  async function setGroupMode(event: Event) {
    openRenderLimit = 100;
    await todoStore.setGroupMode((event.currentTarget as HTMLSelectElement).value as TodoGroupMode);
  }

  async function setDateField(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'dateField',
      (event.currentTarget as HTMLSelectElement).value as TodoDateFilterField,
    );
  }

  async function setDatePreset(event: Event) {
    openRenderLimit = 100;
    await todoStore.updateAdvancedFilters({
      datePreset: (event.currentTarget as HTMLSelectElement).value as TodoDateFilterPreset,
      dateFrom: '',
      dateTo: '',
    });
  }

  async function setDateBound(key: 'dateFrom' | 'dateTo', event: Event) {
    openRenderLimit = 100;
    await todoStore.updateAdvancedFilters({
      [key]: (event.currentTarget as HTMLInputElement).value,
      datePreset: 'custom',
    });
  }

  async function togglePriority(priority: TodoPriority, event: Event) {
    openRenderLimit = 100;
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const current = currentFilters.priority ?? [];
    const next = checked
      ? Array.from(new Set([...current, priority]))
      : current.filter((item) => item !== priority);
    await todoStore.setAdvancedFilter('priority', next);
  }

  async function setTagsFilter(event: Event) {
    openRenderLimit = 100;
    const tags = (event.currentTarget as HTMLInputElement).value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    await todoStore.setAdvancedFilter('tags', Array.from(new Set(tags)));
  }

  async function setTagMode(event: Event) {
    openRenderLimit = 100;
    await todoStore.setAdvancedFilter(
      'tagMode',
      (event.currentTarget as HTMLSelectElement).value as 'any' | 'all',
    );
  }

  async function resetTaskPreferences() {
    openRenderLimit = 100;
    await todoStore.resetCurrentWorkspacePreference();
  }

  async function setCompletedSearchFilter(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter('search', (event.currentTarget as HTMLInputElement).value);
  }

  async function setCompletedSourceFilter(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter(
      'source',
      (event.currentTarget as HTMLSelectElement).value as 'all' | 'dedicated' | 'inline',
    );
  }

  async function setCompletedListFilter(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter(
      'list',
      (event.currentTarget as HTMLSelectElement).value as 'all' | TodoList,
    );
  }

  async function setCompletedRecurrenceFilter(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter(
      'recurrence',
      (event.currentTarget as HTMLSelectElement).value as 'all' | 'with' | 'without',
    );
  }

  async function setCompletedSortMode(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedSortMode((event.currentTarget as HTMLSelectElement).value as TodoSortMode);
  }

  async function setCompletedGroupMode(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedGroupMode((event.currentTarget as HTMLSelectElement).value as TodoGroupMode);
  }

  async function setCompletedDateField(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter(
      'dateField',
      (event.currentTarget as HTMLSelectElement).value as TodoDateFilterField,
    );
  }

  async function setCompletedDatePreset(event: Event) {
    completedRenderLimit = 100;
    await todoStore.updateCompletedAdvancedFilters({
      datePreset: (event.currentTarget as HTMLSelectElement).value as TodoDateFilterPreset,
      dateFrom: '',
      dateTo: '',
    });
  }

  async function setCompletedDateBound(key: 'dateFrom' | 'dateTo', event: Event) {
    completedRenderLimit = 100;
    await todoStore.updateCompletedAdvancedFilters({
      [key]: (event.currentTarget as HTMLInputElement).value,
      datePreset: 'custom',
    });
  }

  async function toggleCompletedPriority(priority: TodoPriority, event: Event) {
    completedRenderLimit = 100;
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const current = completedFilters.priority ?? [];
    const next = checked
      ? Array.from(new Set([...current, priority]))
      : current.filter((item) => item !== priority);
    await todoStore.setCompletedAdvancedFilter('priority', next);
  }

  async function setCompletedTagsFilter(event: Event) {
    completedRenderLimit = 100;
    const tags = (event.currentTarget as HTMLInputElement).value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    await todoStore.setCompletedAdvancedFilter('tags', Array.from(new Set(tags)));
  }

  async function setCompletedTagMode(event: Event) {
    completedRenderLimit = 100;
    await todoStore.setCompletedAdvancedFilter(
      'tagMode',
      (event.currentTarget as HTMLSelectElement).value as 'any' | 'all',
    );
  }

  async function resetCompletedTaskPreferences() {
    completedRenderLimit = 100;
    await todoStore.resetCurrentCompletedWorkspacePreference();
  }

  function resetRenderLimits() {
    openRenderLimit = 100;
    completedRenderLimit = 100;
  }

  function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
</script>

<section class="tasks-workspace" aria-label="Tasks workspace">
  <nav class="task-nav" aria-label="Task views">
    <div class="nav-title">
      <div>
        <ListChecks size={16} strokeWidth={2} />
        <span>Tasks</span>
        <InfoPopover
          title="Task views"
          body="Task views are lenses over the same markdown-backed tasks; moving between views does not duplicate the task."
          items={[
            'Inbox is for unprocessed tasks.',
            'Today and Upcoming are date-based.',
            'Notes and Tags show tasks by their source.',
          ]}
          align="start"
        />
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
    </header>

    <div class="task-command-center">
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
        <SelectShell class="task-capture-select-shell">
          <select name="task-capture-priority" bind:value={capturePriority} aria-label="Priority">
            <option value="none">Priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </SelectShell>
        <button type="submit" disabled={!capture.trim()}>Add</button>
      </form>

      {#if showOpenSurface}
        <section class="surface-toolbar" aria-label="Open task controls">
          <div class="surface-title">
            <span>Open</span>
            <strong>{openTodos.length}</strong>
          </div>

          <div class="search-box">
            <Search size={15} strokeWidth={2} />
            <input
              bind:this={searchInput}
              type="search"
              name="task-search"
              placeholder="Search open tasks"
              value={currentFilters.search ?? ''}
              oninput={setSearchFilter}
              aria-label="Search open tasks"
            />
          </div>

          <label class="control-select compact-control">
            <span><ArrowDownWideNarrow size={14} strokeWidth={2} /> Sort</span>
            <SelectShell class="task-select-shell">
              <select name="task-sort-mode" value={currentPreference.sortMode} onchange={setSortMode} aria-label="Sort open tasks">
                <option value="viewDefault">Default</option>
                <option value="completedNewest">Completed newest</option>
                <option value="createdNewest">Created newest</option>
                <option value="planningDateAsc">Planning date</option>
                <option value="priority">Priority</option>
                <option value="sourceOrder">Source order</option>
              </select>
            </SelectShell>
          </label>

          <label class="control-select compact-control">
            <span><Layers size={14} strokeWidth={2} /> Group</span>
            <SelectShell class="task-select-shell">
              <select name="task-group-mode" value={currentPreference.groupMode} onchange={setGroupMode} aria-label="Group open tasks">
                <option value="viewDefault">Default</option>
                <option value="smartDate">Smart date</option>
                <option value="completedDate">Completed date</option>
                <option value="createdDate">Created date</option>
                <option value="planningDate">Planning date</option>
                <option value="sourceFile">Source file</option>
                <option value="priority">Priority</option>
                <option value="tag">Tag</option>
                <option value="none">None</option>
              </select>
            </SelectShell>
          </label>

          <div class="toolbar-actions">
            {#if todoStore.activeView !== 'logbook'}
              <label class="completed-toggle">
                <input
                  type="checkbox"
                  name="task-show-completed"
                  checked={todoStore.showCompleted}
                  onchange={setCompletedVisibility}
                />
                <span>Show completed</span>
              </label>
            {/if}

            <button
              type="button"
              class="filter-toggle"
              class:active={filtersExpanded}
              onclick={() => { filtersExpanded = !filtersExpanded; }}
              aria-expanded={filtersExpanded}
              aria-controls="task-advanced-filters"
            >
              <SlidersHorizontal size={15} strokeWidth={2} />
              <span>Filters</span>
              {#if todoStore.activeAdvancedFilterCount > 0}
                <strong>{todoStore.activeAdvancedFilterCount}</strong>
              {/if}
            </button>

            <button
              type="button"
              class="reset-filters"
              onclick={resetTaskPreferences}
              disabled={!todoStore.hasCurrentWorkspacePreference}
              title="Reset open filters"
              aria-label="Reset open filters"
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
          </div>
        </section>
      {/if}

      {#if showOpenSurface && filtersExpanded}
        <section id="task-advanced-filters" class="advanced-filters" aria-label="Open task filters">
          <div class="filter-block">
            <div class="filter-block-title"><Filter size={14} strokeWidth={2} /> Scope</div>
            <label class="filter-field">
              <span>Status</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-status" value={currentFilters.status ?? 'all'} onchange={setStatusFilter} aria-label="Open task status">
                  <option value="all">All visible</option>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                </select>
              </SelectShell>
            </label>
            <label class="filter-field">
              <span>Source</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-source" value={currentFilters.source ?? 'all'} onchange={setSourceFilter} aria-label="Open task source">
                  <option value="all">All sources</option>
                  <option value="dedicated">TODO.md</option>
                  <option value="inline">Inline notes</option>
                </select>
              </SelectShell>
            </label>
            <label class="filter-field">
              <span>List</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-list" value={currentFilters.list ?? 'all'} onchange={setListFilter} aria-label="Open task list">
                  <option value="all">All lists</option>
                  <option value="inbox">Inbox</option>
                  <option value="anytime">Anytime</option>
                  <option value="someday">Someday</option>
                </select>
              </SelectShell>
            </label>
          </div>

          <div class="filter-block">
            <div class="filter-block-title"><Tag size={14} strokeWidth={2} /> Attributes</div>
            <label class="filter-field">
              <span>Repeats</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-recurrence" value={currentFilters.recurrence ?? 'all'} onchange={setRecurrenceFilter} aria-label="Open task recurrence">
                  <option value="all">All tasks</option>
                  <option value="with">Repeating</option>
                  <option value="without">Non-repeating</option>
                </select>
              </SelectShell>
            </label>
            <fieldset class="priority-filter">
              <legend>Priority</legend>
              {#each priorityOptions as priority}
                <label>
                  <input
                    type="checkbox"
                    name={`task-filter-priority-${priority}`}
                    checked={priorityFilters.includes(priority)}
                    onchange={(event) => togglePriority(priority, event)}
                  />
                  <span>{priority[0]!.toUpperCase() + priority.slice(1)}</span>
                </label>
              {/each}
            </fieldset>
            <label class="filter-field">
              <span>Tags</span>
              <input
                type="text"
                name="task-filter-tags"
                value={tagFilterInput}
                oninput={setTagsFilter}
                placeholder="work, writing"
                aria-label="Open task tags"
              />
            </label>
            <label class="filter-field">
              <span>Tag match</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-tag-mode" value={currentFilters.tagMode ?? 'any'} onchange={setTagMode} aria-label="Open task tag match">
                  <option value="any">Any tag</option>
                  <option value="all">All tags</option>
                </select>
              </SelectShell>
            </label>
          </div>

          <div class="filter-block">
            <div class="filter-block-title"><CalendarRange size={14} strokeWidth={2} /> Date</div>
            <label class="filter-field">
              <span>Field</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-date-field" value={currentFilters.dateField ?? 'smart'} onchange={setDateField} aria-label="Open task date field">
                  <option value="smart">Smart date</option>
                  <option value="createdAt">Created</option>
                  <option value="dueDate">Due</option>
                  <option value="scheduledDate">Scheduled</option>
                  <option value="completedAt">Completed</option>
                </select>
              </SelectShell>
            </label>
            <label class="filter-field">
              <span>Range</span>
              <SelectShell class="task-select-shell">
                <select name="task-filter-date-preset" value={currentFilters.datePreset ?? 'any'} onchange={setDatePreset} aria-label="Open task date range">
                  <option value="any">Any date</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7Days">Last 7 days</option>
                  <option value="last30Days">Last 30 days</option>
                  <option value="custom">Custom</option>
                </select>
              </SelectShell>
            </label>
            <div class="date-range-pair">
              <label class="filter-field">
                <span>From</span>
                <input
                  type="date"
                  name="task-filter-date-from"
                  value={currentFilters.dateFrom ?? ''}
                  onchange={(event) => setDateBound('dateFrom', event)}
                  aria-label="Open task date from"
                />
              </label>
              <label class="filter-field">
                <span>To</span>
                <input
                  type="date"
                  name="task-filter-date-to"
                  value={currentFilters.dateTo ?? ''}
                  onchange={(event) => setDateBound('dateTo', event)}
                  aria-label="Open task date to"
                />
              </label>
            </div>
          </div>
        </section>
      {/if}
    </div>

    {#if !todoStore.activeListPath && (todoStore.activeView === 'inbox' || todoStore.activeView === 'all') && hasSelectedOpenTodo()}
      <div class="triage-bar" aria-label="Inbox triage actions">
        <span>
          Triage selected
          <InfoPopover
            title="Triage selected"
            body="Triage quickly moves the selected task out of the Inbox and into a clearer place."
            items={[
              'Today schedules it for today.',
              'Anytime keeps it active without a date.',
              'Someday keeps it out of the active plan.',
            ]}
            align="start"
          />
        </span>
        <button type="button" onclick={moveSelectedToToday}>Today</button>
        <button type="button" onclick={() => moveSelectedToList('anytime')}>Anytime</button>
        <button type="button" onclick={() => moveSelectedToList('someday')}>Someday</button>
        <input type="date" name="triage-deadline" bind:value={triageDueDate} aria-label="Deadline" onchange={applySelectedDeadline} />
      </div>
    {/if}

    <div class="task-scroll" aria-live="polite">
      {#if todoStore.loading}
        <div class="state-line">Loading tasks...</div>
      {:else if todoStore.error}
        <div class="state-line error">
          <span>{todoStore.error.message}</span>
          <button type="button" onclick={() => todoStore.refresh()}>Retry</button>
        </div>
      {:else}
        {#if showOpenSurface}
          <section class="task-surface open-surface" aria-label="Open tasks">
            {#if openTodos.length === 0}
              <div class="empty-state">
                <h2>No open tasks</h2>
                <p>{todoStore.activeAdvancedFilterCount > 0 ? 'No open task matches your filters.' : 'This view is clear.'}</p>
              </div>
            {:else}
              {#each groupedOpenTodos as group (group.label)}
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
              {#if hasMoreOpenTodos}
                <button type="button" class="load-more" onclick={() => { openRenderLimit += 100; }}>
                  Show next {Math.min(100, openTodos.length - openRenderLimit)} open tasks
                </button>
              {/if}
            {/if}
          </section>
        {/if}

        {#if showCompletedSurface}
          <section class="completed-workbench" aria-label="Completed tasks">
            <div class="completed-heading">
              <div>
                <p class="section-kicker">Archive</p>
                <h2>Completed</h2>
              </div>
              <strong>{completedTodos.length}</strong>
            </div>

            <div class="surface-toolbar completed-toolbar" aria-label="Completed task controls">
              <div class="search-box">
                <Search size={15} strokeWidth={2} />
                <input
                  type="search"
                  name="completed-task-search"
                  placeholder="Search completed"
                  value={completedFilters.search ?? ''}
                  oninput={setCompletedSearchFilter}
                  aria-label="Search completed tasks"
                />
              </div>

              <label class="control-select compact-control">
                <span><ArrowDownWideNarrow size={14} strokeWidth={2} /> Sort</span>
                <SelectShell class="task-select-shell">
                  <select name="completed-task-sort-mode" value={completedPreference.sortMode} onchange={setCompletedSortMode} aria-label="Sort completed tasks">
                    <option value="completedNewest">Completed newest</option>
                    <option value="createdNewest">Created newest</option>
                    <option value="planningDateAsc">Planning date</option>
                    <option value="priority">Priority</option>
                    <option value="sourceOrder">Source order</option>
                    <option value="viewDefault">Default</option>
                  </select>
                </SelectShell>
              </label>

              <label class="control-select compact-control">
                <span><Layers size={14} strokeWidth={2} /> Group</span>
                <SelectShell class="task-select-shell">
                  <select name="completed-task-group-mode" value={completedPreference.groupMode} onchange={setCompletedGroupMode} aria-label="Group completed tasks">
                    <option value="completedDate">Completed date</option>
                    <option value="smartDate">Smart date</option>
                    <option value="createdDate">Created date</option>
                    <option value="planningDate">Planning date</option>
                    <option value="sourceFile">Source file</option>
                    <option value="priority">Priority</option>
                    <option value="tag">Tag</option>
                    <option value="none">None</option>
                    <option value="viewDefault">Default</option>
                  </select>
                </SelectShell>
              </label>

              <label class="control-select compact-control">
                <span><CalendarRange size={14} strokeWidth={2} /> Range</span>
                <SelectShell class="task-select-shell">
                  <select name="completed-task-date-preset" value={completedFilters.datePreset ?? 'any'} onchange={setCompletedDatePreset} aria-label="Completed task date range">
                    <option value="any">Any date</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last7Days">Last 7 days</option>
                    <option value="last30Days">Last 30 days</option>
                    <option value="custom">Custom</option>
                  </select>
                </SelectShell>
              </label>

              <div class="toolbar-actions">
                <button
                  type="button"
                  class="filter-toggle"
                  class:active={completedFiltersExpanded}
                  onclick={() => { completedFiltersExpanded = !completedFiltersExpanded; }}
                  aria-expanded={completedFiltersExpanded}
                  aria-controls="completed-task-advanced-filters"
                >
                  <SlidersHorizontal size={15} strokeWidth={2} />
                  <span>Filters</span>
                  {#if todoStore.activeCompletedFilterCount > 0}
                    <strong>{todoStore.activeCompletedFilterCount}</strong>
                  {/if}
                </button>

                <button
                  type="button"
                  class="reset-filters"
                  onclick={resetCompletedTaskPreferences}
                  disabled={!todoStore.hasCurrentCompletedWorkspacePreference}
                  title="Reset completed filters"
                  aria-label="Reset completed filters"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            {#if completedFiltersExpanded}
              <section id="completed-task-advanced-filters" class="advanced-filters completed-filters" aria-label="Completed task filters">
                <div class="filter-block">
                  <div class="filter-block-title"><Filter size={14} strokeWidth={2} /> Scope</div>
                  <label class="filter-field">
                    <span>Source</span>
                    <SelectShell class="task-select-shell">
                      <select name="completed-task-filter-source" value={completedFilters.source ?? 'all'} onchange={setCompletedSourceFilter} aria-label="Completed task source">
                        <option value="all">All sources</option>
                        <option value="dedicated">TODO.md</option>
                        <option value="inline">Inline notes</option>
                      </select>
                    </SelectShell>
                  </label>
                  <label class="filter-field">
                    <span>List</span>
                    <SelectShell class="task-select-shell">
                      <select name="completed-task-filter-list" value={completedFilters.list ?? 'all'} onchange={setCompletedListFilter} aria-label="Completed task list">
                        <option value="all">All lists</option>
                        <option value="inbox">Inbox</option>
                        <option value="anytime">Anytime</option>
                        <option value="someday">Someday</option>
                      </select>
                    </SelectShell>
                  </label>
                  <label class="filter-field">
                    <span>Repeats</span>
                    <SelectShell class="task-select-shell">
                      <select name="completed-task-filter-recurrence" value={completedFilters.recurrence ?? 'all'} onchange={setCompletedRecurrenceFilter} aria-label="Completed task recurrence">
                        <option value="all">All tasks</option>
                        <option value="with">Repeating</option>
                        <option value="without">Non-repeating</option>
                      </select>
                    </SelectShell>
                  </label>
                </div>

                <div class="filter-block">
                  <div class="filter-block-title"><Tag size={14} strokeWidth={2} /> Attributes</div>
                  <fieldset class="priority-filter">
                    <legend>Priority</legend>
                    {#each priorityOptions as priority}
                      <label>
                        <input
                          type="checkbox"
                          name={`completed-task-filter-priority-${priority}`}
                          checked={completedPriorityFilters.includes(priority)}
                          onchange={(event) => toggleCompletedPriority(priority, event)}
                        />
                        <span>{priority[0]!.toUpperCase() + priority.slice(1)}</span>
                      </label>
                    {/each}
                  </fieldset>
                  <label class="filter-field">
                    <span>Tags</span>
                    <input
                      type="text"
                      name="completed-task-filter-tags"
                      value={completedTagFilterInput}
                      oninput={setCompletedTagsFilter}
                      placeholder="work, writing"
                      aria-label="Completed task tags"
                    />
                  </label>
                  <label class="filter-field">
                    <span>Tag match</span>
                    <SelectShell class="task-select-shell">
                      <select name="completed-task-filter-tag-mode" value={completedFilters.tagMode ?? 'any'} onchange={setCompletedTagMode} aria-label="Completed task tag match">
                        <option value="any">Any tag</option>
                        <option value="all">All tags</option>
                      </select>
                    </SelectShell>
                  </label>
                </div>

                <div class="filter-block">
                  <div class="filter-block-title"><CalendarRange size={14} strokeWidth={2} /> Date</div>
                  <label class="filter-field">
                    <span>Field</span>
                    <SelectShell class="task-select-shell">
                      <select name="completed-task-filter-date-field" value={completedFilters.dateField ?? 'completedAt'} onchange={setCompletedDateField} aria-label="Completed task date field">
                        <option value="completedAt">Completed</option>
                        <option value="smart">Smart date</option>
                        <option value="createdAt">Created</option>
                        <option value="dueDate">Due</option>
                        <option value="scheduledDate">Scheduled</option>
                      </select>
                    </SelectShell>
                  </label>
                  <div class="date-range-pair">
                    <label class="filter-field">
                      <span>From</span>
                      <input
                        type="date"
                        name="completed-task-filter-date-from"
                        value={completedFilters.dateFrom ?? ''}
                        onchange={(event) => setCompletedDateBound('dateFrom', event)}
                        aria-label="Completed task date from"
                      />
                    </label>
                    <label class="filter-field">
                      <span>To</span>
                      <input
                        type="date"
                        name="completed-task-filter-date-to"
                        value={completedFilters.dateTo ?? ''}
                        onchange={(event) => setCompletedDateBound('dateTo', event)}
                        aria-label="Completed task date to"
                      />
                    </label>
                  </div>
                </div>
              </section>
            {/if}

            <div class="task-list completed-list">
              {#if completedTodos.length === 0}
                <div class="empty-state compact-empty">
                  <h2>No completed tasks</h2>
                  <p>{todoStore.activeCompletedFilterCount > 0 ? 'No completed task matches your filters.' : 'Nothing completed in this view yet.'}</p>
                </div>
              {:else}
                {#each groupedCompletedTodos as group (group.label)}
                  <section class="task-group completed-group" aria-label={group.label}>
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
                {#if hasMoreCompletedTodos}
                  <button type="button" class="load-more" onclick={() => { completedRenderLimit += 100; }}>
                    Show next {Math.min(100, completedTodos.length - completedRenderLimit)} completed tasks
                  </button>
                {/if}
              {/if}
            </div>
          </section>
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

  .task-command-center {
    display: grid;
    gap: 10px;
    padding: 16px 34px 14px;
    border-bottom: 1px solid var(--border-faint);
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

  .filter-toggle,
  .reset-filters {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 32px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
  }

  .filter-toggle:hover,
  .filter-toggle.active,
  .reset-filters:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .filter-toggle strong {
    min-width: 18px;
    border-radius: var(--radius-full);
    background: var(--accent-light);
    color: var(--accent-primary);
    padding: 1px 5px;
    text-align: center;
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .reset-filters {
    width: 34px;
    padding: 0;
  }

  .reset-filters:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
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

  .surface-toolbar {
    display: grid;
    grid-template-columns: auto minmax(180px, 1fr) minmax(132px, 160px) minmax(132px, 160px) auto;
    gap: 8px;
    align-items: end;
  }

  .completed-toolbar {
    grid-template-columns: minmax(180px, 1fr) minmax(132px, 160px) minmax(132px, 160px) minmax(132px, 160px) auto;
  }

  .surface-title {
    display: inline-flex;
    align-items: center;
    align-self: end;
    gap: 7px;
    min-height: 34px;
    color: var(--text-secondary);
    font-size: var(--text-small);
    font-weight: 600;
    white-space: nowrap;
  }

  .surface-title strong,
  .completed-heading > strong {
    min-width: 24px;
    border-radius: var(--radius-full);
    background: var(--bg-subtle);
    color: var(--text-tertiary);
    padding: 2px 7px;
    text-align: center;
    font-size: var(--text-caption);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .toolbar-actions {
    display: inline-flex;
    align-items: end;
    justify-content: flex-end;
    gap: 7px;
    min-width: max-content;
  }

  .control-select,
  .filter-field {
    min-width: 0;
    display: grid;
    gap: 5px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .control-select > span,
  .filter-field > span,
  .priority-filter legend {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  :global(.task-select-shell) {
    --select-bg: var(--bg-app);
    --select-hover-bg: var(--bg-card);
    --select-min-height: 34px;
    --select-padding-x: 9px;
    --select-padding-y: 7px;
    width: 100%;
  }

  .compact-control {
    gap: 4px;
  }

  .control-select select,
  .filter-field select,
  .filter-field input,
  .priority-filter {
    min-width: 0;
    min-height: 34px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background-color: var(--bg-app);
    color: var(--text-primary);
    padding: 7px 9px;
    font: inherit;
    font-size: var(--text-small);
  }

  .control-select select,
  .filter-field select {
    padding-right: 34px;
  }

  .control-select select:focus,
  .filter-field select:focus {
    outline: none;
  }

  .filter-field input:focus {
    outline: 2px solid var(--accent-primary);
    outline-offset: 0;
  }

  .advanced-filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    padding: 0;
    overflow: hidden;
  }

  .filter-block {
    display: grid;
    align-content: start;
    gap: 9px;
    min-width: 0;
    padding: 12px;
  }

  .filter-block + .filter-block {
    border-left: 1px solid var(--border-faint);
  }

  .filter-block-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .date-range-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .priority-filter {
    display: flex;
    align-items: end;
    gap: 9px;
    margin: 0;
  }

  .priority-filter legend {
    padding: 0;
  }

  .priority-filter label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 22px;
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 500;
    white-space: nowrap;
  }

  .priority-filter input {
    width: 14px;
    height: 14px;
    accent-color: var(--accent-primary);
  }

  .capture-bar {
    display: grid;
    grid-template-columns: 18px minmax(180px, 1fr) 142px 112px auto;
    gap: 8px;
    align-items: center;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    padding: 8px 8px 8px 12px;
    color: var(--text-tertiary);
  }

  .capture-bar input,
  .capture-bar :global(.task-capture-select-shell) {
    min-width: 0;
    border: 0;
    border-left: 1px solid var(--border-faint);
    background-color: transparent;
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }

  .capture-bar input {
    padding: 6px 8px;
  }

  .capture-bar :global(.task-capture-select-shell) {
    --select-bg: transparent;
    --select-border: transparent;
    --select-hover-bg: transparent;
    --select-hover-border: transparent;
    --select-min-height: 30px;
    --select-padding-x: 8px;
    --select-padding-y: 6px;
    --select-radius: var(--radius-sm);
    --select-shadow: none;
    width: 100%;
  }

  .capture-bar select {
    border: 0;
    background-color: transparent;
    color: var(--text-primary);
    font: inherit;
    outline: none;
    padding: 6px 30px 6px 8px;
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
    margin: 12px 34px 0;
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

  .task-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 18px 34px 34px;
  }

  .task-surface {
    min-width: 0;
  }

  .completed-workbench {
    display: grid;
    gap: 12px;
    margin-top: 22px;
    border-top: 1px solid var(--border-light);
    padding-top: 18px;
  }

  .open-surface + .completed-workbench {
    margin-top: 28px;
  }

  .completed-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .completed-heading h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-h3);
    font-weight: 600;
  }

  .section-kicker {
    margin: 0 0 3px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
  }

  .task-list {
    min-width: 0;
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

  .compact-empty {
    min-height: 180px;
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
    .surface-toolbar,
    .completed-toolbar {
      grid-template-columns: minmax(0, 1fr) minmax(132px, 160px) minmax(132px, 160px) auto;
    }

    .surface-title {
      grid-column: 1 / -1;
      min-height: 24px;
    }

    .advanced-filters {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .capture-bar {
      grid-template-columns: 18px minmax(0, 1fr) auto;
    }

    .capture-bar input[name='task-capture-due'],
    .capture-bar :global(.task-capture-select-shell) {
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

    .completed-toggle {
      min-height: 28px;
    }

    .task-command-center {
      padding: 12px 18px;
    }

    .capture-bar {
      grid-template-columns: 18px minmax(0, 1fr);
    }

    .surface-toolbar,
    .completed-toolbar {
      grid-template-columns: 1fr;
      align-items: stretch;
    }

    .surface-title {
      grid-column: auto;
    }

    .toolbar-actions {
      justify-content: flex-start;
      flex-wrap: wrap;
      min-width: 0;
    }

    .advanced-filters {
      grid-template-columns: 1fr;
    }

    .filter-block + .filter-block {
      border-left: 0;
      border-top: 1px solid var(--border-faint);
    }

    .date-range-pair {
      grid-template-columns: 1fr;
    }

    .triage-bar {
      flex-wrap: wrap;
      margin: 12px 18px 0;
    }

    .capture-bar input,
    .capture-bar :global(.task-capture-select-shell),
    .capture-bar button {
      grid-column: 2;
      border-left: 0;
    }

    .task-scroll {
      padding: 16px 18px 24px;
    }
  }
</style>
