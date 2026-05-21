<script lang="ts">
  /**
   * Sidebar Component
   *
   * Clean, minimal sidebar with workspace identity, navigation, and settings.
   * Features:
   * - Workspace identity area (app icon + name + new note)
   * - Search row (opens Quick Switcher)
   * - Favorites section
   * - Tag-first virtual folders
   * - Recent notes section
   * - Bottom bar (Trash + Settings)
   * - Collapsible with smooth animation
   */

  import { notesStore, todoStore, uiStore, workspaceStore } from '$lib/stores';
  import type { NotesListItem, TagGroup } from '$lib/ports/inbound';
  import { createSortableState, type SortableState } from '$lib/components/dnd/sortable';
  import FolderTree from './FolderTree.svelte';
  import { createFolderReorderDnd } from './folderReorderDnd';
  import { ChevronRight, Clock, FileText, Folder, FolderPlus, Hash, Home, Layers, Plus, RefreshCw, Star, Trash2 } from '@lucide/svelte';

  interface Props {
    /** Whether the sidebar is visible */
    visible?: boolean;
    /** Callback to create a new note */
    onCreateNote?: () => void;
    /** Callback to open the home screen */
    onOpenHome?: () => void;
    /** Callback to open settings panel */
    onOpenSettings?: () => void;
    /** Callback to open quick switcher */
    onOpenQuickSwitcher?: () => void;
    /** Callback to open the Tasks workspace */
    onOpenTasks?: () => void;
    /** Callback to request deletion of a note */
    onRequestDeleteNote?: (path: string, title: string) => void;
    /** Callback when a note is right-clicked */
    onNoteContextMenu?: (path: string, title: string, position: { x: number; y: number }, isFolder?: boolean) => void;
    /** Callback to open the create-folder modal. null parentPath = root. */
    onRequestCreateFolder?: (parentPath: string | null) => void;
  }

  let {
    visible = true,
    onCreateNote,
    onOpenHome,
    onOpenSettings,
    onOpenQuickSwitcher,
    onOpenTasks,
    onRequestDeleteNote,
    onNoteContextMenu,
    onRequestCreateFolder,
  }: Props = $props();

  /** Handle right-click on a note/folder (works for tree, Recent, and Favorites rows). */
  function handleNoteContextMenu(item: Pick<NotesListItem, 'path' | 'title'> & { isFolder?: boolean }, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onNoteContextMenu?.(item.path, item.title, { x: event.clientX, y: event.clientY }, item.isFolder ?? false);
  }

  /**
   * Handle note selection with optional multi-select.
   *
   * - Cmd/Ctrl+click toggles a note in/out of multi-selection (no nav).
   * - Shift+click extends multi-selection (adds; doesn't navigate).
   * - Plain click clears multi-selection and navigates to the note.
   */
  function handleSelectNote(path: string, event?: MouseEvent | KeyboardEvent) {
    if (event && (event.metaKey || event.ctrlKey)) {
      notesStore.toggleSelection(path);
      return;
    }
    if (event && event.shiftKey) {
      notesStore.addToSelection(path);
      return;
    }
    notesStore.selectNote(path);
  }

  function handleSelectFolder(path: string) {
    notesStore.selectFolderView(path);
  }

  function handleSelectFavorite(item: NotesListItem, event?: MouseEvent | KeyboardEvent) {
    if (item.isFolder) {
      handleSelectFolder(item.path);
      return;
    }
    handleSelectNote(item.path, event);
  }

  function handleToggleFolder(path: string) {
    notesStore.toggleFolder(path);
  }

  async function handleRefreshFolders() {
    if (folderRefreshInProgress) return;
    folderRefreshInProgress = true;
    try {
      await notesStore.refresh();
    } finally {
      folderRefreshInProgress = false;
    }
  }

  function openCreateFolderAtRoot() {
    onRequestCreateFolder?.(null);
  }

  function openCreateFolderInside(parentPath: string) {
    onRequestCreateFolder?.(parentPath);
  }

  function handleNoteRowKeydown(path: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelectNote(path, event);
  }

  function handleFavoriteRowKeydown(item: NotesListItem, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelectFavorite(item, event);
  }

  // ─── Multi-select bulk actions ───
  let bulkDeleteInProgress = $state(false);
  let folderRefreshInProgress = $state(false);
  let bulkTagOpen = $state(false);
  let bulkTagDraft = $state('');
  let bulkTagInProgress = $state(false);
  let bulkTagInputEl: HTMLInputElement | null = $state(null);

  async function handleBulkDelete() {
    if (bulkDeleteInProgress) return;
    bulkDeleteInProgress = true;
    try {
      const count = await notesStore.deleteSelected();
      // Toast feedback handled by the page; the store records each delete
      // in ActionHistoryService so Cmd+Shift+Z restores them.
      if (count === 0) {
        return;
      }
    } finally {
      bulkDeleteInProgress = false;
    }
  }

  function openBulkTag() {
    bulkTagOpen = true;
    bulkTagDraft = '';
    requestAnimationFrame(() => bulkTagInputEl?.focus());
  }

  function closeBulkTag() {
    bulkTagOpen = false;
    bulkTagDraft = '';
  }

  async function commitBulkTag() {
    if (bulkTagInProgress) return;
    const tag = bulkTagDraft.trim();
    if (!tag) {
      closeBulkTag();
      return;
    }
    bulkTagInProgress = true;
    try {
      await notesStore.tagSelected(tag);
    } finally {
      bulkTagInProgress = false;
      closeBulkTag();
    }
  }

  function handleBulkTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitBulkTag();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeBulkTag();
    }
  }

  function handleClearSelection() {
    notesStore.clearSelection();
    closeBulkTag();
  }

  /** Handle home navigation */
  function handleOpenHome() {
    onOpenHome?.();
  }

  /** Handle note deletion from a row action */
  function handleDeleteNote(note: Pick<NotesListItem, 'path' | 'title'>, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onRequestDeleteNote?.(note.path, note.title);
  }

  /** Handle tag group toggle */
  function handleToggleTagGroup(id: string) {
    notesStore.toggleTagGroup(id);
  }

  function handleTagGroupKeydown(id: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleToggleTagGroup(id);
  }

  async function handleCreateNoteInTag(group: TagGroup, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (group.isUntagged) {
      const document = await notesStore.createQuickNote();
      if (document && !notesStore.isTagGroupExpanded(group.id)) {
        notesStore.toggleTagGroup(group.id);
      }
      return;
    }

    if (group.tag) {
      await notesStore.createQuickNoteWithTags([group.tag]);
    }
  }

  function getCreateNoteLabel(group: TagGroup) {
    return group.isUntagged ? 'New untagged note' : `New note tagged ${group.title}`;
  }

  /** Handle favorite toggle */
  function handleToggleFavorite(path: string, event: MouseEvent, kind: 'note' | 'folder' = 'note') {
    event.stopPropagation();
    notesStore.toggleFavorite(path, kind);
  }

  let folderDndState = $state<SortableState>(createSortableState());
  const folderDnd = createFolderReorderDnd({
    onStateChange: (state) => {
      folderDndState = state;
    },
    onReorder: async (path, targetPath, position) => {
      await notesStore.reorderFolder(path, targetPath, position);
    },
  });

  /** Show only the most-recent N notes per tag in the sidebar.
   *  The full list lives on the tag detail page. */
  const TAG_NOTES_PREVIEW_LIMIT = 6;

  /** Untagged groups don't have a tag detail page, so we keep their
   *  inline "Show more / Show fewer" toggle for completeness. */
  let expandedLongTagGroups = $state<Set<string>>(new Set());

  function isLongTagGroupExpanded(id: string) {
    return expandedLongTagGroups.has(id);
  }

  /** Sort by modifiedAt desc, then take the first N (latest first). */
  function sortByRecent(notes: TagGroup['notes']) {
    return [...notes].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }

  function getVisibleTagNotes(group: TagGroup) {
    const sorted = sortByRecent(group.notes);
    if (sorted.length <= TAG_NOTES_PREVIEW_LIMIT) return sorted;
    if (group.isUntagged && isLongTagGroupExpanded(group.id)) return sorted;
    return sorted.slice(0, TAG_NOTES_PREVIEW_LIMIT);
  }

  function getHiddenTagNoteCount(group: TagGroup) {
    return Math.max(0, group.notes.length - TAG_NOTES_PREVIEW_LIMIT);
  }

  function handleToggleLongTagGroup(id: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const next = new Set(expandedLongTagGroups);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedLongTagGroups = next;
  }

  /** Open the embedded tag detail view for the given tag. */
  function handleOpenTagView(tag: string) {
    notesStore.selectTagView(tag);
  }

  function handleTagViewKeydown(tag: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenTagView(tag);
  }

  // Sidebar resize
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 400;
  const DEFAULT_WIDTH = 260;

  let sidebarWidth = $state(DEFAULT_WIDTH);
  let isResizing = $state(false);
  let sidebarElement: HTMLElement | undefined = $state(undefined);

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      sidebarWidth = newWidth;
      if (sidebarElement) {
        sidebarElement.style.width = `${newWidth}px`;
      }
    }

    function onMouseUp() {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResizeDoubleClick() {
    sidebarWidth = DEFAULT_WIDTH;
    if (sidebarElement) {
      sidebarElement.style.width = `${DEFAULT_WIDTH}px`;
    }
  }

  function handleWorkspaceSelect(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    if (!target.value || target.value === workspaceStore.activeWorkspace?.id) return;
    void workspaceStore.switchTo(target.value);
  }
</script>

<nav
  bind:this={sidebarElement}
  class="sidebar"
  class:sidebar-visible={visible}
  class:sidebar-hidden={!visible}
  aria-label="Notes navigation"
  style="width: {visible ? sidebarWidth + 'px' : '0px'};"
>
  <!-- Workspace Identity -->
  <div class="workspace-identity">
    <div class="workspace-left">
      {#if workspaceStore.workspaces.length > 1}
        <a
          href="/workspaces"
          class="workspace-icon workspace-icon-link"
          title="Manage workspaces"
          aria-label="Manage workspaces"
        >V</a>
        <select
          class="workspace-select"
          aria-label="Switch workspace"
          value={workspaceStore.activeWorkspace?.id ?? ''}
          onchange={handleWorkspaceSelect}
          disabled={workspaceStore.loading}
        >
          {#each workspaceStore.workspaces as workspace (workspace.id)}
            <option value={workspace.id}>{workspace.name}</option>
          {/each}
        </select>
      {:else}
        <span class="workspace-icon" aria-hidden="true">V</span>
        <a
          href="/workspaces"
          class="workspace-name workspace-name-link"
          title="Manage workspaces"
        >{workspaceStore.activeWorkspace?.name ?? 'Void'}</a>
      {/if}
    </div>
    <div class="workspace-actions">
      <button
        type="button"
        class="workspace-action-btn"
        class:active={notesStore.selectedPath === null && notesStore.activeTagView === null && notesStore.activeFolderPath === null}
        onclick={handleOpenHome}
        title="Home"
        aria-label="Go to home screen"
      >
        <Home size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="workspace-action-btn"
        onclick={() => onCreateNote?.()}
        title="New note (Cmd+N)"
        aria-label="Create new note"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Search row (opens Quick Switcher) -->
  <div class="search-area">
    <button
      type="button"
      class="search-row"
      onclick={() => onOpenQuickSwitcher?.()}
      aria-label="Search notes (Cmd+P)"
    >
      <svg class="search-icon" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <span class="search-text">Search</span>
      <kbd class="search-kbd" aria-hidden="true">Cmd+P</kbd>
    </button>
  </div>

  <div class="divider"></div>

  <!-- ─── Scrollable content area ──────────────────────────────────────
       One scroll region for RECENT, FAVORITES, FOLDERS, and TAGS so the
       scrollbar always sits at the sidebar's right edge instead of nested
       half-way down. Bottom bar stays outside this wrapper. -->
  <div class="sidebar-scroll scrollbar-thin">

  <!-- RECENT Section — always visible, collapsible, with empty state -->
  <div class="section-items">
    <button
      type="button"
      class="sidebar-item section-toggle group"
      onclick={() => notesStore.toggleRecentExpanded()}
      aria-expanded={notesStore.recentExpanded}
      aria-controls="recent-list"
    >
      <span
        class="chevron-icon"
        class:chevron-open={notesStore.recentExpanded}
        aria-hidden="true"
      >
        <ChevronRight size={14} strokeWidth={1.6} />
      </span>
      <Clock class="item-icon" size={14} strokeWidth={1.6} aria-hidden="true" />
      <span class="item-text section-toggle-label">Recent</span>
      {#if notesStore.recentNotes.length > 0}
        <span class="item-badge">{notesStore.recentNotes.length}</span>
      {/if}
    </button>

    {#if notesStore.recentExpanded}
      <div id="recent-list" role="list" aria-label="Recent notes">
        {#if notesStore.hasRecentNotes}
          {#each notesStore.recentNotes as recent (recent.path)}
            <div
              class="sidebar-item sidebar-item-nested group"
              class:selected={notesStore.selectedPath === recent.path}
              class:multi-selected={notesStore.selectedPaths.has(recent.path)}
              onclick={(e) => handleSelectNote(recent.path, e)}
              oncontextmenu={(event) => handleNoteContextMenu(recent, event)}
              onkeydown={(event) => handleNoteRowKeydown(recent.path, event)}
              role="button"
              tabindex="0"
              title={recent.title}
            >
              <FileText class="item-icon-sm" size={14} strokeWidth={1.5} aria-hidden="true" />
              <span class="item-text">{recent.title}</span>
              <button
                type="button"
                class="action-button action-button-danger"
                onclick={(event) => handleDeleteNote(recent, event)}
                aria-label={`Delete ${recent.title}`}
                title="Delete note"
              >
                <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          {/each}
        {:else}
          <div class="sidebar-item-nested empty-recent" role="presentation">
            <span class="empty-recent-text">Notes you open will appear here</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="divider"></div>

  <!-- FAVORITES Section -->
  {#if notesStore.hasFavorites}
    <div class="section-items">
      <button
        type="button"
        class="sidebar-item section-toggle group"
        onclick={() => notesStore.toggleFavoritesExpanded()}
        aria-expanded={notesStore.favoritesExpanded}
        aria-controls="favorites-list"
      >
        <span
          class="chevron-icon"
          class:chevron-open={notesStore.favoritesExpanded}
          aria-hidden="true"
        >
          <ChevronRight size={14} strokeWidth={1.6} />
        </span>
        <Star class="item-icon" size={14} strokeWidth={1.6} aria-hidden="true" />
        <span class="item-text section-toggle-label">Favorites</span>
        <span class="item-badge">{notesStore.favoriteItems.length}</span>
      </button>

      {#if notesStore.favoritesExpanded}
        <div id="favorites-list" role="list" aria-label="Favorite items">
          {#each notesStore.favoriteItems as note (note.favoriteKind + ':' + note.path)}
            <div
              class="sidebar-item sidebar-item-nested group"
              class:selected={note.isFolder ? notesStore.activeFolderPath === note.path : notesStore.selectedPath === note.path}
              class:multi-selected={notesStore.selectedPaths.has(note.path)}
              onclick={(e) => handleSelectFavorite(note, e)}
              oncontextmenu={(event) => handleNoteContextMenu(note, event)}
              onkeydown={(event) => handleFavoriteRowKeydown(note, event)}
              role="button"
              tabindex="0"
              title={note.title}
            >
              {#if note.isFolder}
                <Folder class="item-icon-sm" size={14} strokeWidth={1.5} aria-hidden="true" />
              {:else}
                <FileText class="item-icon-sm" size={14} strokeWidth={1.5} aria-hidden="true" />
              {/if}
              <span class="item-text">{note.title}</span>
              {#if !note.isFolder}
                <button
                  type="button"
                  class="action-button action-button-danger"
                  onclick={(event) => handleDeleteNote(note, event)}
                  aria-label={`Delete ${note.title}`}
                  title="Delete note"
                >
                  <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              {/if}
              <button
                type="button"
                class="action-button"
                onclick={(e) => handleToggleFavorite(note.path, e, note.isFolder ? 'folder' : 'note')}
                aria-label="Remove from favorites"
                title="Remove from favorites"
              >
                <Star size={14} strokeWidth={1.8} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="divider"></div>
  {/if}

  <!-- Tag-first navigation (folders + tags). The outer .sidebar-scroll
       owns vertical overflow now — this wrapper is just a layout box. -->
  <div class="tree-container">
    {#if notesStore.isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
      </div>
    {:else if notesStore.error}
      <div class="error-state">
        <p>{notesStore.error.message}</p>
      </div>
    {:else if !notesStore.hasNotes}
      <div class="empty-sidebar">
        <p>No notes yet</p>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => onCreateNote?.()}
        >
          Create a note
        </button>
      </div>
    {:else}
      <div class="section-header section-header-row">
        <span>FOLDERS</span>
        <div class="section-header-actions">
          <button
            type="button"
            class="section-icon-button"
            onclick={openCreateFolderAtRoot}
            title="New folder at root"
            aria-label="New folder at root"
          >
            <FolderPlus size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="section-icon-button"
            onclick={handleRefreshFolders}
            disabled={folderRefreshInProgress}
            title="Refresh folders"
            aria-label="Refresh folders"
          >
            <span class:spin={folderRefreshInProgress} aria-hidden="true">
              <RefreshCw size={13} strokeWidth={1.8} />
            </span>
          </button>
        </div>
      </div>
      <div class="section-items file-tree" role="tree" aria-label="Folders and notes">
        <FolderTree
          items={notesStore.orderedItems}
          selectedPath={notesStore.selectedPath}
          selectedFolderPath={notesStore.activeFolderPath}
          expandedFolders={notesStore.expandedFolders}
          onSelectNote={handleSelectNote}
          onSelectFolder={handleSelectFolder}
          onToggleFolder={handleToggleFolder}
          onContextMenu={handleNoteContextMenu}
          onRequestCreateFolder={openCreateFolderInside}
          {folderDnd}
          dndState={folderDndState}
        />
      </div>

      <div class="divider compact-divider"></div>

      <div class="section-header">TAGS</div>
      <div class="section-items">
        {#each notesStore.tagGroups as group (group.id)}
          <!-- Tag folder row — chevron toggles, name opens the embedded detail view -->
          <div
            class="tag-folder-row group"
            class:selected={!group.isUntagged && group.tag === notesStore.activeTagView}
          >
            <button
              type="button"
              class="tag-chevron-btn"
              onclick={() => handleToggleTagGroup(group.id)}
              aria-expanded={notesStore.isTagGroupExpanded(group.id)}
              aria-controls={`tag-group-${group.id}`}
              aria-label={notesStore.isTagGroupExpanded(group.id) ? `Collapse ${group.title}` : `Expand ${group.title}`}
              title={notesStore.isTagGroupExpanded(group.id) ? 'Collapse' : 'Expand'}
            >
              <span
                class="chevron-icon"
                class:chevron-open={notesStore.isTagGroupExpanded(group.id)}
                aria-hidden="true"
              >
                <ChevronRight size={14} strokeWidth={1.6} />
              </span>
            </button>

            {#if group.isUntagged}
              <button
                type="button"
                class="tag-name-target"
                onclick={() => handleToggleTagGroup(group.id)}
                onkeydown={(event) => handleTagGroupKeydown(group.id, event)}
                aria-expanded={notesStore.isTagGroupExpanded(group.id)}
                aria-controls={`tag-group-${group.id}`}
              >
                <Folder class="tag-glyph" size={14} strokeWidth={1.6} aria-hidden="true" />
                <span class="item-text">{group.title}</span>
                <span class="item-badge">{group.count}</span>
              </button>
            {:else if group.tag}
              {@const tagName = group.tag}
              <button
                type="button"
                class="tag-name-target"
                aria-pressed={tagName === notesStore.activeTagView}
                onclick={() => handleOpenTagView(tagName)}
                onkeydown={(event) => handleTagViewKeydown(tagName, event)}
                title={`Open ${group.title}`}
                aria-label={`Open ${group.title} detail view`}
              >
                <Hash class="tag-glyph" size={14} strokeWidth={1.6} aria-hidden="true" />
                <span class="item-text">{group.title}</span>
                <span class="item-badge">{group.count}</span>
              </button>
            {/if}

            <button
              type="button"
              class="action-button tag-add-note"
              onclick={(event) => handleCreateNoteInTag(group, event)}
              aria-label={getCreateNoteLabel(group)}
              title={getCreateNoteLabel(group)}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>

          {#if notesStore.isTagGroupExpanded(group.id)}
            <div id={`tag-group-${group.id}`} class="tag-group-notes" role="list" aria-label={`${group.title} notes`}>
              {#each getVisibleTagNotes(group) as note (note.path)}
                <div
                  class="sidebar-item sidebar-item-nested group"
                  class:selected={notesStore.selectedPath === note.path}
                  class:multi-selected={notesStore.selectedPaths.has(note.path)}
                  onclick={(e) => handleSelectNote(note.path, e)}
                  oncontextmenu={(event) => handleNoteContextMenu(note, event)}
                  onkeydown={(event) => handleNoteRowKeydown(note.path, event)}
                  role="button"
                  tabindex="0"
                >
                  <FileText class="item-icon-sm" size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span class="item-text">{note.title}</span>
                  <button
                    type="button"
                    class="action-button action-button-danger"
                    onclick={(event) => handleDeleteNote(note, event)}
                    aria-label={`Delete ${note.title}`}
                    title="Delete note"
                  >
                    <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              {/each}

              {#if group.notes.length > TAG_NOTES_PREVIEW_LIMIT}
                {#if group.isUntagged}
                  <button
                    type="button"
                    class="sidebar-item sidebar-item-nested tag-overflow"
                    onclick={(event) => handleToggleLongTagGroup(group.id, event)}
                  >
                    <span class="item-icon-sm overflow-spacer" aria-hidden="true"></span>
                    <span class="item-text">
                      {isLongTagGroupExpanded(group.id) ? 'Show fewer' : `Show ${getHiddenTagNoteCount(group)} more`}
                    </span>
                  </button>
                {:else if group.tag}
                  {@const tagName = group.tag}
                  <button
                    type="button"
                    class="sidebar-item sidebar-item-nested tag-overflow tag-overflow-link"
                    onclick={() => handleOpenTagView(tagName)}
                    aria-label={`Open ${group.title} to see all ${group.count} notes`}
                  >
                    <span class="item-icon-sm overflow-spacer" aria-hidden="true"></span>
                    <span class="item-text">
                      View all {group.count}
                    </span>
                    <span class="tag-overflow-arrow" aria-hidden="true">→</span>
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  </div><!-- /.sidebar-scroll -->

  <!-- Bottom bar: icon-only dock with tooltips. Keep this OUTSIDE the
       scroll region so it stays pinned to the bottom of the sidebar. -->
  <div class="bottom-bar" role="toolbar" aria-label="Sidebar actions">
    <button
      type="button"
      class="dock-item"
      class:dock-item-active={uiStore.tasksWorkspaceOpen}
      onclick={() => onOpenTasks?.()}
      title={`Tasks${todoStore.stats.open > 0 ? ` (${todoStore.stats.open} open)` : ''} — ⌘⇧T`}
      aria-label={`Tasks, ${todoStore.stats.open} open`}
    >
      <svg class="dock-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      {#if todoStore.stats.open > 0}
        <span class="dock-badge" aria-hidden="true">
          {todoStore.stats.open > 9 ? '9+' : todoStore.stats.open}
        </span>
      {/if}
    </button>
    <a
      href="/trash"
      class="dock-item"
      title="Trash"
      aria-label="Trash"
    >
      <svg class="dock-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
      </svg>
    </a>
    <a
      href="/workspaces"
      class="dock-item"
      title="Workspaces"
      aria-label="Workspaces"
    >
      <Layers class="dock-icon" size={16} strokeWidth={1.5} aria-hidden="true" />
    </a>
    <button
      type="button"
      class="dock-item"
      onclick={() => onOpenSettings?.()}
      title="Settings"
      aria-label="Settings"
    >
      <svg class="dock-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    </button>
  </div>

  <!-- Resize handle -->
  {#if visible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      onmousedown={handleResizeStart}
      ondblclick={handleResizeDoubleClick}
    ></div>
  {/if}

  <!-- Multi-selection bar (Wave 4.3) — appears when paths are selected. -->
  {#if notesStore.hasMultiSelection}
    <div class="selection-bar" role="region" aria-label="Bulk selection">
      {#if bulkTagOpen}
        <span class="selection-prefix">#</span>
        <input
          bind:this={bulkTagInputEl}
          bind:value={bulkTagDraft}
          type="text"
          class="selection-tag-input"
          placeholder="tag-name"
          onkeydown={handleBulkTagKeydown}
          onblur={commitBulkTag}
          autocomplete="off"
          spellcheck="false"
        />
      {:else}
        <span class="selection-count">{notesStore.selectedPaths.size} selected</span>
        <button
          type="button"
          class="selection-action"
          onclick={openBulkTag}
          disabled={bulkTagInProgress}
          title="Add a tag to selected notes (undoable)"
        >
          Tag
        </button>
        <button
          type="button"
          class="selection-action selection-action-danger"
          onclick={handleBulkDelete}
          disabled={bulkDeleteInProgress}
          title="Delete selected (undoable with ⌘⇧Z)"
        >
          {bulkDeleteInProgress ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          class="selection-action"
          onclick={handleClearSelection}
          title="Clear selection"
        >
          Cancel
        </button>
      {/if}
    </div>
  {/if}
</nav>

<style>
  /* ─── Sidebar shell ─── warm sunken surface */
  .sidebar {
    display: flex;
    flex-direction: column;
    position: relative;
    height: 100%;
    flex-shrink: 0;
    background: var(--bg-sidebar);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    transition: width 280ms var(--ease-out-soft);
  }

  .sidebar-visible {
    min-width: 0;
  }

  .sidebar-hidden {
    width: 0 !important;
    pointer-events: none;
  }

  .sidebar > * {
    transition: opacity 220ms var(--ease-out-soft);
  }

  .sidebar-hidden > * {
    opacity: 0;
  }

  /* ─── Workspace identity ─── refined wordmark */
  .workspace-identity {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-height);
    padding: 0 12px 0 14px;
    flex-shrink: 0;
  }

  .workspace-left {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .workspace-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-active) 100%);
    color: var(--text-inverse);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.01em;
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .workspace-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  /* Anchored "V" badge — keeps the gradient styling, adds a subtle hover
     so it reads as the canonical entry-point to /workspaces. */
  .workspace-icon-link {
    text-decoration: none;
    cursor: pointer;
    transition: filter var(--transition-fast), box-shadow var(--transition-fast);
  }

  .workspace-icon-link:hover {
    filter: brightness(1.08);
    box-shadow: 0 1px 3px rgba(20, 19, 16, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  }

  .workspace-icon-link:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* Anchored workspace name — single-workspace mode only. Inherits the
     non-link typography so it doesn't look like a hyperlink. */
  .workspace-name-link {
    text-decoration: none;
    cursor: pointer;
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 -4px;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .workspace-name-link:hover {
    background: var(--bg-hover);
  }

  .workspace-name-link:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .workspace-select {
    max-width: 142px;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    padding: 2px 18px 2px 2px;
    outline: none;
  }

  .workspace-select:hover,
  .workspace-select:focus-visible {
    border-color: var(--border-subtle);
    background: var(--surface-hover);
  }

  .workspace-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .workspace-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .workspace-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .workspace-action-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  .workspace-action-btn.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ─── Search row ─── input-like, not button-like */
  .search-area {
    padding: 0 10px 8px;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px 6px 9px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                box-shadow var(--transition-fast);
    box-shadow: var(--shadow-xs);
  }

  .search-row:hover {
    border-color: var(--border-medium);
    background: var(--bg-card);
  }

  .search-row:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .search-text {
    flex: 1;
    text-align: left;
    font-size: var(--text-small);
    color: var(--text-tertiary);
    letter-spacing: -0.003em;
  }

  .search-kbd {
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 1px 5px;
    border-radius: 4px;
    line-height: 1.4;
    letter-spacing: 0.02em;
  }

  /* ─── Section headers ─── refined eyebrow */
  .section-header {
    padding: 12px 14px 4px;
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-right: 9px;
  }

  .section-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .section-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .section-icon-button:hover:not(:disabled) {
    border-color: var(--border-light);
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .section-icon-button:disabled {
    cursor: default;
    opacity: 0.62;
  }

  .section-icon-button:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -1px;
  }

  .section-icon-button span {
    display: inline-flex;
  }

  .spin {
    animation: spin 800ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Section items */
  .section-items {
    padding: 0 8px 2px;
  }

  .file-tree {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ─── Sidebar item ─── more breathable, with proper hover */
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-size: var(--text-small);
    font-family: inherit;
    line-height: 1.45;
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: none;
    letter-spacing: -0.003em;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .sidebar-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sidebar-item:focus-visible {
    background: var(--bg-hover);
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  .sidebar-item.selected {
    background: var(--bg-card);
    color: var(--text-primary);
    font-weight: 500;
    box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--border-light);
  }

  /* ─── Multi-select highlight (Wave 4.3) ─── */
  .sidebar-item.multi-selected {
    background: var(--accent-light);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  /* When both single-selected and multi-selected (current note is in the
   * multi-selection bag) — accent wins. */
  .sidebar-item.selected.multi-selected {
    background: var(--accent-light);
    box-shadow: inset 0 0 0 1px var(--accent-primary), var(--shadow-xs);
  }

  .sidebar-item-nested {
    padding-left: 28px;
  }

  /* ─── Section toggle ─── header rows that expand/collapse a list (Recent, Favorites) */
  .section-toggle {
    gap: 6px;
    color: var(--text-secondary);
  }

  .section-toggle .item-text {
    font-weight: 500;
    letter-spacing: -0.005em;
  }

  .section-toggle :global(.item-icon) {
    color: var(--text-tertiary);
  }

  .section-toggle:hover :global(.item-icon) {
    color: var(--text-secondary);
  }

  /* The chevron sits in front of the section icon — keep it muted and
     rotate when expanded (matches tag-folder-row behaviour) */
  .section-toggle .chevron-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    margin-right: -2px;
  }

  /* ─── Empty Recent state ─── soft placeholder when the user has not opened anything */
  .empty-recent {
    padding: 4px 8px 8px 28px;
    pointer-events: none;
  }

  .empty-recent-text {
    color: var(--text-tertiary);
    font-size: 11.5px;
    line-height: 1.4;
    letter-spacing: -0.003em;
  }

  /* ─── Tag folder row ─── chevron toggles, name links ────────────────── */
  .tag-folder-row {
    display: flex;
    align-items: center;
    gap: 0;
    width: 100%;
    margin-top: 1px;
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
  }

  .tag-folder-row:hover {
    background: var(--bg-hover);
  }

  .tag-folder-row.selected {
    background: var(--bg-card);
    box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--border-light);
  }

  .tag-folder-row.selected .tag-name-target {
    color: var(--text-primary);
    font-weight: 500;
  }

  .tag-folder-row.selected :global(.tag-glyph) {
    color: var(--accent-primary);
  }

  /* Chevron button — minimal, just a hit target for the rotation */
  .tag-chevron-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 26px;
    padding: 0;
    margin-left: 2px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tag-chevron-btn:hover {
    background: rgba(28, 27, 24, 0.06);
    color: var(--text-secondary);
  }

  .tag-chevron-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  /* Tag name — link (or button for untagged) — primary click target */
  .tag-name-target {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 6px 5px 4px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--text-small);
    line-height: 1.45;
    letter-spacing: -0.003em;
    text-align: left;
    text-decoration: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .tag-name-target:hover {
    color: var(--text-primary);
  }

  .tag-name-target:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  /* Lucide icons render their own SVG, so scope-piercing :global() lets
   * our scoped CSS reach the underlying element. */
  :global(.tag-glyph) {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: color var(--transition-fast);
  }

  .tag-name-target:hover :global(.tag-glyph) {
    color: var(--accent-primary);
  }

  .tag-folder-row .item-text {
    flex: 1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
  }

  .tag-folder-row .item-badge {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    padding: 0 5px;
    background: rgba(28, 27, 24, 0.04);
    border-radius: var(--radius-full);
    line-height: 16px;
    min-width: 18px;
    text-align: center;
    transition: background var(--transition-fast);
  }

  .tag-folder-row:hover .item-badge {
    background: var(--bg-card);
  }

  .tag-group-notes {
    padding: 1px 0 3px;
  }

  .tag-add-note {
    margin-right: 4px;
    margin-left: -2px;
  }

  /* Overflow row — inline toggle (untagged) or link to tag detail page */
  .tag-overflow {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .tag-overflow-link {
    color: var(--text-tertiary);
    text-decoration: none;
  }

  .tag-overflow-link:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }

  .tag-overflow-link .tag-overflow-arrow {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
    transition: transform var(--transition-fast), color var(--transition-fast);
  }

  .tag-overflow-link:hover .tag-overflow-arrow {
    color: var(--accent-primary);
    transform: translateX(2px);
  }

  .overflow-spacer {
    display: inline-block;
    width: 14px;
    height: 14px;
  }

  /* Icons (item-icon-sm targets the inline span/spacer; the lucide-svelte
     <Clock/Star/etc> icons inherit color from the parent .sidebar-item). */
  .item-icon-sm {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: color var(--transition-fast);
  }

  .sidebar-item:hover .item-icon-sm {
    color: var(--text-secondary);
  }

  /* Chevron rotation */
  .chevron-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    transition: transform var(--transition-fast);
    color: var(--text-muted);
  }

  .chevron-open {
    transform: rotate(90deg);
  }

  /* Item text */
  .item-text {
    flex: 1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Item badge — pill */
  .item-badge {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    padding: 0 5px;
    background: var(--bg-hover);
    border-radius: var(--radius-full);
    line-height: 16px;
    min-width: 18px;
    text-align: center;
  }

  /* Action button (hover-reveal) */
  .action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-xs);
    cursor: pointer;
    opacity: 0;
    transition: background var(--transition-fast), opacity var(--transition-fast),
                color var(--transition-fast);
  }

  .group:hover .action-button,
  .group:focus-within .action-button {
    opacity: 1;
  }

  .action-button:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .action-button-danger:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  /* Section divider */
  .divider {
    margin: 8px 14px;
    border-top: 1px solid var(--border-light);
  }

  .compact-divider {
    margin: 8px 8px 5px;
  }

  /* ─── Single scroll region for all content ─────────────────────────
     RECENT, FAVORITES, FOLDERS, and TAGS all live inside this wrapper so
     the scrollbar sits at the sidebar's right edge — not nested half-way
     down. The bottom dock stays outside this element. */
  .sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* Tree container — now purely a layout box; the .sidebar-scroll parent
     owns vertical overflow. */
  .tree-container {
    flex: 1 0 auto;
    padding: 0 4px 6px;
    min-height: 0;
  }

  .tree-container .section-header {
    padding: 8px 6px 3px;
  }

  .tree-container .section-header-row {
    padding-right: 2px;
  }

  .tree-container .section-icon-button {
    width: 18px;
    height: 18px;
  }

  .tree-container .section-items {
    padding: 0 2px 1px;
  }

  /* States */
  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 0;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--border-medium);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: var(--text-small);
    margin: 4px 0;
  }

  .empty-sidebar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    gap: 14px;
  }

  /* ─── Bottom dock ─── icon-only with tooltips ────────────────────── */
  .bottom-bar {
    flex-shrink: 0;
    border-top: 1px solid var(--border-light);
    padding: 6px 8px;
    display: flex;
    justify-content: space-around;
    align-items: center;
    gap: 4px;
    background: var(--bg-sidebar);
  }

  .dock-item {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .dock-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dock-item:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
    color: var(--text-primary);
  }

  .dock-item-active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--border-light);
  }

  .dock-icon {
    color: inherit;
    flex-shrink: 0;
  }

  /* Tasks count overlay — small pill at the dock item's top-right. */
  .dock-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    background: var(--accent-primary);
    color: var(--text-inverse, #fff);
    font-size: 9.5px;
    font-weight: 600;
    line-height: 15px;
    text-align: center;
    border-radius: 9999px;
    box-shadow: 0 0 0 1.5px var(--bg-sidebar);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    pointer-events: none;
  }

  /* ─── Selection bar (Wave 4.3) ─── */
  .selection-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-card);
    border-top: 1px solid var(--border-light);
    box-shadow: 0 -2px 8px rgba(20, 19, 16, 0.04);
    flex-shrink: 0;
  }

  .selection-count {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .selection-action {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .selection-action:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .selection-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .selection-action-danger {
    border-color: var(--color-error);
    background: var(--color-error);
    color: var(--text-inverse, #fff);
  }

  .selection-action-danger:hover:not(:disabled) {
    background: var(--color-error);
    filter: brightness(0.92);
    color: var(--text-inverse, #fff);
  }

  .selection-prefix {
    color: var(--accent-primary);
    font-weight: 600;
    font-size: 13px;
  }

  .selection-tag-input {
    flex: 1;
    border: 1px solid var(--border-medium);
    background: var(--bg-app);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .selection-tag-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px var(--accent-light);
  }

/* Resize handle */
  .resize-handle {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    background: transparent;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    left: 2px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background var(--transition-fast) 120ms;
  }

  .resize-handle:hover::after {
    background: var(--accent-primary);
    opacity: 0.45;
  }

  .resize-handle:active::after {
    background: var(--accent-primary);
    opacity: 0.7;
  }
</style>
