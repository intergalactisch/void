<script lang="ts">
  import { ChevronRight, Wrench } from '@lucide/svelte';
  import type { AgentWorkerMessage } from '$lib/domain/entities/AgentRun';

  interface Props {
    message: AgentWorkerMessage;
  }

  let { message }: Props = $props();
  let expanded = $state(false);

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  let data = $derived(asRecord(message.data));
  let status = $derived(typeof data?.status === 'string' ? data.status : 'success');
  let resultPreview = $derived(() => {
    const value = data?.result;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    return '';
  });
  let toolLabel = $derived(message.toolId ?? 'tool');
</script>

<div class="tool-call-card" data-status={status} data-expanded={expanded}>
  <button
    type="button"
    class="tool-call-summary"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="tool-call-icon" aria-hidden="true">
      <Wrench size={13} strokeWidth={1.9} />
    </span>
    <span class="tool-call-name">{toolLabel}</span>
    <span class="tool-call-status" data-status={status}>{status}</span>
    <span class="tool-call-chevron" data-expanded={expanded} aria-hidden="true">
      <ChevronRight size={13} strokeWidth={1.9} />
    </span>
  </button>
  {#if expanded}
    <pre class="tool-call-body">{resultPreview()}</pre>
  {/if}
</div>

<style>
  .tool-call-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .tool-call-card[data-status='failure'] {
    border-color: color-mix(in srgb, var(--color-error) 38%, var(--border-light));
  }

  .tool-call-summary {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto 14px;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .tool-call-summary:hover {
    background: var(--bg-hover);
  }

  .tool-call-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .tool-call-name {
    overflow: hidden;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-call-status {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .tool-call-status[data-status='failure'] {
    color: var(--color-error);
  }

  .tool-call-chevron {
    display: inline-flex;
    color: var(--text-muted);
    transition: transform var(--transition-fast);
  }

  .tool-call-chevron[data-expanded='true'] {
    transform: rotate(90deg);
  }

  .tool-call-body {
    max-height: 280px;
    overflow: auto;
    margin: 0;
    padding: 10px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-editor);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
