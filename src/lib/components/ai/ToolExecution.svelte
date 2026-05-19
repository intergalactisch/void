<script lang="ts">
  /**
   * ToolExecution - Display a tool invocation with its status
   *
   * Shows tool name, parameters, and execution status with appropriate
   * visual indicators. Provides confirm/reject buttons for tools
   * that require user confirmation before execution.
   */

  import type { ToolInvocation, InvocationStatus } from '$lib/domain/entities/ToolInvocation';
  import { isToolCompleted, isToolFailure, isToolCancelled } from '$lib/domain/values/ToolResult';
  import { getToolSummary } from '$lib/tools/registry';

  interface Props {
    /** The tool invocation to display */
    invocation: ToolInvocation;
    /** Reveal raw arguments/results. Normal chat keeps this false. */
    showRawDetails?: boolean;
    /** Callback when user confirms execution */
    onConfirm?: () => void;
    /** Callback when user rejects execution */
    onReject?: () => void;
  }

  let { invocation, showRawDetails = false, onConfirm, onReject }: Props = $props();

  /** Whether details are expanded */
  let expanded = $state(false);

  /** Whether this invocation needs confirmation */
  let needsConfirmation = $derived(
    invocation.status === 'pending' && !invocation.confirmed
  );
  let canExpand = $derived(
    showRawDetails && (Object.keys(invocation.args).length > 0 || invocation.result !== null)
  );

  /** Human-readable summary of completed tool execution */
  let summary = $derived.by(() => {
    if (!invocation.result || !isToolCompleted(invocation.result)) return null;
    return getToolSummary(invocation.toolId, invocation.args, invocation.result.data);
  });

  /** Get status color class */
  function getStatusClass(status: InvocationStatus): string {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'executing':
        return 'status-executing';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return '';
    }
  }

  /** Get status label */
  function getStatusLabel(status: InvocationStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'executing':
        return 'Executing';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  /** Format args for display */
  function formatArgs(args: Record<string, unknown>): string {
    return JSON.stringify(args, null, 2);
  }

  /** Get result display content */
  function getResultContent(inv: ToolInvocation): string {
    if (!inv.result) return '';

    if (isToolCompleted(inv.result)) {
      return JSON.stringify(inv.result.data, null, 2);
    }
    if (isToolFailure(inv.result)) {
      return inv.result.error.message || inv.message || 'Tool failed';
    }
    if (isToolCancelled(inv.result)) {
      return inv.result.reason;
    }
    return '';
  }

  /** Check if result is an error */
  function isResultError(inv: ToolInvocation): boolean {
    return inv.result ? isToolFailure(inv.result) : false;
  }

  /** Map tool IDs to human-readable labels */
  function getToolLabel(toolId: string): string {
    const labels: Record<string, string> = {
      'note:create': 'Creating note',
      'note:update': 'Updating note',
      'note:read': 'Reading note',
      'note:list': 'Listing notes',
      'note:delete': 'Deleting note',
      'note:create-folder': 'Creating folder',
      'note:tag': 'Updating tags',
      'note:move': 'Moving note',
      'note:duplicate': 'Duplicating note',
      'note:merge': 'Merging notes',
      'todo:create': 'Creating todo',
      'todo:list': 'Listing todos',
      'todo:update': 'Updating todo',
      'todo:toggle': 'Updating todo status',
      'todo:delete': 'Deleting todo',
      'editor:replace-block': 'Replacing block',
      'editor:insert-blocks': 'Inserting blocks',
      'editor:delete-block': 'Deleting block',
      'editor:apply-note-patch': 'Applying note patch',
      'editor:disable-line': 'Disabling line',
      'navigation:goto': 'Navigating',
      'navigation:back': 'Going back',
      'navigation:forward': 'Going forward',
      'navigation:home': 'Opening home',
      'intelligence:research': 'Starting research',
      read_file: 'Reading file',
      write_file: 'Writing file',
      search_notes: 'Searching notes',
      search: 'Searching',
      list_files: 'Listing files',
      create_note: 'Creating note',
      delete_note: 'Deleting note',
      rename_note: 'Renaming note',
      read_note: 'Reading note',
      get_note: 'Getting note',
      edit_note: 'Editing note',
      distill: 'Distilling content',
      challenge: 'Challenging ideas',
      morph: 'Transforming format',
      continue: 'Continuing writing',
      thread: 'Threading topic',
      bridge: 'Bridging notes',
      extract: 'Extracting content',
      synthesize: 'Synthesizing notes',
    };
    return labels[toolId] || toolId.replace(/[_:]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /** Get a one-line summary of tool args */
  function getArgsSummary(toolId: string, args: Record<string, unknown>): string {
    if (args.path && typeof args.path === 'string') {
      const name = (args.path as string).split('/').pop();
      return name || '';
    }
    if (args.query && typeof args.query === 'string') return `"${args.query}"`;
    if (args.title && typeof args.title === 'string') return args.title as string;
    return '';
  }

  /** Toggle expanded state */
  function toggleExpanded() {
    if (!canExpand) return;
    expanded = !expanded;
  }

</script>

<div class="tool-execution" class:expanded>
  <div
    class="tool-header"
  >
    <div class="tool-info">
      <span class="tool-icon">
        {#if invocation.status === 'executing'}
          <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
        {:else if invocation.status === 'completed'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else if invocation.status === 'failed'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        {:else if invocation.status === 'cancelled'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        {/if}
      </span>
      <span class="tool-name">{getToolLabel(invocation.toolId)}</span>
      {#if getArgsSummary(invocation.toolId, invocation.args)}
        <span class="tool-args-summary">{getArgsSummary(invocation.toolId, invocation.args)}</span>
      {/if}
      <span class="tool-status {getStatusClass(invocation.status)}">
        {getStatusLabel(invocation.status)}
      </span>
    </div>

    {#if canExpand}
      <button
        type="button"
        class="expand-btn"
        aria-label={expanded ? 'Collapse details' : 'Expand details'}
        onclick={(e) => { e.stopPropagation(); toggleExpanded(); }}
      >
        <svg
          class="expand-icon"
          class:rotated={expanded}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    {/if}
  </div>

  {#if summary}
    <div class="tool-summary">{summary}</div>
  {/if}

  {#if invocation.status === 'executing' && invocation.progress > 0}
    <div class="progress-bar">
      <div class="progress-fill" style="width: {invocation.progress}%"></div>
    </div>
  {/if}

  {#if !summary && invocation.message}
    <div class="tool-message">{invocation.message}</div>
  {/if}

  {#if needsConfirmation && onConfirm && onReject}
    <div class="confirmation-actions">
      <button type="button" class="btn btn-reject" onclick={onReject}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        Reject
      </button>
      <button type="button" class="btn btn-confirm" onclick={onConfirm}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Confirm
      </button>
    </div>
  {/if}

  {#if expanded && showRawDetails}
    <div class="tool-details">
      <div class="detail-section">
        <span class="detail-label">Arguments</span>
        <pre class="detail-content">{formatArgs(invocation.args)}</pre>
      </div>

      {#if invocation.result}
        <div class="detail-section">
          <span class="detail-label">Result</span>
          <pre class="detail-content {isResultError(invocation) ? 'error' : ''}">{getResultContent(invocation)}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-execution {
    display: flex;
    flex-direction: column;
    background-color: var(--bg-app);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    overflow: hidden;
    font-size: 12.5px;
  }

  .tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    transition: background var(--transition-fast);
  }

  .tool-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tool-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .tool-name {
    font-weight: 500;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0;
  }

  .tool-args-summary {
    font-size: 11.5px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
    font-family: var(--font-mono);
  }

  .tool-status {
    padding: 1px 7px;
    border-radius: var(--radius-full);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.005em;
  }

  .status-pending {
    background-color: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .status-executing {
    background-color: var(--accent-light);
    color: var(--accent-primary);
  }

  .status-completed {
    background-color: var(--color-success-bg);
    color: var(--color-success);
  }

  .status-failed {
    background-color: var(--color-error-bg);
    color: var(--color-error);
  }

  .status-cancelled {
    background-color: var(--bg-sidebar);
    color: var(--text-muted);
  }

  .expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: color var(--transition-fast), background-color var(--transition-fast);
  }

  .expand-btn:hover {
    color: var(--text-primary);
    background-color: var(--border-light);
  }

  .expand-icon {
    transition: transform var(--transition-fast);
  }

  .expand-icon.rotated {
    transform: rotate(180deg);
  }

  .tool-summary {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--text-primary);
    border-top: 1px solid var(--border-light);
  }

  .progress-bar {
    height: 2px;
    background-color: var(--border-light);
  }

  .progress-fill {
    height: 100%;
    background-color: var(--accent-primary);
    transition: width var(--transition-fast);
  }

  .tool-message {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    border-top: 1px solid var(--border-light);
  }

  .confirmation-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-top: 1px solid var(--border-light);
    background-color: var(--bg-sidebar);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .btn-reject {
    background-color: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border-light);
  }

  .btn-reject:hover {
    background-color: var(--border-light);
  }

  .btn-confirm {
    background-color: var(--accent-primary);
    color: white;
  }

  .btn-confirm:hover {
    background-color: var(--accent-hover);
  }

  .tool-details {
    padding: 0.75rem;
    border-top: 1px solid var(--border-light);
    background-color: var(--bg-sidebar);
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .detail-section + .detail-section {
    margin-top: 0.75rem;
  }

  .detail-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .detail-content {
    margin: 0;
    padding: 0.5rem;
    background-color: var(--bg-hover);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    color: var(--text-secondary);
    overflow-x: auto;
    max-height: 150px;
    overflow-y: auto;
  }

  .detail-content.error {
    color: var(--color-error);
  }
</style>
