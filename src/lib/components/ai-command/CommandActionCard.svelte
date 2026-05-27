<script lang="ts">
  import {
    CheckCircle2,
    ExternalLink,
    FileText,
    Folder,
    Globe2,
    Image,
    ListTodo,
    RotateCcw,
    Trash2,
  } from '@lucide/svelte';
  import type { ArtifactChangedEntry } from '$lib/domain/values/StreamEntry';
  import { notesStore, todoStore } from '$lib/stores';
  import { events } from '$lib/events';

  interface Props {
    entry: ArtifactChangedEntry;
  }

  let { entry }: Props = $props();

  let canOpen = $derived(entry.target.kind !== 'none');

  function verbLabel(): string {
    const { action, entity } = entry;
    const noun =
      entity === 'note' ? 'note' :
      entity === 'folder' ? 'folder' :
      entity === 'todo' ? 'todo' :
      entity === 'source' ? 'source' : 'media';
    switch (action) {
      case 'created': return entity === 'todo' ? 'Added todo' : `Created ${noun}`;
      case 'updated': return `Updated ${noun}`;
      case 'found': return `Found ${noun}`;
      case 'completed': return 'Completed todo';
      case 'reopened': return 'Reopened todo';
      case 'deleted': return `Deleted ${noun}`;
      case 'moved': return `Moved ${noun}`;
      case 'tagged': return `Tagged ${noun}`;
      default: return noun;
    }
  }

  function open() {
    const target = entry.target;
    switch (target.kind) {
      case 'note':
        notesStore.selectNoteByAnyPath(target.path);
        break;
      case 'folder':
        events.emit('app:navigate', { view: 'folder', path: target.path });
        break;
      case 'external':
        if (typeof window !== 'undefined') {
          window.open(target.url, '_blank', 'noopener,noreferrer');
        }
        break;
      case 'todo':
        events.emit('app:navigate', { view: 'tasks' });
        if (target.todoId) todoStore.selectTodo(target.todoId as never);
        break;
    }
  }

  function handleContextMenu(event: MouseEvent) {
    if (entry.target.kind !== 'note') return;
    event.preventDefault();
    event.stopPropagation();
    events.emit('app:note-context-menu', {
      path: entry.target.path,
      title: entry.title,
      position: { x: event.clientX, y: event.clientY },
      isFolder: false,
    });
  }
</script>

<button
  type="button"
  class="action-card"
  data-entity={entry.entity}
  data-action={entry.action}
  disabled={!canOpen}
  onclick={open}
  oncontextmenu={handleContextMenu}
>
  <span class="action-icon" aria-hidden="true">
    {#if entry.entity === 'folder'}
      <Folder size={15} strokeWidth={1.8} />
    {:else if entry.entity === 'source'}
      <Globe2 size={15} strokeWidth={1.8} />
    {:else if entry.entity === 'media'}
      <Image size={15} strokeWidth={1.8} />
    {:else if entry.entity === 'todo'}
      {#if entry.action === 'completed'}
        <CheckCircle2 size={15} strokeWidth={1.8} />
      {:else if entry.action === 'reopened'}
        <RotateCcw size={15} strokeWidth={1.8} />
      {:else if entry.action === 'deleted'}
        <Trash2 size={15} strokeWidth={1.8} />
      {:else}
        <ListTodo size={15} strokeWidth={1.8} />
      {/if}
    {:else}
      <FileText size={15} strokeWidth={1.8} />
    {/if}
  </span>
  <span class="action-main">
    <span class="action-verb">{verbLabel()}</span>
    <span class="action-title">{entry.title}</span>
    {#if entry.detail}
      <span class="action-detail">{entry.detail}</span>
    {/if}
  </span>
  {#if canOpen}
    <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
  {/if}
</button>

<style>
  .action-card {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) 14px;
    align-items: start;
    gap: 9px;
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border-light);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .action-card:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .action-card:disabled {
    cursor: default;
    box-shadow: none;
  }

  .action-card[data-entity='source'],
  .action-card[data-entity='media'] {
    border-left-color: var(--color-success);
  }

  .action-card[data-entity='todo'] {
    border-left-color: var(--accent-secondary, var(--ai-accent));
  }

  .action-card[data-action='deleted'] {
    border-left-color: var(--text-muted);
  }

  .action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin-top: 1px;
    border-radius: var(--radius-sm);
    background: var(--ai-tint);
    color: var(--accent-primary);
  }

  .action-card[data-entity='source'] .action-icon,
  .action-card[data-entity='media'] .action-icon {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .action-main {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .action-verb {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .action-title {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-detail {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 11.5px;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .action-card :global(svg:last-child) {
    margin-top: 3px;
    color: var(--text-placeholder);
  }
</style>
