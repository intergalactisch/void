<script lang="ts">
  import {
    Calendar,
    CheckCircle2,
    FileText,
    Flag,
    GripVertical,
    Repeat,
    Tag,
  } from '@lucide/svelte';
  import type { Todo } from '$lib/domain/entities/Todo';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import { todoStore, toastStore } from '$lib/stores';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';

  interface Props {
    todo: Todo;
    selected?: boolean;
    multiSelected?: boolean;
    /** Visual density (drives row height, padding, font sizing). */
    density?: 'compact' | 'comfortable';
    /** Hide the source-file chip — the workspace passes this when the source is implied by the active view. */
    hideSource?: boolean;
    /** Single-line vs. multi-line title. Compact density implies single-line. */
    compact?: boolean;
    /** Show a drag handle for manual source-order reordering. */
    reorderable?: boolean;
    onSelect?: (todo: Todo, event?: MouseEvent | KeyboardEvent) => void;
    onNavigateToFile?: (filePath: string) => void;
  }

  let {
    todo,
    selected = false,
    multiSelected = false,
    density = 'compact',
    hideSource = false,
    compact = false,
    reorderable = false,
    onSelect,
    onNavigateToFile,
  }: Props = $props();

  async function toggle(event?: Event) {
    event?.stopPropagation();
    await todoStore.toggle(todo.id);
    if (todoStore.selectedTodoId === todo.id) {
      todoStore.selectTodo(null);
    }
  }

  function navigateSource(event: MouseEvent) {
    event.stopPropagation();
    onNavigateToFile?.(todo.sourceFile);
  }

  async function copyRef(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    if ('stopPropagation' in event) event.stopPropagation();
    const success = await copyTextToClipboard(buildRefId({ kind: 'todo', todoId: todo.id }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? path;
  }

  function formatDate(date: Date): string {
    const today = startOfToday();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
    if (diffDays <= 7) return `In ${diffDays}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatCompletedDate(date: Date): string {
    const today = startOfToday();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today ${time}`;
    if (diffDays === -1) return `Yesterday ${time}`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatDateTimeTitle(date: Date): string {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function priorityLabel(priority: TodoPriority | undefined): string {
    if (!priority) return '';
    return priority[0]!.toUpperCase() + priority.slice(1);
  }

  function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function handleClick(event: MouseEvent) {
    onSelect?.(todo, event);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelect?.(todo, event);
    }
    if (event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  }

  const dueState = $derived.by(() => {
    if (!todo.dates.dueDate || todo.isCompleted) return '';
    const due = new Date(todo.dates.dueDate);
    due.setHours(0, 0, 0, 0);
    const today = startOfToday();
    if (due < today) return 'overdue';
    if (due.getTime() === today.getTime()) return 'today';
    return '';
  });

  /** Compact / comfortable single-line rows put the title and chips on one line.
   *  Use the comfortable+compact=false combo only when callers explicitly want two-line. */
  const isSingleLine = $derived(!compact || density === 'compact');
</script>

<div
  class="task-row"
  class:selected
  class:multi-selected={multiSelected}
	  class:completed={todo.isCompleted}
	  class:reorderable
	  class:density-compact={density === 'compact'}
  class:density-comfortable={density === 'comfortable'}
  class:overdue={dueState === 'overdue'}
  class:today={dueState === 'today'}
  data-todo-id={todo.id}
  onclick={handleClick}
  oncontextmenu={copyRef}
  onkeydown={handleKeydown}
  role="button"
  tabindex="0"
	  aria-pressed={selected}
	>
	  {#if reorderable}
	    <button
	      type="button"
	      class="drag-handle"
	      data-todo-drag-handle
	      title="Drag to reorder"
	      aria-label={`Drag ${todo.content} to reorder`}
	      onclick={(event) => event.stopPropagation()}
	    >
	      <GripVertical size={13} strokeWidth={1.8} aria-hidden="true" />
	    </button>
	  {/if}

	  <span class="check-wrap">
	    <input
	      type="checkbox"
      checked={todo.isCompleted}
      aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
      onchange={toggle}
      onclick={(event) => event.stopPropagation()}
      onpointerdown={(event) => event.stopPropagation()}
    />
    <span class="check-shell" class:multi={multiSelected} aria-hidden="true"></span>
  </span>

  <div class="title" class:single-line={isSingleLine}>{todo.content}</div>

  <div class="meta" aria-label="Task metadata">
    {#if todo.dates.dueDate && !todo.isCompleted}
      <span class="chip due {dueState}" title={`Due ${formatDateTimeTitle(todo.dates.dueDate)}`}>
        <Calendar size={11} strokeWidth={2} />
        <span>{formatDate(todo.dates.dueDate)}</span>
      </span>
    {/if}

    {#if todo.priority}
      <span class="chip priority-{todo.priority}" title={`${priorityLabel(todo.priority)} priority`}>
        <Flag size={11} strokeWidth={2} />
        <span>{priorityLabel(todo.priority)}</span>
      </span>
    {/if}

    {#if todo.isCompleted && todo.dates.completedAt}
      <span class="chip completed-at" title={`Completed ${formatDateTimeTitle(todo.dates.completedAt)}`}>
        <CheckCircle2 size={11} strokeWidth={2} />
        <span>{formatCompletedDate(todo.dates.completedAt)}</span>
      </span>
    {/if}

    {#if todo.dates.scheduledDate && !todo.isCompleted}
      <span class="chip" title={`Starts ${formatDateTimeTitle(todo.dates.scheduledDate)}`}>
        <Calendar size={11} strokeWidth={2} />
        <span>{formatDate(todo.dates.scheduledDate)}</span>
      </span>
    {/if}

    {#if todo.dates.recurrence}
      <span class="chip" title={`Repeats ${todo.dates.recurrence}`}>
        <Repeat size={11} strokeWidth={2} />
        <span>{todo.dates.recurrence}</span>
      </span>
    {/if}

    {#each todo.tags.slice(0, 2) as tagName (tagName)}
      <span class="chip tag">
        <Tag size={11} strokeWidth={2} />
        <span>{tagName}</span>
      </span>
    {/each}
    {#if todo.tags.length > 2}
      <span class="chip muted" title={todo.tags.slice(2).map((t) => `#${t}`).join(' ')}>+{todo.tags.length - 2}</span>
    {/if}

    {#if !hideSource}
      <button type="button" class="source" onclick={navigateSource} title={todo.sourceFile} aria-label={`Open ${getFileName(todo.sourceFile)}`}>
        <FileText size={11} strokeWidth={2} />
        <span>{getFileName(todo.sourceFile)}</span>
	      </button>
	    {/if}
	  </div>
	</div>

<style>
	  .task-row {
	    display: grid;
	    grid-template-columns: 22px minmax(0, 1fr) auto;
	    align-items: center;
	    gap: 10px;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0 8px;
    cursor: default;
    transition: background var(--transition-fast);
	    outline: none;
	  }

	  .task-row.reorderable {
	    grid-template-columns: 18px 22px minmax(0, 1fr) auto;
	  }

  .task-row:hover {
    background: var(--bg-hover);
  }

  .task-row:focus-visible {
    background: var(--bg-hover);
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  .task-row.selected {
    background: var(--accent-light);
    box-shadow: inset 2px 0 0 var(--accent-primary);
  }

  .task-row.multi-selected {
    background: var(--accent-soft);
  }

  .task-row.multi-selected.selected {
    box-shadow: inset 2px 0 0 var(--accent-primary), inset 0 0 0 1px var(--accent-primary);
  }

  .task-row.completed {
    background: color-mix(in srgb, var(--bg-sidebar) 50%, transparent);
  }

  .task-row.completed:hover {
    background: color-mix(in srgb, var(--bg-hover) 100%, transparent);
  }

  .density-compact {
    padding: 0 8px;
  }

  .density-comfortable {
    padding: 2px 10px;
  }

  /* ─── Checkbox ───────────────────────────────────────────────────────── */
  .check-wrap {
    position: relative;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .check-wrap input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .check-shell {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--border-dark);
    border-radius: 4px;
    background: var(--bg-editor);
    transition: border-color 120ms ease, background-color 120ms ease, transform 90ms ease;
  }

  .check-wrap:hover .check-shell {
    border-color: var(--accent-primary);
    background: var(--accent-light);
  }

  .check-wrap input:checked + .check-shell {
    background: var(--color-success);
    border-color: var(--color-success);
  }

  .check-shell.multi {
    border-color: var(--accent-primary);
    background: var(--accent-soft);
  }

  .check-shell::after {
    content: '';
    width: 7px;
    height: 3.5px;
    border-left: 1.5px solid var(--text-inverse);
    border-bottom: 1.5px solid var(--text-inverse);
    transform: rotate(-45deg) translateY(-1px);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .check-wrap input:checked + .check-shell::after {
    opacity: 1;
  }

  /* ─── Title ──────────────────────────────────────────────────────────── */
  .title {
    color: var(--text-primary);
    font-size: var(--text-small);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .density-comfortable .title {
    font-size: var(--text-body);
  }

  .title.single-line {
    white-space: nowrap;
  }

  .completed .title {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-color: var(--border-medium);
  }

  /* ─── Meta cluster ───────────────────────────────────────────────────── */
  .meta {
    display: inline-flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 4px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    line-height: 1.3;
    overflow: hidden;
  }

  .chip,
  .source {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 18px;
    border: 0;
    border-radius: var(--radius-xs);
    padding: 0 5px;
    background: transparent;
    color: var(--text-tertiary);
    font: inherit;
    font-size: 11px;
    line-height: 1.3;
    white-space: nowrap;
  }

  .chip.muted {
    color: var(--text-muted);
  }

  .chip.due.overdue {
    color: var(--color-error);
    background: var(--color-error-bg);
    font-weight: 500;
  }

  .chip.due.today {
    color: var(--color-warning);
    background: var(--color-warning-bg);
    font-weight: 500;
  }

  .chip.completed-at {
    color: var(--color-success);
  }

  .chip.priority-high {
    color: var(--color-error);
  }

  .chip.priority-medium {
    color: var(--color-warning);
  }

  .chip.priority-low {
    color: var(--text-tertiary);
  }

  .chip.tag {
    color: var(--accent-primary);
  }

  .source {
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
    max-width: 180px;
  }

  .source span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source:hover {
    color: var(--accent-primary);
    background: var(--accent-light);
  }

  /* ─── Drag affordance ────────────────────────────────────────────────── */
  .drag-handle {
    display: grid;
    place-items: center;
    width: 18px;
    height: 22px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: grab;
    opacity: 0;
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .task-row:hover .drag-handle,
  .task-row:focus-within .drag-handle,
  .task-row.selected .drag-handle {
    opacity: 1;
  }

  .drag-handle:hover,
  .drag-handle:focus-visible {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  /* ─── Responsive: at narrow widths the meta cluster wraps under the title ─── */
	  @media (max-width: 720px) {
	    .task-row {
	      grid-template-columns: 22px minmax(0, 1fr);
	      grid-template-rows: auto auto;
	      row-gap: 2px;
	    }

	    .task-row.reorderable {
	      grid-template-columns: 18px 22px minmax(0, 1fr);
	    }

	    .meta {
	      grid-column: 2;
	      grid-row: 2;
	      flex-wrap: wrap;
	    }

	    .task-row.reorderable .meta {
	      grid-column: 3;
	    }

	    .drag-handle {
	      grid-column: 1;
	      grid-row: 1 / -1;
	    }
	  }
</style>
