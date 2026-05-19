<script lang="ts">
  import {
    Calendar,
    CheckCircle2,
    Copy,
    Edit3,
    FileText,
    Flag,
    Repeat,
    Tag,
    Trash2,
  } from '@lucide/svelte';
  import type { Todo } from '$lib/domain/entities/Todo';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import { todoStore } from '$lib/stores';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { toastStore } from '$lib/stores';

  interface Props {
    todo: Todo;
    selected?: boolean;
    compact?: boolean;
    onSelect?: (todo: Todo) => void;
    onNavigateToFile?: (filePath: string) => void;
  }

  let { todo, selected = false, compact = false, onSelect, onNavigateToFile }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!editing) draft = todo.content;
  });

  $effect(() => {
    if (editing && editInput) {
      editInput.focus();
      editInput.select();
    }
  });

  async function toggle() {
    await todoStore.toggle(todo.id);
  }

  async function remove() {
    await todoStore.delete(todo.id);
  }

  function select() {
    todoStore.selectTodo(todo.id);
    onSelect?.(todo);
  }

  function startEditing() {
    editing = true;
    draft = todo.content;
  }

  async function saveEdit() {
    const content = draft.trim();
    if (content && content !== todo.content) {
      await todoStore.updatePatch(todo.id, { content });
    }
    editing = false;
  }

  function cancelEdit() {
    draft = todo.content;
    editing = false;
  }

  function navigate(event: MouseEvent) {
    event.stopPropagation();
    onNavigateToFile?.(todo.sourceFile);
  }

  async function copyRef(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
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

    if (diffDays === 0) return `Completed today, ${time}`;
    if (diffDays === -1) return `Completed yesterday, ${time}`;
    return `Completed ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
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

  const dueState = $derived.by(() => {
    if (!todo.dates.dueDate || todo.isCompleted) return '';
    const due = new Date(todo.dates.dueDate);
    due.setHours(0, 0, 0, 0);
    const today = startOfToday();
    if (due < today) return 'overdue';
    if (due.getTime() === today.getTime()) return 'today';
    return '';
  });
</script>

<div
  class="task-row"
  class:selected
  class:completed={todo.isCompleted}
  class:compact
  onclick={select}
  oncontextmenu={copyRef}
  onkeydown={(event) => {
    if (event.key === 'Enter') select();
  }}
  role="button"
  tabindex="0"
>
  <label class="check-wrap" aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}>
    <input type="checkbox" checked={todo.isCompleted} onchange={toggle} onclick={(event) => event.stopPropagation()} />
    <span class="check-shell" aria-hidden="true"></span>
  </label>

  <div class="task-body">
    {#if editing}
      <input
        bind:this={editInput}
        class="inline-edit"
        bind:value={draft}
        aria-label="Task title"
        onkeydown={(event) => {
          if (event.key === 'Enter') saveEdit();
          if (event.key === 'Escape') cancelEdit();
        }}
        onblur={saveEdit}
        onclick={(event) => event.stopPropagation()}
      />
    {:else}
      <div class="task-title">{todo.content}</div>
    {/if}

    <div class="task-meta" aria-label="Task metadata">
      {#if todo.priority}
        <span class="meta-chip priority-{todo.priority}">
          <Flag size={13} strokeWidth={2} />
          {priorityLabel(todo.priority)}
        </span>
      {/if}

      {#if todo.isCompleted && todo.dates.completedAt}
        <span class="meta-chip completed-at" title={`Completed ${formatDateTimeTitle(todo.dates.completedAt)}`}>
          <CheckCircle2 size={13} strokeWidth={2} />
          {formatCompletedDate(todo.dates.completedAt)}
        </span>
      {/if}

      {#if todo.dates.dueDate}
        <span class="meta-chip due {dueState}">
          <Calendar size={13} strokeWidth={2} />
          {formatDate(todo.dates.dueDate)}
        </span>
      {/if}

      {#if todo.dates.scheduledDate}
        <span class="meta-chip">
          <Calendar size={13} strokeWidth={2} />
          {formatDate(todo.dates.scheduledDate)}
        </span>
      {/if}

      {#if todo.dates.recurrence}
        <span class="meta-chip">
          <Repeat size={13} strokeWidth={2} />
          {todo.dates.recurrence}
        </span>
      {/if}

      {#each todo.tags as tagName (tagName)}
        <span class="meta-chip">
          <Tag size={13} strokeWidth={2} />
          {tagName}
        </span>
      {/each}

      <button type="button" class="source-link" onclick={navigate} title={todo.sourceFile}>
        <FileText size={13} strokeWidth={2} />
        {getFileName(todo.sourceFile)}
      </button>
    </div>
  </div>

  <div class="row-actions">
    <button type="button" class="icon-button" onclick={copyRef} title="Copy Ref" aria-label="Copy Ref">
      <Copy size={14} strokeWidth={2} />
    </button>
    <button type="button" class="icon-button" onclick={(event) => { event.stopPropagation(); startEditing(); }} title="Edit task" aria-label="Edit task">
      <Edit3 size={14} strokeWidth={2} />
    </button>
    <button type="button" class="icon-button danger" onclick={(event) => { event.stopPropagation(); remove(); }} title="Delete task" aria-label="Delete task">
      <Trash2 size={14} strokeWidth={2} />
    </button>
  </div>
</div>

<style>
  .task-row {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    min-height: 44px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-faint);
    background: transparent;
    cursor: default;
    border-radius: var(--radius-sm);
  }

  .task-row:hover {
    background: var(--bg-hover);
  }

  .task-row.selected {
    background: var(--accent-light);
    box-shadow: inset 2px 0 0 var(--accent-primary);
  }

  .task-row.completed {
    background: color-mix(in srgb, var(--bg-sidebar) 62%, transparent);
  }

  .task-row.compact {
    padding: 9px 10px;
  }

  .check-wrap {
    display: grid;
    place-items: center;
    min-height: 24px;
    cursor: pointer;
  }

  .check-wrap input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .check-shell {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--border-dark);
    border-radius: var(--radius-full);
    background: var(--bg-editor);
    pointer-events: none;
  }

  .check-wrap input:checked + .check-shell {
    border-color: var(--color-success);
    background: var(--color-success);
  }

  .check-shell::after {
    content: '';
    width: 8px;
    height: 4px;
    border-left: 1.5px solid var(--text-inverse);
    border-bottom: 1.5px solid var(--text-inverse);
    opacity: 0;
    transform: rotate(-45deg) translateY(-1px);
  }

  .check-wrap input:checked + .check-shell::after {
    opacity: 1;
  }

  .task-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .task-title {
    color: var(--text-primary);
    font-size: var(--text-body);
    line-height: 1.42;
    overflow-wrap: anywhere;
  }

  .completed .task-title {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .inline-edit {
    width: 100%;
    border: 1px solid var(--border-medium);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-primary);
    font: inherit;
    padding: 5px 7px;
    outline: none;
  }

  .inline-edit:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
  }

  .meta-chip,
  .source-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 20px;
    border: 0;
    border-radius: var(--radius-xs);
    padding: 1px 4px;
    color: var(--text-secondary);
    background: transparent;
    font-size: var(--text-caption);
    line-height: var(--text-caption-line-height);
  }

  .source-link {
    cursor: pointer;
    color: var(--text-tertiary);
  }

  .source-link:hover {
    color: var(--accent-primary);
    background: var(--accent-light);
  }

  .meta-chip.due.overdue {
    color: var(--color-error);
    background: var(--color-error-bg);
  }

  .meta-chip.due.today {
    color: var(--color-warning);
    background: var(--color-warning-bg);
  }

  .meta-chip.completed-at {
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 10%, transparent);
  }

  .priority-high {
    color: var(--color-error);
  }

  .priority-medium {
    color: var(--color-warning);
  }

  .priority-low {
    color: var(--text-tertiary);
  }

  .row-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
  }

  .task-row:hover .row-actions,
  .task-row:focus-within .row-actions,
  .task-row.selected .row-actions {
    opacity: 1;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .icon-button:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .icon-button.danger:hover {
    color: var(--color-error);
    background: var(--color-error-bg);
  }

  @media (max-width: 720px) {
    .task-row {
      grid-template-columns: 28px minmax(0, 1fr);
    }

    .row-actions {
      grid-column: 2;
      opacity: 1;
    }
  }
</style>
