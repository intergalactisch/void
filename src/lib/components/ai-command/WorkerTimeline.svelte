<script lang="ts">
  import { Sparkles } from '@lucide/svelte';
  import type { AgentRun, AgentWorker, AgentWorkerMessage } from '$lib/domain/entities/AgentRun';
  import WorkerMessageBubble from './WorkerMessageBubble.svelte';

  interface Props {
    run: AgentRun;
    worker: AgentWorker;
    showPromptTraces: boolean;
  }

  let { run, worker, showPromptTraces }: Props = $props();

  let scrollEl: HTMLDivElement | null = $state(null);
  let pinnedToBottom = $state(true);

  const HIDDEN_TYPES = new Set<AgentWorkerMessage['type']>(['orchestrator.merge_decision']);

  let messages = $derived.by(() => {
    return run.workerMessages
      .filter((m) => m.workerId === worker.id || (m.type === 'orchestrator.instruction' && m.workerId === worker.id))
      .filter((m) => !HIDDEN_TYPES.has(m.type))
      .filter((m) => showPromptTraces || m.type !== 'worker.prompt')
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });

  let isStreaming = $derived.by(() => {
    if (worker.status !== 'running') return false;
    const last = messages.at(-1);
    if (!last) return true;
    return last.type === 'worker.prompt' || last.type === 'worker.progress' || last.type === 'user.followup';
  });

  function handleScroll() {
    if (!scrollEl) return;
    const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    pinnedToBottom = remaining < 100;
  }

  function scrollToBottom() {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  $effect(() => {
    void messages.length;
    void isStreaming;
    if (pinnedToBottom) {
      requestAnimationFrame(scrollToBottom);
    }
  });
</script>

<div bind:this={scrollEl} class="worker-timeline scrollbar-thin" onscroll={handleScroll}>
  <div class="timeline-inner">
    {#if messages.length === 0 && worker.status === 'pending'}
      <div class="timeline-empty">
        <span class="empty-icon" aria-hidden="true">
          <Sparkles size={22} strokeWidth={1.5} />
        </span>
        <strong>Waiting for orchestrator to brief this worker…</strong>
        <p>Messages will appear here as soon as the worker starts.</p>
      </div>
    {/if}

    {#each messages as message (message.id)}
      <WorkerMessageBubble {message} />
    {/each}

    {#if isStreaming}
      <div class="timeline-thinking">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    {/if}
  </div>
</div>

<style>
  .worker-timeline {
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    background: var(--bg-editor);
  }

  .timeline-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 18px 32px;
  }

  .timeline-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text-secondary);
  }

  .empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-bottom: 6px;
    border-radius: var(--radius-md);
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .timeline-empty strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
  }

  .timeline-empty p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .timeline-thinking {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 4px;
    padding: 8px 14px;
    border-radius: var(--radius-md);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
  }

  .timeline-thinking .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ai-accent);
    animation: thinking-pulse 1.2s ease-in-out infinite;
  }

  .timeline-thinking .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .timeline-thinking .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes thinking-pulse {
    0%, 100% {
      opacity: 0.3;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
