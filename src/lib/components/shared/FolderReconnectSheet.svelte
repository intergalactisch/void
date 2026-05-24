<script lang="ts">
  import { FolderOpen } from '@lucide/svelte';
  import { folderAccessStore, toastStore, uiStore } from '$lib/stores';

  async function reconnect() {
    const grant = await folderAccessStore.reconnect();
    if (!grant) {
      toastStore.error(folderAccessStore.error?.message ?? 'Could not reconnect notes folder');
      return;
    }
    toastStore.success('Notes folder reconnected');
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  function moveToManagedFolder() {
    uiStore.openSettings();
    toastStore.info('Open Workspaces to move this notes folder into a managed Void folder.');
  }
</script>

{#if folderAccessStore.reconnectRequired}
  <div class="reconnect-backdrop" role="presentation"></div>
  <div class="reconnect-sheet" role="dialog" aria-modal="true" aria-labelledby="reconnect-title">
    <header class="reconnect-header">
      <span class="reconnect-icon" aria-hidden="true">
        <FolderOpen size={17} strokeWidth={2} />
      </span>
      <div>
        <h2 id="reconnect-title">Reconnect notes folder</h2>
        <p>macOS needs confirmation before Void can open this Desktop folder.</p>
      </div>
      <span aria-hidden="true"></span>
    </header>

    <div class="reconnect-body">
      <p class="folder-path">{folderAccessStore.status?.notesPath}</p>
      {#if folderAccessStore.status?.message}
        <p class="message">{folderAccessStore.status.message}</p>
      {/if}
      {#if folderAccessStore.error}
        <p class="error" role="alert">{folderAccessStore.error.message}</p>
      {/if}
    </div>

    <footer class="reconnect-actions">
      <button type="button" class="secondary-button" onclick={moveToManagedFolder}>
        Move to managed folder
      </button>
      <button type="button" class="primary-button" onclick={reconnect} disabled={folderAccessStore.loading}>
        {folderAccessStore.loading ? 'Opening...' : 'Reconnect folder'}
      </button>
    </footer>
  </div>
{/if}

<style>
  .reconnect-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal, 400) - 1);
    background: color-mix(in srgb, var(--bg-overlay, rgba(18, 18, 18, 0.46)) 54%, transparent);
    backdrop-filter: blur(4px) saturate(115%);
    -webkit-backdrop-filter: blur(4px) saturate(115%);
  }

  .reconnect-sheet {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--z-modal, 400);
    width: min(520px, calc(100vw - 32px));
    transform: translate(-50%, -50%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xl, 0 24px 80px rgba(0, 0, 0, 0.22));
    overflow: hidden;
  }

  .reconnect-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .reconnect-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.35;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.45;
  }

  .reconnect-body {
    padding: 16px 18px 4px;
  }

  .folder-path {
    margin: 0;
    padding: 10px 11px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .message,
  .error {
    margin-top: 10px;
  }

  .error {
    color: var(--color-error, #c2410c);
  }

  .reconnect-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 18px 18px;
  }

  button {
    min-height: 34px;
    border-radius: 8px;
    padding: 0 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .secondary-button {
    border: 1px solid var(--border-light);
    color: var(--text-primary);
    background: var(--bg-card);
  }

  .primary-button {
    border: 1px solid var(--accent-primary);
    color: var(--accent-contrast, white);
    background: var(--accent-primary);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
