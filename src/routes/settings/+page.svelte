<script lang="ts">
  import { settingsStore, workspaceStore } from '$lib/stores';
  import UpdateSettingsSection from '$lib/components/shared/UpdateSettingsSection.svelte';
  import CLIProviderDetails from '$lib/components/shared/CLIProviderDetails.svelte';
  import {
    AI_REASONING_EFFORT_OPTIONS,
    CLI_PROVIDER_OPTIONS,
    type AIReasoningEffort,
    type CLIProviderId,
    type Settings,
  } from '$lib/domain';
  import { open } from '@tauri-apps/plugin-dialog';

  /**
   * Settings Page
   *
   * This page allows users to configure app settings:
   * - Theme (light/dark/system)
   * - Notes path
   * - Auto-save preferences
   * - Local AI CLI configuration
   */

  // Local state for form inputs
  let notesPathInput = $state('');
  let autoSaveDelayInput = $state('');
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let saveError = $state<string | null>(null);

  // Sync form inputs with loaded settings
  $effect(() => {
    if (settingsStore.settings) {
      notesPathInput = settingsStore.settings.notesPath;
      autoSaveDelayInput = String(settingsStore.settings.autoSaveDelay);
    }
  });

  const cliProviderLabels: Record<CLIProviderId, string> = {
    codex: 'Codex CLI',
    'claude-code': 'Claude Code',
  };

  const reasoningLabels: Record<AIReasoningEffort, string> = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
  };

  /**
   * Update a setting and show save status
   */
  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    saveStatus = 'saving';
    saveError = null;

    try {
      await settingsStore.set(key, value);
      saveStatus = 'saved';
      // Reset status after a delay
      setTimeout(() => {
        if (saveStatus === 'saved') saveStatus = 'idle';
      }, 2000);
    } catch (e) {
      saveStatus = 'error';
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * Handle notes path update
   */
  async function handleNotesPathUpdate() {
    await updateActiveWorkspacePath(notesPathInput);
  }

  async function updateActiveWorkspacePath(path: string) {
    if (!settingsStore.settings) return;
    saveStatus = 'saving';
    saveError = null;
    try {
      const updated = await workspaceStore.updateNotesPath(
        settingsStore.settings.activeWorkspaceId,
        path,
      );
      if (!updated) {
        throw workspaceStore.error ?? new Error('Failed to update active workspace folder');
      }
      await settingsStore.load();
      notesPathInput = settingsStore.settings?.notesPath ?? path;
      saveStatus = 'saved';
      setTimeout(() => {
        if (saveStatus === 'saved') saveStatus = 'idle';
      }, 2000);
    } catch (e) {
      saveStatus = 'error';
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * Browse for notes folder
   */
  async function browseNotesFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Notes Folder',
      });

      if (selected && typeof selected === 'string') {
        notesPathInput = selected;
        await updateActiveWorkspacePath(selected);
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  }

  /**
   * Handle auto-save delay update
   */
  async function handleAutoSaveDelayUpdate() {
    const delay = parseInt(autoSaveDelayInput, 10);
    if (!isNaN(delay) && delay >= 0) {
      await updateSetting('autoSaveDelay', delay);
    }
  }

  /**
   * Reload settings from storage
   */
  async function reloadSettings() {
    await settingsStore.load();
  }

  // Reset confirmation state
  let showResetConfirm = $state(false);

  /**
   * Show reset confirmation
   */
  function requestReset() {
    showResetConfirm = true;
  }

  /**
   * Cancel reset
   */
  function cancelReset() {
    showResetConfirm = false;
  }

  /**
   * Confirm and execute reset
   */
  async function confirmReset() {
    showResetConfirm = false;
    saveStatus = 'saving';
    saveError = null;
    try {
      const success = await settingsStore.reset();
      if (success) {
        saveStatus = 'saved';
        // Sync form inputs
        if (settingsStore.settings) {
          notesPathInput = settingsStore.settings.notesPath;
          autoSaveDelayInput = String(settingsStore.settings.autoSaveDelay);
        }
        setTimeout(() => {
          if (saveStatus === 'saved') saveStatus = 'idle';
        }, 2000);
      } else {
        saveStatus = 'error';
        saveError = 'Failed to reset settings';
      }
    } catch (e) {
      saveStatus = 'error';
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  // Debug state
  let showDebug = $state(false);
</script>

<main class="settings-page">
  <div class="settings-container">
    <!-- Header -->
    <header class="settings-header">
      <div class="header-row">
        <a
          href="/"
          class="back-link"
          title="Back to editor"
        >
          <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <div>
          <h1 class="page-title">
            Settings
          </h1>
          <p class="page-subtitle">
            Configure your preferences
          </p>
        </div>
      </div>
    </header>

    <!-- Loading State -->
    {#if settingsStore.loading}
      <div class="loading-card">
        <div class="loading-content">
          <div class="spinner"></div>
          <p class="loading-text">Loading settings...</p>
        </div>
      </div>

    <!-- Error State -->
    {:else if settingsStore.error}
      <div class="error-card">
        <h2 class="error-title">
          Error Loading Settings
        </h2>
        <p class="error-message">
          {settingsStore.error.message}
        </p>
        <button
          onclick={reloadSettings}
          class="error-button"
        >
          Retry
        </button>
      </div>

    <!-- Settings Loaded -->
    {:else if settingsStore.settings}
      <!-- Save Status Banner -->
      {#if saveStatus !== 'idle'}
        <div
          class="status-banner"
          class:status-saving={saveStatus === 'saving'}
          class:status-saved={saveStatus === 'saved'}
          class:status-error={saveStatus === 'error'}
        >
          {#if saveStatus === 'saving'}
            <p>Saving...</p>
          {:else if saveStatus === 'saved'}
            <p>Settings saved successfully</p>
          {:else if saveStatus === 'error'}
            <p>Error: {saveError}</p>
          {/if}
        </div>
      {/if}

      <UpdateSettingsSection variant="page" />

      <!-- Settings Form -->
      <section class="settings-form">
        <!-- Notes Path -->
        <div class="form-group">
          <label for="notesPath" class="form-label">
            Notes Path
          </label>
          <div class="input-row">
            <input
              id="notesPath"
              type="text"
              bind:value={notesPathInput}
              class="input flex-1"
            />
            <button
              onclick={browseNotesFolder}
              class="btn btn-secondary"
              title="Browse for folder"
            >
              Browse...
            </button>
            <button
              onclick={handleNotesPathUpdate}
              class="btn btn-primary"
            >
              Update
            </button>
          </div>
        </div>

        <!-- Auto Save -->
        <div class="form-group">
          <span id="autoSaveLabel" class="form-label">
            Auto Save
          </span>
          <button
            onclick={() => updateSetting('autoSave', !settingsStore.settings?.autoSave)}
            role="switch"
            aria-checked={settingsStore.settings.autoSave}
            aria-labelledby="autoSaveLabel"
            class="toggle-switch"
            class:toggle-on={settingsStore.settings.autoSave}
          >
            <span
              class="toggle-knob"
              class:toggle-knob-on={settingsStore.settings.autoSave}
            ></span>
          </button>
          <span class="toggle-label">
            {settingsStore.settings.autoSave ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <!-- Auto Save Delay -->
        <div class="form-group">
          <label for="autoSaveDelay" class="form-label">
            Auto Save Delay (ms)
          </label>
          <div class="input-row">
            <input
              id="autoSaveDelay"
              type="number"
              min="0"
              step="100"
              bind:value={autoSaveDelayInput}
              class="input input-narrow"
            />
            <button
              onclick={handleAutoSaveDelayUpdate}
              class="btn btn-primary"
            >
              Update
            </button>
          </div>
        </div>

        <!-- Local AI CLI -->
        <fieldset class="form-group">
          <legend class="form-label">
            Local AI CLI
          </legend>
          <div class="button-group button-group-wrap" role="group" aria-label="Local AI CLI selection">
            {#each CLI_PROVIDER_OPTIONS as provider}
              <button
                type="button"
                onclick={() => updateSetting('cliProvider', provider)}
                class="option-btn"
                class:option-active={settingsStore.settings.cliProvider === provider}
              >
                {cliProviderLabels[provider]}
              </button>
            {/each}
          </div>
          <CLIProviderDetails selectedProvider={settingsStore.settings.cliProvider} />
        </fieldset>

        <!-- Reasoning Effort -->
        <fieldset class="form-group">
          <legend class="form-label">
            Reasoning
          </legend>
          <div class="button-group button-group-wrap" role="group" aria-label="Reasoning strength selection">
            {#each AI_REASONING_EFFORT_OPTIONS as effort}
              <button
                type="button"
                onclick={() => updateSetting('aiReasoningEffort', effort)}
                class="option-btn"
                class:option-active={settingsStore.settings.aiReasoningEffort === effort}
              >
                {reasoningLabels[effort]}
              </button>
            {/each}
          </div>
        </fieldset>
      </section>

      <!-- Actions -->
      <section class="actions-section">
        <button
          onclick={reloadSettings}
          class="btn btn-secondary"
        >
          Reload Settings
        </button>
        {#if showResetConfirm}
          <div class="confirm-group">
            <span class="confirm-text">Reset all settings?</span>
            <button
              onclick={confirmReset}
              class="btn btn-danger btn-small"
            >
              Yes, Reset
            </button>
            <button
              onclick={cancelReset}
              class="btn btn-secondary btn-small"
            >
              Cancel
            </button>
          </div>
        {:else}
          <button
            onclick={requestReset}
            class="btn btn-danger"
          >
            Reset to Defaults
          </button>
        {/if}
        <button
          onclick={() => showDebug = !showDebug}
          class="btn btn-secondary"
        >
          {showDebug ? 'Hide' : 'Show'} Debug Info
        </button>
      </section>

      <!-- Debug Panel -->
      {#if showDebug}
        <section class="debug-panel">
          <h3 class="debug-title">Debug Information</h3>
          <div class="debug-content">
            <div class="debug-row">
              <span class="debug-label">Current notesPath:</span>
              <code class="debug-value">{settingsStore.settings?.notesPath ?? 'not set'}</code>
            </div>
            <div class="debug-row">
              <span class="debug-label">Form input value:</span>
              <code class="debug-value">{notesPathInput}</code>
            </div>
            <div class="debug-row">
              <span class="debug-label">Store initialized:</span>
              <code class="debug-value">{settingsStore.isInitialized}</code>
            </div>
            <div class="debug-row">
              <span class="debug-label">Settings loaded:</span>
              <code class="debug-value">{settingsStore.isLoaded}</code>
            </div>
            <p class="debug-hint">
              Note: Paths starting with ~ should be expanded to your home directory by the backend.
              If your notes aren't showing, check that the path exists and contains .md files.
            </p>
          </div>
        </section>
      {/if}

    <!-- Not Initialized -->
    {:else}
      <div class="warning-card">
        <h2 class="warning-title">
          Settings Not Loaded
        </h2>
        <p class="warning-message">
          The settings store has not been initialized. This usually means the bootstrap process did not complete.
        </p>
      </div>
    {/if}
  </div>
</main>

<style>
  .settings-page {
    height: 100%;
    overflow-y: auto;
    background-color: var(--bg-app);
    padding: 2rem;
  }

  .settings-container {
    max-width: 42rem;
    margin: 0 auto;
  }

  .settings-header {
    margin-bottom: 2rem;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .back-link {
    padding: 0.5rem;
    border-radius: var(--radius-lg);
    color: var(--text-secondary);
    transition: background-color var(--transition-fast);
  }

  .back-link:hover {
    background-color: var(--bg-hover);
  }

  .back-link .icon {
    width: 1.25rem;
    height: 1.25rem;
  }

  .page-title {
    font-size: 1.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .page-subtitle {
    margin-top: 0.5rem;
    color: var(--text-secondary);
  }

  .loading-card {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem;
    border-radius: var(--radius-lg);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-sm);
  }

  .loading-content {
    text-align: center;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    margin: 0 auto 1rem;
    border: 4px solid var(--border-light);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    color: var(--text-secondary);
  }

  .error-card {
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    background-color: var(--color-error-bg);
  }

  .error-title {
    margin-bottom: 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-error);
  }

  .error-message {
    margin-bottom: 1rem;
    color: var(--color-error);
  }

  .error-button {
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    background-color: var(--color-error);
    color: var(--text-inverse);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .error-button:hover {
    opacity: 0.9;
  }

  .status-banner {
    margin-bottom: 1.5rem;
    padding: 1rem;
    border-radius: var(--radius-lg);
  }

  .status-saving {
    background-color: var(--accent-light);
    color: var(--accent-primary);
  }

  .status-saved {
    background-color: var(--color-success-bg);
    color: var(--color-success);
  }

  .status-error {
    background-color: var(--color-error-bg);
    color: var(--color-error);
  }

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-sm);
  }

  .form-group {
    border: none;
    padding: 0;
    margin: 0;
  }

  .form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
  }

  .input-narrow {
    width: 8rem;
  }

  .button-group {
    display: flex;
    gap: 0.5rem;
  }

  .button-group-wrap {
    flex-wrap: wrap;
  }

  .option-btn {
    padding: 0.5rem 1rem;
    border-radius: var(--radius-lg);
    font-size: 0.875rem;
    font-weight: 500;
    background-color: var(--bg-hover);
    color: var(--text-primary);
    transition: background-color var(--transition-fast);
    cursor: pointer;
  }

  .option-btn:hover:not(.option-active) {
    background-color: var(--bg-active);
  }

  .option-active {
    background-color: var(--accent-primary);
    color: var(--text-inverse);
  }

  .toggle-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 2.75rem;
    height: 1.5rem;
    border-radius: 9999px;
    background-color: var(--border-medium);
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .toggle-on {
    background-color: var(--accent-primary);
  }

  .toggle-knob {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background-color: white;
    transform: translateX(0.25rem);
    transition: transform var(--transition-fast);
  }

  .toggle-knob-on {
    transform: translateX(1.5rem);
  }

  .toggle-label {
    margin-left: 0.75rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .actions-section {
    margin-top: 1.5rem;
    display: flex;
    gap: 1rem;
  }

  .warning-card {
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    background-color: var(--color-warning-bg);
  }

  .warning-title {
    margin-bottom: 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-warning);
  }

  .warning-message {
    color: var(--color-warning);
  }

  .btn-danger {
    background-color: var(--color-error);
    color: var(--text-inverse);
  }

  .btn-danger:hover {
    opacity: 0.9;
  }

  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
  }

  .confirm-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-lg);
    background-color: var(--color-warning-bg);
  }

  .confirm-text {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-warning);
  }

  .debug-panel {
    margin-top: 1.5rem;
    padding: 1rem;
    border-radius: var(--radius-lg);
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
  }

  .debug-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .debug-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .debug-row {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }

  .debug-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    min-width: 10rem;
  }

  .debug-value {
    font-size: 0.75rem;
    font-family: monospace;
    background-color: var(--bg-hover);
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    word-break: break-all;
  }

  .debug-hint {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--text-tertiary);
    font-style: italic;
  }

</style>
