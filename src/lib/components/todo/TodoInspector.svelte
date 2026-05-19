<script lang="ts">
  import { Archive, Calendar, CheckCircle2, FileText, Flag, Hash, Repeat, Tag, Trash2, X } from '@lucide/svelte';
  import type { Todo, TodoUpdatePatch } from '$lib/domain/entities/Todo';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import type { TodoList } from '$lib/domain/values/TodoView';
  import { todoStore, toastStore } from '$lib/stores';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';

  interface Props {
    todo: Todo | null;
    onNavigateToFile?: (filePath: string) => void;
    onClose?: () => void;
  }

  let { todo, onNavigateToFile, onClose }: Props = $props();

  let title = $state('');
  let dueDate = $state('');
  let scheduledDate = $state('');
  let priority = $state<'none' | TodoPriority>('none');
  let list = $state<TodoList>('inbox');
  let tags = $state('');
  let recurrence = $state('');

  $effect(() => {
    title = todo?.content ?? '';
    dueDate = todo?.dates.dueDate ? formatDateInput(todo.dates.dueDate) : '';
    scheduledDate = todo?.dates.scheduledDate ? formatDateInput(todo.dates.scheduledDate) : '';
    priority = todo?.priority ?? 'none';
    list = todo?.list ?? 'inbox';
    tags = todo?.tags.join(', ') ?? '';
    recurrence = todo?.dates.recurrence ?? '';
  });

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
  }

  async function moveToToday() {
    if (!todo) return;
    const patch: TodoUpdatePatch = {
      scheduledDate: startOfToday(),
    };
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
    await todoStore.updatePatch(todo.id, {
      dueDate: null,
      scheduledDate: null,
    });
  }

  async function remove() {
    if (!todo) return;
    await todoStore.delete(todo.id);
    todoStore.selectTodo(todoStore.visibleTodos[0]?.id ?? null);
  }

  async function copyRef() {
    if (!todo) return;
    const success = await copyTextToClipboard(buildRefId({ kind: 'todo', todoId: todo.id }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function openSource() {
    if (todo) onNavigateToFile?.(todo.sourceFile);
  }

  function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? path;
  }

  function parseTags(value: string): string[] {
    return value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
  }

  function formatDateInput(date: Date): string {
    return date.toISOString().slice(0, 10);
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

  function parseDateInput(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year!, month! - 1, day);
  }

  function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
</script>

<aside class="inspector" aria-label="Task inspector">
  {#if todo}
    <div class="inspector-header">
      <div>
        <p class="eyebrow">Task</p>
        <h2>Details</h2>
      </div>
      <button type="button" class="icon-button close-button" onclick={() => onClose?.()} title="Close details" aria-label="Close details">
        <X size={15} strokeWidth={2} />
      </button>
    </div>

    <label class="title-field">
      <span>Title</span>
      <textarea
        bind:value={title}
        rows="3"
        name="task-title"
        onblur={saveTitle}
        onkeydown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveTitle();
        }}
      ></textarea>
    </label>

    {#if todo.isCompleted && todo.dates.completedAt}
      <div class="completion-meta" aria-label="Completed date">
        <span><CheckCircle2 size={14} strokeWidth={2} /> Completed</span>
        <strong>{formatDisplayDateTime(todo.dates.completedAt)}</strong>
      </div>
    {/if}

    <div class="quick-actions" aria-label="Task movement">
      <button type="button" onclick={moveToToday}>Today</button>
      <button type="button" onclick={() => moveToList('anytime')} disabled={todo.source !== 'dedicated'}>Anytime</button>
      <button type="button" onclick={() => moveToList('someday')} disabled={todo.source !== 'dedicated'}>Someday</button>
      <button type="button" onclick={clearDates}>No date</button>
    </div>

    <div class="field-grid">
      <label>
        <span><Calendar size={14} strokeWidth={2} /> Due</span>
        <input type="date" name="task-due-date" bind:value={dueDate} onchange={saveMetadata} />
      </label>

      <label>
        <span><Calendar size={14} strokeWidth={2} /> Start</span>
        <input type="date" name="task-scheduled-date" bind:value={scheduledDate} onchange={saveMetadata} />
      </label>

      <label>
        <span><Flag size={14} strokeWidth={2} /> Priority</span>
        <select name="task-priority" bind:value={priority} onchange={saveMetadata}>
          <option value="none">None</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>

      <label>
        <span><Archive size={14} strokeWidth={2} /> Area</span>
        <select name="task-list" bind:value={list} onchange={saveMetadata} disabled={todo.source !== 'dedicated'}>
          <option value="inbox">Inbox</option>
          <option value="anytime">Anytime</option>
          <option value="someday">Someday</option>
        </select>
      </label>

      <label>
        <span><Repeat size={14} strokeWidth={2} /> Repeats</span>
        <input
          type="text"
          name="task-recurrence"
          bind:value={recurrence}
          placeholder="every week"
          onblur={saveMetadata}
        />
      </label>
    </div>

    <label class="tags-field">
      <span><Tag size={14} strokeWidth={2} /> Tags</span>
      <input
        type="text"
        name="task-tags"
        bind:value={tags}
        placeholder="work, follow-up"
        onblur={saveMetadata}
      />
    </label>

    <div class="reference-actions" aria-label="Task reference actions">
      <button type="button" class="source-button" onclick={openSource} title={todo.sourceFile}>
        <FileText size={15} strokeWidth={2} />
        <span>{getFileName(todo.sourceFile)}</span>
      </button>
      <button type="button" class="ref-button" onclick={copyRef} title="Copy task ref" aria-label="Copy task ref">
        <Hash size={15} strokeWidth={2} />
        <span>Copy ref</span>
      </button>
    </div>

    <button type="button" class="delete-button" onclick={remove}>
      <Trash2 size={15} strokeWidth={2} />
      <span>Delete task</span>
    </button>
  {:else}
    <div class="empty-inspector">
      <h2>No task selected</h2>
      <p>Select a task to edit its dates, tags, priority, and source note.</p>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    min-width: 292px;
    width: 336px;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
    border-left: 1px solid var(--border-light);
    background: var(--bg-sidebar);
    padding: 18px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .inspector-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .close-button {
    flex: 0 0 auto;
    margin-left: auto;
  }

  .eyebrow {
    margin: 0 0 2px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
  }

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-h2);
    font-weight: var(--text-h2-weight);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--text-small);
    line-height: var(--text-small-line-height);
  }

  label span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  textarea,
  input,
  select {
    width: 100%;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    padding: 8px 9px;
    outline: none;
  }

  textarea:focus,
  input:focus,
  select:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .title-field textarea {
    resize: vertical;
    min-height: 88px;
    font-size: var(--text-body);
  }

  .completion-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    border: 1px solid color-mix(in srgb, var(--color-success) 22%, var(--border-light));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    color: var(--text-secondary);
    padding: 8px 10px;
    font-size: var(--text-small);
  }

  .completion-meta span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-success);
    font-weight: 600;
  }

  .completion-meta strong {
    color: var(--text-primary);
    font-weight: 500;
    text-align: right;
  }

  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
    padding-bottom: 2px;
  }

  .quick-actions button {
    min-height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    padding: 0 9px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
  }

  .quick-actions button:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .quick-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .field-grid,
  .tags-field {
    margin-top: 14px;
  }

  .field-grid {
    display: grid;
    gap: 12px;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .icon-button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .reference-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    margin-top: 18px;
  }

  .source-button,
  .ref-button,
  .delete-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
  }

  .source-button {
    min-width: 0;
    max-width: 100%;
    background: var(--bg-subtle);
    color: var(--text-secondary);
  }

  .source-button:hover {
    color: var(--accent-primary);
    background: var(--accent-light);
  }

  .source-button span,
  .ref-button span,
  .delete-button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ref-button {
    background: var(--bg-card);
    color: var(--text-secondary);
  }

  .ref-button:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .delete-button {
    justify-content: center;
    width: 100%;
    margin-top: 10px;
    border-color: color-mix(in srgb, var(--color-error) 28%, var(--border-light));
    background: transparent;
    color: var(--color-error);
  }

  .delete-button:hover {
    background: var(--color-error-bg);
  }

  .empty-inspector {
    display: grid;
    gap: 8px;
    min-height: 220px;
    align-content: center;
    color: var(--text-tertiary);
  }

  .empty-inspector p {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-body);
    line-height: 1.5;
  }

  @media (max-width: 980px) {
    .inspector {
      display: none;
    }
  }
</style>
