<script lang="ts">
  import { onMount } from 'svelte';
  import { noteWorkspaceStore, notesStore } from '$lib/stores';
  import { FileSearch, X } from '@lucide/svelte';

  interface Props {
    tabId: string;
    paneId: string;
    onPick?: (path: string) => void;
    onCancel?: () => void;
  }

  let { tabId, paneId, onPick, onCancel }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputElement: HTMLInputElement | null = $state(null);

  const openNotePaths = $derived.by(() =>
    new Set(noteWorkspaceStore.tabs.flatMap((tab) => noteWorkspaceStore.getNotePaths(tab)))
  );

  const filteredNotes = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const notes = notesStore.allNotes.filter((note) => !note.isFolder && !openNotePaths.has(note.path));
    if (!needle) return notes.slice(0, 40);
    return notes
      .filter((note) => {
        const haystack = `${note.title} ${note.path} ${(note.tags ?? []).join(' ')}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, 40);
  });

  $effect(() => {
    if (selectedIndex >= filteredNotes.length) {
      selectedIndex = Math.max(0, filteredNotes.length - 1);
    }
  });

  function pick(path: string): void {
    const selectedPath = noteWorkspaceStore.setPaneNote(tabId, paneId, path);
    if (selectedPath) {
      notesStore.selectNote(selectedPath);
      onPick?.(selectedPath);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = Math.min(filteredNotes.length - 1, selectedIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const note = filteredNotes[selectedIndex];
      if (note) pick(note.path);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  }

  function folderCrumb(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  }

  onMount(() => {
    requestAnimationFrame(() => inputElement?.focus());
  });
</script>

<div class="split-note-picker">
  <div class="split-note-search">
    <FileSearch size={15} strokeWidth={1.8} aria-hidden="true" />
    <input
      bind:this={inputElement}
      type="search"
      bind:value={query}
      placeholder="Open note in pane"
      aria-label="Open note in pane"
      onkeydown={handleKeydown}
    />
    {#if onCancel}
      <button type="button" class="split-note-cancel" onclick={onCancel} aria-label="Cancel">
        <X size={13} strokeWidth={2.1} aria-hidden="true" />
      </button>
    {/if}
  </div>

  <div class="split-note-results" role="listbox" aria-label="Notes">
    {#each filteredNotes as note, index (note.path)}
      <button
        type="button"
        class="split-note-result"
        class:active={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        data-note-path={note.path}
        onmouseenter={() => { selectedIndex = index; }}
        onclick={() => pick(note.path)}
      >
        <span class="split-note-title">{note.title}</span>
        {#if folderCrumb(note.path)}
          <span class="split-note-crumb">{folderCrumb(note.path)}</span>
        {/if}
      </button>
    {:else}
      <div class="split-note-empty">No matching notes</div>
    {/each}
  </div>
</div>

<style>
  .split-note-picker {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    background: var(--bg-editor);
  }

  .split-note-search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-faint);
    color: var(--text-tertiary);
  }

  .split-note-search input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    outline: none;
  }

  .split-note-search input::placeholder {
    color: var(--text-muted);
  }

  .split-note-cancel {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .split-note-cancel:hover,
  .split-note-cancel:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .split-note-results {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }

  .split-note-result {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .split-note-result:hover,
  .split-note-result:focus-visible,
  .split-note-result.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .split-note-title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-small);
  }

  .split-note-crumb {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
  }

  .split-note-empty {
    padding: 18px 10px;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    text-align: center;
  }
</style>
