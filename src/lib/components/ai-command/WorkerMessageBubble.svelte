<script lang="ts">
  import { Bot, FileText, Sparkles, User } from '@lucide/svelte';
  import type { AgentWorkerMessage } from '$lib/domain/entities/AgentRun';
  import WorkerToolCallCard from './WorkerToolCallCard.svelte';
  import WorkerReplyCard from './WorkerReplyCard.svelte';

  interface Props {
    message: AgentWorkerMessage;
  }

  let { message }: Props = $props();

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  let promptText = $derived.by(() => {
    if (message.type !== 'worker.prompt') return '';
    const data = asRecord(message.data);
    const request = asRecord(data?.request);
    const text = request?.message;
    return typeof text === 'string' ? text : message.message;
  });

  function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
</script>

{#if message.type === 'orchestrator.instruction'}
  <div class="bubble bubble-system" data-type="orchestrator">
    <div class="bubble-head">
      <Sparkles size={12} strokeWidth={1.9} aria-hidden="true" />
      <span>Orchestrator brief</span>
      <time>{formatTime(message.createdAt)}</time>
    </div>
    <div class="bubble-body">{message.message}</div>
  </div>
{:else if message.type === 'worker.response'}
  <WorkerReplyCard {message} />
{:else if message.type === 'worker.prompt'}
  <details class="bubble bubble-trace">
    <summary>
      <span>Prompt trace</span>
      <time>{formatTime(message.createdAt)}</time>
    </summary>
    <pre>{promptText}</pre>
  </details>
{:else if message.type === 'worker.tool_result'}
  <WorkerToolCallCard {message} />
{:else if message.type === 'worker.artifact_draft' && message.artifactDraft}
  <div class="bubble-pill" data-type="artifact">
    <FileText size={12} strokeWidth={1.9} aria-hidden="true" />
    <span>Drafted: {message.artifactDraft.title}</span>
  </div>
{:else if message.type === 'worker.progress'}
  <div class="bubble-progress">
    <span>{message.message}</span>
    {#if typeof message.progress === 'number'}
      <span class="bubble-progress-percent">{message.progress}%</span>
    {/if}
  </div>
{:else if message.type === 'worker.question'}
  <div class="bubble bubble-worker bubble-question">
    <div class="bubble-head">
      <Bot size={12} strokeWidth={1.9} aria-hidden="true" />
      <span>Worker asks</span>
      <time>{formatTime(message.createdAt)}</time>
    </div>
    <div class="bubble-body">{message.message}</div>
  </div>
{:else if message.type === 'worker.result' && message.result}
  <div class="bubble bubble-result">
    <div class="bubble-head">
      <Bot size={12} strokeWidth={1.9} aria-hidden="true" />
      <span>Result delivered</span>
      <time>{formatTime(message.createdAt)}</time>
    </div>
    <div class="bubble-body">
      <p>{message.result.summary}</p>
      {#if message.result.findings.length > 0}
        <ul>
          {#each message.result.findings as finding}
            <li>{finding}</li>
          {/each}
        </ul>
      {/if}
      <div class="result-facts">
        <span>{message.result.artifactDrafts.length} draft{message.result.artifactDrafts.length === 1 ? '' : 's'}</span>
        <span>{message.result.citations.length} citation{message.result.citations.length === 1 ? '' : 's'}</span>
        <span>{Math.round(message.result.confidence * 100)}% confidence</span>
        {#if message.result.risks.length > 0}
          <span data-tone="warn">{message.result.risks.length} risk{message.result.risks.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
    </div>
  </div>
{:else if message.type === 'worker.failed'}
  <div class="bubble bubble-failed">
    <div class="bubble-head">
      <Bot size={12} strokeWidth={1.9} aria-hidden="true" />
      <span>Worker failed</span>
      <time>{formatTime(message.createdAt)}</time>
    </div>
    <div class="bubble-body">{message.message}</div>
  </div>
{:else if message.type === 'user.followup' || message.type === 'user.directive'}
  <div class="bubble bubble-user" data-target={message.type === 'user.directive' ? 'orchestrator' : 'worker'}>
    <div class="bubble-head">
      <User size={12} strokeWidth={1.9} aria-hidden="true" />
      <span>{message.type === 'user.directive' ? 'You / orchestrator' : 'You'}</span>
      <time>{formatTime(message.createdAt)}</time>
    </div>
    <div class="bubble-body">{message.message}</div>
  </div>
{/if}

<style>
  .bubble {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
  }

  .bubble-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .bubble-head time {
    margin-left: auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .bubble-body {
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.55;
  }

  .bubble-system {
    background: color-mix(in srgb, var(--ai-tint) 60%, var(--bg-card));
    border-color: color-mix(in srgb, var(--ai-border) 60%, var(--border-light));
  }

  .bubble-worker {
    background: var(--bg-card);
  }

  .bubble-worker .bubble-head {
    color: var(--ai-accent);
  }

  .bubble-question {
    border-color: color-mix(in srgb, var(--color-warning) 35%, var(--border-light));
  }

  .bubble-result {
    background: color-mix(in srgb, var(--color-success-bg) 28%, var(--bg-card));
    border-color: color-mix(in srgb, var(--color-success) 32%, var(--border-light));
  }

  .bubble-result ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }

  .bubble-result li {
    margin-bottom: 3px;
    color: var(--text-secondary);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .result-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .result-facts span {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .result-facts span[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--color-warning) 35%, var(--border-light));
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .bubble-failed {
    background: var(--color-error-bg);
    border-color: color-mix(in srgb, var(--color-error) 38%, var(--border-light));
    color: var(--color-error);
  }

  .bubble-failed .bubble-body {
    color: var(--color-error);
  }

  .bubble-user {
    align-self: flex-end;
    max-width: 80%;
    background: var(--ai-accent);
    color: var(--text-inverse);
    border-color: transparent;
  }

  .bubble-user .bubble-head {
    color: color-mix(in srgb, var(--text-inverse) 78%, transparent);
  }

  .bubble-user .bubble-head time {
    color: color-mix(in srgb, var(--text-inverse) 65%, transparent);
  }

  .bubble-user[data-target='orchestrator'] {
    background: color-mix(in srgb, var(--ai-accent) 78%, var(--bg-editor));
  }

  .bubble-user .bubble-body {
    color: var(--text-inverse);
  }

  .bubble-trace {
    background: var(--bg-editor);
    border: 1px dashed var(--border-light);
  }

  .bubble-trace summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
    cursor: pointer;
  }

  .bubble-trace summary time {
    margin-left: auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .bubble-trace pre {
    max-height: 280px;
    overflow: auto;
    margin: 0;
    padding: 10px;
    border-top: 1px solid var(--border-faint);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .bubble-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
  }

  .bubble-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: center;
    color: var(--text-muted);
    font-size: 10.5px;
    line-height: 1.35;
  }

  .bubble-progress-percent {
    font-family: var(--font-mono);
    font-weight: 600;
  }

</style>
