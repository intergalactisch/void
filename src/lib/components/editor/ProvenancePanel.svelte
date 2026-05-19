<script lang="ts">
  /**
   * ProvenancePanel — right rail showing the interaction history for the
   * active note. Surfaces the .void/provenance/{note}.jsonl backend that
   * already records every AI rewrite, AI action, and user edit.
   *
   * Toggled via `view.toggleProvenance` (Mod+Shift+T).
   */

  import { provenanceStore, notesStore, uiStore } from '$lib/stores';
  import { Clock, Sparkles, Edit3, FileText, X, ChevronRight } from '@lucide/svelte';
  import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
  import { formatRelativeDate } from '$lib/utils/relativeDate';

  let expandedId = $state<string | null>(null);

  $effect(() => {
    void provenanceStore.fetchFor(notesStore.selectedPath);
  });

  function close() {
    uiStore.closeProvenancePanel();
  }

  function summarize(event: ProvenanceEvent): string {
    if (event.type === 'ai_rewrite') return event.prompt || 'AI rewrite';
    if (event.type === 'ai_action') return event.action || 'AI action';
    if (event.type === 'ai_generate') return event.prompt || 'AI generated content';
    if (event.type === 'ai_continue') return event.prompt || 'AI continuation';
    if (event.type === 'user_edit') {
      const diff = event.diff;
      if (diff) return `User edit (+${diff.added} −${diff.removed})`;
      return 'User edit';
    }
    return event.type;
  }

  function actor(event: ProvenanceEvent): string {
    return event.type === 'user_edit' ? 'You' : event.model || 'AI';
  }

  function icon(event: ProvenanceEvent) {
    if (event.type === 'user_edit') return Edit3;
    return Sparkles;
  }

  function toggle(eventId: string) {
    expandedId = expandedId === eventId ? null : eventId;
  }
</script>

{#if uiStore.provenancePanelVisible}
  <aside class="provenance-panel" aria-label="Note history">
    <header class="prov-header">
      <span class="prov-title">
        <Clock size={13} strokeWidth={1.7} aria-hidden="true" />
        History
      </span>
      <button type="button" class="prov-close" onclick={close} aria-label="Close history panel">
        <X size={13} strokeWidth={1.8} />
      </button>
    </header>

    <div class="prov-body">
      {#if provenanceStore.loading}
        <p class="prov-empty">Loading history…</p>
      {:else if provenanceStore.error}
        <p class="prov-empty prov-error">{provenanceStore.error.message}</p>
      {:else if !provenanceStore.activePath}
        <p class="prov-empty">No note open</p>
      {:else if provenanceStore.events.length === 0}
        <p class="prov-empty">
          <FileText size={20} strokeWidth={1.2} aria-hidden="true" />
          <span>No history yet</span>
          <span class="prov-hint">AI edits and saves will appear here</span>
        </p>
      {:else}
        <ul class="prov-list" role="list">
          {#each provenanceStore.events as event (event.id)}
            {@const Icon = icon(event)}
            {@const expanded = expandedId === event.id}
            <li class="prov-row" class:prov-row-ai={event.type !== 'user_edit'}>
              <button
                type="button"
                class="prov-toggle"
                onclick={() => toggle(event.id)}
                aria-expanded={expanded}
              >
                <span class="prov-chevron" class:prov-chevron-open={expanded} aria-hidden="true">
                  <ChevronRight size={11} strokeWidth={1.8} />
                </span>
                <span class="prov-icon">
                  <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div class="prov-meta">
                  <span class="prov-actor">{actor(event)}</span>
                  <span class="prov-summary">{summarize(event)}</span>
                </div>
                <time class="prov-time" datetime={event.ts}>
                  {formatRelativeDate(new Date(event.ts))}
                </time>
              </button>
              {#if expanded}
                <div class="prov-detail">
                  {#if event.prompt}
                    <div class="prov-field">
                      <span class="prov-field-label">Prompt</span>
                      <p class="prov-field-value">{event.prompt}</p>
                    </div>
                  {/if}
                  {#if event.before && event.after}
                    <div class="prov-field">
                      <span class="prov-field-label">Before</span>
                      <pre class="prov-snippet prov-before">{event.before}</pre>
                    </div>
                    <div class="prov-field">
                      <span class="prov-field-label">After</span>
                      <pre class="prov-snippet prov-after">{event.after}</pre>
                    </div>
                  {/if}
                  {#if event.result}
                    <div class="prov-field">
                      <span class="prov-field-label">Result</span>
                      <p class="prov-field-value">{event.result}</p>
                    </div>
                  {/if}
                  {#if event.blocks && event.blocks.length > 0}
                    <div class="prov-field">
                      <span class="prov-field-label">Blocks</span>
                      <p class="prov-field-value prov-mono">{event.blocks.join(', ')}</p>
                    </div>
                  {/if}
                  {#if event.model}
                    <div class="prov-field">
                      <span class="prov-field-label">Model</span>
                      <p class="prov-field-value prov-mono">{event.model}</p>
                    </div>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .provenance-panel {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-app);
    border-left: 1px solid var(--border-light);
    overflow: hidden;
  }

  .prov-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 36px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .prov-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: -0.005em;
  }

  .prov-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .prov-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .prov-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 16px;
  }

  .prov-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .prov-empty.prov-error {
    color: var(--color-error);
  }

  .prov-hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .prov-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .prov-row {
    border-bottom: 1px solid var(--border-faint);
  }

  .prov-row:last-child {
    border-bottom: none;
  }

  .prov-toggle {
    width: 100%;
    display: grid;
    grid-template-columns: 14px 16px 1fr auto;
    gap: 6px;
    align-items: start;
    padding: 8px 10px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text-secondary);
    font-family: inherit;
  }

  .prov-toggle:hover {
    background: var(--bg-hover);
  }

  .prov-chevron {
    color: var(--text-muted);
    transition: transform 120ms var(--ease-out-soft, ease-out);
    margin-top: 1px;
  }

  .prov-chevron-open {
    transform: rotate(90deg);
  }

  .prov-icon {
    color: var(--accent-primary);
    margin-top: 1px;
  }

  .prov-row:not(.prov-row-ai) .prov-icon {
    color: var(--text-tertiary);
  }

  .prov-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .prov-actor {
    font-size: 10.5px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .prov-summary {
    font-size: 12.5px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
  }

  .prov-time {
    font-size: 10.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
  }

  .prov-detail {
    padding: 4px 12px 12px 36px;
    background: var(--bg-subtle);
    border-top: 1px solid var(--border-faint);
  }

  .prov-field {
    margin-top: 8px;
  }

  .prov-field-label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .prov-field-value {
    margin: 0;
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .prov-mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .prov-snippet {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    line-height: 1.4;
    padding: 6px 8px;
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-xs);
    overflow: auto;
    max-height: 120px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .prov-before {
    color: var(--text-tertiary);
  }

  .prov-after {
    color: var(--text-primary);
  }
</style>
