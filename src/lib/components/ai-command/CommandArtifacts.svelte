<script lang="ts">
  import { ExternalLink, FileText, Folder, Globe2, Image, Newspaper, PackageCheck, Video } from '@lucide/svelte';
  import type { AgentArtifact } from '$lib/domain/entities/AgentRun';
  import { notesStore } from '$lib/stores';

  interface Props {
    artifacts: AgentArtifact[];
    limit?: number;
    compact?: boolean;
  }

  let { artifacts, limit = 8, compact = false }: Props = $props();
  let visibleArtifacts = $derived(artifacts.slice(0, limit));
  let hiddenCount = $derived(Math.max(artifacts.length - visibleArtifacts.length, 0));

  function openArtifact(artifact: AgentArtifact) {
    if (artifact.path) {
      notesStore.selectNoteByAnyPath(artifact.path);
      return;
    }

    if (artifact.url && typeof window !== 'undefined') {
      window.open(artifact.url, '_blank', 'noopener,noreferrer');
    }
  }

  function artifactMeta(artifact: AgentArtifact): string {
    return artifact.path ?? artifact.url ?? artifact.summary ?? artifact.type;
  }

  function artifactTypeLabel(artifact: AgentArtifact): string {
    switch (artifact.type) {
      case 'note':
        return 'Note';
      case 'folder':
        return 'Folder';
      case 'source':
        return 'Source';
      case 'media':
        return artifact.mediaKind ? artifact.mediaKind.replace(/^\w/, (char) => char.toUpperCase()) : 'Media';
      case 'diff':
        return 'Change';
      case 'operation':
        return 'Operation';
      case 'summary':
        return 'Summary';
      default:
        return artifact.type;
    }
  }
</script>

<div class="artifacts" class:compact role="list" aria-label="Agent outputs">
  {#each visibleArtifacts as artifact (artifact.id)}
    <button
      type="button"
      class="artifact-row"
      disabled={!artifact.path && !artifact.url}
      onclick={() => openArtifact(artifact)}
    >
      <span class="artifact-icon" data-type={artifact.type} aria-hidden="true">
        {#if artifact.type === 'note'}
          <FileText size={14} strokeWidth={1.8} />
        {:else if artifact.type === 'folder'}
          <Folder size={14} strokeWidth={1.8} />
        {:else if artifact.type === 'source'}
          <Globe2 size={14} strokeWidth={1.8} />
        {:else if artifact.type === 'media' && artifact.mediaKind === 'image'}
          <Image size={14} strokeWidth={1.8} />
        {:else if artifact.type === 'media' && (artifact.mediaKind === 'youtube' || artifact.mediaKind === 'video')}
          <Video size={14} strokeWidth={1.8} />
        {:else if artifact.type === 'media' && artifact.mediaKind === 'article'}
          <Newspaper size={14} strokeWidth={1.8} />
        {:else}
          <PackageCheck size={14} strokeWidth={1.8} />
        {/if}
      </span>
      <span class="artifact-main">
        <span class="artifact-title">{artifact.title}</span>
        <span class="artifact-meta">
          <span>{artifactTypeLabel(artifact)}</span>
          <span aria-hidden="true">/</span>
          <span>{artifactMeta(artifact)}</span>
        </span>
      </span>
      {#if artifact.path || artifact.url}
        <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
      {/if}
    </button>
  {/each}

  {#if hiddenCount > 0}
    <div class="artifact-overflow" aria-label={`${hiddenCount} more outputs`}>
      +{hiddenCount} more
    </div>
  {/if}
</div>

<style>
  .artifacts {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .artifact-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 14px;
    align-items: start;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .artifacts.compact {
    gap: 0;
  }

  .artifacts.compact .artifact-row {
    min-height: 32px;
    padding: 6px 0;
    border: 0;
    border-top: 1px solid var(--border-light);
    border-radius: 0;
    background: transparent;
  }

  .artifacts.compact .artifact-row:first-child {
    border-top: 0;
  }

  .artifact-row:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .artifact-row:disabled {
    cursor: default;
  }

  .artifact-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .artifact-icon[data-type='note'] {
    color: var(--accent-primary);
  }

  .artifact-icon[data-type='source'] {
    color: var(--color-success);
  }

  .artifact-icon[data-type='media'] {
    color: var(--accent-secondary);
  }

  .artifact-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .artifact-title,
  .artifact-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artifact-title {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 550;
  }

  .artifact-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .artifact-meta span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artifact-row :global(svg:last-child) {
    color: var(--text-placeholder);
    margin-top: 2px;
  }

  .artifact-overflow {
    padding: 5px 0 0;
    color: var(--text-muted);
    font-size: 10.5px;
    line-height: 1.35;
  }
</style>
