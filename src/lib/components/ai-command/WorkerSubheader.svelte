<script lang="ts">
  import { Check, ChevronLeft, Copy, PanelRightClose, PanelRightOpen } from '@lucide/svelte';
  import type { AgentRun, AgentWorker } from '$lib/domain/entities/AgentRun';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { buildRefId } from '$lib/domain/values';

  interface Props {
    run: AgentRun;
    worker: AgentWorker;
    railOpen: boolean;
    onBack: () => void;
    onToggleRail: () => void;
  }

  let { run, worker, railOpen, onBack, onToggleRail }: Props = $props();

  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  function statusLabel(status: string): string {
    return status.replace(/_/g, ' ');
  }

  async function copyWorkerId() {
    const success = await copyTextToClipboard(buildRefId({ kind: 'worker', runId: run.id, workerId: worker.id }));
    copyState = success ? 'copied' : 'failed';
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyState = 'idle';
      resetTimer = null;
    }, 1600);
  }
</script>

<header class="worker-subheader">
  <button type="button" class="back-chip" onclick={onBack} aria-label="Back to run">
    <ChevronLeft size={14} strokeWidth={1.9} aria-hidden="true" />
    <span>Back to run</span>
  </button>

  <div class="subheader-title">
    <strong>{worker.spec.title}</strong>
    <span class="subheader-meta">
      <span data-status={worker.status}>{statusLabel(worker.status)}</span>
      <span class="dot" aria-hidden="true">·</span>
      <span>{run.prompt.slice(0, 60)}{run.prompt.length > 60 ? '…' : ''}</span>
    </span>
  </div>

  <button
    type="button"
    class="worker-id-copy"
    class:copied={copyState === 'copied'}
    class:failed={copyState === 'failed'}
    onclick={copyWorkerId}
    title={`Copy worker ref ${worker.id}`}
    aria-label={`Copy worker ref ${worker.id}`}
  >
    <span class="worker-id-label">REF</span>
    <span class="worker-id-value">{copyState === 'copied' ? 'Copied' : worker.id}</span>
    {#if copyState === 'copied'}
      <Check size={12} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Copy size={12} strokeWidth={1.8} aria-hidden="true" />
    {/if}
  </button>

  <button
    type="button"
    class="rail-toggle"
    onclick={onToggleRail}
    aria-pressed={railOpen}
    title={railOpen ? 'Hide info rail' : 'Show info rail'}
    aria-label={railOpen ? 'Hide info rail' : 'Show info rail'}
  >
    {#if railOpen}
      <PanelRightClose size={14} strokeWidth={1.9} aria-hidden="true" />
    {:else}
      <PanelRightOpen size={14} strokeWidth={1.9} aria-hidden="true" />
    {/if}
  </button>
</header>

<style>
  .worker-subheader {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .worker-id-copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 260px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-tertiary);
    font: inherit;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
  }

  .worker-id-copy:hover {
    border-color: var(--border-medium);
    color: var(--text-secondary);
  }

  .worker-id-copy.copied {
    border-color: color-mix(in srgb, var(--color-success) 42%, var(--border-light));
    color: var(--color-success);
  }

  .worker-id-copy.failed {
    border-color: color-mix(in srgb, var(--color-error) 42%, var(--border-light));
    color: var(--color-error);
  }

  .worker-id-label {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .worker-id-value {
    overflow: hidden;
    color: currentColor;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .back-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px 0 6px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
  }

  .back-chip:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .subheader-title {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .subheader-title strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subheader-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-muted);
    font-size: 11px;
  }

  .subheader-meta span[data-status='running'] {
    color: var(--ai-accent);
    font-weight: 600;
    text-transform: capitalize;
  }

  .subheader-meta span[data-status='completed'] {
    color: var(--color-success);
    font-weight: 600;
    text-transform: capitalize;
  }

  .subheader-meta span[data-status='failed'] {
    color: var(--color-error);
    font-weight: 600;
    text-transform: capitalize;
  }

  .subheader-meta > span:not([data-status]) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    color: var(--text-muted);
  }

  .rail-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .rail-toggle:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }
</style>
