<script lang="ts">
  /**
   * OperationDetail - Expanded view of a single operation
   *
   * Shows prompt, context summary, result preview, errors.
   * For sessions: shows interaction history and resume prompt input.
   */

  import type { Operation } from '$lib/domain/entities/Operation';
  import { isSessionOperation } from '$lib/domain/entities/Operation';
  import ResultPreview from './ResultPreview.svelte';
  import { Check, Copy } from '@lucide/svelte';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';

  interface Props {
    operation: Operation;
    onApply?: () => void;
    onDiscard?: () => void;
    onClose?: () => void;
  }

  let { operation, onApply, onDiscard, onClose }: Props = $props();

  let isSession = $derived(isSessionOperation(operation));
  let hasResult = $derived(operation.result !== null && operation.result.outputs.length > 0);
  let hasFailed = $derived(operation.status === 'failed');
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');

  async function copyRef() {
    const success = await copyTextToClipboard(buildRefId({ kind: 'operation', operationId: operation.id }));
    copyState = success ? 'copied' : 'failed';
    setTimeout(() => {
      copyState = 'idle';
    }, 1400);
  }
</script>

<div class="operation-detail">
  <div class="detail-header">
    <h3 class="detail-title">{operation.label}</h3>
    <button type="button" class="copy-ref-btn" class:copied={copyState === 'copied'} onclick={copyRef} aria-label="Copy Ref" title="Copy Ref">
      {#if copyState === 'copied'}
        <Check size={14} strokeWidth={2} />
      {:else}
        <Copy size={14} strokeWidth={2} />
      {/if}
      <span>{copyState === 'copied' ? 'Copied' : 'Copy Ref'}</span>
    </button>
    {#if onClose}
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    {/if}
  </div>

  <div class="detail-body">
    <div class="detail-section">
      <span class="section-label">Prompt</span>
      <p class="section-content">{operation.prompt}</p>
    </div>

    {#if operation.context}
      <div class="detail-section">
        <span class="section-label">Context</span>
        <p class="section-content">
          {operation.context.noteContents.size} note(s) loaded,
          {operation.context.noteSummaries.length} in index
        </p>
      </div>
    {/if}

    {#if isSession}
      <div class="detail-section">
        <span class="section-label">Session</span>
        <p class="section-content">Persistent session — can be resumed later</p>
      </div>
    {/if}

    {#if hasFailed && operation.result}
      <div class="detail-section error">
        <span class="section-label">Error</span>
        <pre class="section-content error-content">{operation.result.rawResponse}</pre>
      </div>
    {/if}

    {#if hasResult && operation.result}
      <ResultPreview result={operation.result} {onApply} {onDiscard} />
    {/if}
  </div>
</div>

<style>
  .operation-detail {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-primary);
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border-light);
  }
  .detail-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .close-btn {
    display: flex;
    padding: 0.25rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 0.25rem;
  }
  .copy-ref-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    margin-right: 8px;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--border-light);
    border-radius: 0.25rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .copy-ref-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .copy-ref-btn.copied {
    color: var(--color-success);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .detail-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    max-height: 400px;
    overflow-y: auto;
  }
  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .section-content {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .error .section-label {
    color: var(--color-error);
  }
  .error-content {
    padding: 0.5rem;
    background: var(--color-error-bg);
    border-radius: 0.375rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--color-error);
  }
</style>
