<script lang="ts">
  /**
   * ChatMessage - Display a single message in the conversation
   *
   * Renders user and assistant messages with appropriate styling,
   * including tool invocations inline with status badges.
   * Supports markdown rendering for content.
   */

  import MarkdownIt from 'markdown-it';
  import type { Message } from '$lib/domain/entities/Message';
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import ToolExecution from './ToolExecution.svelte';
  import StreamingText from './StreamingText.svelte';

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
  });

  interface Props {
    /** The message to display */
    message: Message;
    /** Callback when user confirms a tool invocation */
    onConfirmTool?: (invocationId: string) => void;
    /** Callback when user rejects a tool invocation */
    onRejectTool?: (invocationId: string) => void;
  }

  let { message, onConfirmTool, onRejectTool }: Props = $props();

  let activityExpanded = $state(false);

  /** Render markdown to sanitized HTML */
  let renderedHtml = $derived(
    message.role === 'assistant' && message.text
      ? md.render(message.text)
      : ''
  );

  let activityEntries = $derived(message.activity ?? []);
  let latestActivity = $derived(activityEntries.at(-1));
  let hasActivityHistory = $derived(activityEntries.length > 1);
  let activityIsRunning = $derived(message.isStreaming || latestActivity?.status === 'running');
  let activityHasFailed = $derived(latestActivity?.status === 'failed');
  let showActivityLog = $derived(
    activityEntries.length > 0 && (activityIsRunning || activityHasFailed)
  );
  let visibleActivityEntries = $derived(
    activityExpanded ? activityEntries : latestActivity ? [latestActivity] : []
  );

  /** Format timestamp for display */
  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Get role display label */
  function getRoleLabel(role: Message['role']): string {
    switch (role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'Assistant';
      case 'system':
        return 'System';
      default:
        return role;
    }
  }

  /** Handle confirm tool */
  function handleConfirmTool(invocationId: string) {
    onConfirmTool?.(invocationId);
  }

  /** Handle reject tool */
  function handleRejectTool(invocationId: string) {
    onRejectTool?.(invocationId);
  }

  function toggleActivityExpanded() {
    activityExpanded = !activityExpanded;
  }
</script>

