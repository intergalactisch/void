<script lang="ts">
  /**
   * BranchPicker — modal listing alternative versions for the active note.
   *
   * Surfaces .void/branches/{note}/ via BranchService. Each entry shows the
   * generation prompt, age, and content preview, with Accept and Reject
   * actions. Toggle via `view.toggleBranchPicker` (Mod+Shift+H).
   */

  import { onDestroy } from 'svelte';
  import { branchesStore, notesStore, uiStore } from '$lib/stores';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { GitBranch, X, Check, Trash2, RotateCcw } from '@lucide/svelte';
  import { formatRelativeDate } from '$lib/utils/relativeDate';
  import { InfoPopover } from '$lib/components/shared';

  let dialogRef: HTMLDivElement | null = $state(null);
  let cleanup: (() => void) | null = null;

  $effect(() => {
    if (uiStore.branchPickerOpen) {
      void branchesStore.fetchFor(notesStore.selectedPath);
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
    uiStore.closeBranchPicker();
  }

  async function accept(branchId: string) {
    await branchesStore.accept(branchId);
  }

  async function reject(branchId: string) {
    await branchesStore.reject(branchId);
  }

  async function restore(branchId: string) {
    await branchesStore.restore(branchId);
  }

  function preview(content: string, max = 240): string {
    if (content.length <= max) return content;
    return content.slice(0, max - 1) + '…';
  }

  function comparisonSummary(branchId: string): string | null {
    return branchesStore.comparisons.get(branchId)?.summary ?? null;
  }
</script>

{#if uiStore.branchPickerOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="branch-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="branch-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Branch picker"
    >
      <header class="branch-header">
        <span class="branch-title">
          <GitBranch size={13} strokeWidth={1.7} aria-hidden="true" />
          Branches
          <InfoPopover
            title="Alternative drafts"
            body="Branches are alternative versions of the current note that live beside your markdown until you accept, reject, or restore them."
            items={[
              'Accept replaces the note with that draft.',
              'Reject archives the draft from the pending list.',
              'Restore brings back a previously handled draft.',
            ]}
            align="start"
          />
        </span>
        <span class="branch-count">{branchesStore.branches.length} alternative{branchesStore.branches.length === 1 ? '' : 's'}</span>
        <button type="button" class="branch-close" onclick={close} aria-label="Close branch picker">
          <X size={13} strokeWidth={1.8} />
        </button>
      </header>

      <div class="branch-body">
        {#if branchesStore.loading}
          <p class="branch-empty">Loading branches…</p>
        {:else if branchesStore.error}
          <p class="branch-empty branch-error">{branchesStore.error.message}</p>
        {:else if !branchesStore.activePath}
          <p class="branch-empty">No note open</p>
        {:else if branchesStore.branches.length === 0}
          <p class="branch-empty">
            <GitBranch size={20} strokeWidth={1.2} aria-hidden="true" />
            <span>No alternative versions yet</span>
            <span class="branch-hint">Use AI to generate alternatives, then come back here to compare and pick.</span>
          </p>
        {:else}
          <ul class="branch-list" role="list">
            {#each branchesStore.branches as branch (branch.id)}
              <li class="branch-item branch-item-{branch.status}">
                <div class="branch-item-header">
                  <span class="branch-item-status branch-status-{branch.status}">{branch.status}</span>
                  <time class="branch-item-time" datetime={branch.created}>
                    {formatRelativeDate(new Date(branch.created))}
                  </time>
                </div>
                {#if branch.prompt}
                  <p class="branch-prompt">"{branch.prompt}"</p>
                {/if}
                {#if comparisonSummary(branch.id)}
                  <p class="branch-compare">{comparisonSummary(branch.id)}</p>
                {/if}
                <pre class="branch-content">{preview(branch.content)}</pre>
                {#if branch.status === 'pending'}
                  <div class="branch-actions">
                    <button type="button" class="branch-accept" onclick={() => accept(branch.id)}>
                      <Check size={11} strokeWidth={1.8} aria-hidden="true" /> Accept
                    </button>
                    <button type="button" class="branch-reject" onclick={() => reject(branch.id)}>
                      <Trash2 size={11} strokeWidth={1.8} aria-hidden="true" /> Reject
                    </button>
                  </div>
                {:else}
                  <div class="branch-actions">
                    <button type="button" class="branch-restore" onclick={() => restore(branch.id)}>
                      <RotateCcw size={11} strokeWidth={1.8} aria-hidden="true" /> Restore
                    </button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .branch-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8vh;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .branch-panel {
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
  }

  .branch-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .branch-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .branch-count {
    flex: 1;
    color: var(--text-tertiary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .branch-close {
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

  .branch-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .branch-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0 14px;
  }

  .branch-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 36px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12.5px;
  }

  .branch-error {
    color: var(--color-error);
  }

  .branch-hint {
    font-size: 11.5px;
    color: var(--text-muted);
    max-width: 360px;
  }

  .branch-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .branch-item {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .branch-item:last-child {
    border-bottom: none;
  }

  .branch-item-rejected,
  .branch-item-accepted {
    opacity: 0.65;
  }

  .branch-item-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }

  .branch-item-status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }

  .branch-status-pending {
    background: var(--accent-light);
    color: var(--accent-primary);
  }

  .branch-status-accepted {
    background: var(--color-success, #2c8a4d);
    color: var(--text-inverse, #fff);
  }

  .branch-status-rejected {
    background: var(--color-error-bg, rgba(200, 50, 50, 0.16));
    color: var(--color-error, #c83232);
  }

  .branch-item-time {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .branch-prompt {
    margin: 0 0 6px;
    font-size: 12.5px;
    color: var(--text-secondary);
    font-style: italic;
  }

  .branch-compare {
    margin: -2px 0 7px;
    color: var(--text-tertiary);
    font-size: 11.5px;
  }

  .branch-content {
    margin: 0 0 8px;
    padding: 8px 10px;
    background: var(--bg-app);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-primary);
    max-height: 140px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .branch-actions {
    display: flex;
    gap: 6px;
  }

  .branch-accept,
  .branch-reject,
  .branch-restore {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 9px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
  }

  .branch-accept:hover {
    background: var(--color-success, #2c8a4d);
    border-color: var(--color-success, #2c8a4d);
    color: var(--text-inverse, #fff);
  }

  .branch-reject:hover {
    background: var(--color-error, #c83232);
    border-color: var(--color-error, #c83232);
    color: var(--text-inverse, #fff);
  }

  .branch-restore:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
