<script lang="ts">
  import { onMount } from 'svelte';
  import type { Document } from '$lib/domain/entities/Document';
  import type { NotePaneLeaf } from '$lib/domain';
  import { noteWorkspaceStore, notesStore } from '$lib/stores';
  import ConflictBanner from './ConflictBanner.svelte';
  import EditorShell from './EditorShell.svelte';
  import NotePaneNode from './NotePaneNode.svelte';
  import SplitNotePicker from './SplitNotePicker.svelte';

  interface Props {
    document: Document | null;
    onSaveStatusChange?: ((status: 'saved' | 'saving' | 'unsaved') => void) | undefined;
    onCountsChange?: ((wordCount: number, charCount: number) => void) | undefined;
    onError?: ((error: string | null) => void) | undefined;
    onTitleRename?: ((newTitle: string) => void) | undefined;
    editorStyle?: string;
  }

  let {
    document,
    onSaveStatusChange,
    onCountsChange,
    onError,
    onTitleRename,
    editorStyle = '',
  }: Props = $props();

  let narrowPaneMode = $state(false);

  const activeTab = $derived(noteWorkspaceStore.activeTab);
  const splitMode = $derived(activeTab?.root.type === 'split');
  const panes = $derived(activeTab ? noteWorkspaceStore.getPanes(activeTab) : []);
  const activePane = $derived(activeTab ? noteWorkspaceStore.getActivePane(activeTab) : null);
  const maximizedPane = $derived.by(() => {
    if (!activeTab || !noteWorkspaceStore.maximizedPaneId) return null;
    return panes.find((pane) => pane.paneId === noteWorkspaceStore.maximizedPaneId) ?? null;
  });
  const visibleLeaf = $derived<NotePaneLeaf | null>(
    narrowPaneMode && splitMode ? activePane : maximizedPane
  );

  function forwardSaveStatusChange(status: 'saved' | 'saving' | 'unsaved'): void {
    onSaveStatusChange?.(status);
  }

  function forwardCountsChange(wordCount: number, charCount: number): void {
    onCountsChange?.(wordCount, charCount);
  }

  function forwardError(error: string | null): void {
    onError?.(error);
  }

  function forwardTitleRename(newTitle: string): void {
    onTitleRename?.(newTitle);
  }

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  function titleForPath(path: string | null): string {
    if (!path) return 'Choose note';
    return notesStore.allNotes.find((note) => note.path === path)?.title ?? basename(path);
  }

  function switchPane(paneId: string): void {
    if (!activeTab) return;
    const path = noteWorkspaceStore.focusPane(activeTab.id, paneId);
    if (path) notesStore.selectNote(path);
  }

  onMount(() => {
    const query = window.matchMedia('(max-width: 879px)');
    const sync = () => {
      narrowPaneMode = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });
</script>

{#if activeTab}
  <div class="note-pane-workspace" class:split={splitMode} class:narrow={narrowPaneMode}>
    {#if splitMode && narrowPaneMode}
      <div class="pane-switcher" role="tablist" aria-label="Open panes">
        {#each panes as pane (pane.paneId)}
          <button
            type="button"
            class:active={pane.paneId === activeTab.activePaneId}
            role="tab"
            aria-selected={pane.paneId === activeTab.activePaneId}
            onclick={() => switchPane(pane.paneId)}
          >
            {titleForPath(pane.notePath)}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeTab.root.type === 'leaf'}
      {#if activeTab.root.notePath}
        {#if document?.path === activeTab.root.notePath}
          <ConflictBanner />
          <EditorShell
            {document}
            onSaveStatusChange={forwardSaveStatusChange}
            onCountsChange={forwardCountsChange}
            onError={forwardError}
            onTitleRename={forwardTitleRename}
            {editorStyle}
          />
        {:else}
          <div class="note-pane-loading">Opening…</div>
        {/if}
      {:else}
        <SplitNotePicker tabId={activeTab.id} paneId={activeTab.root.paneId} />
      {/if}
    {:else if visibleLeaf}
      <NotePaneNode
        node={visibleLeaf}
        tabId={activeTab.id}
        {document}
        onSaveStatusChange={forwardSaveStatusChange}
        onCountsChange={forwardCountsChange}
        onError={forwardError}
        onTitleRename={forwardTitleRename}
        {editorStyle}
      />
    {:else}
      <NotePaneNode
        node={activeTab.root}
        tabId={activeTab.id}
        {document}
        onSaveStatusChange={forwardSaveStatusChange}
        onCountsChange={forwardCountsChange}
        onError={forwardError}
        onTitleRename={forwardTitleRename}
        {editorStyle}
      />
    {/if}
  </div>
{/if}

<style>
  .note-pane-workspace {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-editor);
  }

  .note-pane-workspace.split {
    background: var(--surface-sunken);
  }

  .pane-switcher {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 5px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-light);
    background: var(--surface-sunken);
    scrollbar-width: thin;
  }

  .pane-switcher button {
    min-width: 0;
    max-width: 180px;
    height: 24px;
    padding: 0 9px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-switcher button:hover,
  .pane-switcher button:focus-visible,
  .pane-switcher button.active {
    border-color: var(--border-light);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .note-pane-loading {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }
</style>
