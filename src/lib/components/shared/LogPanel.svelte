<script lang="ts">
  /**
   * LogPanel - Bottom slide-up panel for viewing structured log entries.
   *
   * Shows filtered, searchable log entries like browser DevTools console.
   * Toggle with Cmd+Shift+L or via the StatusBar button.
   */

  import { logStore } from '$lib/stores';
  import type { LogLevel } from '$lib/domain/values/LogEntry';

  const LEVEL_FILTERS: Array<{ label: string; value: LogLevel | 'all' }> = [
    { label: 'All', value: 'all' },
    { label: 'Debug', value: 'debug' },
    { label: 'Info', value: 'info' },
    { label: 'Warn', value: 'warn' },
    { label: 'Error', value: 'error' },
  ];

  const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: 'var(--text-muted)',
    info: 'var(--accent-primary)',
    warn: 'var(--color-warning)',
    error: 'var(--color-error)',
  };

  let expandedIds = $state<Set<number>>(new Set());

  function toggleExpanded(index: number) {
    const next = new Set(expandedIds);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    expandedIds = next;
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }
</script>

{#if logStore.isOpen}
  <div class="log-panel" role="log" aria-label="Application logs">
    <!-- Header -->
    <div class="log-header">
      <div class="log-filters">
        {#each LEVEL_FILTERS as { label, value }}
          <button
            type="button"
            class="log-filter-tab"
            class:active={logStore.filter === value}
            onclick={() => logStore.setFilter(value)}
          >
            {label}
          </button>
        {/each}
      </div>

      <div class="log-actions">
        <input
          type="search"
          class="log-search"
          placeholder="Filter logs..."
          value={logStore.search}
          oninput={(e) => logStore.setSearch(e.currentTarget.value)}
        />
        <button type="button" class="log-action-btn" onclick={() => logStore.clear()} title="Clear logs">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <button type="button" class="log-action-btn" onclick={() => logStore.toggle()} title="Close log panel">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="log-body scrollbar-thin">
      {#each logStore.filteredEntries.toReversed() as entry, i (logStore.filteredEntries.length - 1 - i)}
        {@const globalIndex = logStore.filteredEntries.length - 1 - i}
        <div class="log-entry" class:log-entry-error={entry.level === 'error'} class:log-entry-warn={entry.level === 'warn'}>
          <span class="log-time">{formatTime(entry.timestamp)}</span>
          <span class="log-level" style="color: {LEVEL_COLORS[entry.level]};">{entry.level.toUpperCase()}</span>
          <span class="log-source">{entry.source}</span>
          <span class="log-message">{entry.message}</span>
          {#if entry.metadata}
            <button
              type="button"
              class="log-meta-toggle"
              onclick={() => toggleExpanded(globalIndex)}
              title="Toggle metadata"
            >
              {expandedIds.has(globalIndex) ? '\u25BC' : '\u25B6'}
            </button>
          {/if}

          {#if entry.metadata && expandedIds.has(globalIndex)}
            <pre class="log-metadata">{JSON.stringify(entry.metadata, null, 2)}</pre>
          {/if}
        </div>
      {/each}

      {#if logStore.filteredEntries.length === 0}
        <div class="log-empty">No log entries</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .log-panel {
    position: fixed;
    bottom: var(--statusbar-height, 24px);
    left: 0;
    right: 0;
    height: 280px;
    background: var(--bg-sidebar);
    border-top: 1px solid var(--border-light);
    display: flex;
    flex-direction: column;
    z-index: var(--z-overlay);
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
    gap: 8px;
  }

  .log-filters {
    display: flex;
    gap: 2px;
  }

  .log-filter-tab {
    padding: 2px 8px;
    font-size: 11px;
    font-family: var(--font-sans);
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .log-filter-tab:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .log-filter-tab.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .log-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .log-search {
    width: 160px;
    padding: 2px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-primary);
    outline: none;
  }

  .log-search:focus {
    border-color: var(--accent-primary);
  }

  .log-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .log-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .log-body {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
  }

  .log-entry {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 8px;
    flex-wrap: wrap;
    border-bottom: 1px solid transparent;
  }

  .log-entry:hover {
    background: var(--bg-hover);
  }

  .log-entry-error {
    background: color-mix(in srgb, var(--color-error) 5%, transparent);
  }

  .log-entry-warn {
    background: color-mix(in srgb, var(--color-warning) 5%, transparent);
  }

  .log-time {
    color: var(--text-placeholder);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .log-level {
    font-weight: 600;
    font-size: 10px;
    width: 40px;
    flex-shrink: 0;
    text-align: center;
  }

  .log-source {
    color: var(--text-muted);
    flex-shrink: 0;
    font-weight: 500;
  }

  .log-message {
    color: var(--text-primary);
    word-break: break-word;
    flex: 1;
    min-width: 0;
  }

  .log-meta-toggle {
    font-size: 10px;
    padding: 0 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .log-meta-toggle:hover {
    color: var(--text-primary);
  }

  .log-metadata {
    width: 100%;
    margin: 2px 0 4px 96px;
    padding: 4px 8px;
    font-size: 11px;
    background: var(--bg-editor);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-empty {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
    font-family: var(--font-sans);
  }
</style>
