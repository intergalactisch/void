<script lang="ts">
  /**
   * AIRewritePopup - Popup for AI rewrite operations
   *
   * Displays:
   * - Loading spinner during processing
   * - AI result preview
   * - Accept/Reject buttons
   * - Error messages
   */

  import type { AIRewritePluginState } from '$lib/adapters/prosemirror/plugins/aiRewrite';

  interface Props {
    /** Current AI rewrite state */
    state: AIRewritePluginState;
    /** Callback when user accepts the result */
    onAccept: () => void;
    /** Callback when user rejects the result */
    onReject: () => void;
    /** Callback when user cancels processing */
    onCancel: () => void;
  }

  let { state, onAccept, onReject, onCancel }: Props = $props();

  /** Whether we should show the popup */
  let visible = $derived(
    state.isProcessing || (state.showPopup && (state.resultText || state.error))
  );

  /** Position style for the popup */
  let positionStyle = $derived(
    state.popupCoords
      ? `top: ${state.popupCoords.top}px; left: ${state.popupCoords.left}px;`
      : ''
  );

  /** Get operation label for display */
  function getOperationLabel(operation: string | null): string {
    switch (operation) {
      case 'rewrite':
        return 'Rewrite';
      case 'expand':
        return 'Expand';
      case 'summarize':
        return 'Summarize';
      case 'fix-grammar':
        return 'Fix Grammar';
      case 'translate':
        return 'Translate';
      case 'custom':
        return 'Custom';
      default:
        return 'AI';
    }
  }

  /** Handle keyboard shortcuts */
  function handleKeydown(event: KeyboardEvent) {
    if (!visible) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.isProcessing) {
        onCancel();
      } else {
        onReject();
      }
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!state.isProcessing && state.resultText) {
        onAccept();
      }
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
  <div
    class="ai-rewrite-popup"
    style={positionStyle}
    role="dialog"
    aria-label="AI Rewrite Result"
  >
    {#if state.isProcessing}
      <!-- Processing State -->
      <div class="ai-popup-processing">
        <div class="ai-popup-spinner">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
            />
          </svg>
        </div>
        <span class="ai-popup-label">
          {getOperationLabel(state.operation)}...
        </span>
        <button
          type="button"
          class="ai-popup-cancel"
          onclick={onCancel}
          title="Cancel (Esc)"
        >
          Cancel
        </button>
      </div>
    {:else if state.error}
      <!-- Error State -->
      <div class="ai-popup-error">
        <div class="ai-popup-error-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <span class="ai-popup-error-message">{state.error}</span>
        <button
          type="button"
          class="ai-popup-dismiss"
          onclick={onReject}
          title="Dismiss (Esc)"
        >
          Dismiss
        </button>
      </div>
    {:else if state.resultText}
      <!-- Result State -->
      <div class="ai-popup-result">
        <div class="ai-popup-header">
          <span class="ai-popup-title">
            {getOperationLabel(state.operation)} Result
          </span>
        </div>

        <div class="ai-popup-preview">
          <div class="ai-popup-original">
            <span class="ai-popup-label-small">Original</span>
            <p class="ai-popup-text">{state.originalText}</p>
          </div>
          <div class="ai-popup-arrow">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <div class="ai-popup-new">
            <span class="ai-popup-label-small">Result</span>
            <p class="ai-popup-text ai-popup-text-new">{state.resultText}</p>
          </div>
        </div>

        <div class="ai-popup-actions">
          <button
            type="button"
            class="ai-popup-btn ai-popup-btn-secondary"
            onclick={onReject}
            title="Reject (Esc)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Reject
          </button>
          <button
            type="button"
            class="ai-popup-btn ai-popup-btn-primary"
            onclick={onAccept}
            title="Accept (Cmd+Enter)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Accept
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ai-rewrite-popup {
    position: fixed;
    z-index: 1000;
    min-width: 280px;
    max-width: 400px;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    font-family: var(--font-sans);
    font-size: 14px;
    animation: ai-popup-scale-in var(--duration-normal) ease-out;
    transform-origin: top left;
  }

  @keyframes ai-popup-scale-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Processing State */
  .ai-popup-processing {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
  }

  .ai-popup-spinner {
    display: flex;
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .ai-popup-label {
    flex: 1;
    font-weight: 500;
    color: var(--text-primary);
  }

  .ai-popup-cancel {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .ai-popup-cancel:hover {
    background-color: var(--bg-hover);
  }

  .ai-popup-cancel:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* Error State */
  .ai-popup-error {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background-color: var(--color-error-bg);
  }

  .ai-popup-error-icon {
    display: flex;
    color: var(--color-error);
  }

  .ai-popup-error-message {
    flex: 1;
    color: var(--color-error);
  }

  .ai-popup-dismiss {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--color-error);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ai-popup-dismiss:hover {
    background-color: var(--color-error-bg);
  }

  .ai-popup-dismiss:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* Result State */
  .ai-popup-result {
    display: flex;
    flex-direction: column;
  }

  .ai-popup-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-light);
  }

  .ai-popup-title {
    font-weight: 600;
    color: var(--text-primary);
  }

  .ai-popup-preview {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-popup-original,
  .ai-popup-new {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ai-popup-label-small {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .ai-popup-text {
    margin: 0;
    padding: 8px;
    font-size: 13px;
    line-height: 1.5;
    background-color: var(--bg-sidebar);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    max-height: 80px;
    overflow-y: auto;
  }

  .ai-popup-text-new {
    background-color: var(--color-success-bg);
    border: 1px solid var(--color-success);
  }

  .ai-popup-arrow {
    display: flex;
    justify-content: center;
    color: var(--text-muted);
  }

  .ai-popup-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-light);
    background-color: var(--bg-sidebar);
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }

  .ai-popup-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .ai-popup-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .ai-popup-btn-secondary {
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    color: var(--text-primary);
  }

  .ai-popup-btn-secondary:hover {
    background-color: var(--bg-hover);
  }

  .ai-popup-btn-primary {
    background-color: var(--accent-primary);
    color: var(--text-inverse);
  }

  .ai-popup-btn-primary:hover {
    background-color: var(--accent-hover);
  }
</style>
