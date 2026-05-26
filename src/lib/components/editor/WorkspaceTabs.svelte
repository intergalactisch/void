<script lang="ts">
  import { noteWorkspaceStore, editorStore, notesStore, toastStore } from '$lib/stores';
  import { buildRefId, type NotePaneDirection, type NoteWorkspaceTab } from '$lib/domain';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { AlertTriangle, Copy, PanelRight, Plus, Rows3, X } from '@lucide/svelte';

  type ContextMenuState = {
    tabId: string;
    x: number;
    y: number;
  };

  interface Props {
    onActivatePath?: (path: string | null, paneId: string | null) => void;
  }

  let { onActivatePath }: Props = $props();

  let contextMenu = $state<ContextMenuState | null>(null);

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  function titleForPath(path: string | null): string {
    if (!path) return 'Choose note';
    return notesStore.titleForPath(path, basename(path));
  }

  function pathsForTab(tab: NoteWorkspaceTab): string[] {
    return noteWorkspaceStore.getNotePaths(tab);
  }

  function activePathForTab(tab: NoteWorkspaceTab): string | null {
    return noteWorkspaceStore.getActivePane(tab).notePath;
  }

  function tabLabel(tab: NoteWorkspaceTab): string {
    if (tab.root.type === 'leaf') return titleForPath(tab.root.notePath);
    return tab.title ?? titleForPath(activePathForTab(tab));
  }

  function tabIsDirty(tab: NoteWorkspaceTab): boolean {
    const paths = new Set(pathsForTab(tab));
    return editorStore.tabs.some((session) => paths.has(session.path) && session.isDirty);
  }

  function tabHasConflict(tab: NoteWorkspaceTab): boolean {
    const paths = new Set(pathsForTab(tab));
    return editorStore.tabs.some((session) => paths.has(session.path) && session.conflictState !== 'clean');
  }

  function remainingWorkspacePaths(): Set<string> {
    return new Set(noteWorkspaceStore.tabs.flatMap((tab) => pathsForTab(tab)));
  }

  async function closeRemovedEditorSessions(paths: string[]): Promise<void> {
    const remaining = remainingWorkspacePaths();
    for (const path of new Set(paths)) {
      if (remaining.has(path)) continue;
      if (!editorStore.tabs.some((tab) => tab.path === path)) continue;
      await editorStore.closeTab(path);
    }
  }

  function syncSelectedPath(path: string | null): void {
    if (path && notesStore.selectedPath !== path) {
      notesStore.selectNote(path);
    } else if (!path && notesStore.selectedPath !== null) {
      notesStore.selectNote(null);
    }
  }

  function handleSwitch(tab: NoteWorkspaceTab): void {
    const path = noteWorkspaceStore.focusTab(tab.id);
    if (onActivatePath) {
      onActivatePath(path, noteWorkspaceStore.activePaneId);
    } else {
      syncSelectedPath(path);
    }
  }

  function handleNewTab(): void {
    // Creates an empty tab; NotePaneWorkspace shows its picker. We deliberately do not
    // touch the note selection here — clearing it would close the freshly-created tab.
    noteWorkspaceStore.openEmptyTab();
  }

  async function handleClose(event: MouseEvent, tab: NoteWorkspaceTab): Promise<void> {
    event.stopPropagation();
    const removedPaths = pathsForTab(tab);
    const nextPath = noteWorkspaceStore.closeTab(tab.id);
    await closeRemovedEditorSessions(removedPaths);
    syncSelectedPath(nextPath);
    contextMenu = null;
  }

  function splitTab(tab: NoteWorkspaceTab, direction: NotePaneDirection): void {
    const path = noteWorkspaceStore.focusTab(tab.id);
    syncSelectedPath(path);
    noteWorkspaceStore.splitActivePane(direction);
    contextMenu = null;
  }

  function renameLayout(tab: NoteWorkspaceTab): void {
    if (tab.root.type === 'leaf') return;
    const next = window.prompt('Layout name', tab.title ?? tabLabel(tab));
    if (next === null) return;
    noteWorkspaceStore.renameTab(tab.id, next);
    contextMenu = null;
  }

  async function closeOtherTabs(tab: NoteWorkspaceTab): Promise<void> {
    const removedPaths = noteWorkspaceStore.tabs
      .filter((item) => item.id !== tab.id)
      .flatMap((item) => pathsForTab(item));
    const nextPath = noteWorkspaceStore.closeOtherTabs(tab.id);
    await closeRemovedEditorSessions(removedPaths);
    syncSelectedPath(nextPath);
    contextMenu = null;
  }

  async function copyRef(tab: NoteWorkspaceTab): Promise<void> {
    const path = activePathForTab(tab);
    if (!path) {
      toastStore.error('No note ref to copy');
      contextMenu = null;
      return;
    }
    const success = await copyTextToClipboard(buildRefId({ kind: 'note', notePath: path }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
    contextMenu = null;
  }

  function handleContextMenu(event: MouseEvent, tab: NoteWorkspaceTab): void {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = { tabId: tab.id, x: event.clientX, y: event.clientY };
  }

  function handleKeydown(event: KeyboardEvent, tab: NoteWorkspaceTab): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSwitch(tab);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!contextMenu || event.key !== 'Escape') return;
    event.preventDefault();
    contextMenu = null;
  }

