<script lang="ts">
  /**
   * EditorTabs — horizontal tab strip for open documents.
   *
   * Reads `tabs` and `activePath` from the editor store, calls
   * `editorStore.switchTab` / `closeTab` on interaction. Also keeps
   * `notesStore.selectedPath` in sync so the sidebar highlight follows
   * the active tab when the user clicks the tab strip directly.
   */
  import { editorStore } from '$lib/stores/editor.svelte';
  import { notesStore } from '$lib/stores/notes.svelte';
  import { events } from '$lib/events';
  import { X } from '@lucide/svelte';

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/, '');
  }

  async function handleSwitch(path: string) {
    if (editorStore.activePath === path) return;
    await editorStore.switchTab(path);
    if (notesStore.selectedPath !== path) {
      notesStore.selectNote(path);
    }
  }

  async function handleClose(event: MouseEvent, path: string) {
    event.stopPropagation();
    await editorStore.closeTab(path);
    // After closing, the service activates the next tab; sync sidebar.
    const newActive = editorStore.activePath;
    if (newActive && notesStore.selectedPath !== newActive) {
      notesStore.selectNote(newActive);
    } else if (!newActive && notesStore.selectedPath !== null) {
      notesStore.selectNote(null);
    }
  }

  function handleContextMenu(event: MouseEvent, path: string, displayTitle: string) {
    event.preventDefault();
    event.stopPropagation();
    events.emit('app:note-context-menu', {
      path,
      title: displayTitle,
      position: { x: event.clientX, y: event.clientY },
      isFolder: false,
    });
  }

  function handleKeydown(event: KeyboardEvent, path: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void handleSwitch(path);
    }
  }
</script>

{#if editorStore.tabs.length > 1}
  <div class="editor-tabs" role="tablist" aria-label="Open documents">
    {#each editorStore.tabs as tab (tab.path)}
      {@const active = tab.path === editorStore.activePath}
      {@const displayTitle = notesStore.titleForPath(tab.path, tab.title || basename(tab.path))}
      <div
        class="editor-tab"
        class:active
        class:dirty={tab.isDirty}
        role="tab"
        aria-selected={active}
        tabindex={active ? 0 : -1}
        title={tab.path}
        onclick={() => handleSwitch(tab.path)}
        oncontextmenu={(e) => handleContextMenu(e, tab.path, displayTitle)}
        onkeydown={(e) => handleKeydown(e, tab.path)}
      >
        <span class="editor-tab-label">{displayTitle}</span>
        {#if tab.isDirty}
          <span class="editor-tab-dot" aria-label="Unsaved changes"></span>
        {/if}
        <button
          class="editor-tab-close"
          aria-label="Close tab"
          onclick={(e) => handleClose(e, tab.path)}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .editor-tabs {
    display: flex;
    align-items: stretch;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 1px;
    padding: 0 12px;
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--border-light);
    user-select: none;
    scrollbar-width: thin;
  }

  .editor-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
    min-width: 0;
    max-width: 200px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    background: transparent;
    border-top: 2px solid transparent;
    border-right: 1px solid var(--border-faint);
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .editor-tab:hover {
    background: var(--surface-base);
    color: var(--text-primary);
  }

  .editor-tab.active {
    background: var(--surface-base);
    color: var(--text-primary);
    border-top-color: var(--accent-primary);
  }

  .editor-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .editor-tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
  }

  .editor-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .editor-tab-close:hover {
    background: var(--border-medium);
    color: var(--text-primary);
  }

  .editor-tab.dirty .editor-tab-close {
    /* Keep close button visible even when dirty dot is shown. */
    margin-left: 0;
  }
</style>
