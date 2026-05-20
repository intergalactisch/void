<script lang="ts">
  /**
   * PromptWindow - Modal overlay for AI prompt interactions
   *
   * A modal-style overlay activated by Cmd+Shift+O that provides:
   * - Text input for prompts
   * - Streaming response display
   * - Tool execution status indicators
   * - Conversation history
   *
   * Features:
   * - Slide up animation from bottom
   * - Focus trap while open (WCAG 2.1 compliant)
   * - Close on Escape or clicking outside
   * - Keyboard navigation for conversation history
   * - Live regions for streaming text announcements
   */

  import { aiStore } from '$lib/stores';
  import ChatMessage from './ChatMessage.svelte';
  import { createFocusTrap } from '$lib/utils/focusTrap';

  interface Props {
    /** Whether the prompt window is open */
    isOpen?: boolean;
    /** Callback when window should close */
    onClose?: () => void;
  }

  let { isOpen = $bindable(false), onClose }: Props = $props();

  /** Input text */
  let input = $state('');

  /** Reference to the input element */
  let inputRef: HTMLTextAreaElement | null = $state(null);

  /** Reference to the messages container for scrolling */
  let messagesRef: HTMLDivElement | null = $state(null);

  /** Reference to the dialog window for focus trapping */
  let dialogRef: HTMLDivElement | null = $state(null);

  /** Focus trap cleanup function */
  let focusTrapCleanup: (() => void) | null = null;

  /** Whether input is focused */
  let inputFocused = $state(false);

  /** Messages from current conversation */
  let messages = $derived(
    (aiStore.currentConversation?.messages ?? []).filter((message) => message.visibility !== 'internal')
  );

  /** Whether we're currently processing or streaming */
  let isActive = $derived(aiStore.isProcessing || aiStore.isStreaming || aiStore.agentRunState.isRunning);

  /** Auto-scroll to bottom when new content arrives */
  $effect(() => {
    if (messagesRef && messages.length) {
      messagesRef.scrollTop = messagesRef.scrollHeight;
    }
  });

  /** Set up focus trap when opened */
  $effect(() => {
    if (isOpen) {
      // Set up focus trap when dialog opens
      if (dialogRef) {
        focusTrapCleanup = createFocusTrap({
          container: dialogRef,
          initialFocus: inputRef,
          onEscape: handleClose,
        });
      }
    } else {
      // Clean up focus trap when closing
      if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
      }
    }
  });

  /** Submit the prompt */
  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isActive) return;

    const prompt = trimmed;
    input = '';

    await aiStore.submitPrompt(prompt);
  }

  /** Handle input keydown */
  function handleInputKeydown(event: KeyboardEvent) {
    // Submit on Enter (without Shift)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  /** Handle global keydown for window */
  function handleWindowKeydown(event: KeyboardEvent) {
    if (!isOpen) return;

    // Close on Escape
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }

  /** Handle backdrop click */
  function handleBackdropClick(event: MouseEvent) {
    // Only close if clicking the backdrop itself, not its children
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  /** Close the window */
  async function handleClose() {
    if (aiStore.isProcessing) {
      await aiStore.cancel();
    }
    isOpen = false;
    onClose?.();
  }

  /** Handle tool confirmation */
  function handleConfirmTool(invocationId: string) {
    aiStore.confirmTool(invocationId);
  }

  /** Handle tool rejection */
  function handleRejectTool(invocationId: string) {
    aiStore.rejectTool(invocationId, 'User rejected');
  }

  /** Cancel current operation */
  async function handleCancel() {
    await aiStore.cancel();
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

  /** Quick action chips that insert text and submit */
  const quickActions = [
    { label: 'Continue', prompt: 'Continue' },
    { label: 'Summarize', prompt: 'Summarize this' },
    { label: 'Improve', prompt: 'Improve this' },
    { label: 'Explain', prompt: 'Explain this' },
  ];

  /** Handle quick action chip click */
  async function handleQuickAction(prompt: string) {
    if (isActive) return;
    input = prompt;
    await handleSubmit();
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
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="prompt-backdrop"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="prompt-window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
      aria-describedby="prompt-description"
    >
      <span id="prompt-description" class="sr-only">
        AI assistant conversation window. Type a message and press Enter to send. Use Escape to close.
      </span>

      <!-- Header -->
      <div class="prompt-header">
        <div class="header-left">
          <h2 id="prompt-title" class="header-title">AI Assistant</h2>
          {#if aiStore.currentConversation}
            <span class="conversation-info">
              {messages.length} messages
            </span>
          {/if}
        </div>

        <div class="header-actions">
          {#if messages.length > 0}
            <button
              type="button"
              class="action-btn"
              onclick={handleClearConversation}
              title="Clear conversation"
              aria-label="Clear conversation"
              disabled={isActive}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            type="button"
            class="action-btn close-btn"
            onclick={handleClose}
            title="Close (Esc)"
            aria-label="Close dialog"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div class="prompt-messages" bind:this={messagesRef}>
        {#if messages.length === 0 && !aiStore.isStreaming}
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p class="empty-text">Start a conversation with the AI assistant</p>
            <p class="empty-hint">Type a message below and press Enter to send</p>
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
              <!-- Typing indicator when processing but streaming hasn't started yet -->
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
                    <span class="tool-name">Running {tool.toolId}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if aiStore.lastResponse && !aiStore.isStreaming && !aiStore.isProcessing}
              <div class="response-meta">
                {aiStore.lastResponse.meta.provider} &middot; {aiStore.lastResponse.meta.latencyMs}ms
                {#if aiStore.lastResponse.meta.usage}
                  &middot; {aiStore.lastResponse.meta.usage.inputTokens + aiStore.lastResponse.meta.usage.outputTokens} tokens
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Tool confirmations pending -->
      {#if aiStore.hasPendingConfirmations}
        <div class="pending-confirmations">
          <span class="pending-label">
            {aiStore.pendingConfirmations.length} tool{aiStore.pendingConfirmations.length !== 1 ? 's' : ''} waiting for confirmation
          </span>
        </div>
      {/if}

      <!-- Input area -->
      <div class="prompt-input-area" class:focused={inputFocused}>
        <div class="input-wrapper">
          <textarea
            bind:this={inputRef}
            bind:value={input}
            class="prompt-input"
            placeholder={isActive ? 'AI is responding...' : 'Ask anything...'}
            rows="1"
            disabled={isActive}
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
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
                Cancel
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            {/if}
          </div>
        </div>

        <!-- Quick action chips -->
        {#if !isActive}
          <div class="quick-actions">
            {#each quickActions as action}
              <button
                type="button"
                class="quick-action-chip"
                onclick={() => handleQuickAction(action.prompt)}
              >
                {action.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer hints -->
      <div class="prompt-footer">
        <span class="hint">
          <kbd>Enter</kbd> to send
        </span>
        <span class="hint">
          <kbd>Shift</kbd>+<kbd>Enter</kbd> for new line
        </span>
        <span class="hint">
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 2rem;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    animation: prompt-backdrop-fade var(--duration-normal) ease-out;
  }

  @keyframes prompt-backdrop-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .prompt-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 640px;
    max-height: calc(100vh - 4rem);
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-top: 2px solid var(--accent-primary);
    border-radius: var(--radius-lg);
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.25),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    animation: prompt-scale-in var(--duration-normal) ease-out;
    transform-origin: bottom center;
  }

  @keyframes prompt-scale-in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Header */
  .prompt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .conversation-info {
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.125rem 0.5rem;
    background-color: var(--bg-hover);
    border-radius: 9999px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: color var(--transition-fast), background-color var(--transition-fast);
  }

  .action-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .close-btn:hover {
    color: var(--color-error);
  }

  /* Messages area */
  .prompt-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    min-height: 200px;
    max-height: 400px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-icon {
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .empty-text {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .empty-hint {
    margin: 0.5rem 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Typing indicator */
  .typing-indicator {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 1rem;
    background-color: var(--bg-sidebar);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    margin-right: 2rem;
    width: fit-content;
  }

  .typing-dot {
    width: 8px;
    height: 8px;
    background-color: var(--text-muted);
    border-radius: 50%;
    animation: typingPulse 1.4s ease-in-out infinite;
  }

  .typing-dot:nth-child(1) {
    animation-delay: 0s;
  }

  .typing-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typingPulse {
    0%, 60%, 100% {
      opacity: 0.3;
      transform: scale(0.8);
    }
    30% {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Executing tools */
  .executing-tools {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .executing-tool {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .tool-spinner {
    display: inline-block;
    width: 6px;
    height: 6px;
    background-color: var(--accent-primary);
    border-radius: 50%;
    animation: toolPulse 1.2s ease-in-out infinite;
  }

  @keyframes toolPulse {
    0%, 100% {
      opacity: 0.4;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .tool-name {
    font-family: var(--font-mono, monospace);
  }

  /* Response metadata */
  .response-meta {
    margin-top: 0.5rem;
    font-size: 0.6875rem;
    color: var(--text-muted);
    opacity: 0.7;
  }

  /* Pending confirmations */
  .pending-confirmations {
    padding: 0.5rem 1rem;
    background-color: rgba(251, 191, 36, 0.1);
    border-top: 1px solid rgba(251, 191, 36, 0.2);
    flex-shrink: 0;
  }

  .pending-label {
    font-size: 0.8125rem;
    color: var(--color-warning);
  }

  /* Input area */
  .prompt-input-area {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid var(--border-light);
    background-color: var(--bg-sidebar);
    transition: background-color var(--transition-fast);
    flex-shrink: 0;
  }

  .prompt-input-area.focused {
    background-color: var(--bg-card);
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .prompt-input {
    flex: 1;
    min-height: 2.5rem;
    max-height: 200px;
    padding: 0.625rem 0.875rem;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.5;
    resize: none;
    transition: border-color var(--transition-fast);
  }

  .prompt-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .prompt-input:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .prompt-input::placeholder {
    color: var(--text-muted);
  }

  .prompt-input:disabled {
    background-color: var(--bg-hover);
    cursor: not-allowed;
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border: none;
    background-color: var(--accent-primary);
    color: white;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
  }

  .submit-btn:hover:not(:disabled) {
    background-color: var(--accent-hover);
  }

  .submit-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cancel-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-error);
    background-color: transparent;
    color: var(--color-error);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .cancel-btn:hover {
    background-color: rgba(239, 68, 68, 0.1);
  }

  .cancel-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* Footer */
  .prompt-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border-light);
    background-color: var(--bg-sidebar);
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    flex-shrink: 0;
  }

  .hint {
    font-size: 0.6875rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    padding: 0.125rem 0.375rem;
    background-color: var(--bg-hover);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    font-size: 0.625rem;
    font-family: inherit;
    box-shadow: 0 1px 0 var(--border-medium);
  }

  /* Quick action chips */
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .quick-action-chip {
    padding: 0.375rem 0.75rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-light);
    border-radius: 9999px;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .quick-action-chip:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-medium);
  }

  .quick-action-chip:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
</style>
