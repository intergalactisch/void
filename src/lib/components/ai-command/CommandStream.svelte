<script lang="ts">
  import { FilePlus2, Gauge, ListChecks, ListTodo, Search, Wand2 } from '@lucide/svelte';
  import type { Message } from '$lib/domain/entities/Message';
  import type { AgentRun } from '$lib/domain/entities/AgentRun';
  import type { StreamEntry } from '$lib/domain/values/StreamEntry';
  import { buildConversationStream } from '$lib/application/stream/conversationStream';
  import { aiStore, commandCenterStore } from '$lib/stores';
  import StreamEntryRow from './StreamEntryRow.svelte';
  import StreamCollapsedGroup from './StreamCollapsedGroup.svelte';

  interface Props {
    onConfirmTool?: ((invocationId: string) => void) | undefined;
    onRejectTool?: ((invocationId: string) => void) | undefined;
  }

  let { onConfirmTool, onRejectTool }: Props = $props();

  let conversationId = $derived(aiStore.currentConversation?.id ?? null);

  let messages = $derived(
    (aiStore.currentConversation?.messages ?? [])
      .filter((message) => message.visibility !== 'internal')
      .filter((message) => !isLiveAgentActivityMessage(message))
  );

  let runs = $derived.by<AgentRun[]>(() => {
    if (!conversationId) return [];
    const byId = new Map<string, AgentRun>();
    for (const run of aiStore.agentRunState.runs) byId.set(run.id, run);
    const current = aiStore.agentRunState.currentRun;
    if (current) byId.set(current.id, current);
    return [...byId.values()].filter((run) => run.conversationId === conversationId);
  });

  let pendingTurns = $derived(commandCenterStore.getVisiblePendingUserTurns(messages, conversationId));

  let entries = $derived(buildConversationStream({ messages, runs, pendingTurns }));

  let density = $derived(commandCenterStore.streamDensity);

  type RenderItem =
    | { type: 'entry'; key: string; entry: StreamEntry }
    | { type: 'group'; key: string; entries: StreamEntry[] };

  let renderItems = $derived.by<RenderItem[]>(() => {
    if (density === 'firehose') {
      return entries.map((entry) => ({ type: 'entry', key: entry.id, entry }));
    }
    const items: RenderItem[] = [];
    let buffer: StreamEntry[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      if (buffer.length === 1 && buffer[0]) {
        items.push({ type: 'entry', key: buffer[0].id, entry: buffer[0] });
      } else {
        items.push({ type: 'group', key: `group:${buffer[0]?.id ?? items.length}`, entries: buffer });
      }
      buffer = [];
    };
    for (const entry of entries) {
      if (entry.milestone) {
        flush();
        items.push({ type: 'entry', key: entry.id, entry });
      } else {
        buffer.push(entry);
      }
    }
    flush();
    return items;
  });

  let hasFoldableDetail = $derived(entries.some((entry) => !entry.milestone));
  let hasTranscript = $derived(entries.length > 0 || aiStore.isProcessing || aiStore.isRouting);
  let showThinking = $derived(
    aiStore.isProcessing && !aiStore.isStreaming && !aiStore.agentRunState.isRunning && !aiStore.isRouting
  );

  $effect(() => {
    commandCenterStore.reconcilePendingUserTurns(messages, conversationId);
  });

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

  function retryTurn(turnId: string) {
    void submitOptimisticPrompt('', turnId);
  }

  function isLiveAgentActivityMessage(message: Message): boolean {
    if (message.role !== 'assistant' || !message.isStreaming) return false;
    return message.activity?.some((entry) => entry.id.startsWith('agent-run:')) ?? false;
  }
</script>

<div class="stream">
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
    {#if hasFoldableDetail}
      <div class="stream-toolbar">
        <span class="stream-density-label"><Gauge size={12} strokeWidth={1.9} aria-hidden="true" /> Detail</span>
        <div class="density-toggle" role="group" aria-label="Stream detail level">
          <button
            type="button"
            class:active={density === 'firehose'}
            aria-pressed={density === 'firehose'}
            onclick={() => commandCenterStore.setStreamDensity('firehose')}
          >
            <ListChecks size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>Everything</span>
          </button>
          <button
            type="button"
            class:active={density === 'milestones'}
            aria-pressed={density === 'milestones'}
            onclick={() => commandCenterStore.setStreamDensity('milestones')}
          >
            <span>Milestones</span>
          </button>
        </div>
      </div>
    {/if}

    <div class="message-stack">
      {#each renderItems as item (item.key)}
        {#if item.type === 'entry'}
          <StreamEntryRow entry={item.entry} {onConfirmTool} {onRejectTool} onRetryTurn={retryTurn} />
        {:else}
          <StreamCollapsedGroup entries={item.entries} {onConfirmTool} {onRejectTool} onRetryTurn={retryTurn} />
        {/if}
      {/each}

      {#if showThinking}
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
  .stream {
    min-width: 0;
  }

  .stream-toolbar {
    position: sticky;
    top: -18px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: -4px 0 12px;
    padding: 6px 2px;
    background: linear-gradient(var(--bg-editor) 70%, transparent);
  }

  .stream-density-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .density-toggle {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
  }

  .density-toggle button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .density-toggle button.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .density-toggle button :global(svg) {
    color: var(--ai-accent);
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

  .thinking span:nth-child(2) { animation-delay: 0.18s; }
  .thinking span:nth-child(3) { animation-delay: 0.36s; }

  @keyframes commandThinkingPulse {
    0%, 60%, 100% { opacity: 0.25; transform: scale(0.8); }
    30% { opacity: 1; transform: scale(1); }
  }

  @media (max-width: 640px) {
    .suggestions {
      grid-template-columns: 1fr;
    }
  }
</style>
