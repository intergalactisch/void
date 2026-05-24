<script lang="ts">
  import {
    Archive,
    Calendar,
    CheckCircle2,
    FileText,
    Flag,
    Hash,
    Repeat,
    Tag,
    Trash2,
    X,
  } from '@lucide/svelte';
  import type { Todo, TodoUpdatePatch } from '$lib/domain/entities/Todo';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import type { TodoList } from '$lib/domain/values/TodoView';
  import { todoStore, toastStore } from '$lib/stores';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import SelectShell from '$lib/components/shared/SelectShell.svelte';

  interface Props {
    todo: Todo | null;
    onNavigateToFile?: (filePath: string) => void;
    onClose?: () => void;
  }

  let { todo, onNavigateToFile, onClose }: Props = $props();

  // ─── Editable mirror of the todo (so blur/Enter commits) ─────────────────
  let title = $state('');
  let dueDate = $state('');
  let scheduledDate = $state('');
  let priority = $state<'none' | TodoPriority>('none');
  let list = $state<TodoList>('inbox');
  let tags = $state('');
  let recurrence = $state('');

  /** Track which property is being edited inline. */
  let editingField = $state<null | 'due' | 'start' | 'priority' | 'list' | 'repeats' | 'tags'>(null);

  let titleInput = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    title = todo?.content ?? '';
    dueDate = todo?.dates.dueDate ? formatDateInput(todo.dates.dueDate) : '';
    scheduledDate = todo?.dates.scheduledDate ? formatDateInput(todo.dates.scheduledDate) : '';
    priority = todo?.priority ?? 'none';
    list = todo?.list ?? 'inbox';
    tags = todo?.tags.join(', ') ?? '';
    recurrence = todo?.dates.recurrence ?? '';
    editingField = null;
  });

  // ─── Saves ──────────────────────────────────────────────────────────────
  async function saveTitle() {
    if (!todo) return;
    const content = title.trim();
    if (content && content !== todo.content) {
      await todoStore.updatePatch(todo.id, { content });
    }
  }

  async function saveMetadata() {
    if (!todo) return;
    const patch: TodoUpdatePatch = {
      dueDate: dueDate ? parseDateInput(dueDate) : null,
      scheduledDate: scheduledDate ? parseDateInput(scheduledDate) : null,
      priority: priority === 'none' ? null : priority,
      tags: parseTags(tags),
      recurrence: recurrence.trim() ? recurrence.trim() : null,
    };
    if (todo.source === 'dedicated' && list !== (todo.list ?? 'inbox')) {
      patch.targetList = list;
    }
    await todoStore.updatePatch(todo.id, patch);
    editingField = null;
  }

  async function toggleComplete() {
    if (!todo) return;
    await todoStore.toggle(todo.id);
  }

  async function moveToToday() {
    if (!todo) return;
    const patch: TodoUpdatePatch = { scheduledDate: startOfToday() };
    if (todo.source === 'dedicated') patch.targetList = 'anytime';
    await todoStore.updatePatch(todo.id, patch);
  }

  async function moveToList(targetList: TodoList) {
    if (!todo || todo.source !== 'dedicated') return;
    await todoStore.updatePatch(todo.id, {
      dueDate: null,
      scheduledDate: null,
      targetList,
    });
  }

  async function clearDates() {
    if (!todo) return;
    await todoStore.updatePatch(todo.id, { dueDate: null, scheduledDate: null });
  }

  async function remove() {
    if (!todo) return;
    await todoStore.delete(todo.id);
    todoStore.selectTodo(todoStore.visibleTodos[0]?.id ?? null);
    onClose?.();
  }

  async function copyRef() {
    if (!todo) return;
    const ok = await copyTextToClipboard(buildRefId({ kind: 'todo', todoId: todo.id }));
    if (ok) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function openSource() {
    if (todo) onNavigateToFile?.(todo.sourceFile);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  function parseTags(value: string): string[] {
    return value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
  }

  function formatDateInput(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

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

  function formatDisplayDate(date: Date): string {
    const today = startOfToday();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days`;
    if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
  }

  function formatDisplayDateTime(date: Date): string {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function priorityLabel(p: TodoPriority | 'none'): string {
    if (p === 'none') return 'None';
    return p[0]!.toUpperCase() + p.slice(1);
  }

  function listLabel(l: TodoList): string {
    return l[0]!.toUpperCase() + l.slice(1);
  }

  // ─── Local keyboard (Esc closes, ⌘Enter saves title) ────────────────────
  function handleTitleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveTitle();
      titleInput?.blur();
    }
    if (event.key === 'Escape') {
      titleInput?.blur();
    }
  }

  function startEdit(field: NonNullable<typeof editingField>) {
    editingField = field;
  }

  function commitEdit() {
    saveMetadata();
  }

  /** `use:focusOnMount` — focuses (and selects, for text inputs) when the node mounts. */
  function focusOnMount(node: HTMLInputElement | HTMLSelectElement) {
    node.focus();
    if (node instanceof HTMLInputElement && node.type !== 'date') node.select();
  }
</script>

<aside class="inspector" aria-label="Task inspector">
  {#if todo}
    <header class="inspector-header">
      <div class="header-status" class:completed={todo.isCompleted}>
        <button
          type="button"
          class="status-check"
          onclick={toggleComplete}
          title={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
        >
          <span class="check-shell" class:checked={todo.isCompleted} aria-hidden="true">
            {#if todo.isCompleted}
              <CheckCircle2 size={14} strokeWidth={2.4} />
            {/if}
          </span>
          <span class="status-label">{todo.isCompleted ? 'Completed' : 'Open'}</span>
        </button>
        {#if todo.isCompleted && todo.dates.completedAt}
          <span class="status-time" title={formatDisplayDateTime(todo.dates.completedAt)}>
            {formatDisplayDate(todo.dates.completedAt)}
          </span>
        {/if}
      </div>
      <button type="button" class="close-button" onclick={() => onClose?.()} title="Close (Esc)" aria-label="Close details">
        <X size={14} strokeWidth={2} />
      </button>
    </header>

    <div class="title-field">
      <textarea
        bind:this={titleInput}
        bind:value={title}
        rows="2"
        name="task-title"
        placeholder="Untitled task"
        onblur={saveTitle}
        onkeydown={handleTitleKeydown}
      ></textarea>
    </div>

    <div class="quick-actions" aria-label="Move task">
      <button type="button" onclick={moveToToday}>Today</button>
      <button type="button" onclick={() => moveToList('anytime')} disabled={todo.source !== 'dedicated'} title={todo.source === 'dedicated' ? 'Move to Anytime' : 'Inline tasks stay in their note'}>Anytime</button>
      <button type="button" onclick={() => moveToList('someday')} disabled={todo.source !== 'dedicated'}>Someday</button>
      <button type="button" onclick={clearDates}>No date</button>
    </div>

    <div class="properties" role="list">
      <!-- Due date -->
      <div class="property" role="listitem">
        <span class="prop-label"><Calendar size={13} strokeWidth={2} /> Due</span>
        {#if editingField === 'due'}
          <input type="date" bind:value={dueDate} onchange={commitEdit} onblur={commitEdit} use:focusOnMount />
        {:else}
          <button type="button" class="prop-value" onclick={() => startEdit('due')}>
            {#if dueDate}{formatDisplayDate(parseDateInput(dueDate))}{:else}<span class="placeholder">Add a deadline</span>{/if}
          </button>
        {/if}
      </div>

      <!-- Start date -->
      <div class="property" role="listitem">
        <span class="prop-label"><Calendar size={13} strokeWidth={2} /> Start</span>
        {#if editingField === 'start'}
          <input type="date" bind:value={scheduledDate} onchange={commitEdit} onblur={commitEdit} use:focusOnMount />
        {:else}
          <button type="button" class="prop-value" onclick={() => startEdit('start')}>
            {#if scheduledDate}{formatDisplayDate(parseDateInput(scheduledDate))}{:else}<span class="placeholder">When to start</span>{/if}
          </button>
        {/if}
      </div>

      <!-- Priority -->
      <div class="property" role="listitem">
        <span class="prop-label"><Flag size={13} strokeWidth={2} /> Priority</span>
        {#if editingField === 'priority'}
          <SelectShell class="inspector-select-shell">
            <select bind:value={priority} onchange={commitEdit} onblur={commitEdit}>
              <option value="none">None</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </SelectShell>
        {:else}
          <button type="button" class="prop-value priority-{priority}" onclick={() => startEdit('priority')}>
            {priorityLabel(priority)}
          </button>
        {/if}
      </div>

      <!-- Area / List -->
      <div class="property" role="listitem">
        <span class="prop-label"><Archive size={13} strokeWidth={2} /> Area</span>
        {#if editingField === 'list'}
          <SelectShell class="inspector-select-shell">
            <select bind:value={list} onchange={commitEdit} onblur={commitEdit} disabled={todo.source !== 'dedicated'}>
              <option value="inbox">Inbox</option>
              <option value="anytime">Anytime</option>
              <option value="someday">Someday</option>
            </select>
          </SelectShell>
        {:else}
          <button
            type="button"
            class="prop-value"
            class:disabled={todo.source !== 'dedicated'}
            onclick={() => todo.source === 'dedicated' && startEdit('list')}
          >
            {listLabel(list)}
            {#if todo.source !== 'dedicated'}<span class="hint">· inline</span>{/if}
          </button>
        {/if}
      </div>

      <!-- Repeats -->
      <div class="property" role="listitem">
        <span class="prop-label"><Repeat size={13} strokeWidth={2} /> Repeats</span>
        {#if editingField === 'repeats'}
          <input type="text" bind:value={recurrence} placeholder="every week" onblur={commitEdit} onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); }} use:focusOnMount />
        {:else}
          <button type="button" class="prop-value" onclick={() => startEdit('repeats')}>
            {#if recurrence}{recurrence}{:else}<span class="placeholder">No repeat</span>{/if}
          </button>
        {/if}
      </div>

      <!-- Tags -->
      <div class="property property-tags" role="listitem">
        <span class="prop-label"><Tag size={13} strokeWidth={2} /> Tags</span>
        {#if editingField === 'tags'}
          <input type="text" bind:value={tags} placeholder="work, follow-up" onblur={commitEdit} onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); }} use:focusOnMount />
        {:else}
          <button type="button" class="prop-value tags-value" onclick={() => startEdit('tags')}>
            {#if tags.trim()}
              {#each parseTags(tags) as tagName (tagName)}<span class="tag-chip">#{tagName}</span>{/each}
            {:else}
              <span class="placeholder">Add tags</span>
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <div class="reference-bar" aria-label="Task reference">
      <button type="button" class="ref-button" onclick={openSource} title={todo.sourceFile}>
        <FileText size={13} strokeWidth={2} />
        <span>{getFileName(todo.sourceFile)}</span>
      </button>
      <button type="button" class="ref-button" onclick={copyRef} title="Copy task ref" aria-label="Copy task ref">
        <Hash size={13} strokeWidth={2} />
        <span>Copy ref</span>
      </button>
    </div>

    <button type="button" class="delete-button" onclick={remove}>
      <Trash2 size={13} strokeWidth={2} />
      <span>Delete task</span>
    </button>
  {:else}
    <div class="empty-inspector">
      <h2>No task selected</h2>
      <p>Pick a task to edit its dates, priority, area, and tags.</p>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    min-width: 0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 18px 18px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg-sidebar);
  }

  /* ─── Header ─────────────────────────────────────────────────────────── */
  .inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .header-status {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .status-check {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    padding: 3px 11px 3px 4px;
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .status-check:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .header-status.completed .status-check {
    color: var(--color-success);
    border-color: color-mix(in srgb, var(--color-success) 22%, var(--border-light));
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
  }

  .check-shell {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--border-dark);
    border-radius: var(--radius-full);
    background: var(--bg-editor);
    color: transparent;
  }

  .check-shell.checked {
    border-color: var(--color-success);
    background: var(--color-success);
    color: var(--text-inverse);
  }

  .status-time {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .close-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .close-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ─── Title ──────────────────────────────────────────────────────────── */
  .title-field textarea {
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 18px;
    line-height: 1.35;
    font-weight: 600;
    letter-spacing: -0.012em;
    resize: vertical;
    min-height: 56px;
    padding: 6px 8px;
    outline: none;
    box-sizing: border-box;
    transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  }

  .title-field textarea:hover:not(:focus) {
    background: var(--bg-hover);
  }

  .title-field textarea:focus {
    border-color: var(--accent-primary);
    background: var(--bg-card);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  /* ─── Quick actions ──────────────────────────────────────────────────── */
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .quick-actions button {
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .quick-actions button:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .quick-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── Properties ─────────────────────────────────────────────────────── */
  .properties {
    display: grid;
    gap: 0;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    overflow: hidden;
  }

  .property {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 4px 12px;
    border-top: 1px solid var(--border-faint);
  }

  .property:first-child {
    border-top: 0;
  }

  .prop-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 500;
  }

  .prop-value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    padding: 4px 8px;
    margin-left: -8px;
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    width: calc(100% + 8px);
  }

  .prop-value:hover {
    background: var(--bg-hover);
  }

  .prop-value.disabled {
    cursor: not-allowed;
    color: var(--text-tertiary);
  }

  .prop-value.priority-high { color: var(--color-error); }
  .prop-value.priority-medium { color: var(--color-warning); }
  .prop-value.priority-low { color: var(--text-tertiary); }
  .prop-value.priority-none { color: var(--text-tertiary); }

  .placeholder {
    color: var(--text-placeholder);
    font-weight: 400;
  }

  .hint {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .property input[type='date'],
  .property input[type='text'] {
    width: calc(100% + 8px);
    margin-left: -8px;
    min-height: 28px;
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    padding: 4px 8px;
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  :global(.inspector-select-shell) {
    --select-min-height: 28px;
    --select-padding-x: 8px;
    --select-padding-y: 4px;
    width: calc(100% + 8px);
    margin-left: -8px;
  }

  .property-tags {
    align-items: start;
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .tags-value {
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 28px;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    min-height: 18px;
    border-radius: var(--radius-full);
    background: var(--accent-light);
    color: var(--accent-primary);
    padding: 0 7px;
    font-size: 11px;
    font-weight: 500;
  }

  /* ─── Reference bar ──────────────────────────────────────────────────── */
  .reference-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }

  .ref-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .ref-button:first-child {
    min-width: 0;
  }

  .ref-button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ref-button:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ref-button:first-child:hover {
    color: var(--accent-primary);
    background: var(--accent-light);
    border-color: color-mix(in srgb, var(--accent-primary) 22%, var(--border-light));
  }

  /* ─── Danger ─────────────────────────────────────────────────────────── */
  .delete-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 32px;
    margin-top: auto;
    border: 1px solid color-mix(in srgb, var(--color-error) 22%, var(--border-light));
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-error);
    padding: 0 12px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .delete-button:hover {
    background: var(--color-error-bg);
  }

  /* ─── Empty ──────────────────────────────────────────────────────────── */
  .empty-inspector {
    display: grid;
    align-content: center;
    gap: 6px;
    min-height: 200px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .empty-inspector h2 {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-h3);
    font-weight: 600;
  }

  .empty-inspector p {
    margin: 0;
    font-size: var(--text-small);
    line-height: 1.5;
  }
</style>