<div class="chat-message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'} class:system={message.role === 'system'}>
  <div class="message-header">
    <span class="message-role">{getRoleLabel(message.role)}</span>
    <span class="message-time">{formatTime(message.createdAt)}</span>
  </div>

  <div class="message-content">
    {#if message.isStreaming}
      <StreamingText text={message.text} isStreaming={true} />
    {:else if message.role === 'assistant' && renderedHtml}
      <div class="message-text markdown-rendered">{@html renderedHtml}</div>
    {:else}
      <div class="message-text">{message.text}</div>
    {/if}
  </div>

  {#if message.toolInvocations.length > 0}
    <div class="tool-invocations">
      {#each message.toolInvocations as invocation (invocation.id)}
        <ToolExecution
          {invocation}
          onConfirm={() => handleConfirmTool(invocation.id)}
          onReject={() => handleRejectTool(invocation.id)}
        />
      {/each}
    </div>
  {/if}

  {#if showActivityLog}
    <div class="activity-log" aria-label="Assistant work log">
      {#each visibleActivityEntries as activity (activity.id)}
        <div class="activity-row" class:running={activity.status === 'running'} class:completed={activity.status === 'completed'} class:failed={activity.status === 'failed'}>
          <span class="activity-dot" aria-hidden="true"></span>
          <span class="activity-label">{activity.label}</span>
          {#if activity.detail}
            <span class="activity-detail">{activity.detail}</span>
          {/if}
        </div>
      {/each}

      {#if hasActivityHistory}
        <button
          type="button"
          class="activity-toggle"
          onclick={toggleActivityExpanded}
          aria-expanded={activityExpanded}
          aria-label={activityExpanded ? 'Hide assistant work log' : 'Show assistant work log'}
        >
          {#if activityExpanded}
            <ChevronDown size={13} strokeWidth={2} />
            <span>Hide steps</span>
          {:else}
            <ChevronRight size={13} strokeWidth={2} />
            <span>Show {activityEntries.length} steps</span>
          {/if}
        </button>
      {/if}
    </div>
  {/if}

  {#if message.metadata?.usage}
    <div class="message-meta">
      <span class="token-count">
        {message.metadata.usage.inputTokens} in / {message.metadata.usage.outputTokens} out tokens
      </span>
    </div>
  {/if}
</div>

<style>
  /* ─── Chat message ─── conversational, calm */
  .chat-message {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border-radius: var(--radius-lg);
    font-size: 13.5px;
    line-height: 1.55;
    letter-spacing: -0.003em;
  }

  .chat-message.user {
    background-color: var(--accent-primary);
    color: var(--text-inverse);
    margin-left: 28px;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg);
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }

  .chat-message.user .message-role {
    color: rgba(255, 255, 255, 0.75);
  }

  .chat-message.user .message-time {
    color: rgba(255, 255, 255, 0.55);
  }

  .chat-message.assistant {
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    margin-right: 28px;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-xs);
    box-shadow: var(--shadow-xs);
  }

  .chat-message.system {
    background-color: var(--bg-subtle);
    border: 1px dashed var(--border-medium);
    font-size: 12.5px;
    color: var(--text-tertiary);
  }

  .message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .message-role {
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .message-time {
    font-size: 10.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .message-content {
    line-height: 1.55;
  }

  .message-text {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .message-text.markdown-rendered {
    white-space: normal;
  }

  .message-text.markdown-rendered :global(p) {
    margin: 0.5em 0;
  }

  .message-text.markdown-rendered :global(p:first-child) {
    margin-top: 0;
  }

  .message-text.markdown-rendered :global(p:last-child) {
    margin-bottom: 0;
  }

  .message-text.markdown-rendered :global(pre) {
    background: rgba(0, 0, 0, 0.04);
    padding: 0.75em 1em;
    border-radius: var(--radius-md);
    overflow-x: auto;
    font-size: 0.85em;
    margin: 0.5em 0;
  }

  .message-text.markdown-rendered :global(code) {
    background: rgba(0, 0, 0, 0.04);
    padding: 0.15em 0.4em;
    border-radius: var(--radius-xs, 2px);
    font-size: 0.875em;
    font-family: var(--font-mono);
  }

  .message-text.markdown-rendered :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .message-text.markdown-rendered :global(ul),
  .message-text.markdown-rendered :global(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  .message-text.markdown-rendered :global(li) {
    margin: 0.25em 0;
  }

  .message-text.markdown-rendered :global(strong) {
    font-weight: 600;
  }

  .message-text.markdown-rendered :global(a) {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .message-text.markdown-rendered :global(blockquote) {
    border-left: 3px solid var(--border-medium);
    padding-left: 1em;
    margin: 0.5em 0;
    color: var(--text-secondary);
  }

  .message-text.markdown-rendered :global(h1),
  .message-text.markdown-rendered :global(h2),
  .message-text.markdown-rendered :global(h3) {
    margin: 0.75em 0 0.25em;
    font-weight: 600;
  }

  .message-text.markdown-rendered :global(h1) { font-size: 1.25em; }
  .message-text.markdown-rendered :global(h2) { font-size: 1.125em; }
  .message-text.markdown-rendered :global(h3) { font-size: 1em; }

  .tool-invocations {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .activity-log {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 4px;
    padding: 6px 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
  }

  .activity-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-tertiary);
    font-size: 11.5px;
    line-height: 1.35;
  }

  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .activity-row.running .activity-dot {
    background: var(--ai-accent);
    animation: activityPulse 1.3s ease-in-out infinite;
  }

  .activity-row.completed .activity-dot {
    background: var(--color-success);
  }

  .activity-row.failed .activity-dot {
    background: var(--color-error);
  }

  @keyframes activityPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }

  .activity-label {
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .activity-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0;
  }

  .activity-toggle {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 3px;
    margin-top: 1px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 10.5px;
    line-height: 1.2;
    cursor: pointer;
  }

  .activity-toggle:hover {
    color: var(--text-secondary);
  }

  .activity-toggle:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }

  .activity-toggle :global(svg) {
    flex-shrink: 0;
  }

  .chat-message.user .tool-invocations {
    /* Invert colors for tool executions in user messages */
    --bg-hover: rgba(255, 255, 255, 0.1);
    --bg-sidebar: rgba(255, 255, 255, 0.05);
    --border-light: rgba(255, 255, 255, 0.2);
    --text-primary: white;
    --text-secondary: rgba(255, 255, 255, 0.8);
    --text-muted: rgba(255, 255, 255, 0.6);
  }

  .message-meta {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .token-count {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .chat-message.user .token-count {
    color: rgba(255, 255, 255, 0.5);
  }
</style>
