<script lang="ts">
  import { settingsStore, toastStore, updaterStore } from '$lib/stores';
  import {
    AlertTriangle,
    CheckCircle2,
    Download,
    Info,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';

  interface Props {
    variant?: 'panel' | 'page';
  }

  let { variant = 'panel' }: Props = $props();

  let savingPreference = $state(false);
  let preferenceError = $state<string | null>(null);

  onMount(() => {
    if (updaterStore.isInitialized && !updaterStore.currentVersion) {
      void updaterStore.loadCurrentVersion();
    }
  });

  async function updateAutomaticChecks(event: Event) {
    if (!settingsStore.settings) return;
    const checked = (event.currentTarget as HTMLInputElement).checked;
    savingPreference = true;
    preferenceError = null;

    const saved = await settingsStore.set('automaticUpdateChecks', checked);
    if (!saved) {
      preferenceError = 'Could not save update preference.';
    }
    savingPreference = false;
  }

  async function checkNow() {
    const result = await updaterStore.checkForUpdates({ silent: false });
    if (!result.ok) {
      toastStore.error(`Update check failed: ${result.error.message}`, { duration: 6000 });
      return;
    }
    if (!result.value) {
      toastStore.success('Void is up to date');
    }
  }

  async function installUpdate() {
    const result = await updaterStore.installUpdate();
    if (!result.ok) {
      toastStore.error(`Update failed: ${result.error.message}`, { duration: 8000 });
      return;
    }
    toastStore.success('Update installed. Restart Void to finish.', { duration: 6000 });
  }

  async function restartNow() {
    const result = await updaterStore.restartApp();
    if (!result.ok) {
      toastStore.error(`Restart failed: ${result.error.message}`, { duration: 8000 });
    }
  }

  function formatDate(value: string | null): string {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  const currentVersionLabel = $derived(
    updaterStore.currentVersion ?? updaterStore.availableUpdate?.currentVersion ?? 'Unknown'
  );
  const hasUpdate = $derived(updaterStore.availableUpdate !== null);
  const statusText = $derived(
    updaterStore.restartRequired
      ? 'Restart required'
      : hasUpdate
        ? `Void v${updaterStore.availableUpdate?.version} is available`
        : updaterStore.lastCheckedAt
          ? 'Void is up to date'
          : 'No check has run yet'
  );
  const progressText = $derived(
    updaterStore.contentLength
      ? `${formatBytes(updaterStore.downloadedBytes)} of ${formatBytes(updaterStore.contentLength)}`
      : updaterStore.downloadedBytes > 0
        ? `${formatBytes(updaterStore.downloadedBytes)} downloaded`
        : 'Preparing download'
  );
</script>

<section
  id="settings-updates"
  class="update-section"
  class:update-section-page={variant === 'page'}
  aria-labelledby="settings-updates-title"
>
  <div class="update-heading">
    <div class="update-title-row">
      <ShieldCheck size={14} strokeWidth={1.8} aria-hidden="true" />
      <h3 id="settings-updates-title">Updates</h3>
    </div>
    <p>Signed updates only. Manual checks stay available when automatic checks are off.</p>
  </div>

  {#if settingsStore.settings}
    <div class="update-preference">
      <label class="preference-label" for="automaticUpdateChecks">
        <span>
          <span class="preference-title">Automatic update checks</span>
          <span class="preference-subtitle">Check once on launch and show an update notice when one is available.</span>
        </span>
        <span class="native-switch">
          <span class="native-switch-knob"></span>
          <input
            id="automaticUpdateChecks"
            name="automaticUpdateChecks"
            type="checkbox"
            checked={settingsStore.settings.automaticUpdateChecks}
            onchange={updateAutomaticChecks}
            disabled={savingPreference}
          />
        </span>
      </label>
      {#if preferenceError}
        <p class="inline-error">{preferenceError}</p>
      {/if}
    </div>
  {/if}

  <div class="update-status" aria-live="polite">
    <div class="status-main">
      {#if updaterStore.error || preferenceError}
        <AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" />
      {:else if hasUpdate || updaterStore.restartRequired}
        <Info size={14} strokeWidth={1.8} aria-hidden="true" />
      {:else}
        <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" />
      {/if}
      <div>
        <p class="status-title">{statusText}</p>
        <p class="status-subtitle">
          Current version {currentVersionLabel} · Last checked {formatDate(updaterStore.lastCheckedAt)}
        </p>
      </div>
    </div>

    {#if updaterStore.error}
      <p class="status-error">{updaterStore.error.message}</p>
    {/if}
  </div>

  {#if updaterStore.availableUpdate}
    <div class="release-details">
      <div class="release-meta">
        <span>Version {updaterStore.availableUpdate.version}</span>
        {#if updaterStore.availableUpdate.pubDate}
          <span>{formatDate(updaterStore.availableUpdate.pubDate)}</span>
        {/if}
      </div>
      {#if updaterStore.availableUpdate.notes}
        <pre class="release-notes">{updaterStore.availableUpdate.notes}</pre>
      {/if}
    </div>
  {/if}

  {#if updaterStore.installing}
    <div class="install-progress">
      <div class="progress-row">
        <span>{progressText}</span>
        {#if updaterStore.installProgress !== null}
          <span>{updaterStore.installProgress}%</span>
        {/if}
      </div>
      <div class="progress-track" aria-hidden="true">
        <div
          class="progress-bar"
          style:width={updaterStore.installProgress !== null ? `${updaterStore.installProgress}%` : '35%'}
        ></div>
      </div>
    </div>
  {/if}

  {#if updaterStore.restartRequired}
    <div class="restart-prompt">
      <div>
        <p class="restart-title">Update installed</p>
        <p class="restart-copy">Restart Void to finish applying the update.</p>
      </div>
      <div class="restart-actions">
        <button
          type="button"
          class="update-button update-button-primary"
          onclick={restartNow}
          disabled={updaterStore.restarting}
        >
          <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
          {updaterStore.restarting ? 'Restarting' : 'Restart now'}
        </button>
        <button
          type="button"
          class="update-button"
          onclick={() => updaterStore.dismissRestartPrompt()}
        >
          Later
        </button>
      </div>
    </div>
  {/if}

  <div class="update-actions">
    <button
      type="button"
      class="update-button"
      onclick={checkNow}
      disabled={updaterStore.checking || updaterStore.installing}
    >
      <RefreshCw
        size={14}
        strokeWidth={1.8}
        class={updaterStore.checking ? 'spin' : undefined}
        aria-hidden="true"
      />
      {updaterStore.checking ? 'Checking' : 'Check now'}
    </button>
    <button
      type="button"
      class="update-button update-button-primary"
      onclick={installUpdate}
      disabled={!hasUpdate || updaterStore.restartRequired || updaterStore.installing || updaterStore.checking}
    >
      <Download size={14} strokeWidth={1.8} aria-hidden="true" />
      {updaterStore.installing ? 'Installing' : 'Install update'}
    </button>
  </div>
</section>

<style>
  .update-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .update-section-page {
    margin-bottom: 1.5rem;
  }

  .update-heading {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .update-title-row {
    display: flex;
    align-items: baseline;
    gap: 7px;
    color: var(--text-primary);
  }

  .update-title-row h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
  }

  .update-heading p,
  .preference-subtitle,
  .status-subtitle,
  .restart-copy {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  .update-preference,
  .update-status,
  .release-details,
  .install-progress,
  .restart-prompt {
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .preference-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    cursor: pointer;
  }

  .preference-title,
  .status-title,
  .restart-title {
    display: block;
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
  }

  .native-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--border-medium);
  }

  .native-switch:has(input:checked) {
    background: var(--accent-primary);
  }

  .native-switch:has(input:focus-visible) {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .native-switch:has(input:disabled) {
    opacity: 0.6;
  }

  .native-switch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
    opacity: 0;
  }

  .native-switch-knob {
    width: 14px;
    height: 14px;
    margin-left: 3px;
    border-radius: 999px;
    background: white;
    box-shadow: var(--shadow-xs);
    transition: transform var(--transition-fast);
  }

  .native-switch:has(input:checked) .native-switch-knob {
    transform: translateX(16px);
  }

  .inline-error {
    margin: -2px 12px 10px;
    color: var(--color-error);
    font-size: 12px;
  }

  .update-status {
    padding: 10px 12px;
  }

  .status-main {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .status-main :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--accent-primary);
  }

  .status-error {
    margin: 8px 0 0 22px;
    color: var(--color-error);
    font-size: 12px;
    line-height: 1.45;
  }

  .release-details {
    overflow: hidden;
  }

  .release-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-faint);
    color: var(--text-secondary);
    font-size: 12px;
  }

  .release-notes {
    max-height: 140px;
    margin: 0;
    overflow: auto;
    padding: 10px 12px;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .install-progress {
    padding: 10px 12px;
  }

  .progress-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .progress-track {
    height: 5px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--border-light);
  }

  .progress-bar {
    height: 100%;
    border-radius: inherit;
    background: var(--accent-primary);
  }

  .restart-prompt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
  }

  .restart-actions,
  .update-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .update-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 6px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
  }

  .update-button:hover:not(:disabled) {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .update-button:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .update-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .update-button-primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-inverse);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 1px 2px rgba(20, 19, 16, 0.10);
  }

  .update-button-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--text-inverse);
  }

  .update-actions {
    justify-content: flex-end;
  }

  :global(.spin) {
    animation: update-spin 0.8s linear infinite;
  }

  @keyframes update-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
