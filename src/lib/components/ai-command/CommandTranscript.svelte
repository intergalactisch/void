<script lang="ts">
  import { FilePlus2, ListTodo, Search, Wand2 } from '@lucide/svelte';
  import type { Message } from '$lib/domain/entities/Message';
  import type { AgentRun } from '$lib/domain/entities/AgentRun';
  import type { PendingUserTurn } from '$lib/stores/commandCenter.svelte';
  import { aiStore, commandCenterStore } from '$lib/stores';
  import ChatMessage from '$lib/components/ai/ChatMessage.svelte';
  import CommandRunCard from './CommandRunCard.svelte';

  interface Props {
    onConfirmTool?: (invocationId: string) => void;
    onRejectTool?: (invocationId: string) => void;
  }

  let { onConfirmTool, onRejectTool }: Props = $props();

  let messages = $derived(
    (aiStore.currentConversation?.messages ?? [])
      .filter((message) => message.visibility !== 'internal')
      .filter((message) => !isLiveAgentActivityMessage(message))
  );
  let conversationId = $derived(aiStore.currentConversation?.id ?? null);
  let runs = $derived.by(() => {
    if (!conversationId) return [];
    const byId = new Map<string, AgentRun>();
    for (const run of aiStore.agentRunState.runs) byId.set(run.id, run);
    const current = aiStore.agentRunState.currentRun;
    if (current) byId.set(current.id, current);
    return [...byId.values()]
      .filter((run) => run.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
  let unanchoredRuns = $derived.by(() => {
    const anchored = new Set<string>();
    for (const message of messages) {
      if (message.role !== 'user') continue;
      for (const run of runsForMessage(message)) {
        anchored.add(run.id);
      }
    }
    return runs.filter((run) => !anchored.has(run.id));
  });
  let pendingTurns = $derived(commandCenterStore.getVisiblePendingUserTurns(messages, conversationId));
  let hasTranscript = $derived(
    messages.length > 0 ||
    pendingTurns.length > 0 ||
    runs.length > 0 ||
    aiStore.isProcessing ||
    aiStore.isRouting
  );

  $effect(() => {
    commandCenterStore.reconcilePendingUserTurns(messages, conversationId);
  });

  function runsForMessage(message: Message): AgentRun[] {
    if (message.role !== 'user') return [];
    const text = message.text.trim();
    return runs.filter((run) => run.prompt.trim() === text);
  }

  async function submitOptimisticPrompt(prompt: string, clientTurnId?: string) {
    const turn = clientTurnId
      ? commandCenterStore.retryPendingUserTurn(clientTurnId)
      : commandCenterStore.createPendingUserTurn(prompt, conversationId);
    if (!turn) return;

    let result = null;
    try {
      result = await aiStore.submitPrompt(turn.text, { clientTurnId: turn.id });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      commandCenterStore.failPendingUserTurn(turn.id, error);
      return;
    }

    if (aiStore.error && !commandCenterStore.isPendingUserTurnMatched(turn.id)) {
      commandCenterStore.failPendingUserTurn(turn.id, aiStore.error.message);
      return;
    }

    if (result || !aiStore.error) {
      commandCenterStore.markPendingUserTurnSubmitted(turn.id);
    }
  }

  function runSuggestion(prompt: string) {
    if (!aiStore.ensureAIAvailable()) return;
    void submitOptimisticPrompt(prompt);
  }

  function retryTurn(turn: PendingUserTurn) {
    void submitOptimisticPrompt(turn.text, turn.id);
  }

  function handleConfirm(invocationId: string) {
    onConfirmTool?.(invocationId);
  }

  function handleReject(invocationId: string) {
    onRejectTool?.(invocationId);
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function isLiveAgentActivityMessage(message: Message): boolean {
    if (message.role !== 'assistant' || !message.isStreaming) return false;
    return message.activity?.some((entry) => entry.id.startsWith('agent-run:')) ?? false;
  }
</script>

<div class="transcript">
  {#if !hasTranscript}
    <div class="empty-state">
      <div class="empty-mark" aria-hidden="true">
        <Wand2 size={24} strokeWidth={1.7} />
      </div>
      <h3>What are you capturing now?</h3>
      <p>Start with a note, a todo cleanup, a rewrite, or research across your workspace.</p>
      <div class="suggestions">
        <button type="button" onclick={() => runSuggestion('Create a new note for today')} disabled={!aiStore.canStartAIWork}>
          <FilePlus2 size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>New note for today</span>
        </button>
        <button type="button" onclick={() => runSuggestion('Rewrite the current note into clearer action items')} disabled={!aiStore.canStartAIWork}>
          <Wand2 size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Rewrite into actions</span>
        </button>
        <button type="button" onclick={() => runSuggestion('Research this topic and create a source-backed note')} disabled={!aiStore.canStartAIWork}>
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Research into a note</span>
        </button>
        <button type="button" onclick={() => runSuggestion('Find open todos and group them by priority')} disabled={!aiStore.canStartAIWork}>
          <ListTodo size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Group open todos</span>
        </button>
      </div>
    </div>
  {:else}
    <div class="message-stack">
      {#each messages as message (message.id)}
        <ChatMessage
          {message}
          onConfirmTool={handleConfirm}
          onRejectTool={handleReject}
        />

        {#each runsForMessage(message) as run (run.id)}
          <CommandRunCard {run} compact />
        {/each}
      {/each}

      {#each unanchoredRuns as run (run.id)}
        <CommandRunCard {run} compact />
      {/each}

      {#each pendingTurns as turn (turn.id)}
        <article class="pending-turn" data-status={turn.status} aria-label="Pending user message">
          <div class="pending-head">
            <span>You</span>
            <time datetime={turn.createdAt.toISOString()}>{formatTime(turn.createdAt)}</time>
          </div>
          <div class="pending-text">{turn.text}</div>
          <div class="pending-state">
            <span class="pending-dot" aria-hidden="true"></span>
            {#if turn.status === 'failed'}
              <span>{turn.error ?? 'Could not send this request'}</span>
              <button type="button" onclick={() => retryTurn(turn)}>Retry</button>
            {:else if turn.status === 'submitted'}
              <span>Submitted</span>
            {:else}
              <span>{aiStore.isRouting ? 'Understanding request...' : 'Sending...'}</span>
            {/if}
          </div>
        </article>
      {/each}

      {#if aiStore.isProcessing && !aiStore.isStreaming && !aiStore.agentRunState.isRunning && !aiStore.isRouting}
        <div class="thinking" role="status" aria-label="Void is thinking">
          <span></span>
          <span></span>
          <span></span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .transcript {
    min-width: 0;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 420px;
    padding: 32px 20px;
    text-align: center;
  }

  .empty-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    margin-bottom: 16px;
    border: 1px solid var(--ai-border);
    border-radius: var(--radius-lg);
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .empty-state h3 {
    margin: 0 0 7px;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 650;
  }

  .empty-state p {
    max-width: 360px;
    margin: 0 0 20px;
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1.5;
  }

  .suggestions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    width: min(420px, 100%);
  }

  .suggestions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }

  .suggestions button:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .suggestions button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .suggestions button :global(svg) {
    flex-shrink: 0;
    color: var(--ai-accent);
  }

  .suggestions span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thinking {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    width: fit-content;
    padding: 9px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
  }

  .thinking span {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--ai-accent);
    animation: commandThinkingPulse 1.35s ease-in-out infinite;
  }

  .thinking span:nth-child(2) {
    animation-delay: 0.18s;
  }

  .thinking span:nth-child(3) {
    animation-delay: 0.36s;
  }

  .pending-turn {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-left: 28px;
    padding: 12px 14px;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg);
    background-color: var(--accent-primary);
    color: var(--text-inverse);
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }

  .pending-turn[data-status='failed'] {
    background-color: var(--color-error);
  }

  .pending-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: rgba(255, 255, 255, 0.75);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .pending-head time {
    color: rgba(255, 255, 255, 0.55);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .pending-text {
    color: var(--text-inverse);
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .pending-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: rgba(255, 255, 255, 0.72);
    font-size: 11.5px;
    line-height: 1.35;
  }

  .pending-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: currentColor;
    animation: pendingTurnPulse 1.3s ease-in-out infinite;
  }

  .pending-turn[data-status='submitted'] .pending-dot,
  .pending-turn[data-status='failed'] .pending-dot {
    animation: none;
  }

  .pending-state button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid rgba(255, 255, 255, 0.36);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-inverse);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .pending-state button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  @keyframes commandThinkingPulse {
    0%, 60%, 100% { opacity: 0.25; transform: scale(0.8); }
    30% { opacity: 1; transform: scale(1); }
  }

  @keyframes pendingTurnPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  @media (max-width: 640px) {
    .suggestions {
      grid-template-columns: 1fr;
    }
  }
</style>
