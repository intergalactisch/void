<script lang="ts">
  /**
   * TodoItem - Display a single todo with interactive controls
   *
   * Renders a todo item with checkbox, content, priority indicator,
   * due date, tags, and action buttons. Supports toggling, editing,
   * and deletion.
   */

  import type { Todo } from '$lib/domain/entities/Todo';
  import { DATE_MARKERS, isOverdue, isDueToday } from '$lib/domain/values/TodoDateMeta';
  import { todoStore } from '$lib/stores';

  interface Props {
    /** The todo to display */
    todo: Todo;
    /** Callback when user wants to edit the todo */
    onEdit?: (todo: Todo) => void;
    /** Callback when user clicks the source file to navigate to it */
    onNavigateToFile?: (filePath: string) => void;
  }

  let { todo, onEdit, onNavigateToFile }: Props = $props();

  /** Toggle completion state */
  async function handleToggle() {
    await todoStore.toggle(todo.id);
  }

  /** Delete the todo */
  async function handleDelete() {
    await todoStore.delete(todo.id);
  }

  /** Handle click on todo content (trigger edit) */
  function handleContentClick() {
    onEdit?.(todo);
  }

  /** Handle click on source file to navigate */
  function handleSourceClick() {
    onNavigateToFile?.(todo.sourceFile);
  }

  /** Get priority indicator emoji */
  function getPriorityEmoji(priority: 'high' | 'medium' | 'low' | undefined): string {
    switch (priority) {
      case 'high':
        return DATE_MARKERS.HIGH_PRIORITY;
      case 'medium':
        return DATE_MARKERS.MEDIUM_PRIORITY;
      case 'low':
        return DATE_MARKERS.LOW_PRIORITY;
      default:
        return '';
    }
  }

  /** Format due date for display */
  function formatDueDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateOnly.getTime() === today.getTime()) {
      return 'Today';
    }
    if (dateOnly.getTime() === tomorrow.getTime()) {
      return 'Tomorrow';
    }

    // Show relative date for nearby dates
    const diffDays = Math.round((dateOnly.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) {
      return Math.abs(diffDays) === 1 ? 'Yesterday' : `${Math.abs(diffDays)} days ago`;
    }
    if (diffDays <= 7) {
      return `In ${diffDays} days`;
    }

    // Show date for far dates
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  /** Get filename from full path */
  function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? path;
  }

  /** Format a date as short relative or absolute */
  function formatMetaDate(date: Date): string {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  }

  // Derived state
  const priorityEmoji = $derived(getPriorityEmoji(todo.priority));
  const isOverdueTask = $derived(!todo.isCompleted && isOverdue(todo.dates));
  const isDueTodayTask = $derived(!todo.isCompleted && isDueToday(todo.dates));
</script>

<div
  class="todo-item"
  class:completed={todo.isCompleted}
  class:overdue={isOverdueTask}
  class:due-today={isDueTodayTask}
>
  <div class="todo-checkbox">
    <input
      type="checkbox"
      checked={todo.isCompleted}
      onchange={handleToggle}
      aria-label={todo.isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
    />
  </div>

  <div
    class="todo-content"
    onclick={handleContentClick}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleContentClick();
      }
    }}
    role="button"
    tabindex="0"
  >
    {#if priorityEmoji}
      <span class="priority-indicator" title={`${todo.priority} priority`}>
        {priorityEmoji}
      </span>
    {/if}

    <span class="todo-text">{todo.content}</span>

    {#if todo.dates.dueDate}
      <span class="due-date" class:overdue={isOverdueTask} class:due-today={isDueTodayTask}>
        {DATE_MARKERS.DUE} {formatDueDate(todo.dates.dueDate)}
      </span>
    {/if}
  </div>

  {#if todo.tags.length > 0}
    <div class="todo-tags">
      {#each todo.tags as tag (tag)}
        <span class="tag">#{tag}</span>
      {/each}
    </div>
  {/if}

  <div class="todo-meta">
    {#if todo.dates.createdAt || todo.dates.completedAt}
      <span class="date-meta">
        {#if todo.dates.createdAt}
          <span class="date-info" title="Created {todo.dates.createdAt.toISOString().slice(0, 10)}">
            {DATE_MARKERS.CREATED} {formatMetaDate(todo.dates.createdAt)}
          </span>
        {/if}
        {#if todo.dates.completedAt}
          <span class="date-info" title="Completed {todo.dates.completedAt.toISOString().slice(0, 16)}">
            {DATE_MARKERS.COMPLETED} {formatMetaDate(todo.dates.completedAt)}
          </span>
        {/if}
      </span>
    {/if}
    <button
      class="source-file"
      title={todo.sourceFile}
      onclick={handleSourceClick}
    >
      {getFileName(todo.sourceFile)}
    </button>
  </div>

  <div class="todo-actions">
    <button
      class="action-button delete"
      onclick={handleDelete}
      title="Delete todo"
      aria-label="Delete todo"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="icon">
        <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>
</div>

<style>
  .todo-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background-color: var(--bg-sidebar);
    border: 1px solid var(--border-light);
    transition: all 0.15s ease;
  }

  .todo-item:hover {
    border-color: var(--border-medium);
    background-color: var(--bg-hover);
  }

  .todo-item.completed {
    opacity: 0.6;
  }

  .todo-item.completed .todo-text {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  .todo-item.overdue {
    border-color: var(--color-error);
    background-color: var(--color-error-bg);
  }

  .todo-item.due-today {
    border-color: var(--color-warning);
    background-color: var(--color-warning-bg);
  }

  .todo-checkbox {
    flex-shrink: 0;
    padding-top: 0.125rem;
  }

  .todo-checkbox input[type='checkbox'] {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
    accent-color: var(--accent-primary);
  }

  .todo-content {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    min-width: 0;
  }

  .todo-content:focus {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
    border-radius: 0.25rem;
  }

  .priority-indicator {
    flex-shrink: 0;
  }

  .todo-text {
    color: var(--text-primary);
    word-break: break-word;
  }

  .due-date {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .due-date.overdue {
    color: var(--color-error);
    font-weight: 500;
  }

  .due-date.due-today {
    color: var(--color-warning);
    font-weight: 500;
  }

  .todo-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .tag {
    font-size: 0.6875rem;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    background-color: var(--accent-secondary);
    color: var(--accent-primary);
  }

  .todo-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
  }

  .date-meta {
    display: flex;
    gap: 0.5rem;
  }

  .date-info {
    font-size: 0.625rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .source-file {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .source-file:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .todo-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .todo-item:hover .todo-actions {
    opacity: 1;
  }

  .action-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background-color: var(--bg-sidebar);
  }

  .action-button.delete:hover {
    color: var(--color-error);
    background-color: var(--color-error-bg);
  }

  .icon {
    width: 0.875rem;
    height: 0.875rem;
  }
</style>
