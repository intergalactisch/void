<script lang="ts">
  import {
    Archive,
    ArrowLeft,
    ArrowDownWideNarrow,
    CalendarDays,
    CalendarRange,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock3,
    Edit3,
    Inbox,
    Layers,
    ListChecks,
    MoreHorizontal,
    Plus,
    Repeat,
    RotateCcw,
    Search,
    SlidersHorizontal,
    StickyNote,
    Tag,
    Trash2,
    X,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { tick } from 'svelte';
  import type { CreateTodoOptions, TodoListFile } from '$lib/ports/inbound';
  import type { Todo } from '$lib/domain/entities/Todo';
  import type { TodoId } from '$lib/domain/values/TodoId';
  import type { TodoList } from '$lib/domain/values/TodoView';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import {
    getTodoViewLabel,
    todoStore,
    type TodoDateFilterField,
    type TodoDateFilterPreset,
    type TodoGroupMode,
    type TodoSortMode,
    type TodoView,
  } from '$lib/stores/todo.svelte';
  import { InfoPopover, SelectShell, VirtualList } from '$lib/components/shared';
  import TodoInspector from './TodoInspector.svelte';
  import TodoTaskRow from './TodoTaskRow.svelte';

  interface Props {
    onClose?: () => void;
    onNavigateToFile?: (filePath: string) => void;
  }

  let { onClose, onNavigateToFile }: Props = $props();

  // ─── Public methods (contract preserved) ─────────────────────────────────
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

  export function handleEscape(): boolean {
    if (openPopover) {
      openPopover = null;
      return true;
    }
    if (inspectorPeekOpen) {
      inspectorPeekOpen = false;
      return true;
    }
    if (selectionSet.size > 0) {
      clearSelection();
      return true;
    }
    if (todoStore.selectedTodoId) {
      todoStore.selectTodo(null);
      return true;
    }
    return false;
  }

  // ─── Local state ────────────────────────────────────────────────────────
  let capture = $state('');
  let captureExpanded = $state(false);
  let captureDueDate = $state('');
  let capturePriority = $state<'none' | TodoPriority>('none');
  let captureInput = $state<HTMLInputElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let listRegion = $state<HTMLElement | null>(null);

  /** Density preset for task rows. Persisted to localStorage. */
  let density = $state<'compact' | 'comfortable'>(loadDensity());

  /** Which surface is showing in the main pane. `showCompleted` in the store still drives data. */
  let activeTab = $state<'open' | 'completed'>(initialTab());

  /** Open / close state for popovers and overlays. */
  let openPopover = $state<'sort' | 'group' | 'filter' | 'more' | null>(null);
  let inspectorPeekOpen = $state(false);
  let viewportIsNarrow = $state(false);

  /** Collapsed group keys per tab. Local UI state, not persisted. */
  let collapsedOpenGroups = $state<Set<string>>(new Set());
  let collapsedCompletedGroups = $state<Set<string>>(new Set());

  /** Multi-selection for bulk operations. */
  let selectionSet = $state<Set<TodoId>>(new Set());
  let lastClickedId = $state<TodoId | null>(null);

  /** List CRUD dialog state. */
  let listDialogMode = $state<'create' | 'edit' | null>(null);
  let listDialogPath = $state<string | null>(null);
  let listDraftTitle = $state('');
  let listDraftNote = $state('');
  let listTitleInput = $state<HTMLInputElement | null>(null);
  let deleteListTarget = $state<TodoListFile | null>(null);

  // ─── Navigation taxonomy (left rail) ────────────────────────────────────
  const navSections: Array<{ label: string; views: TodoView[] }> = [
    { label: 'Plan', views: ['inbox', 'today', 'upcoming', 'anytime', 'someday'] },
    { label: 'Library', views: ['all', 'notes', 'tags'] },
    { label: 'Archive', views: ['logbook'] },
  ];
  const priorityOptions: TodoPriority[] = ['high', 'medium', 'low'];

  // ─── Derived: data & meta ───────────────────────────────────────────────
  const isLogbook = $derived(todoStore.activeView === 'logbook');
  const openTodos = $derived(todoStore.visibleOpenTodos);
  const completedTodos = $derived(todoStore.visibleCompletedTodos);
  const openGroups = $derived(todoStore.getOpenGroupsForTodos(openTodos));
  const completedGroups = $derived(todoStore.getCompletedGroupsForTodos(completedTodos));
  const currentPreference = $derived(todoStore.currentWorkspacePreference);
  const currentFilters = $derived(currentPreference.filters);
  const completedPreference = $derived(todoStore.currentCompletedWorkspacePreference);
  const completedFilters = $derived(completedPreference.filters);

  /** The active tab's filters + preference (single source for rail + popovers). */
  const tabFilters = $derived(activeTab === 'completed' ? completedFilters : currentFilters);
  const tabPreference = $derived(activeTab === 'completed' ? completedPreference : currentPreference);
  const tabFilterCount = $derived(
    activeTab === 'completed' ? todoStore.activeCompletedFilterCount : todoStore.activeAdvancedFilterCount,
  );
  const hasCustomPreference = $derived(
    activeTab === 'completed' ? todoStore.hasCurrentCompletedWorkspacePreference : todoStore.hasCurrentWorkspacePreference,
  );

  /** Flatten { groups → rows } into a single list for VirtualList. Honors collapse state. */
  type Entry =
    | { kind: 'header'; key: string; label: string; count: number; collapsed: boolean }
    | { kind: 'row'; key: string; todo: Todo };

  const collapsedGroups = $derived(activeTab === 'completed' ? collapsedCompletedGroups : collapsedOpenGroups);

  const entries = $derived.by<Entry[]>(() => {
    const groups = activeTab === 'completed' ? completedGroups : openGroups;
    const out: Entry[] = [];
    for (const group of groups) {
      const collapsed = collapsedGroups.has(group.label);
      out.push({ kind: 'header', key: `h:${group.label}`, label: group.label, count: group.todos.length, collapsed });
      if (collapsed) continue;
      for (const todo of group.todos) {
        out.push({ kind: 'row', key: `r:${todo.id}`, todo });
      }
    }
    return out;
  });

  const activeListsCount = $derived(todoStore.todoLists.length);
  const selectionCount = $derived(selectionSet.size);
  const hasMultiSelection = $derived(selectionCount > 0);

  // ─── Initialization ────────────────────────────────────────────────────
  onMount(() => {
    const media = window.matchMedia('(max-width: 1279px)');
    viewportIsNarrow = media.matches;
    const onMedia = (event: MediaQueryListEvent) => {
      viewportIsNarrow = event.matches;
      if (!event.matches) inspectorPeekOpen = false;
    };
    media.addEventListener('change', onMedia);

    // Honor the store's current showCompleted when bootstrapping the tab.
    if (isLogbook) {
      activeTab = 'completed';
      todoStore.setShowCompleted(true);
    } else if (todoStore.showCompleted) {
      activeTab = 'completed';
    }

    return () => media.removeEventListener('change', onMedia);
  });

  // When the underlying view changes (e.g. user clicks Logbook in nav), keep the tab honest.
  $effect(() => {
    if (isLogbook && activeTab !== 'completed') {
      activeTab = 'completed';
      todoStore.setShowCompleted(true);
    }
  });

  // When a task is selected on a narrow screen, surface the inspector as a peek.
  $effect(() => {
    if (viewportIsNarrow && todoStore.selectedTodoId) inspectorPeekOpen = true;
    if (!todoStore.selectedTodoId) inspectorPeekOpen = false;
  });

  // ─── Density persistence (presentation only — localStorage) ─────────────
  function loadDensity(): 'compact' | 'comfortable' {
    if (typeof localStorage === 'undefined') return 'compact';
    const stored = localStorage.getItem('void.todoRowDensity');
    return stored === 'comfortable' ? 'comfortable' : 'compact';
  }

  function saveDensity(value: 'compact' | 'comfortable') {
    density = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('void.todoRowDensity', value);
  }

  const rowHeight = $derived(density === 'compact' ? 32 : 40);

  function initialTab(): 'open' | 'completed' {
    if (typeof todoStore.activeView !== 'undefined' && todoStore.activeView === 'logbook') return 'completed';
    return todoStore.showCompleted ? 'completed' : 'open';
  }

  // ─── Capture / quick add ───────────────────────────────────────────────
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
    captureExpanded = false;
  }

  function getCaptureTargetList(view: TodoView): TodoList | undefined {
    if (view === 'all') return 'inbox';
    if (view === 'inbox' || view === 'anytime' || view === 'someday') return view;
    return undefined;
  }

  function getCapturePlaceholder(): string {
    const activeList = todoStore.activeTodoList;
    if (activeList) return `Add to ${activeList.title}`;
    switch (todoStore.activeView) {
      case 'today':
        return 'Add a task for today';
      case 'upcoming':
        return 'Add task with a date';
      case 'anytime':
        return 'Add anytime task';
      case 'someday':
        return 'Add someday task';
      case 'logbook':
      case 'notes':
        return 'Capture to Inbox';
      case 'tags':
        return 'Add task with #tag';
      case 'inbox':
        return 'Add to Inbox';
      default:
        return 'Add task — e.g. Review PR tomorrow p1 #work';
    }
  }

  // ─── View / list switching ─────────────────────────────────────────────
  function setView(view: TodoView) {
    todoStore.setView(view);
    resetTransient();
    if (view === 'logbook') {
      activeTab = 'completed';
      todoStore.setShowCompleted(true);
    } else if (activeTab === 'completed' && !todoStore.showCompleted) {
      todoStore.setShowCompleted(true);
    }
  }

  function setActiveList(path: string) {
    todoStore.setActiveList(path);
    resetTransient();
  }

  function navigateToFile(filePath: string) {
    onNavigateToFile?.(filePath);
  }

  function resetTransient() {
    selectionSet = new Set();
    lastClickedId = null;
    openPopover = null;
  }

  function getWorkspaceTitle(): string {
    return todoStore.activeTodoList?.title ?? getTodoViewLabel(todoStore.activeView);
  }

  function getWorkspaceContext(): string {
    const activeList = todoStore.activeTodoList;
    if (activeList) return activeList.note || `Tasks stored in ${getFileName(activeList.path)}`;
    return getViewDescription(todoStore.activeView);
  }

  function getViewDescription(view: TodoView): string {
    switch (view) {
      case 'all':
        return 'Everything actionable across TODO.md and note checkboxes';
      case 'inbox':
        return 'Unprocessed tasks waiting for a date, list, or context';
      case 'today':
        return 'Overdue and scheduled work ready before the day ends';
      case 'upcoming':
        return 'Future dates grouped into the next week and later';
      case 'anytime':
        return 'Active tasks you can start now, including open deadlines';
      case 'someday':
        return 'Maybe-later work kept out of the active plan';
      case 'notes':
        return 'Markdown checkboxes living inside notes';
      case 'tags':
        return 'Tagged tasks grouped by their first tag';
      case 'logbook':
        return 'Completed tasks kept as a reference trail';
    }
  }

  // ─── Tab switching ──────────────────────────────────────────────────────
  function setTab(tab: 'open' | 'completed') {
    if (activeTab === tab) return;
    activeTab = tab;
    resetTransient();
    if (tab === 'completed') {
      todoStore.setShowCompleted(true);
    } else {
      // In non-logbook views, switching to Open hides completed for cleanliness.
      if (!isLogbook) todoStore.setShowCompleted(false);
    }
    listRegion?.scrollTo({ top: 0 });
  }

  // ─── Group collapse ────────────────────────────────────────────────────
  function toggleGroup(label: string) {
    const target = activeTab === 'completed' ? collapsedCompletedGroups : collapsedOpenGroups;
    const next = new Set(target);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    if (activeTab === 'completed') collapsedCompletedGroups = next;
    else collapsedOpenGroups = next;
  }

  // ─── Sort / group / filter mutations ────────────────────────────────────
  async function setSort(mode: TodoSortMode) {
    if (activeTab === 'completed') await todoStore.setCompletedSortMode(mode);
    else await todoStore.setSortMode(mode);
    openPopover = null;
  }

  async function setGroup(mode: TodoGroupMode) {
    if (activeTab === 'completed') await todoStore.setCompletedGroupMode(mode);
    else await todoStore.setGroupMode(mode);
    openPopover = null;
  }

  async function setFilter<K extends keyof typeof currentFilters>(key: K, value: (typeof currentFilters)[K]) {
    if (activeTab === 'completed') await todoStore.setCompletedAdvancedFilter(key, value as never);
    else await todoStore.setAdvancedFilter(key, value as never);
  }

  async function updateFilters(patch: Partial<typeof currentFilters>) {
    if (activeTab === 'completed') await todoStore.updateCompletedAdvancedFilters(patch);
    else await todoStore.updateAdvancedFilters(patch);
  }

  async function resetPreferences() {
    if (activeTab === 'completed') await todoStore.resetCurrentCompletedWorkspacePreference();
    else await todoStore.resetCurrentWorkspacePreference();
  }

  async function setSearch(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    await setFilter('search', value);
  }

  async function togglePriorityFilter(priority: TodoPriority, event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const current = tabFilters.priority ?? [];
    const next = checked ? Array.from(new Set([...current, priority])) : current.filter((p) => p !== priority);
    await setFilter('priority', next);
  }

  async function setTagsFilter(event: Event) {
    const tags = (event.currentTarget as HTMLInputElement).value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    await setFilter('tags', Array.from(new Set(tags)));
  }

  function tagFilterInput(): string {
    return (tabFilters.tags ?? []).join(', ');
  }

  // ─── Selection / multi-select ──────────────────────────────────────────
  function handleRowSelect(todo: Todo, event: MouseEvent | KeyboardEvent | undefined) {
    const shift = !!event && 'shiftKey' in event && event.shiftKey;
    const meta = !!event && (('metaKey' in event && event.metaKey) || ('ctrlKey' in event && event.ctrlKey));

    if (shift && lastClickedId) {
      const ids = visibleRowIds();
      const start = ids.indexOf(lastClickedId);
      const end = ids.indexOf(todo.id);
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        const next = new Set(selectionSet);
        for (let i = lo; i <= hi; i++) next.add(ids[i]!);
        selectionSet = next;
        return;
      }
    }

    if (meta) {
      const next = new Set(selectionSet);
      if (next.has(todo.id)) next.delete(todo.id);
      else next.add(todo.id);
      selectionSet = next;
      lastClickedId = todo.id;
      return;
    }

    // Plain click: focus the inspector on this todo, do not start multi-selection.
    selectionSet = new Set();
    lastClickedId = todo.id;
    todoStore.selectTodo(todo.id);
  }

  function visibleRowIds(): TodoId[] {
    return entries.filter((entry): entry is Extract<Entry, { kind: 'row' }> => entry.kind === 'row').map((entry) => entry.todo.id);
  }

  function clearSelection() {
    selectionSet = new Set();
    lastClickedId = null;
  }

  async function bulkComplete() {
    const ids = Array.from(selectionSet);
    for (const id of ids) {
      const todo = todoStore.todos.find((t) => t.id === id);
      if (!todo || todo.isCompleted) continue;
      await todoStore.toggle(id);
    }
    clearSelection();
  }

  async function bulkMoveTo(target: TodoList | 'today') {
    const ids = Array.from(selectionSet);
    for (const id of ids) {
      if (target === 'today') {
        await todoStore.updatePatch(id, { scheduledDate: startOfToday(), targetList: 'anytime' });
      } else {
        await todoStore.updatePatch(id, { dueDate: null, scheduledDate: null, targetList: target });
      }
    }
    clearSelection();
  }

  async function bulkSetDeadline(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (!value) return;
    const ids = Array.from(selectionSet);
    for (const id of ids) {
      await todoStore.updatePatch(id, { dueDate: parseDateInput(value), targetList: 'anytime' });
    }
    clearSelection();
  }

  async function bulkDelete() {
    const ids = Array.from(selectionSet);
    for (const id of ids) {
      await todoStore.delete(id);
    }
    clearSelection();
  }

  // ─── Keyboard shortcuts (workspace-scoped) ──────────────────────────────
  function onKeydown(event: KeyboardEvent) {
    if (listDialogMode || deleteListTarget) return;
    if (isFormFieldTarget(event.target)) {
      if (event.key === 'Escape' && (event.target as HTMLElement)?.tagName === 'INPUT') {
        (event.target as HTMLInputElement).blur();
      }
      return;
    }

    const meta = event.metaKey || event.ctrlKey;
    if (event.key === '/' || (meta && event.key.toLowerCase() === 'f')) {
      event.preventDefault();
      focusSearch();
      return;
    }
    if (event.key === 'n' && !meta) {
      event.preventDefault();
      focusCapture();
      return;
    }
    if (event.key === 'Escape') {
      if (handleEscape()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      const todo = todoStore.selectedTodo;
      if (!todo) return;
      if (event.key === ' ') {
        event.preventDefault();
        todoStore.toggle(todo.id);
      }
    }
    if (event.key.toLowerCase() === 'x') {
      const todo = todoStore.selectedTodo;
      if (!todo) return;
      const next = new Set(selectionSet);
      if (next.has(todo.id)) next.delete(todo.id);
      else next.add(todo.id);
      selectionSet = next;
      lastClickedId = todo.id;
    }
    if (event.key.toLowerCase() === 's' && !meta) {
      event.preventDefault();
      openPopover = openPopover === 'sort' ? null : 'sort';
    }
    if (event.key.toLowerCase() === 'g' && !meta) {
      event.preventDefault();
      openPopover = openPopover === 'group' ? null : 'group';
    }
    if (event.key.toLowerCase() === 'f' && !meta) {
      event.preventDefault();
      openPopover = openPopover === 'filter' ? null : 'filter';
    }
  }

  function isFormFieldTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
  }

  function moveSelection(direction: 1 | -1) {
    const ids = visibleRowIds();
    if (ids.length === 0) return;
    const current = todoStore.selectedTodoId;
    let nextIndex = direction > 0 ? 0 : ids.length - 1;
    if (current) {
      const idx = ids.indexOf(current);
      if (idx !== -1) nextIndex = Math.min(Math.max(idx + direction, 0), ids.length - 1);
    }
    const nextId = ids[nextIndex];
    if (nextId) {
      todoStore.selectTodo(nextId);
      scrollSelectedIntoView();
    }
  }

  async function scrollSelectedIntoView() {
    await tick();
    const el = listRegion?.querySelector<HTMLElement>(`[data-todo-id="${todoStore.selectedTodoId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  // ─── List dialog ────────────────────────────────────────────────────────
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
      await todoStore.updateTodoList(listDialogPath, { title, note: listDraftNote });
    } else {
      await todoStore.createTodoList({ title, note: listDraftNote });
    }

    if (!todoStore.error) closeListDialog();
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

  // ─── Utilities ──────────────────────────────────────────────────────────
  function parseDateInput(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year!, month! - 1, day);
  }

  function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? path;
  }

  function getViewCount(view: TodoView): number {
    return todoStore.views.find((item) => item.id === view)?.count ?? 0;
  }

  function priorityLabel(p: TodoPriority): string {
    return p[0]!.toUpperCase() + p.slice(1);
  }

  function listLabel(list: TodoList): string {
    return list[0]!.toUpperCase() + list.slice(1);
  }

  function sortLabel(mode: TodoSortMode): string {
    const map: Record<TodoSortMode, string> = {
      viewDefault: 'Default',
      completedNewest: 'Completed newest',
      createdNewest: 'Created newest',
      planningDateAsc: 'Planning date',
      priority: 'Priority',
      sourceOrder: 'Source order',
    };
    return map[mode] ?? mode;
  }

  function groupLabel(mode: TodoGroupMode): string {
    const map: Record<TodoGroupMode, string> = {
      viewDefault: 'Default',
      smartDate: 'Smart date',
      completedDate: 'Completed date',
      createdDate: 'Created date',
      planningDate: 'Planning date',
      sourceFile: 'Source file',
      priority: 'Priority',
      tag: 'Tag',
      none: 'None',
    };
    return map[mode] ?? mode;
  }

  function dateFieldLabel(field: TodoDateFilterField): string {
    return ({ smart: 'Smart date', createdAt: 'Created', dueDate: 'Due', scheduledDate: 'Scheduled', completedAt: 'Completed' } as const)[field];
  }

  function datePresetLabel(preset: TodoDateFilterPreset): string {
    return ({ any: 'Any date', today: 'Today', yesterday: 'Yesterday', last7Days: 'Last 7 days', last30Days: 'Last 30 days', custom: 'Custom' } as const)[preset];
  }

  // ─── Active filter chip list (for the rail) ─────────────────────────────
  type Chip = { id: string; label: string; clear: () => void | Promise<void> };

  const filterChips = $derived.by<Chip[]>(() => {
    const chips: Chip[] = [];
    const f = tabFilters;
    if (f.search && f.search.trim() !== '') {
      chips.push({ id: 'search', label: `“${f.search}”`, clear: () => setFilter('search', '') });
    }
    if (f.source && f.source !== 'all') {
      chips.push({
        id: 'source',
        label: f.source === 'dedicated' ? 'TODO.md' : 'Inline notes',
        clear: () => setFilter('source', 'all'),
      });
    }
    if (f.list && f.list !== 'all') {
      chips.push({ id: 'list', label: `List · ${listLabel(f.list as TodoList)}`, clear: () => setFilter('list', 'all') });
    }
    for (const p of f.priority ?? []) {
      chips.push({ id: `prio:${p}`, label: `Priority · ${priorityLabel(p)}`, clear: () => togglePriorityFilter(p, fakeUncheckEvent()) });
    }
    if ((f.tags ?? []).length > 0) {
      chips.push({
        id: 'tags',
        label: `Tag · ${(f.tags ?? []).map((t) => `#${t}`).join((f.tagMode ?? 'any') === 'all' ? ' + ' : ' / ')}`,
        clear: () => setFilter('tags', []),
      });
    }
    if (f.recurrence && f.recurrence !== 'all') {
      chips.push({ id: 'recurrence', label: f.recurrence === 'with' ? 'Repeating' : 'Non-repeating', clear: () => setFilter('recurrence', 'all') });
    }
    const preset = f.datePreset ?? 'any';
    const hasDateRange = preset !== 'any' || (f.dateFrom ?? '') || (f.dateTo ?? '');
    if (hasDateRange) {
      const field = dateFieldLabel((f.dateField ?? 'smart') as TodoDateFilterField);
      const range = preset === 'custom' ? `${f.dateFrom || '…'} → ${f.dateTo || '…'}` : datePresetLabel(preset as TodoDateFilterPreset);
      chips.push({ id: 'date', label: `${field} · ${range}`, clear: () => updateFilters({ datePreset: 'any', dateFrom: '', dateTo: '' }) });
    }
    // Status chip only in the open tab (completed tab is implicitly status=completed).
    if (activeTab === 'open' && f.status && f.status !== 'all') {
      chips.push({ id: 'status', label: f.status === 'open' ? 'Open only' : 'Completed only', clear: () => setFilter('status', 'all') });
    }
    return chips;
  });

  function fakeUncheckEvent(): Event {
    return { currentTarget: { checked: false } } as unknown as Event;
  }

  function getSortMode(): TodoSortMode {
    return tabPreference.sortMode;
  }

  function getGroupMode(): TodoGroupMode {
    return tabPreference.groupMode;
  }

  /** Whether the source link is meaningful in a row context.
   *  In Notes / All / Tags the row spans many files, so the link is the point.
   *  In single-file views (TODO.md lists, Inbox/Today/etc.) it's redundant. */
  const showSourceInRow = $derived(
    todoStore.activeListPath === null && (todoStore.activeView === 'all' || todoStore.activeView === 'notes' || todoStore.activeView === 'tags'),
  );
</script>

<svelte:window onkeydown={onKeydown} />

<section class="tasks-workspace" class:has-dock-inspector={!viewportIsNarrow && todoStore.selectedTodoId} aria-label="Tasks workspace">
  <!-- ═══════════ NAV ═══════════ -->
  <nav class="task-nav" aria-label="Task views">
    <div class="nav-title">
      <div class="nav-brand">
        <ListChecks size={16} strokeWidth={2} />
        <span>Tasks</span>
        <InfoPopover
          title="Task views"
          body="Task views are lenses over the same markdown-backed tasks; moving between views does not duplicate the task."
          items={['Inbox is for unprocessed tasks.', 'Today and Upcoming are date-based.', 'Notes and Tags show tasks by their source.']}
          align="start"
        />
      </div>
      <button type="button" class="nav-return" onclick={() => onClose?.()} title="Back to notes (⌘[)" aria-label="Back to notes">
        <ArrowLeft size={14} strokeWidth={2} />
        <span>Notes</span>
      </button>
    </div>

    <div class="nav-body scrollbar-thin">
      {#each navSections as section (section.label)}
        <section class="nav-section" aria-label={section.label}>
          <div class="nav-section-label">{section.label}</div>
          <div role="list" class="nav-items">
            {#each section.views as view (view)}
              {@const active = todoStore.activeListPath === null && todoStore.activeView === view}
              {@const count = getViewCount(view)}
              <button
                type="button"
                class="nav-item"
                class:active
                aria-current={active ? 'page' : undefined}
                onclick={() => setView(view)}
              >
                <span class="nav-icon" aria-hidden="true">
                  {#if view === 'all'}<ListChecks size={14} strokeWidth={2} />
                  {:else if view === 'inbox'}<Inbox size={14} strokeWidth={2} />
                  {:else if view === 'today'}<CalendarDays size={14} strokeWidth={2} />
                  {:else if view === 'upcoming'}<ChevronRight size={14} strokeWidth={2} />
                  {:else if view === 'anytime'}<Layers size={14} strokeWidth={2} />
                  {:else if view === 'someday'}<Clock3 size={14} strokeWidth={2} />
                  {:else if view === 'notes'}<StickyNote size={14} strokeWidth={2} />
                  {:else if view === 'tags'}<Tag size={14} strokeWidth={2} />
                  {:else}<Archive size={14} strokeWidth={2} />
                  {/if}
                </span>
                <span class="nav-label">{getTodoViewLabel(view)}</span>
                {#if count > 0}<span class="nav-count">{count}</span>{/if}
              </button>
            {/each}
          </div>
        </section>
        {#if section.label === 'Plan'}
          <section class="nav-section" aria-label="Todo lists">
            <div class="nav-section-heading">
              <div class="nav-section-label">Lists{activeListsCount > 0 ? ` · ${activeListsCount}` : ''}</div>
              <button type="button" class="nav-add" onclick={openCreateListDialog} title="New list" aria-label="New list">
                <Plus size={13} strokeWidth={2.2} />
              </button>
            </div>
            <div role="list" class="nav-items">
              {#each todoStore.todoLists as list (list.path)}
                {@const active = todoStore.activeListPath === list.path}
                {@const count = todoStore.getTodoListCount(list.path)}
                <div class="nav-list-row" class:active>
                  <button
                    type="button"
                    class="nav-item nav-item-list"
                    aria-current={active ? 'page' : undefined}
                    onclick={() => setActiveList(list.path)}
                  >
                    <span class="nav-icon" aria-hidden="true"><ListChecks size={14} strokeWidth={2} /></span>
                    <span class="nav-label">{list.title}</span>
                    {#if count > 0}<span class="nav-count">{count}</span>{/if}
                  </button>
                  <div class="nav-list-actions">
                    <button type="button" onclick={(e) => openEditListDialog(list, e)} title="Edit list" aria-label={`Edit ${list.title}`}>
                      <Edit3 size={12} strokeWidth={2} />
                    </button>
                    <button type="button" class="danger" onclick={(e) => requestDeleteList(list, e)} title="Delete list" aria-label={`Delete ${list.title}`}>
                      <Trash2 size={12} strokeWidth={2} />
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

  <!-- ═══════════ MAIN ═══════════ -->
  <main class="task-main">
    <!-- ── Command bar: title · stats · capture ── -->
    <header class="command-bar">
      <div class="title-block">
        <h1 class="title">{getWorkspaceTitle()}</h1>
        <p class="context">{getWorkspaceContext()}</p>
      </div>

      <div class="stat-cluster" aria-label="Counts">
        <span class="stat" title="Open tasks">
          <strong class="tabular-nums">{todoStore.stats.open}</strong><span>open</span>
        </span>
        <span class="stat" class:warn={todoStore.stats.dueToday > 0} title="Due today">
          <strong class="tabular-nums">{todoStore.stats.dueToday}</strong><span>today</span>
        </span>
        <span class="stat" class:error={todoStore.stats.overdue > 0} title="Overdue">
          <strong class="tabular-nums">{todoStore.stats.overdue}</strong><span>overdue</span>
        </span>
      </div>

      <form class="capture" class:expanded={captureExpanded || capture.length > 0} onsubmit={createTask}>
        <Plus size={15} strokeWidth={2.2} />
        <input
          bind:this={captureInput}
          type="text"
          name="task-capture"
          placeholder={getCapturePlaceholder()}
          bind:value={capture}
          aria-label="Add a task"
          onfocus={() => { captureExpanded = true; }}
          onblur={() => { if (!capture && !captureDueDate && capturePriority === 'none') captureExpanded = false; }}
        />
        {#if captureExpanded}
          <input type="date" name="task-capture-due" bind:value={captureDueDate} aria-label="Due date" class="capture-date" />
          <SelectShell class="capture-prio-shell">
            <select name="task-capture-priority" bind:value={capturePriority} aria-label="Priority">
              <option value="none">Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </SelectShell>
        {/if}
        <button type="submit" class="capture-submit" disabled={!capture.trim()}>Add</button>
      </form>
    </header>

    <!-- ── Tab strip + filter rail ── -->
    <div class="rail">
      <div class="tabs" role="tablist" aria-label="Task surface">
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={activeTab === 'open'}
          aria-selected={activeTab === 'open'}
          onclick={() => setTab('open')}
          disabled={isLogbook}
          title={isLogbook ? 'Logbook is the completed-only view' : 'Open tasks'}
        >
          <span>Open</span>
          <span class="tab-count tabular-nums">{openTodos.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={activeTab === 'completed'}
          aria-selected={activeTab === 'completed'}
          onclick={() => setTab('completed')}
        >
          <span>Completed</span>
          <span class="tab-count tabular-nums">{completedTodos.length}</span>
        </button>
      </div>

      <div class="search-cluster">
        <div class="search-shell">
          <Search size={14} strokeWidth={2} />
          <input
            bind:this={searchInput}
            type="search"
            name="task-search"
            placeholder={activeTab === 'completed' ? 'Search completed' : 'Search open tasks'}
            value={tabFilters.search ?? ''}
            oninput={setSearch}
            aria-label="Search"
          />
          <span class="kbd-hint" aria-hidden="true">/</span>
        </div>

        <button
          type="button"
          class="rail-button"
          class:active={openPopover === 'sort'}
          aria-haspopup="menu"
          aria-expanded={openPopover === 'sort'}
          onclick={(e) => { e.stopPropagation(); openPopover = openPopover === 'sort' ? null : 'sort'; }}
          title="Sort (s)"
        >
          <ArrowDownWideNarrow size={13} strokeWidth={2} />
          <span class="rail-button-label">{sortLabel(getSortMode())}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>

        <button
          type="button"
          class="rail-button"
          class:active={openPopover === 'group'}
          aria-haspopup="menu"
          aria-expanded={openPopover === 'group'}
          onclick={(e) => { e.stopPropagation(); openPopover = openPopover === 'group' ? null : 'group'; }}
          title="Group (g)"
        >
          <Layers size={13} strokeWidth={2} />
          <span class="rail-button-label">{groupLabel(getGroupMode())}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>

        <button
          type="button"
          class="rail-button"
          class:active={openPopover === 'filter'}
          aria-haspopup="menu"
          aria-expanded={openPopover === 'filter'}
          onclick={(e) => { e.stopPropagation(); openPopover = openPopover === 'filter' ? null : 'filter'; }}
          title="Filter (f)"
        >
          <SlidersHorizontal size={13} strokeWidth={2} />
          <span class="rail-button-label">Filter</span>
          {#if tabFilterCount > 0}<span class="rail-badge tabular-nums">{tabFilterCount}</span>{/if}
        </button>

        <button
          type="button"
          class="rail-button rail-button-icon"
          class:active={openPopover === 'more'}
          aria-haspopup="menu"
          aria-expanded={openPopover === 'more'}
          onclick={(e) => { e.stopPropagation(); openPopover = openPopover === 'more' ? null : 'more'; }}
          title="More"
        >
          <MoreHorizontal size={14} strokeWidth={2} />
        </button>
      </div>

      {#if filterChips.length > 0}
        <div class="chips" role="list" aria-label="Active filters">
          {#each filterChips as chip (chip.id)}
            <span role="listitem" class="chip">
              {chip.label}
              <button type="button" onclick={() => chip.clear()} title="Clear" aria-label={`Clear ${chip.label}`}>
                <X size={11} strokeWidth={2.2} />
              </button>
            </span>
          {/each}
          {#if hasCustomPreference}
            <button type="button" class="chip-clear-all" onclick={resetPreferences}>
              <RotateCcw size={11} strokeWidth={2} />
              <span>Reset</span>
            </button>
          {/if}
        </div>
      {/if}

      <!-- ── Sort popover ── -->
      {#if openPopover === 'sort'}
        <div class="popover popover-sort" role="menu" aria-label="Sort">
          {#each ['viewDefault', 'priority', 'planningDateAsc', 'createdNewest', 'completedNewest', 'sourceOrder'] as TodoSortMode[] as mode (mode)}
            <button type="button" role="menuitemradio" aria-checked={getSortMode() === mode} class="menu-item" onclick={() => setSort(mode)}>
              <span class="menu-check">{#if getSortMode() === mode}<Check size={13} strokeWidth={2.4} />{/if}</span>
              <span>{sortLabel(mode)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- ── Group popover ── -->
      {#if openPopover === 'group'}
        <div class="popover popover-group" role="menu" aria-label="Group">
          {#each ['viewDefault', 'smartDate', 'planningDate', 'createdDate', 'completedDate', 'sourceFile', 'priority', 'tag', 'none'] as TodoGroupMode[] as mode (mode)}
            <button type="button" role="menuitemradio" aria-checked={getGroupMode() === mode} class="menu-item" onclick={() => setGroup(mode)}>
              <span class="menu-check">{#if getGroupMode() === mode}<Check size={13} strokeWidth={2.4} />{/if}</span>
              <span>{groupLabel(mode)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- ── Filter popover (single home for all advanced filters) ── -->
      {#if openPopover === 'filter'}
        <div class="popover popover-filter" role="dialog" aria-label="Filters">
        <div class="filter-grid">
          {#if activeTab === 'open'}
            <label class="filter-field">
              <span>Status</span>
              <SelectShell class="popover-select-shell">
                <select value={tabFilters.status ?? 'all'} onchange={(e) => setFilter('status', (e.currentTarget as HTMLSelectElement).value as never)}>
                  <option value="all">All visible</option>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                </select>
              </SelectShell>
            </label>
          {/if}
          <label class="filter-field">
            <span>Source</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.source ?? 'all'} onchange={(e) => setFilter('source', (e.currentTarget as HTMLSelectElement).value as never)}>
                <option value="all">All sources</option>
                <option value="dedicated">TODO.md</option>
                <option value="inline">Inline notes</option>
              </select>
            </SelectShell>
          </label>
          <label class="filter-field">
            <span>List</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.list ?? 'all'} onchange={(e) => setFilter('list', (e.currentTarget as HTMLSelectElement).value as never)}>
                <option value="all">All lists</option>
                <option value="inbox">Inbox</option>
                <option value="anytime">Anytime</option>
                <option value="someday">Someday</option>
              </select>
            </SelectShell>
          </label>
          <label class="filter-field">
            <span>Repeats</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.recurrence ?? 'all'} onchange={(e) => setFilter('recurrence', (e.currentTarget as HTMLSelectElement).value as never)}>
                <option value="all">All tasks</option>
                <option value="with">Repeating</option>
                <option value="without">Non-repeating</option>
              </select>
            </SelectShell>
          </label>
          <fieldset class="filter-field priority-field">
            <legend>Priority</legend>
            <div class="priority-row">
              {#each priorityOptions as priority (priority)}
                <label>
                  <input
                    type="checkbox"
                    checked={(tabFilters.priority ?? []).includes(priority)}
                    onchange={(e) => togglePriorityFilter(priority, e)}
                  />
                  <span>{priorityLabel(priority)}</span>
                </label>
              {/each}
            </div>
          </fieldset>
          <label class="filter-field">
            <span>Tags</span>
            <input type="text" value={tagFilterInput()} oninput={setTagsFilter} placeholder="work, writing" />
          </label>
          <label class="filter-field">
            <span>Tag match</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.tagMode ?? 'any'} onchange={(e) => setFilter('tagMode', (e.currentTarget as HTMLSelectElement).value as never)}>
                <option value="any">Any tag</option>
                <option value="all">All tags</option>
              </select>
            </SelectShell>
          </label>
          <label class="filter-field">
            <span>Date field</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.dateField ?? (activeTab === 'completed' ? 'completedAt' : 'smart')} onchange={(e) => setFilter('dateField', (e.currentTarget as HTMLSelectElement).value as never)}>
                <option value="smart">Smart date</option>
                <option value="createdAt">Created</option>
                <option value="dueDate">Due</option>
                <option value="scheduledDate">Scheduled</option>
                <option value="completedAt">Completed</option>
              </select>
            </SelectShell>
          </label>
          <label class="filter-field">
            <span>Date range</span>
            <SelectShell class="popover-select-shell">
              <select value={tabFilters.datePreset ?? 'any'} onchange={(e) => updateFilters({ datePreset: (e.currentTarget as HTMLSelectElement).value as never, dateFrom: '', dateTo: '' })}>
                <option value="any">Any date</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7Days">Last 7 days</option>
                <option value="last30Days">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </SelectShell>
          </label>
          <div class="filter-field date-range-pair">
            <label>
              <span>From</span>
              <input type="date" value={tabFilters.dateFrom ?? ''} onchange={(e) => updateFilters({ dateFrom: (e.currentTarget as HTMLInputElement).value, datePreset: 'custom' })} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={tabFilters.dateTo ?? ''} onchange={(e) => updateFilters({ dateTo: (e.currentTarget as HTMLInputElement).value, datePreset: 'custom' })} />
            </label>
          </div>
        </div>
        <div class="popover-footer">
          <button type="button" class="footer-link" onclick={resetPreferences} disabled={!hasCustomPreference}>
            <RotateCcw size={12} strokeWidth={2} />
            <span>Clear all filters</span>
          </button>
          <button type="button" class="footer-done" onclick={() => { openPopover = null; }}>Done</button>
        </div>
      </div>
    {/if}

      <!-- ── More popover (density + show-completed) ── -->
      {#if openPopover === 'more'}
        <div class="popover popover-more" role="menu" aria-label="More options">
          <div class="more-section">
            <div class="more-label">Row density</div>
            <div class="more-segment">
              <button type="button" class:active={density === 'compact'} onclick={() => { saveDensity('compact'); openPopover = null; }}>Compact</button>
              <button type="button" class:active={density === 'comfortable'} onclick={() => { saveDensity('comfortable'); openPopover = null; }}>Comfortable</button>
            </div>
          </div>
          {#if !isLogbook}
            <div class="more-section">
              <div class="more-label">Completed tasks</div>
              <button
                type="button"
                class="more-toggle"
                onclick={() => { todoStore.toggleShowCompleted(); setTab(todoStore.showCompleted ? 'completed' : 'open'); openPopover = null; }}
              >
                {todoStore.showCompleted ? 'Hide completed' : 'Show completed'}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Click-catcher behind popovers — closes on outside click -->
      {#if openPopover}
        <button type="button" class="popover-catcher" aria-label="Close menu" onclick={() => { openPopover = null; }}></button>
      {/if}
    </div>

    <!-- ── List region (virtualized) ── -->
    <div class="list-region" bind:this={listRegion} aria-live="polite">
      {#if todoStore.loading}
        <div class="state-line">Loading tasks…</div>
      {:else if todoStore.error}
        <div class="state-line error">
          <span>{todoStore.error.message}</span>
          <button type="button" onclick={() => todoStore.refresh()}>Retry</button>
        </div>
      {:else if entries.length === 0}
        <div class="empty-state">
          {#if activeTab === 'completed'}
            <h2>Nothing completed yet</h2>
            <p>Tasks land here as you check them off.</p>
          {:else}
            <h2>No open tasks</h2>
            <p>{tabFilterCount > 0 ? 'No task matches your filters.' : 'This view is clear.'}</p>
          {/if}
        </div>
      {:else}
        <VirtualList items={entries} itemHeight={rowHeight} ariaLabel={activeTab === 'completed' ? 'Completed tasks' : 'Open tasks'}>
          {#snippet row(item, _index)}
            {@const entry = item as Entry}
            {#if entry.kind === 'header'}
              <button
                type="button"
                class="group-header"
                class:collapsed={entry.collapsed}
                onclick={() => toggleGroup(entry.label)}
                aria-expanded={!entry.collapsed}
              >
                <span class="group-caret" aria-hidden="true">
                  {#if entry.collapsed}<ChevronRight size={12} strokeWidth={2.4} />{:else}<ChevronDown size={12} strokeWidth={2.4} />{/if}
                </span>
                <span class="group-label">{entry.label}</span>
                <span class="group-count tabular-nums">{entry.count}</span>
              </button>
            {:else}
              <TodoTaskRow
                todo={entry.todo}
                {density}
                hideSource={!showSourceInRow}
                selected={todoStore.selectedTodoId === entry.todo.id}
                multiSelected={selectionSet.has(entry.todo.id)}
                onSelect={(t, event) => handleRowSelect(t, event)}
                onNavigateToFile={navigateToFile}
              />
            {/if}
          {/snippet}
        </VirtualList>
      {/if}
    </div>

    <!-- ── Bulk action bar ── -->
    {#if hasMultiSelection}
      <div class="bulk-bar" role="region" aria-label="Bulk actions">
        <div class="bulk-count">
          <span class="tabular-nums">{selectionCount}</span><span>selected</span>
        </div>
        <div class="bulk-actions">
          <button type="button" onclick={() => bulkMoveTo('today')}>Today</button>
          <button type="button" onclick={() => bulkMoveTo('anytime')}>Anytime</button>
          <button type="button" onclick={() => bulkMoveTo('someday')}>Someday</button>
          <label class="bulk-deadline">
            <span>Deadline</span>
            <input type="date" onchange={bulkSetDeadline} aria-label="Set deadline for selection" />
          </label>
          <button type="button" class="bulk-complete" onclick={bulkComplete}>
            <CheckCircle2 size={13} strokeWidth={2} />
            <span>Complete</span>
          </button>
          <button type="button" class="bulk-delete" onclick={bulkDelete}>
            <Trash2 size={13} strokeWidth={2} />
            <span>Delete</span>
          </button>
        </div>
        <button type="button" class="bulk-close" onclick={clearSelection} aria-label="Clear selection">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    {/if}
  </main>

  <!-- ═══════════ INSPECTOR ═══════════ -->
  {#if todoStore.selectedTodo && (!viewportIsNarrow || inspectorPeekOpen)}
    <aside class="inspector-dock" class:peek={viewportIsNarrow}>
      <TodoInspector
        todo={todoStore.selectedTodo}
        onNavigateToFile={navigateToFile}
        onClose={() => { todoStore.selectTodo(null); inspectorPeekOpen = false; }}
      />
    </aside>
  {/if}

  {#if viewportIsNarrow && inspectorPeekOpen && todoStore.selectedTodo}
    <button type="button" class="inspector-backdrop" aria-label="Close inspector" onclick={() => { inspectorPeekOpen = false; }}></button>
  {/if}

  <!-- ═══════════ DIALOGS ═══════════ -->
  {#if listDialogMode}
    <div class="modal-backdrop" role="presentation">
      <div class="dialog" role="dialog" aria-modal="true" aria-label={listDialogMode === 'edit' ? 'Edit todo list' : 'New todo list'} tabindex="-1">
        <form onsubmit={saveListDialog}>
          <div class="dialog-header">
            <div>
              <p class="dialog-eyebrow">List</p>
              <h2>{listDialogMode === 'edit' ? 'Edit list' : 'New list'}</h2>
            </div>
            <button type="button" class="dialog-close" onclick={closeListDialog} title="Close" aria-label="Close">
              <X size={15} strokeWidth={2} />
            </button>
          </div>
          <label class="dialog-field">
            <span>Name</span>
            <input bind:this={listTitleInput} type="text" bind:value={listDraftTitle} placeholder="Work" autocomplete="off" />
          </label>
          <label class="dialog-field">
            <span>Note</span>
            <textarea rows="4" bind:value={listDraftNote} placeholder="Optional context for this list"></textarea>
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
      <div class="dialog dialog-delete" role="dialog" aria-modal="true" aria-label="Delete todo list" tabindex="-1">
        <div class="dialog-header">
          <div>
            <p class="dialog-eyebrow">Delete</p>
            <h2>{deleteListTarget.title}</h2>
          </div>
          <button type="button" class="dialog-close" onclick={() => { deleteListTarget = null; }} title="Close" aria-label="Close">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <p class="dialog-copy">This removes {getFileName(deleteListTarget.path)} and every task inside it.</p>
        <div class="dialog-actions">
          <button type="button" class="secondary" onclick={() => { deleteListTarget = null; }}>Cancel</button>
          <button type="button" class="danger-action" onclick={confirmDeleteList}>Delete</button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  /* ─── Layout ─────────────────────────────────────────────────────────── */
  .tasks-workspace {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    min-width: 0;
    height: 100%;
    width: 100%;
    background: var(--bg-app);
    isolation: isolate;
  }

  .tasks-workspace.has-dock-inspector {
    grid-template-columns: 232px minmax(0, 1fr) 360px;
  }

  /* ─── Nav ────────────────────────────────────────────────────────────── */
  .task-nav {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-light);
    background: var(--bg-sidebar);
  }

  .nav-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 10px;
  }

  .nav-brand {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-primary);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .nav-return {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 8px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .nav-return:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-body {
    flex: 1;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 4px 10px 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .nav-section {
    display: grid;
    gap: 4px;
  }

  .nav-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 8px 0;
  }

  .nav-section-label {
    padding: 0 8px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .nav-section-heading .nav-section-label {
    padding: 0;
  }

  .nav-add {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .nav-add:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-items {
    display: grid;
    gap: 1px;
  }

  .nav-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    padding: 4px 8px;
    text-align: left;
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-light), var(--shadow-xs);
  }

  .nav-icon {
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
  }

  .nav-item.active .nav-icon {
    color: var(--accent-primary);
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-count {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .nav-list-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border-radius: var(--radius-sm);
  }

  .nav-list-row:hover,
  .nav-list-row.active {
    background: var(--bg-hover);
  }

  .nav-list-row.active {
    background: var(--bg-card);
    box-shadow: inset 0 0 0 1px var(--border-light), var(--shadow-xs);
  }

  .nav-item-list {
    box-shadow: none !important;
  }

  .nav-list-actions {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding-right: 4px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .nav-list-row:hover .nav-list-actions,
  .nav-list-row.active .nav-list-actions {
    opacity: 1;
  }

  .nav-list-actions button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .nav-list-actions button:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .nav-list-actions button.danger:hover {
    color: var(--color-error);
    background: var(--color-error-bg);
  }

  /* ─── Main ───────────────────────────────────────────────────────────── */
  .task-main {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    background: var(--bg-editor);
    overflow: hidden;
  }

  /* ─── Command bar ────────────────────────────────────────────────────── */
  .command-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 18px;
    padding: 14px 22px 12px;
    border-bottom: 1px solid var(--border-faint);
  }

  .title-block {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .title {
    margin: 0;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.012em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-cluster {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    min-height: 24px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    color: var(--text-tertiary);
    padding: 2px 8px;
    font-size: var(--text-caption);
  }

  .stat strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .stat.warn {
    color: var(--color-warning);
    background: var(--color-warning-bg);
    border-color: color-mix(in srgb, var(--color-warning) 18%, transparent);
  }

  .stat.warn strong {
    color: var(--color-warning);
  }

  .stat.error {
    color: var(--color-error);
    background: var(--color-error-bg);
    border-color: color-mix(in srgb, var(--color-error) 22%, transparent);
  }

  .stat.error strong {
    color: var(--color-error);
  }

  .capture {
    display: inline-grid;
    grid-template-columns: 16px minmax(200px, 320px) auto;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    padding: 4px 6px 4px 10px;
    color: var(--text-tertiary);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast), grid-template-columns var(--transition-normal);
  }

  .capture:focus-within {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .capture.expanded {
    grid-template-columns: 16px minmax(220px, 1fr) 130px 110px auto;
  }

  .capture input[type='text'],
  .capture input[type='date'],
  .capture :global(.capture-prio-shell) {
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    outline: none;
    padding: 4px 6px;
  }

  .capture input[type='text']::placeholder {
    color: var(--text-placeholder);
  }

  .capture input[type='date'],
  .capture :global(.capture-prio-shell) {
    border-left: 1px solid var(--border-faint);
  }

  .capture :global(.capture-prio-shell) {
    --select-bg: transparent;
    --select-border: transparent;
    --select-hover-bg: transparent;
    --select-hover-border: transparent;
    --select-min-height: 24px;
    --select-padding-x: 8px;
    --select-padding-y: 4px;
    --select-radius: var(--radius-sm);
    --select-shadow: none;
    width: 100%;
  }

  .capture :global(.capture-prio-shell select) {
    color: var(--text-secondary);
    font-size: var(--text-caption);
  }

  .capture-submit {
    min-height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-inverse);
    padding: 0 12px;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast);
  }

  .capture-submit:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .capture-submit:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  /* ─── Rail (tabs + search + buttons + chips) ─────────────────────────── */
  .rail {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 10px 22px 10px;
    border-bottom: 1px solid var(--border-faint);
  }

  .rail:has(.chips) {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
  }

  .tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    padding: 2px;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    padding: 2px 10px;
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tab:hover:not(:disabled):not(.active) {
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tab-count {
    min-width: 16px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-tertiary);
    padding: 0 6px;
    font-size: 11px;
    text-align: center;
  }

  .tab.active .tab-count {
    background: var(--accent-light);
    color: var(--accent-primary);
  }

  .search-cluster {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto auto auto auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .search-shell {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-tertiary);
    padding: 2px 8px;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .search-shell:focus-within {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search-shell input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
  }

  .search-shell input::placeholder {
    color: var(--text-placeholder);
  }

  .search-shell input::-webkit-search-cancel-button {
    appearance: none;
  }

  .kbd-hint {
    color: var(--text-placeholder);
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 1px 5px;
    border: 1px solid var(--border-faint);
    border-radius: 4px;
    background: var(--bg-subtle);
  }

  .search-shell:focus-within .kbd-hint {
    opacity: 0;
  }

  .rail-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 9px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .rail-button:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .rail-button.active {
    border-color: var(--accent-primary);
    background: var(--accent-light);
    color: var(--accent-primary);
  }

  .rail-button-label {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .rail-button-icon {
    width: 28px;
    padding: 0;
    justify-content: center;
  }

  .rail-badge {
    min-width: 16px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
    color: var(--text-inverse);
    padding: 0 5px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }

  /* ─── Chips ──────────────────────────────────────────────────────────── */
  .chips {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 4px;
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 18%, transparent);
    border-radius: var(--radius-full);
    background: var(--accent-light);
    color: var(--accent-primary);
    padding: 0 4px 0 9px;
    font-size: 11px;
    font-weight: 500;
  }

  .chip button {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--accent-primary);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .chip button:hover {
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  }

  .chip-clear-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    padding: 0 8px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .chip-clear-all:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* ─── Popovers (anchored to .rail) ───────────────────────────────────── */
  .popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 22px;
    z-index: var(--z-popover);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    padding: 6px;
    min-width: 200px;
    animation: popover-in 140ms var(--ease-out-soft);
  }

  .popover-catcher {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
    border: 0;
    background: transparent;
    cursor: default;
  }

  @keyframes popover-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .popover-filter {
    width: min(640px, calc(100vw - 44px));
    padding: 14px;
  }

  .popover-more {
    min-width: 220px;
    padding: 10px;
  }

  .menu-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 30px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    padding: 4px 8px;
    text-align: left;
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-item[aria-checked='true'] {
    color: var(--text-primary);
  }

  .menu-check {
    display: grid;
    place-items: center;
    color: var(--accent-primary);
  }

  .filter-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .filter-field {
    display: grid;
    gap: 5px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .filter-field > span,
  .filter-field legend {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .filter-field input[type='text'],
  .filter-field input[type='date'] {
    min-height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    padding: 4px 8px;
    outline: none;
  }

  .filter-field input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  :global(.popover-select-shell) {
    --select-bg: var(--bg-app);
    --select-hover-bg: var(--bg-card);
    --select-min-height: 30px;
    --select-padding-x: 8px;
    --select-padding-y: 4px;
    width: 100%;
  }

  .priority-field {
    border: 0;
    padding: 0;
    margin: 0;
  }

  .priority-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .priority-row label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 8px;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .priority-row label:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .priority-row input {
    width: 13px;
    height: 13px;
    accent-color: var(--accent-primary);
  }

  .date-range-pair {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .date-range-pair label {
    display: grid;
    gap: 4px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .popover-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-faint);
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: transparent;
    color: var(--text-tertiary);
    padding: 4px 6px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .footer-link:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .footer-link:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .footer-done {
    min-height: 28px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--accent-primary);
    color: var(--text-inverse);
    padding: 0 14px;
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
  }

  .footer-done:hover {
    background: var(--accent-hover);
  }

  .more-section {
    display: grid;
    gap: 6px;
    padding: 6px 4px;
  }

  .more-section + .more-section {
    border-top: 1px solid var(--border-faint);
    margin-top: 4px;
    padding-top: 10px;
  }

  .more-label {
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
    padding: 0 4px;
  }

  .more-segment {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    padding: 2px;
  }

  .more-segment button {
    min-height: 26px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .more-segment button.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .more-segment button:hover:not(.active) {
    color: var(--text-primary);
  }

  .more-toggle {
    min-height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .more-toggle:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ─── List region ────────────────────────────────────────────────────── */
  .list-region {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 14px 14px;
  }

  /* ─── Group header (rendered as a row inside VirtualList) ────────────── */
  :global(.virtual-row) :global(.group-header) {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    padding: 0 8px;
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  :global(.virtual-row) :global(.group-header:hover) {
    color: var(--text-primary);
  }

  :global(.virtual-row) :global(.group-caret) {
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
    transition: transform var(--transition-fast);
  }

  :global(.virtual-row) :global(.group-label) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.virtual-row) :global(.group-count) {
    color: var(--text-tertiary);
    font-weight: 500;
    font-size: 11px;
  }

  /* ─── States ─────────────────────────────────────────────────────────── */
  .state-line,
  .empty-state {
    display: grid;
    place-items: center;
    min-height: 240px;
    color: var(--text-tertiary);
    text-align: center;
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
    cursor: pointer;
  }

  .empty-state {
    align-content: center;
    gap: 4px;
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

  /* ─── Bulk action bar ────────────────────────────────────────────────── */
  .bulk-bar {
    position: absolute;
    left: 22px;
    right: 22px;
    bottom: 16px;
    z-index: var(--z-overlay);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    padding: 8px 8px 8px 14px;
    animation: bulk-in 180ms var(--ease-spring);
  }

  @keyframes bulk-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .bulk-count {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    color: var(--text-primary);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .bulk-count span:last-child {
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .bulk-actions {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .bulk-actions button,
  .bulk-deadline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .bulk-actions button:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .bulk-deadline {
    padding: 0 10px 0 10px;
  }

  .bulk-deadline span {
    color: var(--text-tertiary);
  }

  .bulk-deadline input {
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-caption);
    padding: 2px 0;
    outline: none;
  }

  .bulk-complete {
    color: var(--color-success) !important;
    border-color: color-mix(in srgb, var(--color-success) 24%, var(--border-light)) !important;
  }

  .bulk-complete:hover {
    background: var(--color-success-bg) !important;
  }

  .bulk-delete {
    color: var(--color-error) !important;
    border-color: color-mix(in srgb, var(--color-error) 22%, var(--border-light)) !important;
  }

  .bulk-delete:hover {
    background: var(--color-error-bg) !important;
  }

  .bulk-close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .bulk-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ─── Inspector dock & peek ──────────────────────────────────────────── */
  .inspector-dock {
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border-light);
    background: var(--bg-sidebar);
    overflow: hidden;
  }

  .inspector-dock.peek {
    position: fixed;
    top: var(--titlebar-height, 30px);
    right: 0;
    bottom: 0;
    width: min(360px, 92vw);
    z-index: var(--z-overlay);
    box-shadow: var(--shadow-xl);
  }

  .inspector-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-overlay) - 1);
    border: 0;
    background: var(--bg-overlay);
    backdrop-filter: blur(2px);
    cursor: pointer;
  }

  /* ─── Dialog ─────────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    background: var(--bg-overlay);
    backdrop-filter: blur(2px);
    padding: 20px;
  }

  .dialog {
    width: min(420px, 100%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-dialog);
    padding: 18px;
    display: grid;
    gap: 12px;
  }

  .dialog form {
    display: grid;
    gap: 12px;
  }

  .dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .dialog-eyebrow {
    margin: 0 0 2px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
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
    height: 28px;
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

  .dialog-field {
    display: grid;
    gap: 5px;
    color: var(--text-secondary);
    font-size: var(--text-small);
  }

  .dialog-field input,
  .dialog-field textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    outline: none;
    padding: 8px 10px;
  }

  .dialog-field textarea {
    resize: vertical;
    min-height: 80px;
  }

  .dialog-field input:focus,
  .dialog-field textarea:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .dialog-copy {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-body);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .dialog-actions button {
    min-height: 32px;
    border-radius: var(--radius-md);
    padding: 0 12px;
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

  /* ─── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .command-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      gap: 10px 14px;
    }

    .stat-cluster {
      justify-self: end;
    }

    .capture {
      grid-column: 1 / -1;
    }

    .capture.expanded {
      grid-template-columns: 16px minmax(0, 1fr) 130px 110px auto;
    }
  }

  @media (max-width: 880px) {
    .tasks-workspace,
    .tasks-workspace.has-dock-inspector {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .task-nav {
      border-right: 0;
      border-bottom: 1px solid var(--border-light);
      padding-bottom: 0;
    }

    .nav-body {
      display: flex;
      gap: 12px;
      padding: 4px 12px 10px;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .nav-section {
      min-width: max-content;
    }

    .rail {
      grid-template-columns: 1fr;
      gap: 8px;
      padding: 10px 14px;
    }

    .search-cluster {
      grid-template-columns: minmax(140px, 1fr) auto auto auto auto;
    }

    .bulk-bar {
      left: 12px;
      right: 12px;
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      gap: 8px;
    }

    .bulk-close {
      position: absolute;
      top: 4px;
      right: 4px;
    }
  }
</style>
