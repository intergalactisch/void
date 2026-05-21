<script lang="ts">
  /**
   * SettingsPanel - Slide-over panel for app settings.
   *
   * Replaces the separate /settings page with an in-context panel
   * that slides in from the right edge. Keeps the user in their writing flow.
   */

  import { settingsStore, keymapStore } from '$lib/stores';
  import { Layers } from '@lucide/svelte';
  import {
    AI_REASONING_EFFORT_OPTIONS,
    CLI_PROVIDER_OPTIONS,
    UI_DENSITY_OPTIONS,
    CAPTURE_TARGET_OPTIONS,
    type AIReasoningEffort,
    type CLIProviderId,
    type UIDensity,
    type CaptureTarget,
    type Settings,
  } from '$lib/domain';
  import { onDestroy } from 'svelte';
  import { TODO_VIEWS, getTodoViewLabel } from '$lib/domain/values/TodoView';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import {
    chordFromKeyboardEvent,
    chordsEqual,
    formatChord,
    parseChord,
    serializeChord,
    detectPlatform,
    type KeyChord,
  } from '$lib/domain/values/KeyChord';
  import type { KeyBinding } from '$lib/ports/inbound/KeymapService';

  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
  }

  let { isOpen = false, onClose }: Props = $props();

  let panelRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;

  // Local form state
  let autoSaveDelayInput = $state('');
  let fontSizeInput = $state(16);
  let lineHeightInput = $state(1.6);
  let contentWidthInput = $state(720);
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let saveError = $state<string | null>(null);

  // Sync form inputs with loaded settings
  $effect(() => {
    if (settingsStore.settings) {
      autoSaveDelayInput = String(settingsStore.settings.autoSaveDelay);
      fontSizeInput = settingsStore.settings.fontSize;
      lineHeightInput = settingsStore.settings.lineHeight;
      contentWidthInput = settingsStore.settings.contentWidth;
    }
  });

  // Focus trap management
  $effect(() => {
    if (isOpen && panelRef) {
      focusTrapCleanup = createFocusTrap({
        container: panelRef,
        onEscape: handleClose,
      });
    } else if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
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

  const densityLabels: Record<UIDensity, string> = {
    compact: 'Compact',
    comfortable: 'Comfortable',
    spacious: 'Spacious',
  };

  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    saveStatus = 'saving';
    saveError = null;
    try {
      await settingsStore.set(key, value);
      saveStatus = 'saved';
      setTimeout(() => {
        if (saveStatus === 'saved') saveStatus = 'idle';
      }, 2000);
    } catch (e) {
      saveStatus = 'error';
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleAutoSaveDelayUpdate() {
    const delay = parseInt(autoSaveDelayInput, 10);
    if (!isNaN(delay) && delay >= 0) {
      await updateSetting('autoSaveDelay', delay);
    }
  }

  function handleClose() {
    onClose?.();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  onDestroy(() => {
    focusTrapCleanup?.();
  });

  // ─── Keybindings ───
  let recordingFor = $state<string | null>(null);
  let recordedChord = $state<KeyChord | null>(null);
  let platform = detectPlatform();

  function startRecording(commandId: string) {
    recordingFor = commandId;
    recordedChord = null;
  }

  function cancelRecording() {
    recordingFor = null;
    recordedChord = null;
  }

  async function confirmRecording() {
    if (!recordingFor || !recordedChord) {
      cancelRecording();
      return;
    }
    await keymapStore.setOverride(recordingFor, recordedChord);
    cancelRecording();
  }

  async function resetBinding(commandId: string) {
    await keymapStore.clearOverride(commandId);
  }

  function handleRecordKeydown(event: KeyboardEvent) {
    if (!recordingFor) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelRecording();
      return;
    }
    const chord = chordFromKeyboardEvent(event, platform);
    if (!chord.key) return; // pure modifier press
    event.preventDefault();
    event.stopPropagation();
    recordedChord = chord;
  }

  function commandLabel(commandId: string): string {
    const tail = commandId.split('.').slice(1).join('.') || commandId;
    return tail
      .replace(/([A-Z])/g, ' $1')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  function bindingHasConflict(binding: KeyBinding): boolean {
    return keymapStore.conflicts.some((c) =>
      c.bindings.some((b) => b.commandId === binding.commandId) &&
      chordsEqual(c.chord, binding.chord)
    );
  }

  // ─── Capture window settings ───
  // Separate from the in-app keymap because the global shortcut is enforced
  // by `tauri-plugin-global-shortcut` (OS-level), not the in-app binder.
  const captureTargetLabels: Record<CaptureTarget, string> = {
    inbox: 'Inbox folder',
    daily: "Today's daily note",
  };

  let recordingCapture = $state(false);
  let recordedCaptureChord = $state<KeyChord | null>(null);

  function startCaptureRecording() {
    recordingCapture = true;
    recordedCaptureChord = null;
  }

  function cancelCaptureRecording() {
    recordingCapture = false;
    recordedCaptureChord = null;
  }

  async function confirmCaptureRecording() {
    if (!recordedCaptureChord) {
      cancelCaptureRecording();
      return;
    }
    await updateSetting('captureShortcut', serializeChord(recordedCaptureChord));
    cancelCaptureRecording();
  }

  async function clearCaptureShortcut() {
    await updateSetting('captureShortcut', '');
    cancelCaptureRecording();
  }

  function handleCaptureRecordKeydown(event: KeyboardEvent) {
    if (!recordingCapture) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelCaptureRecording();
      return;
    }
    const chord = chordFromKeyboardEvent(event, platform);
    if (!chord.key) return;
    event.preventDefault();
    event.stopPropagation();
    recordedCaptureChord = chord;
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="settings-backdrop" onclick={handleBackdropClick} role="presentation">
    <div
      bind:this={panelRef}
      class="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <!-- Header -->
      <div class="panel-header">
        <h2 class="panel-title">Settings</h2>
        <button
          type="button"
          class="close-btn"
          onclick={handleClose}
          title="Close (Esc)"
          aria-label="Close settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Save Status -->
      {#if saveStatus !== 'idle'}
        <div
          class="save-banner"
          class:save-saving={saveStatus === 'saving'}
          class:save-saved={saveStatus === 'saved'}
          class:save-error={saveStatus === 'error'}
        >
          {#if saveStatus === 'saving'}
            Saving...
          {:else if saveStatus === 'saved'}
            Saved
          {:else if saveStatus === 'error'}
            Error: {saveError}
          {/if}
        </div>
      {/if}

      <!-- Content -->
      <div class="panel-content">
        {#if settingsStore.loading}
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading settings...</p>
          </div>
        {:else if settingsStore.settings}
          <!-- Pointer to the dedicated Workspaces section. Workspace creation,
               renaming, folder management, and GitHub sync now live at
               /workspaces — Settings only handles app-wide preferences. -->
          <a href="/workspaces" class="workspaces-pointer" onclick={handleClose}>
            <Layers size={16} strokeWidth={1.6} aria-hidden="true" />
            <span class="workspaces-pointer-label">
              <span class="workspaces-pointer-title">Manage workspaces</span>
              <span class="workspaces-pointer-sub">Notes folders, GitHub sync, switching</span>
            </span>
            <span class="workspaces-pointer-arrow" aria-hidden="true">→</span>
          </a>

          <!-- Auto Save -->
          <div class="setting-group">
            <span class="group-label" id="sp-autoSaveLabel">AUTO SAVE</span>
            <div class="toggle-row">
              <button
                onclick={() => updateSetting('autoSave', !settingsStore.settings?.autoSave)}
                role="switch"
                aria-checked={settingsStore.settings.autoSave}
                aria-labelledby="sp-autoSaveLabel"
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
          </div>

          <!-- Auto Save Delay -->
          <div class="setting-group">
            <label class="group-label" for="sp-autoSaveDelay">AUTO SAVE DELAY (MS)</label>
            <div class="input-row">
              <input
                id="sp-autoSaveDelay"
                type="number"
                min="0"
                step="100"
                bind:value={autoSaveDelayInput}
                class="input"
                style="width: 8rem;"
                onblur={handleAutoSaveDelayUpdate}
              />
            </div>
          </div>

          <!-- Theme -->
          <fieldset class="setting-group">
            <legend class="group-label">THEME</legend>
            <div class="option-group" role="group" aria-label="Theme selection">
              {#each (['light', 'dark', 'system'] as const) as theme}
                <button
                  onclick={() => updateSetting('theme', theme)}
                  class="option-btn"
                  class:option-active={settingsStore.settings.theme === theme}
                >
                  {theme.charAt(0).toUpperCase() + theme.slice(1)}
                </button>
              {/each}
            </div>
          </fieldset>

          <!-- Tasks -->
          <fieldset class="setting-group">
            <legend class="group-label">TASKS</legend>
            <div class="option-group option-group-wrap" role="group" aria-label="Default task view">
              {#each TODO_VIEWS as view}
                <button
                  type="button"
                  onclick={() => updateSetting('taskDefaultView', view)}
                  class="option-btn"
                  class:option-active={settingsStore.settings.taskDefaultView === view}
                >
                  {getTodoViewLabel(view)}
                </button>
              {/each}
            </div>
          </fieldset>

          <!-- UI Density -->
          <fieldset class="setting-group">
            <legend class="group-label">DENSITY</legend>
            <div class="option-group option-group-wrap" role="group" aria-label="UI density">
              {#each UI_DENSITY_OPTIONS as option}
                <button
                  type="button"
                  onclick={() => updateSetting('density', option)}
                  class="option-btn"
                  class:option-active={settingsStore.settings.density === option}
                >
                  {densityLabels[option]}
                </button>
              {/each}
            </div>
          </fieldset>

          <!-- Typography -->
          <div class="setting-group">
            <span class="group-label">TYPOGRAPHY</span>

            <div class="typography-controls">
              <div class="typography-row">
                <label class="typography-label" for="sp-fontSize">Font size</label>
                <div class="range-control">
                  <input
                    id="sp-fontSize"
                    type="range"
                    min="12"
                    max="24"
                    step="1"
                    bind:value={fontSizeInput}
                    oninput={() => updateSetting('fontSize', fontSizeInput)}
                    class="range-input"
                  />
                  <span class="range-value">{fontSizeInput}px</span>
                </div>
              </div>

              <div class="typography-row">
                <label class="typography-label" for="sp-lineHeight">Line height</label>
                <div class="range-control">
                  <input
                    id="sp-lineHeight"
                    type="range"
                    min="1.4"
                    max="2.0"
                    step="0.1"
                    bind:value={lineHeightInput}
                    oninput={() => updateSetting('lineHeight', lineHeightInput)}
                    class="range-input"
                  />
                  <span class="range-value">{lineHeightInput.toFixed(1)}</span>
                </div>
              </div>

              <div class="typography-row">
                <label class="typography-label" for="sp-contentWidth">Page width</label>
                <div class="range-control">
                  <input
                    id="sp-contentWidth"
                    type="range"
                    min="480"
                    max="960"
                    step="40"
                    bind:value={contentWidthInput}
                    oninput={() => updateSetting('contentWidth', contentWidthInput)}
                    class="range-input"
                  />
                  <span class="range-value">{contentWidthInput}px</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Local AI CLI -->
          <fieldset class="setting-group">
            <legend class="group-label">LOCAL AI CLI</legend>
            <div class="option-group option-group-wrap" role="group" aria-label="Local AI CLI selection">
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
          </fieldset>

          <!-- Reasoning Effort -->
          <fieldset class="setting-group">
            <legend class="group-label">REASONING</legend>
            <div class="option-group option-group-wrap" role="group" aria-label="Reasoning strength selection">
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

          <!-- Quick Capture -->
          <fieldset class="setting-group">
            <legend class="group-label">QUICK CAPTURE</legend>
            <p class="settings-hint">
              Press the global shortcut from anywhere — even when Void is in the
              tray — to drop a note into your inbox or today's daily note.
            </p>

            <div class="capture-setting-row">
              <label class="capture-setting-label" for="sp-captureTarget">Default target</label>
              <select
                id="sp-captureTarget"
                value={settingsStore.settings.captureTargetDefault}
                onchange={(e) => updateSetting('captureTargetDefault', (e.currentTarget as HTMLSelectElement).value as CaptureTarget)}
                class="capture-setting-select"
              >
                {#each CAPTURE_TARGET_OPTIONS as option}
                  <option value={option}>{captureTargetLabels[option]}</option>
                {/each}
              </select>
            </div>

            <div class="capture-setting-row">
              <span class="capture-setting-label">Global shortcut</span>
              <div class="capture-shortcut-controls">
                {#if recordingCapture}
                  <!-- svelte-ignore a11y_consider_explicit_label -->
                  <button
                    type="button"
                    class="chord-record"
                    onkeydown={handleCaptureRecordKeydown}
                    aria-live="polite"
                  >
                    {recordedCaptureChord ? formatChord(recordedCaptureChord, platform) : 'Press a key…'}
                  </button>
                  <button
                    type="button"
                    class="chord-mini"
                    onclick={confirmCaptureRecording}
                    disabled={!recordedCaptureChord}
                  >Save</button>
                  <button type="button" class="chord-mini" onclick={cancelCaptureRecording}>Cancel</button>
                {:else}
                  {@const currentChord = settingsStore.settings.captureShortcut
                    ? parseChord(settingsStore.settings.captureShortcut)
                    : null}
                  <!-- svelte-ignore a11y_consider_explicit_label -->
                  <button
                    type="button"
                    class="chord-display"
                    onclick={startCaptureRecording}
                    title="Click to rebind"
                  >
                    {currentChord && currentChord.key
                      ? formatChord(currentChord, platform)
                      : 'Disabled'}
                  </button>
                  {#if settingsStore.settings.captureShortcut}
                    <button type="button" class="chord-mini" onclick={clearCaptureShortcut}>
                      Disable
                    </button>
                  {/if}
                {/if}
              </div>
            </div>

            <p class="settings-hint settings-hint-muted">
              On macOS, you'll be asked to grant Accessibility permission the
              first time the shortcut is registered. If registration fails
              (chord conflict with another app), the shortcut is silently
              skipped — pick a different one or use the in-app
              <code>capture.open</code> command instead.
            </p>
          </fieldset>

          <!-- Keybindings -->
          <div class="setting-group">
            <span class="group-label">KEYBINDINGS</span>
            <p class="settings-hint">Click a chord to record a new binding. Press <kbd>Escape</kbd> to cancel.</p>
            <div class="keybindings-list">
              {#each keymapStore.bindings as binding (binding.commandId)}
                {@const conflict = bindingHasConflict(binding)}
                <div class="keybinding-row" class:keybinding-conflict={conflict}>
                  <div class="keybinding-info">
                    <span class="keybinding-label">{commandLabel(binding.commandId)}</span>
                    {#if binding.isOverride}
                      <span class="keybinding-flag" title="Custom binding">customized</span>
                    {/if}
                    {#if conflict}
                      <span class="keybinding-flag keybinding-flag-warn" title="Conflicts with another binding">conflict</span>
                    {/if}
                  </div>
                  <div class="keybinding-actions">
                    {#if recordingFor === binding.commandId}
                      <button
                        type="button"
                        class="chord-record"
                        onkeydown={handleRecordKeydown}
                        aria-live="polite"
                      >
                        {recordedChord ? formatChord(recordedChord, platform) : 'Press a key…'}
                      </button>
                      <button type="button" class="chord-mini" onclick={confirmRecording} disabled={!recordedChord}>Save</button>
                      <button type="button" class="chord-mini" onclick={cancelRecording}>Cancel</button>
                    {:else}
                      <!-- svelte-ignore a11y_consider_explicit_label -->
                      <button
                        type="button"
                        class="chord-display"
                        onclick={() => startRecording(binding.commandId)}
                        title="Click to rebind"
                      >
                        {binding.chord.key ? formatChord(binding.chord, platform) : 'Unbound'}
                      </button>
                      {#if binding.isOverride}
                        <button type="button" class="chord-mini" onclick={() => resetBinding(binding.commandId)}>Reset</button>
                      {/if}
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
    animation: backdrop-fade 220ms var(--ease-out-soft);
  }

  @keyframes backdrop-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .settings-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--settings-panel-width);
    background: var(--bg-app);
    border-left: 1px solid var(--border-light);
    box-shadow: var(--shadow-dialog);
    display: flex;
    flex-direction: column;
    animation: panel-slide-in 280ms var(--ease-out-soft);
  }

  @keyframes panel-slide-in {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
    padding: 0 18px 0 20px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .panel-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.012em;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), background-color var(--transition-fast);
  }

  .close-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .save-banner {
    padding: 6px 16px;
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .save-saving {
    background: var(--accent-light);
    color: var(--accent-primary);
  }

  .save-saved {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .save-error {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 0;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    margin-bottom: 12px;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .setting-group {
    border: none;
    padding: 0;
    margin: 0;
  }

  .group-label {
    display: block;
    margin-bottom: 10px;
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .input-row {
    display: flex;
    gap: 6px;
  }

  .option-group {
    display: flex;
    gap: 6px;
  }

  .option-group-wrap {
    flex-wrap: wrap;
  }

  .option-btn {
    padding: 6px 12px;
    border-radius: var(--radius-md);
    font-size: var(--text-small);
    font-weight: 500;
    font-family: inherit;
    background: var(--bg-card);
    color: var(--text-secondary);
    border: 1px solid var(--border-light);
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
  }

  .option-btn:hover:not(.option-active) {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .option-active {
    background: var(--accent-primary);
    color: var(--text-inverse);
    border-color: transparent;
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }

  .option-active:hover {
    background: var(--accent-hover);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toggle-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 36px;
    height: 20px;
    border-radius: 9999px;
    background: var(--border-medium);
    cursor: pointer;
    transition: background-color var(--transition-fast);
    border: none;
  }

  .toggle-on {
    background: var(--accent-primary);
  }

  .toggle-knob {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transform: translateX(3px);
    transition: transform var(--transition-fast);
  }

  .toggle-knob-on {
    transform: translateX(19px);
  }

  .toggle-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  /* ─── Workspaces pointer ─────────────────────────────────────────── */
  .workspaces-pointer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    text-decoration: none;
    box-shadow: var(--shadow-xs);
    transition: background var(--transition-fast), border-color var(--transition-fast),
                box-shadow var(--transition-fast);
  }

  .workspaces-pointer:hover {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    box-shadow: var(--shadow-sm, var(--shadow-xs));
  }

  .workspaces-pointer:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .workspaces-pointer :global(svg) {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .workspaces-pointer-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .workspaces-pointer-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .workspaces-pointer-sub {
    font-size: 11.5px;
    color: var(--text-tertiary);
    line-height: 1.35;
  }

  .workspaces-pointer-arrow {
    color: var(--text-muted);
    font-size: 13px;
    transition: transform var(--transition-fast), color var(--transition-fast);
  }

  .workspaces-pointer:hover .workspaces-pointer-arrow {
    color: var(--accent-primary);
    transform: translateX(2px);
  }

  /* Typography controls */
  .typography-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .typography-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .typography-label {
    font-size: 13px;
    color: var(--text-secondary);
    flex-shrink: 0;
    min-width: 72px;
  }

  .range-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .range-input {
    flex: 1;
    height: 4px;
    appearance: none;
    background: var(--border-medium);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .range-input::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
  }

  .range-value {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    min-width: 42px;
    text-align: right;
  }

  /* ─── Keybindings ─── */
  .settings-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 4px 0 8px;
    line-height: 1.4;
  }

  .settings-hint kbd {
    font-family: var(--font-sans);
    font-size: 10.5px;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    padding: 0 5px;
    border-radius: 3px;
  }

  .keybindings-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .keybinding-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-faint);
    gap: 12px;
  }

  .keybinding-row:last-child {
    border-bottom: none;
  }

  .keybinding-conflict {
    background: var(--color-warning-bg, rgba(255, 200, 0, 0.06));
  }

  .keybinding-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .keybinding-label {
    font-size: 13px;
    color: var(--text-primary);
  }

  .keybinding-flag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent-primary);
    background: var(--accent-light);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .keybinding-flag-warn {
    color: var(--color-warning, #c08400);
    background: var(--color-warning-bg, rgba(255, 200, 0, 0.18));
  }

  .keybinding-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .chord-display,
  .chord-record,
  .chord-mini {
    font-family: inherit;
    font-size: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 9px;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .chord-display:hover,
  .chord-mini:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chord-record {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: var(--accent-light);
  }

  .chord-mini:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ─── Quick Capture ─── */
  .capture-setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
  }

  .capture-setting-label {
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  .capture-setting-select {
    font-family: inherit;
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    cursor: pointer;
  }

  .capture-shortcut-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .settings-hint-muted {
    color: var(--text-tertiary);
    font-size: 11.5px;
    margin-top: 12px;
    line-height: 1.5;
  }

  .settings-hint-muted code {
    font-family: ui-monospace, 'SF Mono', monospace;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
  }
</style>
