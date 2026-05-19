<script lang="ts">
  /**
   * AISidebar - Unified AI drawer experience
   *
   * Combines chat, conversation history, and command-center work
   * into a right-side drawer. Replaces the older sidebar/panel overlay.
   *
   * Views:
   * - Chat: Conversational AI with streaming + tool calls
   * - History: Browse past conversations
   * - Actions: Quick action templates (formerly OperationsPanel)
   */

  import { aiStore, operationsStore } from '$lib/stores';
  import { Check, Copy } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import ChatMessage from './ChatMessage.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import ViewTabs from './ViewTabs.svelte';
  import ConversationHistoryList from './ConversationHistoryList.svelte';
  import QuickActions from './QuickActions.svelte';
  import type { SidebarView } from '$lib/stores/ai.svelte';

  interface Props {
    /** Whether the sidebar is visible */
    visible?: boolean;
    /** Callback when sidebar should close */
    onClose?: () => void;
  }

  let { visible = false, onClose }: Props = $props();

  /** Input text */
  let input = $state('');

  /** Reference to the input element */
  let inputRef: HTMLTextAreaElement | null = $state(null);

  /** Reference to the messages container for scrolling */
  let messagesRef: HTMLDivElement | null = $state(null);

  /** Whether input is focused */
  let inputFocused = $state(false);
  let isCancelling = $state(false);

  /** Whether user has scrolled up (disable auto-scroll) */
  let userHasScrolled = $state(false);

  /** Copy affordance feedback for the current conversation ID */
  let idCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let previousConversationId: string | null = null;

  /** Messages from current conversation */
  let messages = $derived(
    (aiStore.currentConversation?.messages ?? []).filter((message) => message.visibility !== 'internal')
  );

  /** Current conversation ID, used as the debug reference */
  let conversationId = $derived(aiStore.currentConversation?.id ?? null);

  /** Whether we're currently processing or streaming */
  let isActive = $derived(aiStore.isProcessing || aiStore.isStreaming || aiStore.agentRunState.isRunning);

  /** Current sidebar view */
  let sidebarView = $derived(aiStore.sidebarView);

  /** Number of completed operations with unapplied workspace results */
  let unappliedResultsCount = $derived(operationsStore.unappliedResultOperations.length);

  let activeAgentRunCount = $derived.by(() => {
    const ids = new Set<string>();
    for (const run of aiStore.agentRunState.runs) {
      if (isActiveAgentRun(run)) {
        ids.add(run.id);
      }
    }

    const current = aiStore.agentRunState.currentRun;
    if (isActiveAgentRun(current)) {
      ids.add(current.id);
    }

    return ids.size;
  });

  let workBadgeCount = $derived(unappliedResultsCount + activeAgentRunCount);
  let drawerLabel = $derived(sidebarView === 'actions' ? 'AI Command Center' : 'AI Assistant');

  /** Track user scroll position */
  function handleMessagesScroll() {
    if (!messagesRef) return;
    const isAtBottom = messagesRef.scrollHeight - messagesRef.scrollTop - messagesRef.clientHeight < 50;
    userHasScrolled = !isAtBottom;
  }

  /** Auto-scroll to bottom when new content arrives (unless user scrolled up) */
  $effect(() => {
    if (messagesRef && messages.length && !userHasScrolled) {
      messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: 'smooth' });
    }
  });

  /** Focus input when sidebar becomes visible in chat view */
  $effect(() => {
    if (visible && inputRef && sidebarView === 'chat') {
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }
  });

  /** Submit the prompt (cancel active response first if streaming) */
  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;

    // If AI is active, cancel the current response first
    if (isActive) {
      await handleCancel();
      if (aiStore.agentRunState.isRunning) return;
    }

    // Reset scroll tracking on new message
    userHasScrolled = false;

    const prompt = trimmed;
    input = '';

    await aiStore.submitPrompt(prompt);
  }

  /** Handle input keydown */
  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && visible) {
      event.preventDefault();
      onClose?.();
    }
  }

  /** Handle tool confirmation */
  function handleConfirmTool(invocationId: string) {
    aiStore.confirmTool(invocationId);
  }

  /** Handle tool rejection */
  function handleRejectTool(invocationId: string) {
    aiStore.rejectTool(invocationId, 'User rejected');
  }

  /** Copy current conversation ID for debugging references */
  async function handleCopyConversationId() {
    if (!conversationId) return;

    idCopyState = (await copyTextToClipboard(conversationId)) ? 'copied' : 'failed';

    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      idCopyState = 'idle';
      copyResetTimer = null;
    }, 1600);
  }

  /** Cancel current operation */
  async function handleCancel() {
    if (isCancelling) return;
    isCancelling = true;
    try {
      await aiStore.cancel();
    } finally {
      isCancelling = false;
    }
  }

  /** Clear conversation */
  async function handleClearConversation() {
    if (aiStore.currentConversation) {
      await aiStore.clearConversation();
    }
  }

  /** Create new conversation */
  async function handleNewConversation() {
    await aiStore.newConversation();
  }

  /** Handle view tab change */
  function handleViewChange(view: SidebarView) {
    aiStore.setSidebarView(view);
  }

  /** Auto-resize textarea based on content */
  function handleInputChange(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  }

  /** Reset textarea height when input is cleared */
  $effect(() => {
    if (input === '' && inputRef) {
      inputRef.style.height = 'auto';
    }
  });

  /** Keep copy feedback tied to the visible conversation */
  $effect(() => {
    if (conversationId !== previousConversationId) {
      previousConversationId = conversationId;
      idCopyState = 'idle';
      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
        copyResetTimer = null;
      }
    }
  });

  onDestroy(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if visible}
  <aside
    class="ai-sidebar"
    class:work-view={sidebarView === 'actions'}
    data-view={sidebarView}
    aria-label={drawerLabel}
  >
    <!-- Header -->
    <div class="sidebar-header">
      <div class="header-left">
        <span class="ai-mark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.36 5.64l-2.12 2.12M7.76 16.24l-2.12 2.12M18.36 18.36l-2.12-2.12M7.76 7.76L5.64 5.64" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <h2 class="header-title">Void</h2>
        <ViewTabs active={sidebarView} onChange={handleViewChange} pendingCount={workBadgeCount} />
      </div>

      <div class="header-actions">
        {#if sidebarView === 'chat'}
          {#if messages.length > 0}
            <button
              type="button"
              class="action-btn"
              onclick={handleClearConversation}
              title="Clear conversation"
              aria-label="Clear conversation"
              disabled={isActive}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          {/if}

          <button
            type="button"
            class="action-btn"
            onclick={handleNewConversation}
            title="New conversation"
            aria-label="New conversation"
            disabled={isActive}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        {/if}

        <button
          type="button"
          class="action-btn close-btn"
          onclick={() => onClose?.()}
          title="Close (Esc)"
          aria-label="Close AI sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Agent work status -->
    {#if sidebarView === 'chat'}
      <AgentPanel />

      {#if conversationId}
        <div class="conversation-id-bar" aria-live="polite">
          <button
            type="button"
            class="conversation-id-button"
            onclick={handleCopyConversationId}
            title="Copy conversation ID"
            aria-label={`Copy conversation ID ${conversationId}`}
          >
            <span class="conversation-id-label">ID</span>
            <span class="conversation-id-value">{conversationId}</span>
            {#if idCopyState === 'copied'}
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            {:else}
              <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
            {/if}
          </button>
          {#if idCopyState === 'failed'}
            <span class="copy-failed">Copy failed</span>
          {:else if idCopyState === 'copied'}
            <span class="copy-success">Copied</span>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Content area: switches based on view -->
    {#if sidebarView === 'chat'}
      <!-- Messages -->
      <div class="scrollbar-thin sidebar-messages" bind:this={messagesRef} onscroll={handleMessagesScroll}>
        {#if messages.length === 0 && !aiStore.isStreaming}
          <div class="empty-state">
            <div class="empty-glyph" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="13" stroke="currentColor" stroke-width="1" stroke-dasharray="2 4" opacity="0.30"/>
                <circle cx="14" cy="14" r="2.5" fill="currentColor" opacity="0.85"/>
              </svg>
            </div>
            <p class="empty-text">What's on your mind?</p>
            <p class="empty-sub">Ask anything about your notes — I'll search, draft, or rewrite as needed.</p>
            <div class="suggested-prompts">
              <button class="suggestion-chip" onclick={() => { input = 'Summarize this note'; handleSubmit(); }}>
                <span class="chip-icon">✦</span> Summarize this note
              </button>
              <button class="suggestion-chip" onclick={() => { input = 'Find action items and todos'; handleSubmit(); }}>
                <span class="chip-icon">→</span> Pull out action items
              </button>
              <button class="suggestion-chip" onclick={() => { input = 'What notes are related to this one?'; handleSubmit(); }}>
                <span class="chip-icon">⌁</span> Find related notes
              </button>
              <button class="suggestion-chip" onclick={() => { input = 'Fix grammar and tighten the prose'; handleSubmit(); }}>
                <span class="chip-icon">↻</span> Tighten the prose
              </button>
            </div>
          </div>
        {:else}
          <div class="messages-list">
            {#each messages as message (message.id)}
              <ChatMessage
                {message}
                onConfirmTool={handleConfirmTool}
                onRejectTool={handleRejectTool}
              />
            {/each}

            {#if aiStore.isProcessing && !aiStore.isStreaming}
              <div class="typing-indicator" role="status" aria-label="AI is thinking">
                <span class="typing-dot" aria-hidden="true"></span>
                <span class="typing-dot" aria-hidden="true"></span>
                <span class="typing-dot" aria-hidden="true"></span>
              </div>
            {/if}

            {#if aiStore.executingTools.length > 0}
              <div class="executing-tools" role="status" aria-label="Tools executing">
                {#each aiStore.executingTools as tool (tool.id)}
                  <div class="executing-tool">
                    <span class="tool-spinner" aria-hidden="true"></span>
                    <span class="tool-name">{tool.toolId.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}...</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Input area -->
      <div class="sidebar-input-area" class:focused={inputFocused}>
        <div class="input-wrapper">
          <textarea
            bind:this={inputRef}
            bind:value={input}
            class="sidebar-input"
            placeholder={isCancelling ? 'Cancelling...' : isActive ? 'Type to interrupt...' : 'Ask anything...'}
            rows="1"
            oninput={handleInputChange}
            onkeydown={handleInputKeydown}
            onfocus={() => (inputFocused = true)}
            onblur={() => (inputFocused = false)}
          ></textarea>

          <div class="input-actions">
            {#if isActive}
              <button
                type="button"
                class="cancel-btn"
                onclick={handleCancel}
                title="Cancel"
                aria-label="Cancel AI response"
                disabled={isCancelling}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
              </button>
            {:else}
              <button
                type="button"
                class="submit-btn"
                onclick={handleSubmit}
                disabled={!input.trim()}
                title="Send (Enter)"
                aria-label="Send message"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else if sidebarView === 'history'}
      <ConversationHistoryList />
    {:else if sidebarView === 'actions'}
      <QuickActions />
    {/if}
  </aside>
{/if}

<style>
  /* ─── AI sidebar ─── intelligent companion */
  .ai-sidebar {
    position: fixed;
    top: var(--titlebar-height);
    right: 0;
    bottom: var(--statusbar-height);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    width: min(520px, calc(100vw - 32px));
    height: auto;
    min-height: 0;
    border-left: 1px solid var(--border-light);
    background-color: var(--bg-app);
    box-shadow: -16px 0 40px rgba(20, 19, 16, 0.12);
    animation: sidebar-slide-in 240ms var(--ease-out-soft);
  }

  .ai-sidebar.work-view {
    width: min(760px, calc(100vw - 32px));
  }

  @keyframes sidebar-slide-in {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* ─── Header ─── */
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 10px 0 14px;
    height: var(--header-height);
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
    min-width: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .ai-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    background: var(--ai-tint);
    color: var(--ai-accent);
    flex-shrink: 0;
  }

  .header-title {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    letter-spacing: -0.01em;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .action-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ─── Conversation reference ─── */
  .conversation-id-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-app);
    flex-shrink: 0;
    min-width: 0;
  }

  .conversation-id-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    height: 24px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-tertiary);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
    font-family: inherit;
  }

  .conversation-id-button:hover {
    border-color: var(--border-medium);
    color: var(--text-secondary);
  }

  .conversation-id-button:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .conversation-id-label {
    color: var(--text-muted);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
  }

  .conversation-id-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0;
  }

  .copy-success,
  .copy-failed {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .copy-failed {
    color: var(--color-error);
  }

  /* ─── Messages area ─── */
  .sidebar-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 14px 12px;
  }

  /* ─── Empty state ─── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    color: var(--text-muted);
    padding: 16px 6px 32px;
  }

  .empty-glyph {
    color: var(--ai-accent);
    margin-bottom: 18px;
    opacity: 0.85;
  }

  .empty-text {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .empty-sub {
    margin: 0 0 20px;
    font-size: 12.5px;
    color: var(--text-tertiary);
    max-width: 280px;
    line-height: 1.5;
  }

  .suggested-prompts {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    max-width: 300px;
  }

  .suggestion-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 13px;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    letter-spacing: -0.003em;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast), transform var(--duration-instant);
  }

  .suggestion-chip:hover {
    background: var(--bg-card);
    border-color: var(--border-dark);
    color: var(--text-primary);
  }

  .suggestion-chip:active {
    transform: translateY(0.5px);
  }

  .chip-icon {
    color: var(--ai-accent);
    font-size: 12px;
    line-height: 1;
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ─── Typing indicator ─── */
  .typing-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 9px 12px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    width: fit-content;
    box-shadow: var(--shadow-xs);
  }

  .typing-dot {
    width: 5px;
    height: 5px;
    background-color: var(--ai-accent);
    border-radius: 50%;
    animation: typingPulse 1.4s ease-in-out infinite;
  }

  .typing-dot:nth-child(1) { animation-delay: 0s; }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes typingPulse {
    0%, 60%, 100% { opacity: 0.25; transform: scale(0.8); }
    30% { opacity: 1; transform: scale(1); }
  }

  /* ─── Executing tools ─── */
  .executing-tools {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 6px;
    padding: 0 4px;
  }

  .executing-tool {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--text-tertiary);
  }

  .tool-spinner {
    display: inline-block;
    width: 6px;
    height: 6px;
    background-color: var(--ai-accent);
    border-radius: 50%;
    animation: toolPulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes toolPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }

  .tool-name {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0;
  }

  /* ─── Input area ─── refined composer */
  .sidebar-input-area {
    display: flex;
    flex-direction: column;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--border-faint);
    background-color: var(--bg-app);
    flex-shrink: 0;
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 6px 6px 6px 10px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    box-shadow: var(--shadow-xs);
  }

  .sidebar-input-area.focused .input-wrapper {
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-light);
  }

  .sidebar-input {
    flex: 1;
    min-height: 22px;
    max-height: 200px;
    padding: 4px 0;
    background-color: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13.5px;
    font-family: inherit;
    line-height: 1.5;
    letter-spacing: -0.005em;
    resize: none;
  }

  .sidebar-input::placeholder {
    color: var(--text-tertiary);
  }

  .input-actions {
    display: flex;
    align-items: center;
  }

  .submit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background-color: var(--ai-accent);
    color: var(--text-inverse);
    border-radius: var(--radius-sm);
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15);
    transition: background var(--transition-fast), opacity var(--transition-fast),
                transform var(--duration-instant);
  }

  .submit-btn:hover:not(:disabled) {
    background-color: var(--ai-accent-strong);
  }

  .submit-btn:active:not(:disabled) {
    transform: scale(0.96);
  }

  .submit-btn:focus-visible {
    outline: 2px solid var(--ai-accent);
    outline-offset: 1px;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  .cancel-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-error);
    background-color: transparent;
    color: var(--color-error);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .cancel-btn:hover:not(:disabled) {
    background-color: var(--color-error-bg);
  }

  .cancel-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .cancel-btn:focus-visible {
    outline: 2px solid var(--color-error);
    outline-offset: 1px;
  }

  @media (max-width: 720px) {
    .ai-sidebar,
    .ai-sidebar.work-view {
      left: 0;
      width: 100vw;
      border-left: none;
      box-shadow: none;
    }
  }
</style>
