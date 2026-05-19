<script lang="ts">
  /**
   * ConflictBanner — visible when the active session has a conflict
   * with the on-disk file (external modification or deletion).
   *
   * Offers two resolution paths:
   *   - "Reload from disk"  — discards in-memory edits.
   *   - "Keep my version"   — force-saves, overwriting the external file.
   *
   * The banner also blocks autosave (the service rejects saves while
   * conflictState is non-clean), so the user MUST resolve before more
   * writes can happen.
   */
  import { editorStore, toastStore } from '$lib/stores';
  import { AlertTriangle, RotateCcw, Save } from '@lucide/svelte';

  async function reloadFromDisk() {
    const path = editorStore.activePath;
    if (!path) return;
    const result = await editorStore.resolveConflict(path, 'take-remote');
    if (result.ok) {
      toastStore.success('Reloaded from disk');
    }
  }

  async function keepMyVersion() {
    const path = editorStore.activePath;
    if (!path) return;
    const result = await editorStore.resolveConflict(path, 'keep-local');
    if (result.ok) {
      toastStore.success('Saved your version');
    }
  }
</script>

{#if editorStore.conflictState !== 'clean'}
  <div class="conflict-banner" class:deleted={editorStore.conflictState === 'external-deleted'} role="alert">
    <span class="conflict-icon" aria-hidden="true">
      <AlertTriangle size={16} strokeWidth={2.2} />
    </span>
    <span class="conflict-message">
      {#if editorStore.conflictState === 'external-deleted'}
        This file was <strong>deleted</strong> outside of Void. Saving will recreate it.
      {:else}
        This file was <strong>modified</strong> outside of Void. Saving will overwrite the external changes.
      {/if}
    </span>
    <div class="conflict-actions">
      <button type="button" class="conflict-action" onclick={reloadFromDisk}>
        <RotateCcw size={13} strokeWidth={2.2} />
        Reload from disk
      </button>
      <button type="button" class="conflict-action primary" onclick={keepMyVersion}>
        <Save size={13} strokeWidth={2.2} />
        Keep my version
      </button>
    </div>
  </div>
{/if}

<style>
  .conflict-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: color-mix(in oklab, var(--accent-primary) 8%, var(--surface-base));
    border-bottom: 1px solid color-mix(in oklab, var(--accent-primary) 25%, transparent);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .conflict-banner.deleted {
    background: color-mix(in oklab, #c93838 6%, var(--surface-base));
    border-bottom-color: color-mix(in oklab, #c93838 25%, transparent);
  }

  .conflict-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--accent-primary);
  }

  .conflict-banner.deleted .conflict-icon {
    color: #c93838;
  }

  .conflict-message {
    flex: 1 1 auto;
    line-height: 1.4;
  }

  .conflict-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .conflict-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--surface-raised);
    border: 1px solid var(--border-medium);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }

  .conflict-action:hover {
    background: var(--surface-base);
    border-color: var(--border-dark);
  }

  .conflict-action.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
  }

  .conflict-action.primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
