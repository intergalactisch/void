<script lang="ts">
  /**
   * ResultPreview - Preview parsed operation results before applying
   *
   * Shows each output with content preview, target note, and type.
   * Provides Apply All / Discard buttons.
   */

  import type { OperationResult, OperationOutput } from '$lib/domain/values/OperationResult';

  interface Props {
    result: OperationResult;
    onApply?: (() => void) | undefined;
    onDiscard?: (() => void) | undefined;
  }

  let { result, onApply, onDiscard }: Props = $props();

  function getOutputLabel(output: OperationOutput): string {
    switch (output.type) {
      case 'content': return 'Content';
      case 'todo': return 'Todo';
      case 'reference': return 'Reference';
      case 'metadata': return 'Metadata';
    }
  }

  function getOutputPreview(output: OperationOutput): string {
    switch (output.type) {
      case 'content': return output.content.slice(0, 200) + (output.content.length > 200 ? '...' : '');
      case 'todo': return output.text;
      case 'reference': return `${output.fromNote || '(current)'} → ${output.toNote}`;
      case 'metadata': return `${output.key}: ${JSON.stringify(output.value)}`;
    }
  }
</script>

<div class="result-preview">
  <div class="result-header">
    <span class="result-count">{result.outputs.length} output(s)</span>
    <span class="result-duration">{Math.round(result.durationMs / 1000)}s</span>
  </div>

  <div class="result-outputs">
    {#each result.outputs as output}
      <div class="output-item">
        <span class="output-type">{getOutputLabel(output)}</span>
        <p class="output-preview">{getOutputPreview(output)}</p>
        {#if 'targetNote' in output && output.targetNote}
          <span class="output-target">→ {output.targetNote}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="result-actions">
    {#if onDiscard}
      <button type="button" class="btn btn-discard" onclick={onDiscard}>Discard</button>
    {/if}
    {#if onApply}
      <button type="button" class="btn btn-apply" onclick={onApply}>Apply All</button>
    {/if}
  </div>
</div>

<style>
  .result-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    padding: 0.75rem;
  }
  .result-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .result-outputs {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .output-item {
    padding: 0.5rem;
    background-color: var(--bg-hover);
    border-radius: 0.375rem;
  }
  .output-type {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .output-preview {
    margin: 0.25rem 0 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .output-target {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--accent-primary);
  }
  .result-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }
  .btn-discard {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border-light);
  }
  .btn-discard:hover {
    background: var(--border-light);
  }
  .btn-apply {
    background: var(--accent-primary);
    color: white;
  }
  .btn-apply:hover {
    background: var(--accent-hover);
  }
</style>
