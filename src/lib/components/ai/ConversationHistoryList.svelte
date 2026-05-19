<script lang="ts">
  /**
   * ConversationHistoryList - Browsable list of past AI conversations
   *
   * Shows conversation summaries with search, click to resume,
   * and delete functionality.
   */

  import { aiStore } from '$lib/stores';
  import type { ConversationSummary } from '$lib/ports/outbound/ConversationStoragePort';

  let searchQuery = $state('');

  let filteredSummaries = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return aiStore.conversationSummaries;
    return aiStore.conversationSummaries.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q)
    );
  });

  function formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diff = now - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  }

  async function handleSelect(summary: ConversationSummary) {
    await aiStore.switchConversation(summary.id);
    aiStore.setSidebarView('chat');
  }

  async function handleDelete(e: MouseEvent, conversationId: string) {
    e.stopPropagation();
    await aiStore.deleteConversation(conversationId);
    await aiStore.loadConversationHistory();
  }

  async function handleNewConversation() {
    await aiStore.newConversation();
    aiStore.setSidebarView('chat');
  }
</script>

<div class="history-list">
  <!-- Search + New -->
  <div class="history-header">
    <input
      type="text"
      class="search-input"
      placeholder="Search conversations..."
      bind:value={searchQuery}
    />
    <button
      type="button"
      class="new-btn"
      onclick={handleNewConversation}
      title="New conversation"
      aria-label="New conversation"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  </div>

  <!-- List -->
  <div class="history-items scrollbar-thin">
    {#if filteredSummaries.length === 0}
      <div class="empty-state">
        {#if searchQuery}
          <p class="empty-text">No conversations match "{searchQuery}"</p>
        {:else}
          <p class="empty-text">No conversation history yet</p>
          <p class="empty-hint">Start a new conversation to see it here</p>
        {/if}
      </div>
    {:else}
      {#each filteredSummaries as summary (summary.id)}
        <div
          class="history-item"
          role="button"
          tabindex="0"
          onclick={() => handleSelect(summary)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(summary); } }}
        >
          <div class="item-top">
            <span class="item-title">{summary.title}</span>
            <span class="item-time">{formatRelativeTime(summary.updatedAt)}</span>
          </div>
          {#if summary.preview}
            <p class="item-preview">{summary.preview}</p>
          {/if}
          <div class="item-meta">
            <span class="item-count">{summary.messageCount} messages</span>
            <button
              type="button"
              class="delete-btn"
              onclick={(e) => handleDelete(e, summary.id)}
              title="Delete conversation"
              aria-label="Delete conversation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .history-list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .history-header {
    display: flex;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background-color: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    transition: border-color 150ms ease;
  }

  .search-input:focus {
    border-color: var(--accent-primary);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease;
    flex-shrink: 0;
  }

  .new-btn:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .history-items {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    text-align: center;
  }

  .empty-text {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .empty-hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .history-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: background-color 150ms ease;
  }

  .history-item:hover {
    background-color: var(--bg-hover);
  }

  .history-item + .history-item {
    margin-top: 2px;
  }

  .item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .item-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .item-time {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .item-preview {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .item-count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms ease, color 150ms ease;
  }

  .history-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--color-error);
  }
</style>
