<script lang="ts">
  import { AlertTriangle, X } from '@lucide/svelte';

  interface Props {
    path: string;
    title: string;
    noteCount: number;
    folderCount: number;
    onConfirm: () => Promise<void> | void;
    onClose: () => void;
  }

  let { path, title, noteCount, folderCount, onConfirm, onClose }: Props = $props();

  let deleting = $state(false);
  let error = $state<string | null>(null);

  const totalItems = $derived(noteCount + folderCount);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  async function handleConfirm() {
    if (deleting) return;
    deleting = true;
    error = null;
    try {
      await onConfirm();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      deleting = false;
      return;
    }
    deleting = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="df-backdrop" onclick={onClose} role="presentation"></div>

<div class="df-modal" role="dialog" aria-modal="true" aria-labelledby="df-title">
  <header class="df-head">
    <span class="df-icon" aria-hidden="true"><AlertTriangle size={15} strokeWidth={1.9} /></span>
    <h2 id="df-title">Delete folder?</h2>
    <button type="button" class="df-close" onclick={onClose} aria-label="Cancel" title="Cancel">
      <X size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  </header>

  <div class="df-body">
    <p class="df-question">
      Delete <strong>{title}</strong>
      {#if totalItems > 0}
        and {totalItems} item{totalItems === 1 ? '' : 's'} inside
        ({#if noteCount > 0}{noteCount} note{noteCount === 1 ? '' : 's'}{/if}{#if noteCount > 0 && folderCount > 0}, {/if}{#if folderCount > 0}{folderCount} subfolder{folderCount === 1 ? '' : 's'}{/if})?
      {:else}
        ?
      {/if}
    </p>
    <p class="df-path"><code>{path}</code></p>
    <p class="df-warning">This cannot be undone.</p>
    {#if error}
      <p class="df-error" role="alert">{error}</p>
    {/if}

    <div class="df-actions">
      <button type="button" class="df-button" onclick={onClose} disabled={deleting}>Cancel</button>
      <button type="button" class="df-button df-button-danger" onclick={handleConfirm} disabled={deleting}>
        {deleting ? 'Deleting…' : `Delete ${totalItems > 0 ? 'folder + contents' : 'folder'}`}
      </button>
    </div>
  </div>
</div>

<style>
  .df-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal, 400) - 1);
    background: color-mix(in srgb, var(--bg-overlay, rgba(0,0,0,0.4)) 50%, transparent);
    backdrop-filter: blur(4px) saturate(120%);
    -webkit-backdrop-filter: blur(4px) saturate(120%);
  }

  .df-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--z-modal, 400);
    width: min(460px, calc(100vw - 32px));
    transform: translate(-50%, -50%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: df-pop 180ms var(--ease-out-soft, ease-out);
  }

  @keyframes df-pop {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .df-head {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .df-icon {
    display: inline-flex;
    color: var(--color-error);
  }

  .df-head h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13.5px;
    font-weight: 650;
  }

  .df-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .df-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .df-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }

  .df-question {
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.5;
  }

  .df-question strong {
    font-weight: 650;
  }

  .df-path {
    margin: 0;
  }

  .df-path code {
    display: inline-block;
    padding: 3px 7px;
    border-radius: 4px;
    background: var(--bg-editor);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
    word-break: break-all;
  }

  .df-warning {
    margin: 0;
    color: var(--color-error);
    font-size: 12px;
    font-weight: 600;
  }

  .df-error {
    margin: 0;
    padding: 7px 10px;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 11.5px;
  }

  .df-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .df-button {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .df-button:hover:not(:disabled) {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .df-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .df-button-danger {
    border-color: transparent;
    background: var(--color-error);
    color: var(--text-inverse);
    box-shadow: var(--shadow-xs);
  }

  .df-button-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-error) 88%, black);
  }
</style>
