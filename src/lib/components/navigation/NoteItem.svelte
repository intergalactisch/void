<script lang="ts">
  /**
   * NoteItem Component
   *
   * Renders a single note or folder item in the sidebar.
   * Clean, Notion-inspired design with subtle interactions.
   */

  import type { NotesListItem } from '$lib/ports/inbound';
  import type { FolderDropPosition } from '$lib/ports/inbound';
  import { ChevronRight, FileText, Folder, FolderOpen, FolderPlus, GripVertical, Lock, MoreHorizontal, Unlock } from '@lucide/svelte';
  import type { FolderReorderDnd } from './folderReorderDnd';

  interface Props {
    item: NotesListItem;
    isSelected: boolean;
    isExpanded?: boolean;
    onClick: (item: NotesListItem, event?: MouseEvent | KeyboardEvent) => void;
    onToggle?: (item: NotesListItem) => void;
    onContextMenu?: ((item: NotesListItem, event: MouseEvent) => void) | undefined;
    /** Hover-only Plus button on folder rows. Receives this folder's path as the parent. */
    onCreateSubfolder?: ((parentPath: string) => void) | undefined;
    /** Parent folder path for folder drag ordering. Empty string = root. */
    parentPath?: string;
    folderDnd?: FolderReorderDnd | undefined;
    /** True while this folder is the active drag source. */
    isDragging?: boolean;
    /** Visual drop position for folder reorder. */
    dropPosition?: FolderDropPosition | null;
  }

  function noopAction() {
    return {};
  }

  let {
    item,
    isSelected,
    isExpanded = false,
    onClick,
    onToggle,
    onContextMenu,
    onCreateSubfolder,
    parentPath = '',
    folderDnd,
    isDragging = false,
    dropPosition = null,
  }: Props = $props();

  let sortableItemAction = $derived(folderDnd?.itemAction ?? noopAction);

  function handleClick(event: MouseEvent) {
    event.stopPropagation();
    onClick(item, event);
  }

  function handleToggle(event: MouseEvent) {
    event.stopPropagation();
    onToggle?.(item);
  }

  function handleContextMenu(event: MouseEvent) {
    if (!onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(item, event);
  }

  function handleMoreOptionsClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(item, event);
  }

  function handleCreateSubfolderClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onCreateSubfolder?.(item.path);
  }

  function handleDragHandleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleNoteDragStart(event: DragEvent) {
    if (item.isFolder) return;
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = 'copy';
    transfer.setData('application/x-void-note', JSON.stringify({
      path: item.path,
      title: item.title,
    }));
    transfer.setData('text/plain', item.path);
  }
</script>

<div
  class="note-item group flex w-full cursor-pointer items-center gap-1 rounded-sm py-0.5 pr-1.5 pl-1 text-left"
  class:note-item-folder={item.isFolder}
  class:note-item-selected={isSelected}
  class:note-item-expanded={isExpanded}
  class:note-item-dragging={isDragging}
  class:drop-before={dropPosition === 'before'}
  class:drop-after={dropPosition === 'after'}
  use:sortableItemAction={{ id: item.path, groupId: parentPath, handle: '[data-folder-drag-handle]', disabled: !item.isFolder }}
  data-note-path={item.path}
  onclick={handleClick}
  draggable={!item.isFolder}
  ondragstart={handleNoteDragStart}
  oncontextmenu={handleContextMenu}
  onkeydown={(e) => e.key === 'Enter' && onClick(item, e)}
  role="treeitem"
  tabindex="0"
  aria-selected={isSelected}
  aria-expanded={item.isFolder ? isExpanded : undefined}
  aria-grabbed={item.isFolder ? isDragging : undefined}
