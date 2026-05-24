<script lang="ts">
  import { noteWorkspaceStore, notesStore } from '$lib/stores';
  import { FileText } from '@lucide/svelte';

  interface Props {
    tabId: string;
    paneId: string;
    notePath: string;
  }

  let { tabId, paneId, notePath }: Props = $props();

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  const noteTitle = $derived(
    notesStore.titleForPath(notePath, basename(notePath))
  );

  const folderCrumb = $derived.by(() => {
    const parts = notePath.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  });

  function activate(): void {
    const path = noteWorkspaceStore.focusPane(tabId, paneId);
    if (path) notesStore.selectNote(path);
  }
</script>

<button type="button" class="note-pane-preview" onclick={activate}>
  <FileText size={18} strokeWidth={1.6} aria-hidden="true" />
  <span class="note-pane-preview-title">{noteTitle}</span>
  {#if folderCrumb}
    <span class="note-pane-preview-crumb">{folderCrumb}</span>
  {/if}
</button>

<style>
  .note-pane-preview {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    border: 0;
    background: var(--bg-editor);
    color: var(--text-tertiary);
    cursor: pointer;
    font: inherit;
    text-align: center;
  }

  .note-pane-preview:hover,
  .note-pane-preview:focus-visible {
    background: color-mix(in oklab, var(--bg-hover) 55%, var(--bg-editor));
    color: var(--text-primary);
    outline: none;
  }

  .note-pane-preview-title {
    max-width: min(32ch, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .note-pane-preview:hover .note-pane-preview-title,
  .note-pane-preview:focus-visible .note-pane-preview-title {
    color: var(--text-primary);
  }

  .note-pane-preview-crumb {
    max-width: min(36ch, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
  }
</style>
