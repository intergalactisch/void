<script lang="ts">
  import { editorStore, noteWorkspaceStore, notesStore, toastStore } from '$lib/stores';
  import { buildRefId, type NotePaneDirection, type NotePaneDragPayload } from '$lib/domain';
  import { hasSelection } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import {
    AlertTriangle,
    Circle,
    FileSearch,
    GripVertical,
    Link2,
    Maximize2,
    Minimize2,
    MoreHorizontal,
    PanelRight,
    Rows3,
    X,
  } from '@lucide/svelte';

  interface Props {
    tabId: string;
    paneId: string;
    notePath: string;
    active?: boolean;
    dirty?: boolean;
    saving?: boolean;
    conflict?: boolean;
    editing?: boolean;
    onOpenNote?: () => void;
    onClosePane?: () => void;
  }

  let {
    tabId,
    paneId,
    notePath,
    active = false,
    dirty = false,
    saving = false,
    conflict = false,
    editing = false,
    onOpenNote,
    onClosePane,
  }: Props = $props();

  let moreOpen = $state(false);

  const note = $derived(notesStore.allNotes.find((item) => item.path === notePath));
  const title = $derived(note?.title ?? basename(notePath));
  const folderCrumb = $derived.by(() => {
    const parts = notePath.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  });
  const maximized = $derived(noteWorkspaceStore.maximizedPaneId === paneId);

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  function focusThisPane(): void {
    const selectedPath = noteWorkspaceStore.focusPane(tabId, paneId);
    if (selectedPath) notesStore.selectNote(selectedPath);
  }

  function split(direction: NotePaneDirection, event: MouseEvent): void {
    event.stopPropagation();
    focusThisPane();
    noteWorkspaceStore.splitActivePane(direction);
  }

  function openNote(event: MouseEvent): void {
    event.stopPropagation();
    focusThisPane();
    onOpenNote?.();
  }

  function toggleMaximized(event: MouseEvent): void {
    event.stopPropagation();
    const selectedPath = noteWorkspaceStore.focusPane(tabId, paneId, { preserveMaximized: true });
    if (selectedPath) notesStore.selectNote(selectedPath);
    noteWorkspaceStore.toggleMaximizedPane(paneId);
  }

  function closePane(event: MouseEvent): void {
    event.stopPropagation();
    onClosePane?.();
  }

  async function copyRef(): Promise<void> {
    const success = await copyTextToClipboard(buildRefId({ kind: 'note', notePath }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
    moreOpen = false;
  }

  async function copyPath(): Promise<void> {
    const success = await copyTextToClipboard(notePath);
    if (success) toastStore.info('Path copied');
    else toastStore.error('Failed to copy path');
    moreOpen = false;
  }

  function wikiLink(): string {
    return `[[${title}]]`;
  }

  function insertLink(): void {
    const targetPaneId = editorStore.activePaneId;
    if (targetPaneId) editorStore.focusPane(targetPaneId);
    if (hasSelection(editorStore.selection)) {
      editorStore.setPageLink({
        path: notePath,
        title,
        tags: note?.tags ?? [],
        matchKind: 'all',
        ...(folderCrumb ? { folder: folderCrumb } : {}),
        ...(note?.modifiedAt ? { modifiedAt: note.modifiedAt } : {}),
      });
    } else {
      editorStore.insertContent(wikiLink());
    }
    editorStore.focus();
    toastStore.info('Link inserted');
    moreOpen = false;
  }

  function handleTitleDragStart(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = 'copy';
    transfer.setData('application/x-void-note-link', JSON.stringify({
      path: notePath,
      title,
      markdown: wikiLink(),
    }));
    transfer.setData('application/x-void-note', JSON.stringify({ path: notePath, title }));
    transfer.setData('text/plain', wikiLink());
  }

  function handlePaneDragStart(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const payload: NotePaneDragPayload = { tabId, paneId, notePath };
    focusThisPane();
    transfer.effectAllowed = 'move';
    transfer.setData('application/x-void-pane', JSON.stringify(payload));
    transfer.setData('text/plain', title);
  }
</script>

<div class="note-pane-header" class:active>
  <div class="pane-title-shell">
    <button
      type="button"
      class="pane-drag-handle"
      draggable="true"
      onclick={focusThisPane}
      ondragstart={handlePaneDragStart}
      title="Move Pane"
      aria-label="Move Pane"
    >
      <GripVertical size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="pane-title-group"
      draggable="true"
      onclick={focusThisPane}
      ondragstart={handleTitleDragStart}
      title={`${title}${folderCrumb ? ` - ${folderCrumb}` : ''}`}
    >
      <span class="pane-title-row">
        <span class="pane-title">{title}</span>
        {#if editing}
          <span class="pane-editing-badge">Editing</span>
        {/if}
        {#if saving}
          <Circle class="pane-status saving" size={10} strokeWidth={2.4} aria-label="Saving" />
        {:else if dirty}
          <Circle class="pane-status dirty" size={10} strokeWidth={2.4} fill="currentColor" aria-label="Unsaved changes" />
        {/if}
        {#if conflict}
          <AlertTriangle class="pane-status conflict" size={13} strokeWidth={2.1} aria-label="Conflict" />
        {/if}
      </span>
      {#if folderCrumb}
        <span class="pane-crumb">{folderCrumb}</span>
      {/if}
    </button>
  </div>

  <div class="pane-header-actions">
    <button
      type="button"
      class="pane-icon-btn"
      onclick={(event) => split('horizontal', event)}
      title="Split Right"
      aria-label="Split Right"
    >
      <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="pane-icon-btn"
      onclick={(event) => split('vertical', event)}
      title="Split Down"
      aria-label="Split Down"
    >
      <Rows3 size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="pane-icon-btn"
      onclick={openNote}
      title="Open Note"
      aria-label="Open Note"
    >
      <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="pane-icon-btn"
      onclick={toggleMaximized}
      title={maximized ? 'Restore Pane' : 'Maximize Pane'}
      aria-label={maximized ? 'Restore Pane' : 'Maximize Pane'}
    >
      {#if maximized}
        <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
      {:else}
        <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />
      {/if}
    </button>
    <div class="pane-more-wrap">
      <button
        type="button"
        class="pane-icon-btn"
        onclick={(event) => { event.stopPropagation(); moreOpen = !moreOpen; }}
        title="More"
        aria-label="More"
        aria-expanded={moreOpen}
      >
        <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {#if moreOpen}
        <button
          type="button"
          class="pane-menu-backdrop"
          aria-label="Close pane menu"
          onclick={(event) => { event.stopPropagation(); moreOpen = false; }}
        ></button>
        <div class="pane-menu" role="menu" aria-label="Pane options">
          <button type="button" role="menuitem" onclick={() => { insertLink(); }}>
            <Link2 size={13} strokeWidth={2} aria-hidden="true" />
            Insert Link
          </button>
          <button type="button" role="menuitem" onclick={() => { void copyRef(); }}>Copy Ref</button>
          <button type="button" role="menuitem" onclick={() => { void copyPath(); }}>Copy Path</button>
        </div>
      {/if}
    </div>
    <button
      type="button"
      class="pane-icon-btn"
      onclick={closePane}
      title="Close Pane"
      aria-label="Close Pane"
    >
      <X size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
</div>

<style>
  .note-pane-header {
    position: relative;
    container-type: inline-size;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid var(--border-faint);
    background: color-mix(in oklab, var(--bg-editor) 94%, var(--bg-sidebar));
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
  }

  .note-pane-header.active {
    color: var(--text-primary);
  }

  .note-pane-header.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent-primary);
  }

  .pane-title-shell {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 100%;
  }

  .pane-drag-handle {
    position: relative;
    display: flex;
    width: 18px;
    height: 24px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: grab;
  }

  .pane-drag-handle:active {
    cursor: grabbing;
  }

  .pane-drag-handle:hover,
  .pane-drag-handle:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pane-title-group {
    display: grid;
    grid-template-rows: minmax(0, auto) minmax(0, auto);
    min-width: 0;
    justify-content: center;
    align-self: stretch;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .pane-title-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content max-content max-content;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
  }

  .pane-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-small);
    font-weight: 600;
    letter-spacing: 0;
  }

  .pane-editing-badge {
    min-width: 0;
    max-width: 68px;
    overflow: hidden;
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 34%, var(--border-light));
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    color: var(--accent-primary);
    font-size: 10px;
    font-weight: 650;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-crumb {
    display: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    line-height: 1.1;
  }

  .note-pane-header:hover .pane-crumb,
  .note-pane-header:focus-within .pane-crumb {
    display: block;
  }

  :global(.pane-status) {
    flex: 0 0 auto;
  }

  :global(.pane-status.dirty) {
    color: var(--accent-primary);
  }

  :global(.pane-status.saving) {
    color: var(--text-tertiary);
  }

  :global(.pane-status.conflict) {
    color: var(--color-warning);
  }

  .pane-header-actions {
    display: flex;
    min-width: max-content;
    align-items: center;
    gap: 2px;
    justify-self: end;
    opacity: 0.38;
  }

  .note-pane-header.active .pane-header-actions,
  .note-pane-header:hover .pane-header-actions,
  .note-pane-header:focus-within .pane-header-actions {
    opacity: 1;
  }

  .pane-icon-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .pane-icon-btn:hover,
  .pane-icon-btn:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pane-icon-btn::before {
    content: '';
    position: absolute;
    inset: -12px;
    display: none;
  }

  @media (pointer: coarse) {
    .pane-icon-btn::before {
      display: block;
    }
  }

  .pane-more-wrap {
    position: relative;
  }

  .pane-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    border: 0;
    background: transparent;
  }

  .pane-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: calc(var(--z-popover) + 1);
    min-width: 128px;
    padding: 5px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
  }

  .pane-menu button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
  }

  .pane-menu button:hover,
  .pane-menu button:focus-visible {
    background: var(--bg-hover);
  }

  @container (max-width: 430px) {
    .pane-title-shell {
      grid-template-columns: 16px minmax(0, 1fr);
      gap: 2px;
    }

    .pane-drag-handle {
      width: 16px;
    }

    .pane-crumb {
      display: none !important;
    }

    .pane-header-actions {
      gap: 0;
    }
  }

  @container (max-width: 360px) {
    .pane-editing-badge {
      width: 7px;
      height: 7px;
      padding: 0;
      border-color: var(--accent-primary);
      border-radius: var(--radius-full);
      background: var(--accent-primary);
      color: transparent;
    }

    .pane-icon-btn {
      width: 22px;
    }
  }
</style>
