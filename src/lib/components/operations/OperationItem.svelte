<script lang="ts">
  /**
   * OperationItem - Single operation row display
   *
   * Shows operation label, status badge, progress bar, elapsed time,
   * and action buttons (cancel, resume for sessions).
   */

  import type { Operation } from '$lib/domain/entities/Operation';
  import { isSessionOperation } from '$lib/domain/entities/Operation';
  import type { OperationStatus } from '$lib/domain/values/OperationStatus';

  interface Props {
    operation: Operation;
    onCancel?: () => void;
    onSelect?: () => void;
    onResume?: () => void;
  }

  let { operation, onCancel, onSelect, onResume }: Props = $props();

  let elapsed = $derived.by(() => {
    if (!operation.startedAt) return '';
    const end = operation.completedAt ?? new Date();
    const ms = end.getTime() - operation.startedAt.getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  });

  let isSession = $derived(isSessionOperation(operation));
  let isCompleted = $derived(operation.status === 'completed');
  let isRunning = $derived(operation.status === 'running');

  function getStatusClass(status: OperationStatus): string {
    switch (status) {
      case 'running': return 'status-running';
      case 'queued': return 'status-queued';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  }

  function getStatusLabel(status: OperationStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
</script>

<div
  class="operation-item"
  class:running={isRunning}
  role="button"
  tabindex="0"
  onclick={onSelect}
  onkeydown={(e) => { if (e.key === 'Enter') onSelect?.(); }}
>
  <div class="operation-header">
    <div class="operation-info">
      <span class="operation-icon">
        {#if isRunning}
          <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
        {:else if isCompleted}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else if operation.status === 'failed'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        {/if}
      </span>
      <span class="operation-label">{operation.label}</span>
      {#if isSession}
        <span class="session-badge">Session</span>
      {/if}
    </div>
    <div class="operation-meta">
      <span class="operation-status {getStatusClass(operation.status)}">
        {getStatusLabel(operation.status)}
      </span>
      {#if elapsed}
        <span class="operation-elapsed">{elapsed}</span>
      {/if}
    </div>
  </div>

  {#if isRunning && operation.progress.percent > 0}
    <div class="progress-bar">
      <div class="progress-fill" style="width: {operation.progress.percent}%"></div>
    </div>
  {/if}

  {#if operation.progress.message}
    <div class="operation-message">{operation.progress.message}</div>
  {/if}

  <div class="operation-actions">
    {#if isRunning && onCancel}
      <button type="button" class="btn btn-cancel" onclick={(e) => { e.stopPropagation(); onCancel?.(); }}>Cancel</button>
    {/if}
    {#if isSession && isCompleted && onResume}
      <button type="button" class="btn btn-resume" onclick={(e) => { e.stopPropagation(); onResume?.(); }}>Resume</button>
    {/if}
  </div>
</div>

<style>
  .operation-item {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }
  .operation-item:hover {
    background-color: var(--bg-hover);
  }
  .operation-item.running {
    border-color: var(--accent-primary);
  }
  .operation-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .operation-info {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .operation-icon {
    display: flex;
    color: var(--text-secondary);
  }
  .spinner {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .operation-label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .session-badge {
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 600;
    background-color: var(--accent-light);
    color: var(--accent-primary);
  }
  .operation-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .operation-status {
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .status-running { background-color: var(--accent-light); color: var(--accent-primary); }
  .status-queued { background-color: var(--color-warning-bg); color: var(--color-warning); }
  .status-completed { background-color: var(--color-success-bg); color: var(--color-success); }
  .status-failed { background-color: var(--color-error-bg); color: var(--color-error); }
  .status-cancelled { background-color: var(--bg-sidebar); color: var(--text-muted); }
  .status-pending { background-color: var(--bg-sidebar); color: var(--text-muted); }
  .operation-elapsed {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .progress-bar {
    margin-top: 0.375rem;
    height: 2px;
    background-color: var(--border-light);
    border-radius: 1px;
  }
  .progress-fill {
    height: 100%;
    background-color: var(--accent-primary);
    border-radius: 1px;
    transition: width var(--transition-fast);
  }
  .operation-message {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .operation-actions {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }
  .operation-actions:empty {
    display: none;
  }
  .btn {
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--border-light);
    cursor: pointer;
    background: var(--bg-hover);
    color: var(--text-primary);
    transition: background-color var(--transition-fast);
  }
  .btn:hover {
    background-color: var(--border-light);
  }
  .btn-cancel:hover {
    background-color: var(--color-error-bg);
    color: var(--color-error);
    border-color: var(--color-error);
  }
  .btn-resume {
    background-color: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
  .btn-resume:hover {
    background-color: var(--accent-hover);
  }
</style>
