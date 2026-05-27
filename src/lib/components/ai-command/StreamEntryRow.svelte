<script lang="ts">
  import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Sparkles, Workflow } from '@lucide/svelte';
  import type { StreamEntry } from '$lib/domain/values/StreamEntry';
  import { commandCenterStore } from '$lib/stores';
  import ChatMessage from '$lib/components/ai/ChatMessage.svelte';
  import ToolExecution from '$lib/components/ai/ToolExecution.svelte';
  import WorkerMessageBubble from './WorkerMessageBubble.svelte';
  import CommandActionCard from './CommandActionCard.svelte';

  interface Props {
    entry: StreamEntry;
    onConfirmTool?: ((invocationId: string) => void) | undefined;
    onRejectTool?: ((invocationId: string) => void) | undefined;
    onRetryTurn?: ((turnId: string) => void) | undefined;
  }

  let { entry, onConfirmTool, onRejectTool, onRetryTurn }: Props = $props();

  let planOpen = $state(false);

  function formatTime(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function openRunDetail(runId: string | null) {
    if (runId) commandCenterStore.selectRun(runId);
  }
</script>

{#if entry.kind === 'user-text' || entry.kind === 'assistant-text'}
  <ChatMessage
    message={entry.message}
    suppressToolInvocations
    onConfirmTool={onConfirmTool}
    onRejectTool={onRejectTool}
  />
{:else if entry.kind === 'pending-turn'}
  <article class="pending-turn" data-status={entry.turn.status} aria-label="Pending message">
    <div class="pending-head">
      <span>You</span>
      <time>{formatTime(entry.turn.createdAt)}</time>
    </div>
    <div class="pending-text">{entry.turn.text}</div>
    <div class="pending-state">
      <span class="pending-dot" aria-hidden="true"></span>
      {#if entry.turn.status === 'failed'}
        <span>{entry.turn.error ?? 'Could not send this request'}</span>
        {#if onRetryTurn}
          <button type="button" class="pending-retry" onclick={() => onRetryTurn?.(entry.turn.id)}>Retry</button>
        {/if}
      {:else if entry.turn.status === 'submitted'}
        <span>Submitted</span>
      {:else}
        <span>Sending...</span>
      {/if}
    </div>
  </article>
{:else if entry.kind === 'run-started'}
  <button type="button" class="run-divider" onclick={() => openRunDetail(entry.runId)} title="Open run in details">
    <span class="run-divider-mark" aria-hidden="true"><Workflow size={13} strokeWidth={1.9} /></span>
    <span class="run-divider-label">
      {entry.run.orchestrationMode === 'swarm' ? 'Swarm run started' : 'Agent run started'}
    </span>
    <span class="run-divider-prompt">{entry.run.prompt}</span>
  </button>
{:else if entry.kind === 'plan'}
  <div class="stream-note plan">
    <button type="button" class="plan-toggle" aria-expanded={planOpen} onclick={() => (planOpen = !planOpen)}>
      {#if planOpen}<ChevronDown size={13} strokeWidth={2} />{:else}<ChevronRight size={13} strokeWidth={2} />{/if}
      <span>Plan</span>
      <span class="plan-summary">{entry.summary}</span>
    </button>
    {#if planOpen && entry.steps.length > 0}
      <ol class="plan-steps">
        {#each entry.steps as step}<li>{step}</li>{/each}
      </ol>
    {/if}
  </div>
{:else if entry.kind === 'worker-spawn'}
  <div class="stream-chip">
    <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />
    <span>Spun up {entry.count} worker{entry.count === 1 ? '' : 's'}</span>
  </div>
{:else if entry.kind === 'worker-message'}
  <WorkerMessageBubble message={entry.message} />
{:else if entry.kind === 'tool-call'}
  <ToolExecution
    invocation={entry.invocation}
    onConfirm={() => onConfirmTool?.(entry.invocation.id)}
    onReject={() => onRejectTool?.(entry.invocation.id)}
  />
{:else if entry.kind === 'artifact-changed'}
  <CommandActionCard {entry} />
{:else if entry.kind === 'merge-summary'}
  <div class="stream-note merge">
    <div class="stream-note-head"><Workflow size={12} strokeWidth={1.9} aria-hidden="true" /><span>Merged</span></div>
    <p>{entry.summary}</p>
  </div>
{:else if entry.kind === 'run-completed'}
  <div class="run-outcome" data-tone="done">
    <span class="run-outcome-mark" aria-hidden="true"><CheckCircle2 size={14} strokeWidth={1.9} /></span>
    <div class="run-outcome-main">
      <span class="run-outcome-label">Run completed</span>
      {#if entry.summary}<p>{entry.summary}</p>{/if}
    </div>
  </div>
{:else if entry.kind === 'run-failed'}
  <div class="run-outcome" data-tone="failed">
    <span class="run-outcome-mark" aria-hidden="true"><AlertCircle size={14} strokeWidth={1.9} /></span>
    <div class="run-outcome-main">
      <span class="run-outcome-label">Run failed</span>
      <p>{entry.error}</p>
    </div>
  </div>
{/if}

<style>
  /* Run divider */
  .run-divider {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    align-self: center;
    max-width: 100%;
    padding: 5px 12px;
    border: 1px solid var(--ai-border);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--ai-tint) 60%, var(--bg-editor));
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .run-divider:hover {
    border-color: var(--ai-accent);
  }

  .run-divider-mark {
    display: inline-flex;
    color: var(--ai-accent);
  }

  .run-divider-label {
    flex-shrink: 0;
    color: var(--ai-accent);
    font-size: 11px;
    font-weight: 650;
  }

  .run-divider-prompt {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Generic subtle note (plan, merge) */
  .stream-note {
    padding: 9px 11px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    font-size: 12px;
  }

  .stream-note-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .stream-note p {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .plan-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .plan-summary {
    overflow: hidden;
    color: var(--text-muted);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-steps {
    margin: 8px 0 0;
    padding-left: 20px;
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.5;
  }

  /* Chip (worker spawn) */
  .stream-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 11.5px;
    font-weight: 600;
  }

  .stream-chip :global(svg) {
    color: var(--ai-accent);
  }

  /* Run outcome */
  .run-outcome {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 9px;
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-success-bg) 30%, var(--bg-card));
  }

  .run-outcome[data-tone='failed'] {
    background: var(--color-error-bg);
    border-color: color-mix(in srgb, var(--color-error) 32%, var(--border-light));
  }

  .run-outcome-mark {
    margin-top: 1px;
    color: var(--color-success);
  }

  .run-outcome[data-tone='failed'] .run-outcome-mark {
    color: var(--color-error);
  }

  .run-outcome-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .run-outcome-label {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .run-outcome-main p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .run-outcome[data-tone='failed'] .run-outcome-main p {
    color: var(--color-error);
  }

  /* Pending optimistic turn (mirrors the old transcript styling) */
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

  .pending-retry {
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

  .pending-retry:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  @keyframes pendingTurnPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }
</style>
