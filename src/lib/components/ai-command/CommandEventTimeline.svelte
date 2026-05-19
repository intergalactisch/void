<script lang="ts">
  import {
    CheckCircle2,
    CircleAlert,
    CircleDashed,
    FileText,
    Globe2,
    Link2,
    MessageSquareText,
    Play,
    Workflow,
  } from '@lucide/svelte';
  import type { AgentRunEvent } from '$lib/domain/entities/AgentRun';

  interface Props {
    events: AgentRunEvent[];
    limit?: number;
    compact?: boolean;
  }

  let { events, limit = 10, compact = false }: Props = $props();
  let visibleEvents = $derived.by(() => {
    const compactEvents = compact ? events.filter(isUsefulCompactEvent) : events;
    const source = compactEvents.length > 0 ? compactEvents : events;
    return source.slice(-limit).reverse();
  });

  function formatType(type: string): string {
    const labels: Record<string, string> = {
      'run.started': 'Run started',
      'run.status': 'Status changed',
      'task.created': 'Task queued',
      'task.started': 'Task started',
      'task.completed': 'Task completed',
      'task.failed': 'Task failed',
      'task.cancelled': 'Task cancelled',
      'source.verified': 'Source verified',
      'source.failed': 'Source failed',
      'worker.started': 'Worker started',
      'worker.message': 'Worker update',
      'worker.completed': 'Worker completed',
      'worker.failed': 'Worker failed',
      'worker.cancelled': 'Worker cancelled',
      'merge.started': 'Merge started',
      'merge.completed': 'Merge completed',
      'merge.failed': 'Merge failed',
      'note.created': 'Note created',
      'note.updated': 'Note updated',
      'artifact.created': 'Output ready',
      'link.reviewed': 'Link reviewed',
      narration: 'Progress update',
      'run.completed': 'Run completed',
      'run.failed': 'Run failed',
      'run.cancelled': 'Run cancelled',
    };
    return labels[type] ?? type.replace('.', ' ');
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function eventMessage(event: AgentRunEvent): string {
    return event.message ?? formatType(event.type);
  }

  function eventTone(event: AgentRunEvent): string {
    if (event.type.endsWith('.failed')) return 'error';
    if (event.type.endsWith('.completed') || event.type === 'source.verified') return 'success';
    if (event.type.endsWith('.started') || event.type === 'run.status') return 'active';
    return 'neutral';
  }

  function isUsefulCompactEvent(event: AgentRunEvent): boolean {
    if (event.message) return true;
    if (event.type === 'task.created' || event.type === 'run.status') return false;
    return true;
  }
</script>

<div class="event-timeline" class:compact role="list" aria-label="Agent event timeline">
  {#each visibleEvents as event (event.id)}
    <div class="event-row" data-tone={eventTone(event)} role="listitem">
      <span class="event-icon" aria-hidden="true">
        {#if event.type.endsWith('.failed')}
          <CircleAlert size={13} strokeWidth={1.9} />
        {:else if event.type.endsWith('.completed') || event.type === 'source.verified'}
          <CheckCircle2 size={13} strokeWidth={1.9} />
        {:else if event.type.endsWith('.started')}
          <Play size={13} strokeWidth={1.9} />
        {:else if event.type.startsWith('note.')}
          <FileText size={13} strokeWidth={1.9} />
        {:else if event.type.startsWith('source.')}
          <Globe2 size={13} strokeWidth={1.9} />
        {:else if event.type.startsWith('link.')}
          <Link2 size={13} strokeWidth={1.9} />
        {:else if event.type.startsWith('worker.') || event.type.startsWith('merge.')}
          <Workflow size={13} strokeWidth={1.9} />
        {:else if event.type === 'narration'}
          <MessageSquareText size={13} strokeWidth={1.9} />
        {:else if event.type.startsWith('task.')}
          <Workflow size={13} strokeWidth={1.9} />
        {:else}
          <CircleDashed size={13} strokeWidth={1.9} />
        {/if}
      </span>
      <span class="event-main">
        <span class="event-type">{formatType(event.type)}</span>
        <span class="event-message">{eventMessage(event)}</span>
      </span>
      <time class="event-time" datetime={event.createdAt}>{formatTime(event.createdAt)}</time>
    </div>
  {/each}
</div>

<style>
  .event-timeline {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .event-row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 42px;
    align-items: start;
    gap: 7px;
    min-width: 0;
    color: var(--text-muted);
    font-size: 10.5px;
    line-height: 1.4;
  }

  .event-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-top: 1px;
    color: var(--text-placeholder);
  }

  .event-row[data-tone='active'] .event-icon {
    color: var(--ai-accent);
  }

  .event-row[data-tone='success'] .event-icon {
    color: var(--color-success);
  }

  .event-row[data-tone='error'] .event-icon {
    color: var(--color-error);
  }

  .event-main {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 7px;
    min-width: 0;
  }

  .event-time,
  .event-type,
  .event-message {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-time {
    color: var(--text-placeholder);
    font-family: var(--font-mono);
    text-align: right;
  }

  .event-type {
    color: var(--text-muted);
    font-weight: 600;
  }

  .event-message {
    color: var(--text-secondary);
  }

  .event-timeline.compact .event-main {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .event-timeline.compact .event-type {
    font-size: 10px;
    line-height: 1.25;
  }

  .event-timeline.compact .event-message {
    font-size: 11px;
  }
</style>
