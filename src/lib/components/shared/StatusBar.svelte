<script lang="ts">
  /**
   * StatusBar - Persistent bottom bar showing document metadata and shortcuts.
   *
   * Displays word count, character count, save status, and keyboard hints.
   * Spans full app width below both sidebar and content area.
   */

  import { pulseStore, syncStore, uiStore } from '$lib/stores';

  interface Props {
    /** Whether a document is currently open */
    hasDocument?: boolean;
    /** Word count of the current document */
    wordCount?: number;
    /** Character count of the current document */
    charCount?: number;
    /** Current save status */
    saveStatus?: 'saved' | 'saving' | 'unsaved';
    /** Callback to toggle log panel */
    onToggleLogs?: () => void;
    /** Number of error-level log entries */
    logErrorCount?: number;
    /** Number of active AI operations */
    activeOperationCount?: number;
    /** Short label for active AI work */
    activeOperationLabel?: string;
    /** Callback to toggle operations panel */
    onToggleOperations?: () => void;
  }

  let {
    hasDocument = false,
    wordCount = 0,
    charCount = 0,
    saveStatus = 'saved',
    onToggleLogs,
    logErrorCount = 0,
    activeOperationCount = 0,
    activeOperationLabel = 'AI work',
    onToggleOperations,
  }: Props = $props();

  let pulseCount = $derived(pulseStore.count);
  let syncTitle = $derived.by(() => {
    const pieces = [syncStore.label];
    if (syncStore.status.ahead > 0) pieces.push(`${syncStore.status.ahead} ahead`);
    if (syncStore.status.behind > 0) pieces.push(`${syncStore.status.behind} behind`);
    if (syncStore.status.changedFiles > 0) pieces.push(`${syncStore.status.changedFiles} changed`);
    return pieces.join(' · ');
  });

  function openSyncSurface(): void {
    if (syncStore.status.kind === 'conflicted' || syncStore.status.conflicts.length > 0) {
      uiStore.openSyncConflictWorkspace();
      return;
    }
    uiStore.openSettings();
  }

  /** Format number with locale thousands separator */
  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  /** Save status display text and color */
  let saveDisplay = $derived.by(() => {
    switch (saveStatus) {
      case 'saving':
        return { text: 'Saving...', color: 'var(--text-muted)' };
      case 'unsaved':
        return { text: 'Unsaved changes', color: 'var(--color-warning)' };
      case 'saved':
      default:
        return { text: 'Saved', color: 'var(--text-muted)' };
    }
  });
</script>

<footer
  class="statusbar"
  role="status"
  aria-live="polite"
  aria-label={hasDocument
    ? `${formatNumber(wordCount)} words, ${formatNumber(charCount)} characters. ${saveDisplay.text}`
    : ''}
