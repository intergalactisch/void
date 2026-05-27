<script lang="ts">
  import { MessageSquare, Plus, Search, Trash2, X } from '@lucide/svelte';
  import type { ConversationSummary } from '$lib/ports/outbound/ConversationStoragePort';
  import { aiStore, commandCenterStore } from '$lib/stores';
  import { VirtualList } from '$lib/components/shared';

  let currentConversationId = $derived(aiStore.currentConversation?.id ?? null);
  let activeRunConversationIds = $derived(commandCenterStore.activeRunConversationIds);

  let query = $state('');
  let rows = $state<ConversationSummary[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let total = $state<number | null>(null);
  let nextCursor = $state<string | null>(null);
  let loadTimer: ReturnType<typeof setTimeout> | null = null;

  // Reload the first page (debounced) when the query changes or the current
  // conversation changes — a new/switched conversation or a streamed message
  // bumps `currentConversation.id`/`updatedAt`, keeping titles + previews fresh.
  let loadKey = $derived(
    `${query.trim()}|${aiStore.currentConversation?.id ?? ''}|${aiStore.currentConversation?.updatedAt?.getTime() ?? 0}`
  );

  $effect(() => {
    loadKey;
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      void loadRows(null);
    }, 160);
  });

  async function loadRows(cursor: string | null) {
    loading = true;
    error = null;
    try {
      const trimmed = query.trim();
      const page = await aiStore.loadConversationSummaries({
        limit: 80,
        cursor,
        status: 'all',
        ...(trimmed ? { query: trimmed } : {}),
      });
      rows = cursor ? [...rows, ...page.items] : page.items;
      nextCursor = page.nextCursor;
      total = page.total;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openConversation(summary: ConversationSummary) {
    if (summary.id === currentConversationId) {
      commandCenterStore.showConversationDetail();
      return;
    }
    await aiStore.switchConversation(summary.id);
    commandCenterStore.clearSelectedRun();
    commandCenterStore.showConversationDetail();
  }

  async function startNewCommand() {
    if (!aiStore.ensureAIAvailable()) return;
    await aiStore.newConversation();
    commandCenterStore.reset();
    commandCenterStore.showConversationDetail();
  }

  async function deleteConversation(id: string) {
    const wasCurrent = id === currentConversationId;
    await aiStore.deleteConversation(id);
    if (wasCurrent) commandCenterStore.reset();
    commandCenterStore.handleConversationDeleted(id);
    void loadRows(null);
  }

  function setQuery(value: string) {
    query = value;
  }

  function relativeTime(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    const ms = Date.now() - date.getTime();
    if (Number.isNaN(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="conversation-list">
  <div class="panel-head">
    <div>
      <h3>Conversations</h3>
      <span>{total ?? rows.length}</span>
    </div>
    <button type="button" class="new-command" onclick={startNewCommand}>
      <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>New</span>
    </button>
  </div>

  <div class="search-field">
    <Search size={14} strokeWidth={1.8} aria-hidden="true" />
    <input
      type="search"
      name="command-center-search"
      aria-label="Search conversations"
      placeholder="Search conversations..."
      value={query}
      oninput={(event) => setQuery(event.currentTarget.value)}
    />
    {#if query}
      <button type="button" aria-label="Clear search" onclick={() => setQuery('')}>
        <X size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>

  <div class="list-shell" aria-busy={loading}>
    <VirtualList items={rows} itemHeight={68} ariaLabel="Conversations">
      {#snippet row(raw)}
        {@const summary = raw as ConversationSummary}
        {@const isActive = summary.id === currentConversationId}
        {@const isLive = activeRunConversationIds.has(summary.id)}
        <div class="conv-row" class:active={isActive}>
          <button type="button" class="conv-open" onclick={() => openConversation(summary)}>
            <span class="conv-mark" class:live={isLive} aria-hidden="true"></span>
            <span class="conv-main">
              <strong>{summary.title}</strong>
              <span class="conv-preview">{summary.preview || 'No preview'}</span>
            </span>
            <span class="conv-time">{relativeTime(summary.updatedAt)}</span>
          </button>
          <button
            type="button"
            class="conv-delete"
            aria-label={`Delete conversation ${summary.title}`}
            onclick={() => deleteConversation(summary.id)}
          >
            <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      {/snippet}

      {#snippet empty()}
        <div class="empty">
          <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{loading ? 'Loading...' : error ?? 'No conversations yet'}</span>
        </div>
      {/snippet}
    </VirtualList>
  </div>

  {#if nextCursor}
    <button type="button" class="more" disabled={loading} onclick={() => loadRows(nextCursor)}>
      Load more
    </button>
  {/if}
</div>

<style>
  .conversation-list {
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
    /* Reserve room for the pane's absolute collapse button (top-right) so the
       "New" button never sits underneath it. */
    padding-right: 30px;
  }

  .panel-head div {
    display: flex;
    align-items: baseline;
    gap: 6px;
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
    font-variant-numeric: tabular-nums;
  }

  .new-command {
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

  .new-command:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
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

  .list-shell {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .conv-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px;
    align-items: center;
    gap: 4px;
    height: 62px;
    padding: 0 6px 0 0;
    border-radius: var(--radius-md);
  }

  .conv-row:hover {
    background: var(--bg-hover);
  }

  .conv-row.active {
    background: var(--ai-tint);
  }

  .conv-open {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 100%;
    padding: 8px 4px 8px 8px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .conv-mark {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: transparent;
  }

  .conv-mark.live {
    background: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-light);
    animation: convLivePulse 1.5s ease-in-out infinite;
  }

  @keyframes convLivePulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  .conv-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .conv-main strong,
  .conv-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conv-main strong {
    color: var(--text-primary);
    font-size: 12.5px;
    font-weight: 600;
  }

  .conv-preview {
    color: var(--text-muted);
    font-size: 11px;
  }

  .conv-time {
    flex-shrink: 0;
    color: var(--text-placeholder);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .conv-delete {
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
    opacity: 0;
  }

  .conv-row:hover .conv-delete {
    opacity: 1;
  }

  .conv-delete:hover {
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

  .more {
    height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .more:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .more:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
