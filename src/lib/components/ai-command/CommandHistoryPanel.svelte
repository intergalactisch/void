<script lang="ts">
  import {
    Bot,
    BriefcaseBusiness,
    CalendarDays,
    MessageSquare,
    Plus,
    RotateCcw,
    Search,
    Trash2,
    X,
  } from '@lucide/svelte';
  import type { ConversationSummary } from '$lib/ports/outbound/ConversationStoragePort';
  import type { AgentRunSummary } from '$lib/ports/outbound/AgentRunStoragePort';
  import type { OperationSummary } from '$lib/ports/inbound/OperationService';
  import type { CommandWorkDatePreset } from '$lib/stores/commandCenter.svelte';
  import { aiStore, commandCenterStore, operationsStore } from '$lib/stores';
  import { SelectShell, VirtualList } from '$lib/components/shared';

  type WorkItem =
    | { kind: 'thread'; summary: ConversationSummary }
    | { kind: 'run'; summary: AgentRunSummary }
    | { kind: 'job'; summary: OperationSummary };

  let filters = $derived(commandCenterStore.workIndexFilters);
  let currentConversationId = $derived(aiStore.currentConversation?.id ?? null);
  let rows = $state<WorkItem[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let total = $state<number | null>(null);
  let nextCursor = $state<string | null>(null);
  let loadTimer: ReturnType<typeof setTimeout> | null = null;

  const kindOptions = [
    { kind: 'threads', label: 'Threads', icon: MessageSquare },
    { kind: 'runs', label: 'Runs', icon: Bot },
    { kind: 'jobs', label: 'Jobs', icon: BriefcaseBusiness },
  ] as const;

  const presetOptions = [
    { value: 'all', label: 'All time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 days' },
    { value: 'month', label: '30 days' },
    { value: 'custom', label: 'Range' },
  ] as const;

  let statusOptions = $derived.by(() => {
    if (filters.kind === 'threads') {
      return [
        { value: 'all', label: 'All' },
        { value: 'active', label: 'Active' },
        { value: 'completed', label: 'Done' },
        { value: 'archived', label: 'Archived' },
      ];
    }
    if (filters.kind === 'runs') {
      return [
        { value: 'all', label: 'All' },
        { value: 'active', label: 'Live' },
        { value: 'terminal', label: 'Finished' },
        { value: 'completed', label: 'Done' },
        { value: 'failed', label: 'Failed' },
      ];
    }
    return [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Live' },
      { value: 'terminal', label: 'Finished' },
      { value: 'completed', label: 'Done' },
      { value: 'failed', label: 'Failed' },
      { value: 'cancelled', label: 'Cancelled' },
    ];
  });

  let loadKey = $derived(JSON.stringify(filters));

  $effect(() => {
    loadKey;
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      void loadRows();
    }, 160);
  });

  function dateRange(): { dateFrom?: string; dateTo?: string } {
    const now = new Date();
    if (filters.datePreset === 'all') return {};
    if (filters.datePreset === 'custom') {
      const range: { dateFrom?: string; dateTo?: string } = {};
      if (filters.dateFrom) range.dateFrom = new Date(`${filters.dateFrom}T00:00:00`).toISOString();
      if (filters.dateTo) range.dateTo = new Date(`${filters.dateTo}T23:59:59.999`).toISOString();
      return range;
    }
    const from = new Date(now);
    if (filters.datePreset === 'today') from.setHours(0, 0, 0, 0);
    if (filters.datePreset === 'week') from.setDate(from.getDate() - 7);
    if (filters.datePreset === 'month') from.setDate(from.getDate() - 30);
    return { dateFrom: from.toISOString() };
  }

  function baseQuery(): {
    query?: string;
    limit: number;
    cursor: string | null;
    dateFrom?: string;
    dateTo?: string;
  } {
    const query = {
      limit: filters.pageSize,
      cursor: filters.cursor,
      ...dateRange(),
    };
    return filters.query.trim() ? { ...query, query: filters.query.trim() } : query;
  }

  async function loadRows() {
    loading = true;
    error = null;
    try {
      const base = baseQuery();

      if (filters.kind === 'threads') {
        const status = filters.status === 'all' ? 'all' : filters.status as 'active' | 'completed' | 'archived';
        const page = await aiStore.loadConversationSummaries({ ...base, status });
        const pageRows = page.items.map((summary) => ({ kind: 'thread' as const, summary }));
        rows = filters.cursor ? [...rows, ...pageRows] : pageRows;
        nextCursor = page.nextCursor;
        total = page.total;
        return;
      }

      if (filters.kind === 'runs') {
        const page = await aiStore.loadAgentRunSummaries({ ...base, status: filters.status as never });
        const pageRows = page.items.map((summary) => ({ kind: 'run' as const, summary }));
        rows = filters.cursor ? [...rows, ...pageRows] : pageRows;
        nextCursor = page.nextCursor;
        total = page.total;
        return;
      }

      const page = await operationsStore.loadOperationSummaries({ ...base, status: filters.status as never });
      const pageRows = page.items.map((summary) => ({ kind: 'job' as const, summary }));
      rows = filters.cursor ? [...rows, ...pageRows] : pageRows;
      nextCursor = page.nextCursor;
      total = page.total;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openThread(summary: ConversationSummary) {
    await aiStore.switchConversation(summary.id);
    commandCenterStore.showNow();
    commandCenterStore.showConversationDetail();
  }

  async function openRun(summary: AgentRunSummary) {
    await aiStore.loadAgentRun(summary.id);
    commandCenterStore.selectRun(summary.id);
    commandCenterStore.showNow();
    commandCenterStore.showConversationDetail();
  }

  function openJob(summary: OperationSummary) {
    operationsStore.selectOperation(summary.id);
    commandCenterStore.selectResultOperation(summary.id);
  }

  async function startNewCommand() {
    await aiStore.newConversation();
    commandCenterStore.reset();
    commandCenterStore.showConversationDetail();
  }

  async function deleteConversation(id: string) {
    const wasCurrentConversation = id === currentConversationId;
    await aiStore.deleteConversation(id);
    if (wasCurrentConversation) {
      commandCenterStore.reset();
    }
    commandCenterStore.handleConversationDeleted(id);
    void loadRows();
  }

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function statusLabel(value: string): string {
    return value.replace(/_/g, ' ');
  }

  function rowTitle(item: WorkItem): string {
    if (item.kind === 'thread') return item.summary.title;
    if (item.kind === 'run') return item.summary.prompt;
    return item.summary.label;
  }

  function rowPreview(item: WorkItem): string {
    if (item.kind === 'thread') return item.summary.preview || 'No preview';
    if (item.kind === 'run') {
      return `${statusLabel(item.summary.status)} / ${item.summary.completedTaskCount}/${item.summary.taskCount} tasks / ${item.summary.artifactCount} outputs`;
    }
    return `${statusLabel(item.summary.status)} / ${item.summary.outputCount} outputs`;
  }

  function rowMeta(item: WorkItem): string {
    if (item.kind === 'thread') {
      return item.summary.id === currentConversationId ? 'Open now' : `${item.summary.messageCount} messages`;
    }
    if (item.kind === 'run') {
      return `${item.summary.orchestrationMode} / ${item.summary.workerCount} workers`;
    }
    return item.summary.type;
  }

  function rowUpdatedAt(item: WorkItem): Date | string {
    return item.summary.updatedAt;
  }

  function chooseRow(item: WorkItem) {
    if (item.kind === 'thread') {
      void openThread(item.summary);
      return;
    }
    if (item.kind === 'run') {
      void openRun(item.summary);
      return;
    }
    openJob(item.summary);
  }
</script>

<div class="work-index">
  <div class="panel-head">
    <div>
      <h3>Work Index</h3>
      <span>{total ?? rows.length} {filters.kind}</span>
    </div>
    <button type="button" class="new-command" onclick={startNewCommand}>
      <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>New</span>
    </button>
  </div>

  <div class="kind-tabs" role="group" aria-label="Work index type">
    {#each kindOptions as option}
      {@const Icon = option.icon}
      <button
        type="button"
        class:active={filters.kind === option.kind}
        aria-pressed={filters.kind === option.kind}
        onclick={() => commandCenterStore.setWorkIndexKind(option.kind)}
      >
        <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>{option.label}</span>
      </button>
    {/each}
  </div>

  <div class="search-field">
    <Search size={14} strokeWidth={1.8} aria-hidden="true" />
    <input
      type="search"
      name="command-center-search"
      aria-label="Search command center work"
      placeholder="Search threads, runs, jobs..."
      value={filters.query}
      oninput={(event) => commandCenterStore.setWorkIndexQuery(event.currentTarget.value)}
    />
    {#if filters.query}
      <button type="button" aria-label="Clear search" onclick={() => commandCenterStore.setWorkIndexQuery('')}>
        <X size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>

  <div class="filter-row">
    <label>
      <span>Status</span>
      <SelectShell class="command-history-select-shell">
        <select
          name="command-center-status"
          aria-label="Filter work by status"
          value={filters.status}
          onchange={(event) => commandCenterStore.setWorkIndexStatus(event.currentTarget.value)}
        >
          {#each statusOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </SelectShell>
    </label>

    <label>
      <span>Date</span>
      <SelectShell class="command-history-select-shell">
        <select
          name="command-center-date-preset"
          aria-label="Filter work by date"
          value={filters.datePreset}
          onchange={(event) => commandCenterStore.setWorkIndexDatePreset(event.currentTarget.value as CommandWorkDatePreset)}
        >
          {#each presetOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </SelectShell>
    </label>
  </div>

  {#if filters.datePreset === 'custom'}
    <div class="date-range">
      <label>
        <span>From</span>
        <input
          type="date"
          name="command-center-date-from"
          aria-label="Filter from date"
          value={filters.dateFrom}
          onchange={(event) => commandCenterStore.setWorkIndexDateRange(event.currentTarget.value, filters.dateTo)}
        />
      </label>
      <label>
        <span>To</span>
        <input
          type="date"
          name="command-center-date-to"
          aria-label="Filter to date"
          value={filters.dateTo}
          onchange={(event) => commandCenterStore.setWorkIndexDateRange(filters.dateFrom, event.currentTarget.value)}
        />
      </label>
    </div>
  {/if}

  <div class="list-shell" aria-busy={loading}>
    <VirtualList items={rows} itemHeight={78} ariaLabel="Command center work results">
      {#snippet row(raw)}
        {@const item = raw as WorkItem}
        <div class="work-row" class:active={item.kind === 'thread' && item.summary.id === currentConversationId}>
          <button type="button" class="work-open" onclick={() => chooseRow(item)}>
            <span class="work-main">
              <strong>{rowTitle(item)}</strong>
              <span>{rowPreview(item)}</span>
            </span>
            <span class="work-meta">
              <span>{formatDate(rowUpdatedAt(item))}</span>
              <span>{rowMeta(item)}</span>
            </span>
          </button>
          {#if item.kind === 'thread'}
            <button
              type="button"
              class="work-delete"
              aria-label={`Delete conversation ${item.summary.title}`}
              onclick={() => deleteConversation(item.summary.id)}
            >
              <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
          {/if}
        </div>
      {/snippet}

      {#snippet empty()}
        <div class="empty">
          <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{loading ? 'Loading work...' : error ?? 'No matching work'}</span>
        </div>
      {/snippet}
    </VirtualList>
  </div>

  <div class="index-footer">
    <button type="button" class="ghost-action" onclick={() => commandCenterStore.resetWorkIndexFilters()}>
      <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>Reset</span>
    </button>
    <button
      type="button"
      class="ghost-action"
      disabled={!nextCursor || loading}
      onclick={() => commandCenterStore.setWorkIndexCursor(nextCursor)}
    >
      <CalendarDays size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>More</span>
    </button>
  </div>
</div>

<style>
  .work-index {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
    padding: 12px;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .panel-head div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .panel-head h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
  }

  .panel-head > div > span {
    color: var(--text-muted);
    font-size: 11px;
  }

  .new-command,
  .ghost-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .new-command:hover,
  .ghost-action:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ghost-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .kind-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
  }

  .kind-tabs button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    height: 26px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .kind-tabs button.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .kind-tabs span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-field {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 22px;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-muted);
  }

  .search-field:focus-within {
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-light);
  }

  .search-field input {
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
  }

  .search-field button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .filter-row,
  .date-range {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .filter-row label,
  .date-range label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .filter-row span,
  .date-range span {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
  }

  input[type='date'] {
    width: 100%;
    min-width: 0;
    height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
  }

  :global(.command-history-select-shell) {
    --select-min-height: 28px;
    --select-padding-x: 8px;
    --select-padding-y: 4px;
    --select-radius: var(--radius-sm);
    width: 100%;
    font-size: 11px;
  }

  .list-shell {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .work-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px;
    align-items: start;
    gap: 6px;
    height: 72px;
    padding: 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .work-row:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .work-row.active {
    border-color: var(--ai-border);
    background: var(--ai-tint);
  }

  .work-open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .work-main,
  .work-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .work-main strong,
  .work-main span,
  .work-meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .work-main strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .work-main span,
  .work-meta span {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .work-meta {
    align-items: flex-end;
    white-space: nowrap;
  }

  .work-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .work-delete:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .index-footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  @media (max-width: 900px) {
    .work-index {
      gap: 8px;
      padding: 10px 12px;
    }

    .filter-row,
    .date-range {
      grid-template-columns: 1fr;
    }

    .work-row {
      width: 260px;
    }
  }
</style>
