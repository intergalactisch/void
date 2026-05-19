<script lang="ts">
  /**
   * OperationsPanel - Slide-in panel for AI operation queue management
   *
   * Shows active, queued, and completed operations with real-time progress.
   * Includes session section, template selector, and result preview.
   * Keyboard shortcut: Cmd+Shift+O to toggle.
   */

  import { onDestroy, onMount } from 'svelte';
  import { operationsStore } from '$lib/stores';
  import { isSessionOperation } from '$lib/domain/entities/Operation';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import type { SessionOperation } from '$lib/domain/entities/Operation';
  import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';
  import OperationItem from './OperationItem.svelte';
  import OperationDetail from './OperationDetail.svelte';
  import OperationTemplateSelector from './OperationTemplateSelector.svelte';

  let showTemplates = $state(false);
  let templateVariables = $state<Record<string, string>>({});
  let selectedTemplate = $state<OperationTemplate | null>(null);
  let panelRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;
  let templates = $derived(operationsStore.getTemplates());

  function handleCancel(operationId: string) {
    operationsStore.cancel(operationId as never);
  }

  function handleSelect(operationId: string) {
    operationsStore.selectOperation(operationId as never);
  }

  function handleResume(operation: SessionOperation) {
    operationsStore.selectOperation(operation.id);
  }

  function handleApply() {
    if (operationsStore.selectedOperation) {
      operationsStore.applyResult(operationsStore.selectedOperation.id);
    }
  }

  function handleDiscard() {
    if (operationsStore.selectedOperation) {
      operationsStore.discardResult(operationsStore.selectedOperation.id);
      operationsStore.clearSelection();
    }
  }

  function handleClose() {
    showTemplates = false;
    selectedTemplate = null;
    templateVariables = {};
    operationsStore.closePanel();
  }

  function handleTemplateSelect(template: OperationTemplate) {
    if (template.variables.length > 0) {
      selectedTemplate = template;
      templateVariables = {};
      for (const v of template.variables) {
        templateVariables[v.name] = v.default?.toString() ?? '';
      }
    } else {
      operationsStore.queueFromTemplate(template.id, {});
      showTemplates = false;
    }
  }

  function handleTemplateSubmit() {
    if (!selectedTemplate) return;
    operationsStore.queueFromTemplate(selectedTemplate.id, templateVariables);
    selectedTemplate = null;
    templateVariables = {};
    showTemplates = false;
  }

  function handleEscape() {
    if (selectedTemplate) {
      selectedTemplate = null;
    } else if (operationsStore.selectedOperation) {
      operationsStore.clearSelection();
    } else {
      handleClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'O') {
      e.preventDefault();
      operationsStore.togglePanel();
    }

    if (e.key === 'Escape' && operationsStore.panelOpen) {
      e.preventDefault();
      handleEscape();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  const isOpen = $derived(operationsStore.panelOpen);

  $effect(() => {
    if (isOpen && panelRef) {
      focusTrapCleanup = createFocusTrap({
        container: panelRef,
        onEscape: handleEscape,
      });
    } else if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
  });

  onDestroy(() => {
    focusTrapCleanup?.();
  });
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div class="backdrop" onclick={handleClose} role="presentation"></div>

  <!-- Panel -->
  <div bind:this={panelRef} class="operations-panel" role="dialog" aria-modal="true" aria-label="AI Operations panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-left">
        <h2 class="panel-title">AI Operations</h2>
        {#if operationsStore.queueStatus}
          <div class="queue-badges">
            <span class="badge active">
              {operationsStore.queueStatus.activeCount}/{operationsStore.queueStatus.concurrencyLimit} active
            </span>
            {#if operationsStore.queueStatus.queuedCount > 0}
              <span class="badge queued">{operationsStore.queueStatus.queuedCount} queued</span>
            {/if}
          </div>
        {/if}
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="template-toggle"
          class:active={showTemplates}
          onclick={() => { showTemplates = !showTemplates; selectedTemplate = null; }}
          title="Show operation templates"
          aria-label={showTemplates ? 'Hide templates' : 'Show templates'}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
        <button class="close-button" onclick={handleClose} aria-label="Close panel">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="icon">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Template selector -->
    {#if showTemplates}
      <div class="templates-section">
        {#if selectedTemplate}
          <form class="template-form" onsubmit={(e) => { e.preventDefault(); handleTemplateSubmit(); }}>
            <h4 class="template-form-title">{selectedTemplate.name}</h4>
            <p class="template-form-desc">{selectedTemplate.description}</p>
            {#each selectedTemplate.variables as variable}
              <div class="template-field">
                <label class="template-label" for="var-{variable.name}">{variable.name}</label>
                <input
                  id="var-{variable.name}"
                  type="text"
                  class="template-input"
                  placeholder={variable.description}
                  bind:value={templateVariables[variable.name]}
                  required={variable.required}
                />
              </div>
            {/each}
            <div class="template-form-actions">
              <button type="button" class="btn-cancel" onclick={() => { selectedTemplate = null; }}>Cancel</button>
              <button type="submit" class="btn-run">Run</button>
            </div>
          </form>
        {:else}
          <OperationTemplateSelector {templates} onSelect={handleTemplateSelect} />
        {/if}
      </div>
    {/if}

    <!-- Operation detail view -->
    {#if operationsStore.selectedOperation}
      <div class="detail-container">
        <OperationDetail
          operation={operationsStore.selectedOperation}
          onApply={handleApply}
          onDiscard={handleDiscard}
          onClose={() => operationsStore.clearSelection()}
        />
      </div>
    {/if}

    <!-- Operations list -->
    <div class="operations-list">
      {#if operationsStore.activeOperations.length > 0}
        <div class="section">
          <h3 class="section-title">Active</h3>
          {#each operationsStore.activeOperations as operation (operation.id)}
            <OperationItem
              {operation}
              onCancel={() => handleCancel(operation.id)}
              onSelect={() => handleSelect(operation.id)}
            />
          {/each}
        </div>
      {/if}

      {#if operationsStore.sessions.length > 0}
        <div class="section">
          <h3 class="section-title">Sessions</h3>
          {#each operationsStore.sessions as operation (operation.id)}
            <OperationItem
              {operation}
              onSelect={() => handleSelect(operation.id)}
              onResume={() => {
                if (isSessionOperation(operation)) handleResume(operation);
              }}
            />
          {/each}
        </div>
      {/if}

      {#if operationsStore.completedOperations.length > 0}
        <div class="section">
          <h3 class="section-title">Completed</h3>
          {#each operationsStore.completedOperations as operation (operation.id)}
            <OperationItem
              {operation}
              onSelect={() => handleSelect(operation.id)}
            />
          {/each}
        </div>
      {/if}

      {#if operationsStore.historyOperations.length > 0}
        <div class="section">
          <div class="section-header">
            <h3 class="section-title">History</h3>
            <button
              type="button"
              class="section-clear"
              onclick={() => operationsStore.clearHistory()}
              title="Clear history"
            >
              Clear
            </button>
          </div>
          {#each operationsStore.historyOperations as operation (operation.id)}
            <OperationItem
              {operation}
              onSelect={() => handleSelect(operation.id)}
              onResume={() => {
                if (isSessionOperation(operation)) handleResume(operation);
              }}
            />
            {#if operation.result?.metadata?.reason === 'app_closed'}
              <span class="interrupted-label">Interrupted — app closed</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if operationsStore.operations.length === 0 && !showTemplates}
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
          </div>
          <span class="empty-text">No operations yet</span>
          <button type="button" class="empty-action" onclick={() => { showTemplates = true; }}>
            Browse templates
          </button>
        </div>
      {/if}
    </div>

    {#if operationsStore.error}
      <div class="error-banner">
        <span>{operationsStore.error.message}</span>
        <button type="button" class="error-dismiss" onclick={() => { operationsStore.error = null; }}>
          Dismiss
        </button>
      </div>
    {/if}

    <!-- Keyboard hint -->
    <div class="keyboard-hint">
      <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>O</kbd> to toggle
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.3);
    z-index: var(--z-overlay);
  }

  .operations-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 28rem;
    max-width: 100%;
    background-color: var(--bg-card);
    border-left: 1px solid var(--border-light);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-light);
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .queue-badges {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
  }

  .badge.active {
    background-color: var(--accent-secondary, rgba(99, 102, 241, 0.1));
    color: var(--accent-primary);
  }

  .badge.queued {
    background-color: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .template-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s ease;
  }

  .template-toggle:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .template-toggle.active {
    color: var(--accent-primary);
    background-color: var(--accent-secondary, rgba(99, 102, 241, 0.1));
  }

  .close-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s ease;
  }

  .close-button:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .close-button .icon {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* Templates section */
  .templates-section {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-light);
    max-height: 50%;
    overflow-y: auto;
  }

  .template-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .template-form-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .template-form-desc {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .template-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .template-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: capitalize;
  }

  .template-input {
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border: 1px solid var(--border-light);
    border-radius: 0.375rem;
    background-color: var(--bg-sidebar);
    color: var(--text-primary);
    transition: border-color 0.15s ease;
  }

  .template-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .template-input::placeholder {
    color: var(--text-muted);
  }

  .template-form-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .btn-cancel {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: 1px solid var(--border-light);
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-secondary);
  }

  .btn-run {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: none;
    border-radius: 0.375rem;
    background-color: var(--accent-primary);
    color: white;
    cursor: pointer;
  }

  .btn-run:hover {
    background-color: var(--accent-hover);
  }

  /* Detail container */
  .detail-container {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-light);
    overflow-y: auto;
    max-height: 50%;
  }

  /* Operations list */
  .operations-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.25rem;
  }

  .section-title {
    margin: 0;
    padding: 0 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .section-clear {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    transition: all 0.15s ease;
  }

  .section-clear:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .interrupted-label {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0 0.5rem;
    font-style: italic;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-icon {
    opacity: 0.4;
  }

  .empty-text {
    font-size: 0.875rem;
  }

  .empty-action {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: 1px solid var(--border-light);
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .empty-action:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  /* Error banner */
  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    background-color: var(--color-error-bg);
    color: var(--color-error);
    font-size: 0.8125rem;
    border-top: 1px solid var(--color-error);
  }

  .error-dismiss {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border: 1px solid var(--color-error);
    border-radius: 0.25rem;
    background: transparent;
    color: var(--color-error);
    cursor: pointer;
  }

  .error-dismiss:hover {
    background-color: rgba(239, 68, 68, 0.1);
  }

  /* Keyboard hint */
  .keyboard-hint {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border-light);
    font-size: 0.6875rem;
    color: var(--text-muted);
    text-align: center;
  }

  .keyboard-hint kbd {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    font-family: inherit;
    font-size: 0.625rem;
    background-color: var(--bg-hover);
    border: 1px solid var(--border-light);
    border-radius: 0.25rem;
  }
</style>
