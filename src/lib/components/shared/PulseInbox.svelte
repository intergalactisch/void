<script lang="ts">
  /**
   * PulseInbox — proactive intelligence inbox.
   *
   * Slides down from the top when toggled. Shows pending insights from
   * `PulseService` (contradictions, stale notes, overdue todos, etc.).
   * Each row offers Dismiss and Jump-to-source actions.
   */

  import { pulseStore, notesStore, uiStore } from '$lib/stores';
  import { events } from '$lib/events';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { onDestroy } from 'svelte';
  import { Sparkles, AlertTriangle, GitBranch, Clock, CheckSquare, X } from '@lucide/svelte';
  import type { Insight } from '$lib/domain/entities/Insight';
  import type { Component } from 'svelte';
  import InfoPopover from './InfoPopover.svelte';

  let dialogRef: HTMLDivElement | null = $state(null);
  let cleanup: (() => void) | null = null;

  $effect(() => {
    if (uiStore.pulseInboxOpen) {
      void pulseStore.refresh();
      if (dialogRef) {
        cleanup = createFocusTrap({
          container: dialogRef,
          onEscape: close,
        });
      }
    } else if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  onDestroy(() => cleanup?.());

  function close() {
    uiStore.closePulseInbox();
  }

  function jumpTo(insight: Insight) {
    notesStore.selectNoteByAnyPath(insight.sourceNote);
    events.emit('app:navigate', { view: 'note', path: insight.sourceNote });
    close();
  }

  async function dismiss(insightId: string) {
    await pulseStore.dismiss(insightId);
  }

  async function dismissAll() {
    await pulseStore.dismissAll();
    close();
  }

  function iconFor(type: Insight['type']): Component {
    switch (type) {
      case 'contradiction':
        return AlertTriangle;
      case 'stale':
        return Clock;
      case 'overdue':
        return CheckSquare;
      case 'connection':
        return GitBranch;
      default:
        return Sparkles;
    }
  }
</script>

{#if uiStore.pulseInboxOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="pulse-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="pulse-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Insights inbox"
    >
      <header class="pulse-header">
        <span class="pulse-title">
          <Sparkles size={13} strokeWidth={1.7} aria-hidden="true" />
          Pulse
          <InfoPopover
            title="Pulse insights"
            body="Pulse surfaces note signals that may deserve attention while you write."
            items={[
              'Contradictions point to possible conflicts between notes.',
              'Stale and overdue items are reminders to review.',
              'Dismiss hides the insight without changing the note.',
            ]}
            align="start"
          />
        </span>
        <span class="pulse-count">{pulseStore.count} insight{pulseStore.count === 1 ? '' : 's'}</span>
        <button type="button" class="pulse-action" onclick={dismissAll} disabled={pulseStore.count === 0}>
          Dismiss all
        </button>
        <button type="button" class="pulse-close" onclick={close} aria-label="Close inbox">
          <X size={13} strokeWidth={1.8} />
        </button>
      </header>

      <div class="pulse-body">
        {#if pulseStore.loading}
          <p class="pulse-empty">Loading insights…</p>
        {:else if pulseStore.error}
          <p class="pulse-empty pulse-error">{pulseStore.error.message}</p>
        {:else if pulseStore.count === 0}
          <p class="pulse-empty">
            <Sparkles size={20} strokeWidth={1.2} aria-hidden="true" />
            <span>No insights right now</span>
            <span class="pulse-hint">Pulse will surface contradictions, stale notes, and connections as you write.</span>
          </p>
        {:else}
          <ul class="pulse-list" role="list">
            {#each pulseStore.insights as insight (insight.id)}
              {@const Icon = iconFor(insight.type)}
              <li class="pulse-row">
                <div class="pulse-icon">
                  <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
                </div>
                <div class="pulse-content">
                  <div class="pulse-row-header">
                    <span class="pulse-row-title">{insight.title}</span>
                    <span class="pulse-row-type">{insight.type}</span>
                  </div>
                  <p class="pulse-row-message">{insight.message}</p>
                  <div class="pulse-row-actions">
                    <button type="button" class="pulse-jump" onclick={() => jumpTo(insight)}>
                      Open {insight.sourceNote.split('/').pop()?.replace(/\.md$/, '') ?? insight.sourceNote}
                    </button>
                    <button type="button" class="pulse-dismiss" onclick={() => dismiss(insight.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .pulse-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 60px;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .pulse-panel {
    width: 560px;
    max-width: 92vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
  }

  .pulse-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .pulse-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .pulse-count {
    flex: 1;
    color: var(--text-tertiary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .pulse-action {
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 9px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
  }

  .pulse-action:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pulse-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .pulse-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pulse-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 12px;
  }

  .pulse-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12.5px;
  }

  .pulse-error {
    color: var(--color-error);
  }

  .pulse-hint {
    font-size: 11.5px;
    color: var(--text-muted);
    max-width: 320px;
  }

  .pulse-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .pulse-row {
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-faint);
  }

  .pulse-row:last-child {
    border-bottom: none;
  }

  .pulse-icon {
    color: var(--accent-primary);
    margin-top: 1px;
  }

  .pulse-content {
    min-width: 0;
  }

  .pulse-row-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }

  .pulse-row-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .pulse-row-type {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .pulse-row-message {
    margin: 0 0 6px;
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .pulse-row-actions {
    display: flex;
    gap: 6px;
  }

  .pulse-jump,
  .pulse-dismiss {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
  }

  .pulse-jump:hover,
  .pulse-dismiss:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