>
  {#if item.isFolder}
    <!-- Folder expand toggle -->
    <button
      type="button"
      class="note-item-toggle flex size-4 shrink-0 items-center justify-center rounded"
      onclick={handleToggle}
      aria-label={isExpanded ? 'Collapse' : 'Expand'}
    >
      <ChevronRight class="note-item-chevron" size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>

    <!-- Folder icon -->
    <span class="flex size-4 shrink-0 items-center justify-center">
      {#if isExpanded}
        <FolderOpen class="note-item-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
      {:else}
        <Folder class="note-item-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
      {/if}
    </span>
  {:else}
    <!-- Chevron-column spacer keeps file icons aligned with folder icons. -->
    <span class="note-item-toggle-spacer shrink-0" aria-hidden="true"></span>
    <span class="flex size-4 shrink-0 items-center justify-center">
      {#if item.protection?.level === 'protected'}
        {#if item.protection.lockState === 'locked'}
          <Lock class="note-item-icon note-item-lock" size={14} strokeWidth={1.7} aria-hidden="true" />
        {:else}
          <Unlock class="note-item-icon note-item-lock" size={14} strokeWidth={1.7} aria-hidden="true" />
        {/if}
      {:else}
        <FileText class="note-item-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
      {/if}
    </span>
  {/if}

  <!-- Title -->
  <span class="flex-1 truncate">{item.title}</span>

  {#if item.isFolder}
    <!-- Drag handle (on hover) — moved to the right so the row's left edge
         isn't padded out by an empty 16px column when the handle is hidden. -->
    <button
      type="button"
      class="note-item-drag-handle flex size-4 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
      data-folder-drag-handle
      onclick={handleDragHandleClick}
      title="Drag to reorder"
      aria-label={`Drag ${item.title} to reorder`}
    >
      <GripVertical size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>
  {/if}

  {#if item.isFolder && onCreateSubfolder}
    <!-- New subfolder button (on hover) -->
    <button
      type="button"
      class="note-item-more flex size-4 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
      onclick={handleCreateSubfolderClick}
      title="New subfolder"
      aria-label={`New subfolder in ${item.title}`}
    >
      <FolderPlus size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>
  {/if}

  {#if !item.isFolder && onContextMenu}
    <!-- More options button (on hover) -->
    <button
      type="button"
      class="note-item-more flex size-4 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
      onclick={handleMoreOptionsClick}
      aria-label="More options"
    >
      <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
  /* ─── Note tree row ─── */
  .note-item {
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast), color var(--transition-fast),
                box-shadow var(--transition-fast), opacity var(--transition-fast),
                transform var(--transition-fast);
    font-size: var(--text-small);
    line-height: 1.25;
    letter-spacing: 0;
    min-height: 22px;
  }
  .note-item-drag-handle {
    cursor: grab;
  }
  .note-item-drag-handle:active,
  .note-item-dragging .note-item-drag-handle {
    cursor: grabbing;
  }
  .note-item:hover,
  .note-item:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .note-item-selected {
    background: var(--bg-hover);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-light);
  }
  .note-item-selected:hover {
    background: var(--bg-hover);
  }
  .note-item-dragging {
    background: var(--bg-active);
    color: var(--text-primary);
    opacity: 0.56;
    box-shadow: inset 0 0 0 1px var(--border-medium);
  }
  .drop-before,
  .drop-after {
    position: relative;
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .drop-before::before,
  .drop-after::before {
    content: '';
    position: absolute;
    left: 20px;
    right: 6px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent-primary);
    pointer-events: none;
  }
  .drop-before::after,
  .drop-after::after {
    content: '';
    position: absolute;
    left: 16px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent-primary);
    pointer-events: none;
  }
  .drop-before::before {
    top: -2px;
  }
  .drop-after::before {
    bottom: -2px;
  }
  .drop-before::after {
    top: -4px;
  }
  .drop-after::after {
    bottom: -4px;
  }
  .note-item-toggle,
  .note-item-drag-handle,
  .note-item-more {
    transition: background var(--transition-fast), color var(--transition-fast);
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
  }
  :global(.note-item-chevron) {
    color: var(--text-muted);
    transition: transform var(--transition-fast), color var(--transition-fast);
  }
  .note-item-expanded :global(.note-item-chevron) {
    transform: rotate(90deg);
  }
  :global(.note-item-icon) {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: color var(--transition-fast);
  }
  :global(.note-item-lock) {
    color: var(--color-warning, var(--text-muted));
  }
  .note-item:hover :global(.note-item-icon),
  .note-item:focus-visible :global(.note-item-icon),
  .note-item-selected :global(.note-item-icon) {
    color: var(--text-secondary);
  }
  .note-item-toggle-spacer {
    width: 16px;
    height: 16px;
  }
  .note-item-toggle:hover,
  .note-item-toggle:focus-visible,
  .note-item-drag-handle:hover,
  .note-item-drag-handle:focus-visible,
  .note-item-more:hover,
  .note-item-more:focus-visible {
    background: var(--bg-active);
    color: var(--text-primary);
  }
</style>
