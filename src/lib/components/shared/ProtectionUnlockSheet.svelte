<script lang="ts">
  import { KeyRound, LockKeyhole, X } from '@lucide/svelte';
  import { protectionStore } from '$lib/stores';

  let recoveryPassphrase = $state('');

  const title = $derived(protectionStore.unlockSheet.recoveryMode ? 'Use recovery passphrase' : 'Unlock protected notes');
  const primaryLabel = $derived(protectionStore.loading
    ? 'Unlocking...'
    : protectionStore.unlockSheet.recoveryMode
      ? 'Unlock with recovery'
      : 'Unlock with Keychain');

  function close() {
    protectionStore.closeUnlockSheet(false);
    recoveryPassphrase = '';
  }

  function switchToRecovery() {
    protectionStore.unlockSheet.recoveryMode = true;
    protectionStore.unlockSheet.error = null;
    recoveryPassphrase = '';
  }

  async function submit() {
    const ok = await protectionStore.unlockFromSheet(
      protectionStore.unlockSheet.recoveryMode ? recoveryPassphrase : undefined,
    );
    if (ok) recoveryPassphrase = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!protectionStore.unlockSheet.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if protectionStore.unlockSheet.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="unlock-backdrop" onclick={close} role="presentation"></div>

  <div class="unlock-sheet" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
    <header class="unlock-header">
      <span class="unlock-icon" aria-hidden="true">
        <LockKeyhole size={16} strokeWidth={2} />
      </span>
      <div>
        <h2 id="unlock-title">{title}</h2>
        <p>{protectionStore.unlockSheet.reason}</p>
      </div>
      <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={close}>
        <X size={14} strokeWidth={2} />
      </button>
    </header>

    <div class="unlock-body">
      {#if protectionStore.unlockSheet.recoveryMode}
        <label class="field">
          <span>Recovery passphrase</span>
          <input
            type="password"
            bind:value={recoveryPassphrase}
            autocomplete="current-password"
            placeholder="Enter recovery passphrase"
            disabled={protectionStore.loading}
          />
        </label>
      {:else}
        <div class="keychain-row">
          <KeyRound size={16} strokeWidth={2} aria-hidden="true" />
          <span>macOS may ask once for this workspace. After that, Void keeps the vault key in memory until you lock it or quit.</span>
        </div>
      {/if}

      {#if protectionStore.unlockSheet.error}
        <p class="unlock-error" role="alert">{protectionStore.unlockSheet.error}</p>
      {/if}
    </div>

    <footer class="unlock-actions">
      {#if !protectionStore.unlockSheet.recoveryMode}
        <button type="button" class="text-button" onclick={switchToRecovery} disabled={protectionStore.loading}>
          Use recovery passphrase
        </button>
      {/if}
      <button type="button" class="secondary-button" onclick={close} disabled={protectionStore.loading}>Cancel</button>
      <button
        type="button"
        class="primary-button"
        onclick={submit}
        disabled={protectionStore.loading || (protectionStore.unlockSheet.recoveryMode && recoveryPassphrase.trim().length === 0)}
      >
        {primaryLabel}
      </button>
    </footer>
  </div>
{/if}

<style>
  .unlock-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal, 400) - 1);
    background: color-mix(in srgb, var(--bg-overlay, rgba(18, 18, 18, 0.45)) 50%, transparent);
    backdrop-filter: blur(3px) saturate(115%);
    -webkit-backdrop-filter: blur(3px) saturate(115%);
  }

  .unlock-sheet {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--z-modal, 400);
    width: min(480px, calc(100vw - 32px));
    transform: translate(-50%, -50%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-xl, 0 24px 80px rgba(0, 0, 0, 0.22));
    color: var(--text-primary);
    overflow: hidden;
  }

  .unlock-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .unlock-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
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

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
  }

  .icon-button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .unlock-body {
    padding: 16px 18px 4px;
  }

  .keychain-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-secondary);
    background: var(--bg-subtle);
    font-size: 13px;
    line-height: 1.45;
  }

  .field {
    display: grid;
    gap: 7px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 560;
  }

  input {
    min-height: 38px;
    border: 1px solid var(--border-light);
    border-radius: 8px;
    padding: 0 11px;
    color: var(--text-primary);
    background: var(--bg-input, var(--bg-primary));
    font: inherit;
    outline: none;
  }

  input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }

  .unlock-error {
    margin-top: 12px;
    color: var(--color-error, #c2410c);
  }

  .unlock-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 16px 18px 18px;
  }

  button {
    font: inherit;
  }

  .text-button,
  .secondary-button,
  .primary-button {
    min-height: 34px;
    border-radius: 8px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .text-button {
    margin-right: auto;
    border: 0;
    color: var(--text-secondary);
    background: transparent;
  }

  .text-button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
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