</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if noteWorkspaceStore.tabs.length > 0}
  <div
    class="workspace-tabs"
    role="tablist"
    aria-label="Workspace tabs"
    data-empty-drop="true"
    data-empty-drop-label="New tab"
  >
    {#each noteWorkspaceStore.tabs as tab (tab.id)}
      {@const active = tab.id === noteWorkspaceStore.activeTabId}
      {@const paneCount = noteWorkspaceStore.getPaneCount(tab)}
      {@const dirty = tabIsDirty(tab)}
      {@const conflict = tabHasConflict(tab)}
      <div
        class="workspace-tab"
        class:active
        class:dirty
        data-tab-id={tab.id}
        role="tab"
        aria-selected={active}
        tabindex={active ? 0 : -1}
        title={pathsForTab(tab).join('\n')}
        onclick={() => handleSwitch(tab)}
        oncontextmenu={(event) => handleContextMenu(event, tab)}
        onkeydown={(event) => handleKeydown(event, tab)}
      >
        <span class="workspace-tab-label">{tabLabel(tab)}</span>
        {#if paneCount > 1}
          <span class="workspace-tab-badge" aria-label={`${paneCount} panes`}>+{paneCount - 1}</span>
        {/if}
        {#if conflict}
          <AlertTriangle size={12} strokeWidth={2.1} aria-label="Conflict in tab" />
        {:else if dirty}
          <span class="workspace-tab-dot" aria-label="Unsaved changes"></span>
        {/if}
        <button
          type="button"
          class="workspace-tab-close"
          aria-label="Close workspace tab"
          onclick={(event) => { void handleClose(event, tab); }}
        >
          <X size={12} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    {/each}
    <button
      type="button"
      class="workspace-tab-new"
      title="New tab"
      aria-label="New tab"
      onclick={handleNewTab}
    >
      <Plus size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  {#if contextMenu}
    {@const menuTab = noteWorkspaceStore.tabs.find((tab) => tab.id === contextMenu?.tabId)}
    <button
      type="button"
      class="workspace-tab-menu-backdrop"
      aria-label="Close tab menu"
      onclick={() => { contextMenu = null; }}
    ></button>
    {#if menuTab}
      <div
        class="workspace-tab-menu"
        style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
        role="menu"
        aria-label="Tab options"
      >
        <button type="button" role="menuitem" onclick={() => splitTab(menuTab, 'horizontal')}>
          <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Split Right</span>
        </button>
        <button type="button" role="menuitem" onclick={() => splitTab(menuTab, 'vertical')}>
          <Rows3 size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Split Down</span>
        </button>
        {#if menuTab.root.type === 'split'}
          <button type="button" role="menuitem" onclick={() => renameLayout(menuTab)}>
            <span class="menu-icon-spacer" aria-hidden="true"></span>
            <span>Rename Layout</span>
          </button>
        {/if}
        <button type="button" role="menuitem" onclick={() => { void closeOtherTabs(menuTab); }}>
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Close Other Tabs</span>
        </button>
        <button type="button" role="menuitem" onclick={() => { void copyRef(menuTab); }}>
          <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Copy Ref</span>
        </button>
      </div>
    {/if}
  {/if}
{/if}

<style>
  .workspace-tabs {
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

  .workspace-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 104px;
    max-width: 230px;
    min-height: 32px;
    padding: 5px 8px 5px 12px;
    border-top: 2px solid transparent;
    border-right: 1px solid var(--border-faint);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--text-small);
    letter-spacing: 0;
  }

  .workspace-tab:hover,
  .workspace-tab:focus-visible {
    background: var(--surface-base);
    color: var(--text-primary);
  }

  .workspace-tab.active {
    background: var(--surface-base);
    color: var(--text-primary);
    border-top-color: var(--accent-primary);
  }

  :global(.workspace-tab[data-pane-move-hover='true']) {
    background: var(--surface-base);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 38%, transparent);
  }

  .workspace-tab-label {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 16px;
    padding: 0 5px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    line-height: 1;
  }

  .workspace-tab-dot {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--accent-primary);
  }

  .workspace-tab :global(svg) {
    flex: 0 0 auto;
    color: var(--text-tertiary);
  }

  .workspace-tab-close {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .workspace-tab-close:hover,
  .workspace-tab-close:focus-visible {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .workspace-tab-close::before {
    content: '';
    position: absolute;
    inset: -14px;
    display: none;
  }

  @media (pointer: coarse) {
    .workspace-tab-close::before {
      display: block;
    }
  }

  .workspace-tab-new {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    flex: 0 0 auto;
    width: 28px;
    height: 24px;
    margin-left: 4px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .workspace-tab-new:hover,
  .workspace-tab-new:focus-visible {
    background: var(--surface-base);
    color: var(--text-primary);
  }

  .workspace-tab-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    border: 0;
    background: transparent;
  }

  .workspace-tab-menu {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    min-width: 172px;
    padding: 5px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
  }

  .workspace-tab-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
    cursor: pointer;
  }

  .workspace-tab-menu button:hover,
  .workspace-tab-menu button:focus-visible {
    background: var(--bg-hover);
  }

  .workspace-tab-menu :global(svg),
  .menu-icon-spacer {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    color: var(--text-tertiary);
  }
</style>
