<script lang="ts">
  /**
   * TodoFilters - Filter controls for the todo list
   *
   * Provides filtering by status, source type, priority, and text search.
   * Includes a clear filters button when filters are active.
   */

  import type { TodoFilter } from '$lib/domain/values/TodoFilter';
  import type { TodoSource } from '$lib/domain/values/TodoSource';
  import type { TodoPriority } from '$lib/domain/values/TodoPriority';
  import { ALL_TODO_SOURCES, getTodoSourceDisplayName } from '$lib/domain/values/TodoSource';
  import { ALL_TODO_PRIORITIES, getPriorityDisplayName } from '$lib/domain/values/TodoPriority';
  import { todoStore } from '$lib/stores';
  import SelectShell from '$lib/components/shared/SelectShell.svelte';

  interface Props {
    /** Whether to show filters in expanded or collapsed state */
    expanded?: boolean;
  }

  let { expanded = true }: Props = $props();

  // Local state for filter values
  let statusValue = $state<'all' | 'open' | 'completed'>(todoStore.filter.status ?? 'open');
  let sourceValue = $state<TodoSource | 'all'>('all');
  let priorityValue = $state<TodoPriority | 'all'>('all');
  let searchValue = $state(todoStore.filter.search ?? '');

  // Debounce timer for search
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Handle status filter change */
  async function handleStatusChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    statusValue = target.value as 'all' | 'open' | 'completed';
    await todoStore.updateFilter('status', statusValue);
  }

  /** Handle source filter change */
  async function handleSourceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    sourceValue = target.value as TodoSource | 'all';

    if (sourceValue === 'all') {
      // Remove source filter
      const { source: _, ...rest } = todoStore.filter;
      await todoStore.setFilter(rest);
    } else {
      await todoStore.updateFilter('source', sourceValue);
    }
  }

  /** Handle priority filter change */
  async function handlePriorityChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    priorityValue = target.value as TodoPriority | 'all';

    if (priorityValue === 'all') {
      // Remove priority filter
      const { priority: _, ...rest } = todoStore.filter;
      await todoStore.setFilter(rest);
    } else {
      await todoStore.updateFilter('priority', [priorityValue]);
    }
  }

  /** Handle search input with debounce */
  function handleSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    searchValue = target.value;

    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Debounce search by 300ms
    searchTimeout = setTimeout(async () => {
      if (searchValue.trim()) {
        await todoStore.updateFilter('search', searchValue.trim());
      } else {
        // Remove search filter
        const { search: _, ...rest } = todoStore.filter;
        await todoStore.setFilter(rest);
      }
    }, 300);
  }

  /** Clear all filters */
  async function handleClearFilters() {
    statusValue = 'open';
    sourceValue = 'all';
    priorityValue = 'all';
    searchValue = '';
    await todoStore.clearFilters();
  }
</script>

<div class="todo-filters" class:collapsed={!expanded}>
  <div class="filters-grid">
    <div class="filter-group">
      <label for="status-filter">Status</label>
      <SelectShell class="todo-filter-select-shell">
        <select id="status-filter" name="todo-status-filter" value={statusValue} onchange={handleStatusChange}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>
      </SelectShell>
    </div>

    <div class="filter-group">
      <label for="source-filter">Source</label>
      <SelectShell class="todo-filter-select-shell">
        <select id="source-filter" name="todo-source-filter" value={sourceValue} onchange={handleSourceChange}>
          <option value="all">All Sources</option>
          {#each ALL_TODO_SOURCES as source (source)}
            <option value={source}>{getTodoSourceDisplayName(source)}</option>
          {/each}
        </select>
      </SelectShell>
    </div>

    <div class="filter-group">
      <label for="priority-filter">Priority</label>
      <SelectShell class="todo-filter-select-shell">
        <select id="priority-filter" name="todo-priority-filter" value={priorityValue} onchange={handlePriorityChange}>
          <option value="all">All Priorities</option>
          {#each ALL_TODO_PRIORITIES as priority (priority)}
            <option value={priority}>{getPriorityDisplayName(priority)}</option>
          {/each}
        </select>
      </SelectShell>
    </div>
  </div>

  <div class="search-row">
    <div class="search-group">
      <input
        type="text"
        placeholder="Search todos..."
        value={searchValue}
        oninput={handleSearchInput}
        aria-label="Search todos"
      />
      {#if searchValue}
        <button
          class="clear-search"
          onclick={() => {
            searchValue = '';
            const { search: _, ...rest } = todoStore.filter;
            todoStore.setFilter(rest);
          }}
          aria-label="Clear search"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="icon">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      {/if}
    </div>

    {#if todoStore.hasActiveFilters}
      <button class="clear-filters-btn" onclick={handleClearFilters}>
        Clear Filters
      </button>
    {/if}
  </div>
</div>

<style>
  .todo-filters {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    background-color: var(--bg-subtle);
    border-radius: 0.5rem;
    border: 1px solid var(--border-light);
  }

  .todo-filters.collapsed {
    display: none;
  }

  .filters-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .filter-group label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.todo-filter-select-shell) {
    --select-bg: var(--bg-card);
    --select-radius: var(--radius-sm);
    --select-min-height: 32px;
    --select-padding-x: 10px;
    --select-padding-y: 6px;
    width: 100%;
  }

  .filter-group select {
    padding: 0.375rem 2rem 0.375rem 0.625rem;
    font-size: 0.8125rem;
    border: 1px solid var(--border-light);
    border-radius: 0.375rem;
    background-color: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
  }

  .filter-group select:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .search-group {
    flex: 1;
    position: relative;
  }

  .search-group input {
    width: 100%;
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    font-size: 0.8125rem;
    border: 1px solid var(--border-primary);
    border-radius: 0.375rem;
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    transition: border-color 0.15s ease;
  }

  .search-group input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .search-group input::placeholder {
    color: var(--text-muted);
  }

  .clear-search {
    position: absolute;
    right: 0.375rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: color 0.15s ease;
  }

  .clear-search:hover {
    color: var(--text-primary);
  }

  .clear-search .icon {
    width: 0.875rem;
    height: 0.875rem;
  }

  .clear-filters-btn {
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--border-primary);
    border-radius: 0.375rem;
    background-color: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .clear-filters-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
</style>
