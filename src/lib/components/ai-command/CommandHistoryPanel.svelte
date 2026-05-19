<script lang="ts">
  import { MessageSquare, Plus, Trash2 } from '@lucide/svelte';
  import { aiStore, commandCenterStore } from '$lib/stores';

  let summaries = $derived(aiStore.conversationSummaries);
  let currentConversationId = $derived(aiStore.currentConversation?.id ?? null);

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function openConversation(id: string) {
    await aiStore.switchConversation(id);
    commandCenterStore.showNow();
    commandCenterStore.showConversationDetail();
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
    await aiStore.loadConversationHistory();
  }
</script>

<div class="history-panel">
  <div class="panel-head">
    <div>
      <h3>Conversation History</h3>
      <span>{summaries.length} threads</span>
    </div>
    <button type="button" class="new-command" onclick={startNewCommand}>
      <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>New</span>
    </button>
  </div>

  {#if summaries.length === 0}
    <div class="empty">
      <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>No conversations yet</span>
    </div>
  {:else}
    <div class="history-list" role="list">
      {#each summaries as summary (summary.id)}
        <div class="history-row" class:active={summary.id === currentConversationId} role="listitem">
          <button type="button" class="history-open" onclick={() => openConversation(summary.id)}>
            <span class="history-main">
              <strong>{summary.title}</strong>
              <span>{summary.preview || 'No preview'}</span>
            </span>
            <span class="history-meta">
              <span>{formatDate(summary.updatedAt)}</span>
              <span>{summary.id === currentConversationId ? 'Open now' : `${summary.messageCount} messages`}</span>
            </span>
          </button>
          <button
            type="button"
            class="history-delete"
            aria-label={`Delete conversation ${summary.title}`}
            onclick={() => deleteConversation(summary.id)}
          >
            <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .history-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .new-command {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
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

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .history-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22px;
    align-items: start;
    gap: 8px;
    width: 100%;
    padding: 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .history-row:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .history-row.active {
    border-color: var(--ai-border);
    background: var(--ai-tint);
  }

  .history-open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
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

  .history-main,
  .history-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .history-main strong,
  .history-main span,
  .history-meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-main strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .history-main span,
  .history-meta span {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .history-meta {
    align-items: flex-end;
    white-space: nowrap;
  }

  .history-delete {
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

  .history-delete:hover {
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

  @media (max-width: 900px) {
    .history-panel {
      gap: 8px;
      padding: 10px 12px;
    }

    .panel-head {
      align-items: center;
    }

    .history-list {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 2px;
    }

    .history-row {
      width: 240px;
      flex: 0 0 240px;
    }

    .history-open {
      grid-template-columns: minmax(0, 1fr);
    }

    .history-meta {
      align-items: flex-start;
    }
  }
</style>