>
  <!-- Left: Document metadata -->
  <div class="statusbar-left">
    {#if hasDocument}
      <span class="statusbar-item">{formatNumber(wordCount)} words</span>
      <span class="statusbar-separator" aria-hidden="true">&middot;</span>
      <span class="statusbar-item">{formatNumber(charCount)} chars</span>
    {/if}
  </div>

  <!-- Right: Save status + keyboard shortcuts -->
  <div class="statusbar-right">
    {#if hasDocument}
      <span class="statusbar-item" style="color: {saveDisplay.color};">
        {saveDisplay.text}
      </span>
      <span class="statusbar-separator" aria-hidden="true">&middot;</span>
    {/if}
    <button
      type="button"
      class="statusbar-sync-btn"
      class:statusbar-sync-active={syncStore.status.kind === 'ready'}
      class:statusbar-sync-warn={syncStore.status.kind === 'pending' || syncStore.status.kind === 'auth-required' || syncStore.status.kind === 'paused'}
      class:statusbar-sync-error={syncStore.status.kind === 'error' || syncStore.status.kind === 'conflicted'}
      onclick={openSyncSurface}
      title={syncTitle}
      aria-label={syncTitle}
    >
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16 16l-4 4m0 0l-4-4m4 4V4" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M20 10.5A5.5 5.5 0 0010.2 7 4 4 0 004 10.75 4.25 4.25 0 008.25 15H10" />
      </svg>
      <span class="statusbar-sync-label">{syncStore.label}</span>
    </button>
    <span class="statusbar-separator" aria-hidden="true">&middot;</span>
    {#if onToggleOperations}
      <button
        type="button"
        class="statusbar-ops-btn"
        class:statusbar-ops-active={activeOperationCount > 0}
        onclick={onToggleOperations}
        title="AI Work (Cmd+Shift+O)"
        aria-label={activeOperationCount > 0 ? `${activeOperationCount} active AI work items: ${activeOperationLabel}` : 'AI Work'}
      >
        {#if activeOperationCount > 0}
          <svg class="statusbar-ops-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
          <span class="statusbar-ops-count">{activeOperationCount}</span>
          <span class="statusbar-ops-label">{activeOperationLabel}</span>
        {:else}
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        {/if}
      </button>
      <span class="statusbar-separator" aria-hidden="true">&middot;</span>
    {/if}
    {#if pulseCount > 0}
      <button
        type="button"
        class="statusbar-pulse-btn"
        onclick={() => uiStore.openPulseInbox()}
        title="{pulseCount} pulse insight{pulseCount === 1 ? '' : 's'} (Cmd+Shift+U)"
        aria-label="{pulseCount} pulse insights pending"
      >
        <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        </svg>
        <span class="statusbar-pulse-count">{pulseCount}</span>
      </button>
      <span class="statusbar-separator" aria-hidden="true">&middot;</span>
    {/if}
    {#if onToggleLogs}
      <button type="button" class="statusbar-log-btn" onclick={onToggleLogs} title="Toggle log panel (Cmd+Shift+L)">
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
        {#if logErrorCount > 0}
          <span class="statusbar-error-badge">{logErrorCount}</span>
        {/if}
      </button>
      <span class="statusbar-separator statusbar-kbd-divider" aria-hidden="true">&middot;</span>
    {/if}
    <kbd class="statusbar-kbd" aria-hidden="true">Cmd+P</kbd>
    <span class="statusbar-separator statusbar-kbd-divider" aria-hidden="true">&middot;</span>
    <kbd class="statusbar-kbd" aria-hidden="true">Cmd+Shift+O</kbd>
  </div>
</footer>

<style>
  /* ─── Status bar ─── thin, refined, paper-like */
  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--statusbar-height);
    padding: 0 14px;
    background: var(--bg-app);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-micro);
    color: var(--text-tertiary);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
    letter-spacing: 0.003em;
    font-variant-numeric: tabular-nums;
  }

  .statusbar-left,
  .statusbar-right {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .statusbar-item {
    white-space: nowrap;
  }

  .statusbar-separator {
    margin: 0 8px;
    color: var(--text-placeholder);
    opacity: 0.6;
  }

  .statusbar-kbd {
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 0 5px;
    border-radius: 4px;
    line-height: 14px;
    letter-spacing: 0.02em;
  }

  /* ─── Pulse insights badge ─── */
  .statusbar-pulse-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    color: var(--accent-primary);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--text-micro);
    font-variant-numeric: tabular-nums;
    transition: background var(--transition-fast);
  }

  .statusbar-pulse-btn:hover {
    background: var(--accent-light);
  }

  .statusbar-pulse-count {
    font-weight: 600;
  }

  .statusbar-ops-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 5px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    font-size: var(--text-micro);
    font-family: inherit;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .statusbar-sync-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    padding: 0 5px;
    font-family: inherit;
    font-size: var(--text-micro);
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .statusbar-sync-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .statusbar-sync-active {
    color: var(--color-success);
  }

  .statusbar-sync-warn {
    color: var(--color-warning);
  }

  .statusbar-sync-error {
    color: var(--color-error);
  }

  .statusbar-sync-label {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .statusbar-ops-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .statusbar-ops-active {
    color: var(--ai-accent);
  }

  .statusbar-ops-active:hover {
    color: var(--ai-accent);
    background: var(--ai-accent-light);
  }

  .statusbar-ops-spinner {
    animation: spin 1.4s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .statusbar-ops-count {
    font-weight: 600;
    font-size: 10px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .statusbar-ops-label {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .statusbar-log-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    padding: 0;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .statusbar-log-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .statusbar-error-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    font-size: 9px;
    font-weight: 600;
    line-height: 13px;
    text-align: center;
    color: var(--text-inverse);
    background: var(--color-error);
    border-radius: 7px;
    letter-spacing: 0;
  }

  /* Tablet (≤1099): drop the keyboard hint chips & their dividers — they
     are the lowest-value items in a constrained bar. */
  @media (max-width: 1099px) {
    .statusbar-kbd,
    .statusbar-kbd-divider {
      display: none;
    }
  }

  /* Smaller tablets (≤879): hide sync label, ops label, char count.
     Icons and counts remain so functionality is preserved. */
  @media (max-width: 879px) {
    .statusbar {
      padding: 0 10px;
    }

    .statusbar-sync-label,
    .statusbar-ops-label {
      display: none;
    }

    /* Drop the second left-side "chars" item — words is enough at this
       width, and a trailing separator would dangle. */
    .statusbar-left .statusbar-item:nth-of-type(2),
    .statusbar-left .statusbar-separator {
      display: none;
    }
  }

  /* Phone (≤479): keep status text in left column readable, hide more
     non-essential right-side controls. Save state still shows. */
  @media (max-width: 479px) {
    .statusbar {
      font-size: 11px;
      padding: 0 8px;
    }

    .statusbar-left .statusbar-item {
      display: none;
    }
  }
</style>
