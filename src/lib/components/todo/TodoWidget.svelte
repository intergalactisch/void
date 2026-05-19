<script lang="ts">
  /**
   * TodoWidget - Compact todo status widget
   *
   * A small widget for sidebar or status bar that shows:
   * - Open todo count
   * - Overdue count (if any)
   * - Next due todo (optional)
   * Click to open the full Tasks workspace.
   */

  import { todoStore } from '$lib/stores';
  import { events } from '$lib/events';

  interface Props {
    /** Show the next due todo preview */
    showNextDue?: boolean;
    /** Compact mode (icon only) */
    compact?: boolean;
  }

  let { showNextDue = true, compact = false }: Props = $props();

  /** Format due date for widget display */
  function formatDueDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateOnly.getTime() === today.getTime()) {
      return 'Today';
    }

    const diffDays = Math.round((dateOnly.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) {
      return Math.abs(diffDays) === 1 ? 'Yesterday' : `${Math.abs(diffDays)}d ago`;
    }
    if (diffDays === 1) {
      return 'Tomorrow';
    }
    if (diffDays <= 7) {
      return `${diffDays}d`;
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  /** Truncate text to max length */
  function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '...';
  }

  /** Handle widget click */
  function handleClick() {
    events.emit('app:navigate', { view: 'tasks' });
  }

  // Derived state
  const hasOverdue = $derived(todoStore.stats.overdue > 0);
  const nextDue = $derived(todoStore.nextDueTodo);
</script>

<button
  class="todo-widget"
  class:compact
  class:has-overdue={hasOverdue}
  onclick={handleClick}
  aria-label="Open tasks workspace"
  title="Open tasks workspace"
>
  <div class="widget-icon">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13zm10.857 5.691a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 00-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
    </svg>
  </div>

  {#if !compact}
    <div class="widget-content">
      <div class="widget-counts">
        <span class="open-count">{todoStore.stats.open}</span>
        {#if hasOverdue}
          <span class="overdue-count">{todoStore.stats.overdue}</span>
        {/if}
      </div>

      {#if showNextDue && nextDue}
        <div class="next-due">
          <span class="next-due-content">{truncate(nextDue.content, 20)}</span>
          {#if nextDue.dates.dueDate}
            <span class="next-due-date">{formatDueDate(nextDue.dates.dueDate)}</span>
          {/if}
        </div>
      {/if}
    </div>
  {:else if todoStore.stats.open > 0}
    <span class="badge">{todoStore.stats.open}</span>
  {/if}
</button>

<style>
  .todo-widget {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.625rem;
    background-color: var(--bg-sidebar);
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.8125rem;
  }

  .todo-widget:hover {
    background-color: var(--bg-hover);
    border-color: var(--border-medium);
  }

  .todo-widget.has-overdue {
    border-color: var(--color-error);
  }

  .todo-widget.compact {
    padding: 0.375rem;
    position: relative;
  }

  .widget-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .todo-widget.has-overdue .widget-icon {
    color: var(--color-error);
  }

  .widget-icon svg {
    width: 100%;
    height: 100%;
  }

  .widget-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .widget-counts {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    font-weight: 500;
  }

  .open-count {
    color: var(--text-primary);
  }

  .overdue-count {
    font-size: 0.6875rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background-color: var(--color-error-bg);
    color: var(--color-error);
  }

  .next-due {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .next-due-content {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 8rem;
  }

  .next-due-date {
    flex-shrink: 0;
    opacity: 0.75;
  }

  .badge {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    min-width: 1rem;
    height: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 600;
    background-color: var(--accent-primary);
    color: white;
    border-radius: 9999px;
    padding: 0 0.25rem;
  }
</style>
