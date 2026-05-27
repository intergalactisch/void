<script lang="ts">
  /**
   * FolderTree Component
   *
   * Recursively renders the folder tree of notes in the sidebar.
   * Handles folder expansion, note selection, and nested rendering.
   */

  import type { NotesListItem } from '$lib/ports/inbound';
  import type { FolderDropPosition } from '$lib/ports/inbound';
  import type { SortableState } from '$lib/components/dnd/sortable';
  import NoteItem from './NoteItem.svelte';
  import FolderTree from './FolderTree.svelte';
  import type { FolderReorderDnd } from './folderReorderDnd';

  interface Props {
    /** The items to display at this level */
    items: NotesListItem[];
    /** Currently selected note path */
    selectedPath: string | null;
    /** Currently selected virtual folder path */
    selectedFolderPath?: string | null;
    /** Multi-selected note paths */
    selectedPaths?: Set<string>;
    /** Set of expanded folder paths */
    expandedFolders: Set<string>;
    /** Callback when a note is selected */
    onSelectNote: (path: string, event?: MouseEvent | KeyboardEvent) => void;
    /** Callback when a folder label is selected */
    onSelectFolder?: ((path: string) => void) | undefined;
    /** Callback when a folder is toggled */
    onToggleFolder: (path: string) => void;
    /** Callback when a note is right-clicked */
    onContextMenu?: ((item: NotesListItem, event: MouseEvent) => void) | undefined;
    /** Callback to request creating a subfolder inside the clicked folder */
    onRequestCreateFolder?: ((parentPath: string) => void) | undefined;
    /** Parent folder path for this rendered level. Empty string = root. */
    parentPath?: string;
    folderDnd?: FolderReorderDnd | undefined;
    dndState?: SortableState | undefined;
  }

  function noopAction() {
    return {};
  }

  let {
    items,
    selectedPath,
    selectedFolderPath = null,
    selectedPaths = new Set(),
    expandedFolders,
    onSelectNote,
    onSelectFolder,
    onToggleFolder,
    onContextMenu,
    onRequestCreateFolder,
    parentPath = '',
    folderDnd,
    dndState,
  }: Props = $props();

  let sortableListAction = $derived(folderDnd?.listAction ?? noopAction);

  /** Handle item click */
  function handleItemClick(item: NotesListItem, event?: MouseEvent | KeyboardEvent) {
    if (item.isFolder) {
      if (onSelectFolder) {
        onSelectFolder(item.path);
      } else {
        onToggleFolder(item.path);
      }
    } else {
      onSelectNote(item.path, event);
    }
  }

  /** Handle folder toggle */
  function handleToggle(item: NotesListItem) {
    onToggleFolder(item.path);
  }

  /** Check if a folder is expanded */
  function isExpanded(path: string): boolean {
    return expandedFolders.has(path);
  }

  function isDragging(path: string): boolean {
    return dndState?.dragging?.id === path && dndState.dragging.groupId === parentPath;
  }

  function getDropPosition(path: string): FolderDropPosition | null {
    const target = dndState?.dropTarget;
    if (!target || target.id !== path || target.groupId !== parentPath) return null;
    return target.position;
  }
</script>

<div
  class="flex flex-col"
  use:sortableListAction={{ groupId: parentPath }}
  role="group"
>
  {#each items as item (item.path)}
    <NoteItem
      {item}
      isSelected={item.isFolder ? selectedFolderPath === item.path : selectedPath === item.path}
      isMultiSelected={!item.isFolder && selectedPaths.has(item.path)}
      isExpanded={item.isFolder && isExpanded(item.path)}
      onClick={handleItemClick}
      onToggle={handleToggle}
      {onContextMenu}
      onCreateSubfolder={onRequestCreateFolder ? (path) => onRequestCreateFolder?.(path) : undefined}
      {parentPath}
      {folderDnd}
      isDragging={isDragging(item.path)}
      dropPosition={getDropPosition(item.path)}
    />

    <!-- Render children if folder is expanded -->
    {#if item.isFolder && item.children && isExpanded(item.path)}
      <div class="tree-children">
        <FolderTree
          items={item.children}
          {selectedPath}
          {selectedFolderPath}
          {selectedPaths}
          {expandedFolders}
          {onSelectNote}
          {onSelectFolder}
          {onToggleFolder}
          {onContextMenu}
          {onRequestCreateFolder}
          parentPath={item.path}
          {folderDnd}
          {dndState}
        />
      </div>
    {/if}
  {/each}
</div>

<style>
  .tree-children {
    position: relative;
    margin-left: 10px;
    padding-left: 4px;
    border-left: 1px solid var(--border-light);
  }
</style>
