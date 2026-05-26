<script lang="ts">
  /**
   * NoteContextMenu - Right-click context menu for sidebar notes
   *
   * Provides note-level operations:
   * - Rename
   * - Duplicate
   * - Add/Remove from Favorites
   * - Delete
   */

  import { onMount } from 'svelte';
  import { notesStore, toastStore } from '$lib/stores';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { FileSearch, FolderOpen, PanelRight, Rows3 } from '@lucide/svelte';

  export interface NoteContextMenuLayoutDescriptor {
    tabId: string;
    title: string;
    isActive: boolean;
    paneCount: number;
  }

  export interface NoteContextMenuPaneTarget {
    tabId: string;
    paneId: string;
    title: string;
    meta: string;
  }

  export interface NoteContextMenuOpenState {
    isOpen: boolean;
    canOpenInSplit: boolean;
    canOpenInNewLayout: boolean;
    canOpenFolderAsLayout: boolean;
    folderLayoutNoteCount: number;
  }

  interface Props {
    /** Path of the note or folder */
    path: string;
    /** Title of the note or folder */
    title: string;
    /** Whether this menu is for a folder row */
    isFolder?: boolean;
    /** Screen position for the menu */
    position: { x: number; y: number };
    /** Callback to close the menu */
    onClose: () => void;
    /** Callback to request deletion of the note */
    onRequestDeleteNote?: (path: string, title: string) => void;
    /** Callback to request opening the create-folder modal with this path as parent */
    onRequestCreateFolder?: (parentPath: string) => void;
    /** Callback to request deletion of a folder. Layout shows the confirm dialog. */
    onRequestDeleteFolder?: (path: string, title: string) => void;
    /** Focus the already-open note pane/tab (note rows only) */
    onFocusOpenNote?: (path: string) => void;
    /** Open the note as a standalone tab */
    onOpenInNewTab?: (path: string) => void;
    /** Open the note in a new split */
    onOpenInSplit?: (path: string, direction: 'right' | 'bottom') => void;
    /** Append the note to a named multi-pane layout */
    onOpenInExistingLayout?: (path: string, targetTabId: string) => void;
    /** Open this note with the active note in a fresh layout */
    onOpenInNewLayout?: (path: string) => void;
    /** Open the note beside a specific existing pane (split right) */
    onOpenInPane?: (path: string, tabId: string, paneId: string) => void;
    /** Open a folder's notes as a fresh multi-pane layout */
    onOpenFolderAsLayout?: (path: string) => void;
    /** State-aware open affordances for the selected note/folder */
    openState?: NoteContextMenuOpenState;
    /** Available pane targets grouped by existing multi-pane layout */
    layoutTargets?: NoteContextMenuLayoutDescriptor[];
    /** Every open pane (across tabs) the note can be placed next to */
    paneTargets?: NoteContextMenuPaneTarget[];
  }

  let {
    path,
    title,
    isFolder = false,
    position,
    onClose,
    onRequestDeleteNote,
    onRequestCreateFolder,
    onRequestDeleteFolder,
    onFocusOpenNote,
    onOpenInNewTab,
    onOpenInSplit,
    onOpenInExistingLayout,
    onOpenInNewLayout,
    onOpenInPane,
    onOpenFolderAsLayout,
    openState = {
      isOpen: false,
      canOpenInSplit: false,
      canOpenInNewLayout: false,
      canOpenFolderAsLayout: false,
      folderLayoutNoteCount: 0,
    },
    layoutTargets = [],
    paneTargets = [],
  }: Props = $props();

  let menuElement: HTMLDivElement | undefined = $state(undefined);
  let selectedIndex = $state(0);
  let isRenaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state(undefined);
  let openSubmenuId = $state<string | null>(null);
  let submenuSelectedIndex = $state(0);
  let submenuFlipLeft = $state(false);
  let parentItemRefs: Record<string, HTMLButtonElement | undefined> = {};

  // Viewport-aware positioning. The menu mounts hidden, measures itself in
  // an effect, then flips to a side that stays inside the window.
  let resolvedPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let positionReady = $state(false);

  $effect(() => {
    if (!menuElement) return;
    const margin = 8;
    const width = menuElement.offsetWidth;
    const height = menuElement.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + width > viewportW - margin) {
      x = position.x - width;
    }
    x = Math.max(margin, Math.min(viewportW - width - margin, x));

    if (y + height > viewportH - margin) {
      y = position.y - height;
    }
    y = Math.max(margin, Math.min(viewportH - height - margin, y));

    resolvedPos = { x, y };
    positionReady = true;
  });

  const favoriteKind = $derived(isFolder ? 'folder' : 'note');
  const isFavorite = $derived(notesStore.isFavorite(path, favoriteKind));
  const canMoveUp = $derived(isFolder && notesStore.canMoveFolder(path, 'up'));
  const canMoveDown = $derived(isFolder && notesStore.canMoveFolder(path, 'down'));

  interface MenuItem {
    id: string;
    label: string;
    icon?: 'focus' | 'new-tab' | 'split-right' | 'split-down' | 'layout' | 'folder-layout';
    destructive?: boolean;
    disabled?: boolean;
    heading?: boolean;
    meta?: string;
    /** Sub-items rendered as a submenu when this item is highlighted. */
    children?: MenuItem[];
    /** When set, this item targets a specific existing layout tab. */
    targetTabId?: string;
    /** When set (with targetTabId), this item targets a specific pane. */
    targetPaneId?: string;
  }

  const existingLayoutChildren = $derived.by<MenuItem[]>(() => {
    if (isFolder || !onOpenInExistingLayout) return [];
    return layoutTargets.map((layout) => ({
      id: `open-in-layout:${layout.tabId}`,
      label: layout.title,
      icon: 'layout',
      targetTabId: layout.tabId,
      meta: `${layout.paneCount} pane${layout.paneCount === 1 ? '' : 's'}${layout.isActive ? ' - active' : ''}`,
    }));
  });

  const paneTargetChildren = $derived.by<MenuItem[]>(() => {
    if (isFolder || !onOpenInPane) return [];
    return paneTargets.map((target) => ({
      id: `open-in-pane:${target.tabId}:${target.paneId}`,
      label: target.title,
      icon: 'split-right',
      meta: target.meta,
      targetTabId: target.tabId,
      targetPaneId: target.paneId,
    }));
  });

  const paneActionItems = $derived.by<MenuItem[]>(() => {
    if (isFolder) {
      if (!onOpenFolderAsLayout) return [];
      return [
        {
          id: 'open-folder-layout',
          label: 'Open Folder as Layout',
          icon: 'folder-layout',
          disabled: !openState.canOpenFolderAsLayout,
        },
        { id: 'separator0', label: '' },
      ];
    }
    const items: MenuItem[] = [];
    if (openState.isOpen) {
      if (onFocusOpenNote) items.push({ id: 'focus-open-note', label: 'Focus Open Note', icon: 'focus' });
    } else {
      if (onOpenInNewTab) items.push({ id: 'open-new-tab', label: 'Open in New Tab', icon: 'new-tab' });
      if (onOpenInSplit && openState.canOpenInSplit) {
        items.push({ id: 'split-right', label: 'Open in Split Right', icon: 'split-right' });
        items.push({ id: 'split-down', label: 'Open in Split Down', icon: 'split-down' });
      }
      if (existingLayoutChildren.length > 0) {
        items.push({
          id: 'open-existing-layout',
          label: 'Open in Existing Layout',
          icon: 'layout',
          children: existingLayoutChildren,
        });
      }
      if (paneTargetChildren.length > 0) {
        items.push({
          id: 'open-in-pane',
          label: 'Open in Pane',
          icon: 'split-right',
          children: paneTargetChildren,
        });
      }
      if (onOpenInNewLayout && openState.canOpenInNewLayout) {
        items.push({ id: 'open-new-layout', label: 'Open in New Layout', icon: 'layout' });
      }
    }
    if (items.length > 0) items.push({ id: 'separator0', label: '' });
    return items;
  });

  const menuItems = $derived<MenuItem[]>(
    isFolder
      ? [
          ...paneActionItems,
          { id: 'create-note', label: 'Create New Note' },
          { id: 'create-folder', label: 'Create Subfolder' },
          { id: 'separator', label: '' },
          { id: 'favorite', label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites' },
          { id: 'move-up', label: 'Move Folder Up', disabled: !canMoveUp },
          { id: 'move-down', label: 'Move Folder Down', disabled: !canMoveDown },
          { id: 'separator2', label: '' },
          { id: 'rename', label: 'Rename Folder' },
          { id: 'copy-ref', label: 'Copy Ref' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'separator3', label: '' },
          { id: 'delete', label: 'Delete Folder', destructive: true },
        ]
      : [
          ...paneActionItems,
          { id: 'rename', label: 'Rename' },
          { id: 'duplicate', label: 'Duplicate' },
          { id: 'favorite', label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites' },
          { id: 'separator', label: '' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'copy-ref', label: 'Copy Ref' },
          { id: 'separator2', label: '' },
          { id: 'delete', label: 'Move to Trash', destructive: true },
        ]
  );

  $effect(() => {
    const selected = menuItems[selectedIndex];
    if (!selected || selected.id.startsWith('separator') || selected.disabled) {
      selectedIndex = firstSelectableIndex(menuItems);
    }
    if (openSubmenuId && !menuItems.some((item) => item.id === openSubmenuId)) {
      closeSubmenu();
    }
  });

  onMount(() => {
    selectedIndex = firstSelectableIndex(menuItems);
    menuElement?.focus();
  });

  async function handleAction(id: string) {
    const selected = findMenuItem(id);
    if (!selected || selected.id.startsWith('separator') || selected.disabled) return;

    if (selected.children && selected.children.length > 0) {
      openSubmenu(selected.id);
      return;
    }

    if (id === 'focus-open-note') {
      onFocusOpenNote?.(path);
      onClose();
      return;
    }
    if (id === 'open-new-tab') {
      onOpenInNewTab?.(path);
      onClose();
      return;
    }
    if (id === 'split-right') {
      onOpenInSplit?.(path, 'right');
      onClose();
      return;
    }
    if (id === 'split-down') {
      onOpenInSplit?.(path, 'bottom');
      onClose();
      return;
    }
    if (selected.id.startsWith('open-in-layout:') && selected.targetTabId) {
      onOpenInExistingLayout?.(path, selected.targetTabId);
      onClose();
      return;
    }
    if (selected.id.startsWith('open-in-pane:') && selected.targetTabId && selected.targetPaneId) {
      onOpenInPane?.(path, selected.targetTabId, selected.targetPaneId);
      onClose();
      return;
    }
    if (id === 'open-new-layout') {
      onOpenInNewLayout?.(path);
      onClose();
      return;
    }
    if (id === 'open-folder-layout') {
      onOpenFolderAsLayout?.(path);
      onClose();
      return;
    }

    switch (id) {
      case 'create-note': {
        const doc = await notesStore.createQuickNote(path);
        if (doc) {
          toastStore.success('Note created');
        } else {
          toastStore.error(notesStore.error?.message ?? 'Could not create note');
        }
        break;
      }
      case 'create-folder':
        onRequestCreateFolder?.(path);
        break;
      case 'rename':
        isRenaming = true;
        renameValue = title;
        requestAnimationFrame(() => {
          renameInput?.focus();
          renameInput?.select();
        });
        return; // Don't close yet
      case 'delete':
        if (isFolder) {
          onRequestDeleteFolder?.(path, title);
        } else {
          onRequestDeleteNote?.(path, title);
        }
        break;
      case 'duplicate':
        try {
          const dupResult = await notesStore.duplicateNote(path);
          if (dupResult) {
            toastStore.success('Note duplicated');
          }
        } catch {
          toastStore.error('Failed to duplicate note');
        }
        break;
      case 'favorite':
        notesStore.toggleFavorite(path, favoriteKind);
        toastStore.info(isFavorite ? 'Removed from favorites' : 'Added to favorites');
        break;
      case 'move-up':
        if (await notesStore.moveFolder(path, 'up')) {
          toastStore.info('Folder moved up');
        }
        break;
      case 'move-down':
        if (await notesStore.moveFolder(path, 'down')) {
          toastStore.info('Folder moved down');
        }
        break;
      case 'copy-path':
        try {
          await navigator.clipboard.writeText(path);
          toastStore.info('Path copied');
        } catch {
          toastStore.error('Failed to copy path');
        }
        break;
      case 'copy-ref': {
        const refId = isFolder
          ? buildRefId({ kind: 'folder', folderPath: path })
          : buildRefId({ kind: 'note', notePath: path });
        const success = await copyTextToClipboard(refId);
        if (success) {
          toastStore.info('Ref copied');
        } else {
          toastStore.error('Failed to copy ref');
        }
        break;
      }
    }
    onClose();
  }

  async function handleRenameSubmit() {
    const newTitle = renameValue.trim();
    if (newTitle && newTitle !== title) {
      if (isFolder) {
        const newPath = await notesStore.renameFolder(path, newTitle);
        if (newPath) {
          toastStore.success('Folder renamed');
        } else {
          toastStore.error(notesStore.error?.message ?? 'Failed to rename folder');
        }
      } else {
        const newPath = await notesStore.renameNote(path, newTitle);
        if (newPath) {
          toastStore.success('Note renamed');
        }
      }
    }
    onClose();
  }

  function handleRenameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (isRenaming) return;

    const submenuItems = activeSubmenuItems;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (submenuItems) {
          submenuSelectedIndex = nextSelectableIndex(submenuItems, submenuSelectedIndex, 1);
        } else {
          selectedIndex = nextSelectableIndex(menuItems, selectedIndex, 1);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (submenuItems) {
          submenuSelectedIndex = nextSelectableIndex(submenuItems, submenuSelectedIndex, -1);
        } else {
          selectedIndex = nextSelectableIndex(menuItems, selectedIndex, -1);
        }
        break;
      case 'ArrowRight': {
        const parent = menuItems[selectedIndex];
        if (!submenuItems && parent?.children?.length) {
          event.preventDefault();
          openSubmenu(parent.id);
        }
        break;
      }
      case 'ArrowLeft':
        if (submenuItems) {
          event.preventDefault();
          closeSubmenu();
        }
        break;
      case 'Enter': {
        event.preventDefault();
        if (submenuItems) {
          const child = submenuItems[submenuSelectedIndex];
          if (child) handleAction(child.id);
        } else {
          const item = menuItems[selectedIndex];
          if (item) handleAction(item.id);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  }

  function nextSelectableIndex(items: MenuItem[], current: number, delta: 1 | -1): number {
    let next = current;
    for (let i = 0; i < items.length; i++) {
      next = Math.max(0, Math.min(items.length - 1, next + delta));
      const item = items[next];
      if (item && !item.id.startsWith('separator') && !item.disabled) {
        return next;
      }
      if (next === 0 || next === items.length - 1) break;
    }
    return current;
  }

  function firstSelectableIndex(items: MenuItem[]): number {
    const idx = items.findIndex((item) => !item.id.startsWith('separator') && !item.disabled);
    return Math.max(0, idx);
  }

  function findMenuItem(id: string): MenuItem | undefined {
    for (const item of menuItems) {
      if (item.id === id) return item;
      if (item.children) {
        const child = item.children.find((c) => c.id === id);
        if (child) return child;
      }
    }
    return undefined;
  }

  const activeSubmenuItems = $derived.by<MenuItem[] | null>(() => {
    if (!openSubmenuId) return null;
    const parent = menuItems.find((item) => item.id === openSubmenuId);
    return parent?.children?.length ? parent.children : null;
  });

  function openSubmenu(id: string) {
    const parent = menuItems.find((item) => item.id === id);
    if (!parent?.children?.length) return;
    openSubmenuId = id;
    submenuSelectedIndex = parent.children.findIndex(
      (child) => !child.id.startsWith('separator') && !child.disabled,
    );
    if (submenuSelectedIndex < 0) submenuSelectedIndex = 0;
    const triggerRect = parentItemRefs[id]?.getBoundingClientRect();
    const menuRect = menuElement?.getBoundingClientRect();
    if (triggerRect && menuRect) {
      const submenuWidth = 260;
      submenuFlipLeft =
        triggerRect.right + submenuWidth + 8 > window.innerWidth &&
        menuRect.left - submenuWidth - 8 >= 0;
    }
  }

  function closeSubmenu() {
    openSubmenuId = null;
    submenuSelectedIndex = 0;
    submenuFlipLeft = false;
  }

  function handleParentHover(item: MenuItem, idx: number) {
    selectedIndex = idx;
    if (item.children?.length) {
      openSubmenu(item.id);
    } else if (openSubmenuId) {
      closeSubmenu();
    }
  }

  function submenuOffsetTop(id: string): number {
    const triggerRect = parentItemRefs[id]?.getBoundingClientRect();
    const menuRect = menuElement?.getBoundingClientRect();
    if (!triggerRect || !menuRect) return 0;
    return triggerRect.top - menuRect.top;
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40"
  role="presentation"
  onclick={() => onClose()}
  onkeydown={handleKeyDown}
></div>

<!-- Menu popup -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={menuElement}
  class="context-menu"
  style="top: {resolvedPos.y}px; left: {resolvedPos.x}px; visibility: {positionReady ? 'visible' : 'hidden'};"
  role="menu"
  aria-label={isFolder ? 'Folder options' : 'Note options'}
  tabindex="0"
  onkeydown={handleKeyDown}
>
  {#if isRenaming}
    <div class="rename-form">
      <input
        bind:this={renameInput}
        bind:value={renameValue}
        class="rename-input"
        type="text"
        onkeydown={handleRenameKeyDown}
        onblur={handleRenameSubmit}
        placeholder="Note title"
      />
    </div>
  {:else}
    <div class="context-menu-list">
      {#each menuItems as item, idx}
        {#if item.id.startsWith('separator')}
          <div class="context-menu-separator" role="separator"></div>
        {:else}
          <button
            bind:this={parentItemRefs[item.id]}
            type="button"
            class="context-menu-item"
            class:is-selected={idx === selectedIndex}
            class:is-destructive={item.destructive}
            class:is-disabled={item.disabled}
            class:is-heading={item.heading}
            class:has-submenu={!!item.children?.length}
            role="menuitem"
            aria-haspopup={item.children?.length ? 'menu' : undefined}
            aria-expanded={item.children?.length ? openSubmenuId === item.id : undefined}
            disabled={item.disabled}
            onclick={() => handleAction(item.id)}
            onmouseenter={() => handleParentHover(item, idx)}
          >
            {#if item.icon === 'focus' || item.icon === 'new-tab'}
              <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
            {:else if item.icon === 'split-right'}
              <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
            {:else if item.icon === 'split-down'}
              <Rows3 size={14} strokeWidth={1.8} aria-hidden="true" />
            {:else if item.icon === 'layout'}
              <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
            {:else if item.icon === 'folder-layout'}
              <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
            {/if}
            <span class="context-menu-label">{item.label}</span>
            {#if item.meta}
              <span class="context-menu-meta">{item.meta}</span>
            {/if}
            {#if item.children?.length}
              <span class="context-menu-chevron" aria-hidden="true">›</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>

    {#if activeSubmenuItems && openSubmenuId}
      <div
        class="context-submenu"
        class:flip-left={submenuFlipLeft}
        style="top: {submenuOffsetTop(openSubmenuId)}px;"
        role="menu"
        aria-label="Layout targets"
      >
        <div class="context-menu-list">
          {#each activeSubmenuItems as child, childIdx}
            {#if child.id.startsWith('separator')}
              <div class="context-menu-separator" role="separator"></div>
            {:else}
              <button
                type="button"
                class="context-menu-item"
                class:is-selected={childIdx === submenuSelectedIndex}
                class:is-disabled={child.disabled}
                class:is-heading={child.heading}
                role="menuitem"
                disabled={child.disabled}
                onclick={() => handleAction(child.id)}
                onmouseenter={() => { submenuSelectedIndex = childIdx; }}
              >
                {#if child.icon === 'focus' || child.icon === 'new-tab'}
                  <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
                {:else if child.icon === 'split-right'}
                  <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
                {:else if child.icon === 'split-down'}
                  <Rows3 size={14} strokeWidth={1.8} aria-hidden="true" />
                {:else if child.icon === 'layout'}
                  <PanelRight size={14} strokeWidth={1.8} aria-hidden="true" />
                {:else if child.icon === 'folder-layout'}
                  <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
                {/if}
                <span class="context-menu-label">{child.label}</span>
                {#if child.meta}
                  <span class="context-menu-meta">{child.meta}</span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 244px;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-light);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-popover);
    animation: context-menu-in 160ms var(--ease-out-soft);
    transform-origin: top left;
    outline: none;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  @keyframes context-menu-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(-2px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .context-menu-list {
    padding: 5px;
  }

  .context-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    text-align: left;
    color: var(--text-primary);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: inherit;
  }

  .context-menu-item :global(svg) {
    flex: 0 0 auto;
    color: var(--text-tertiary);
  }

  .context-menu-item:hover {
    background-color: var(--bg-hover);
  }

  .context-menu-item.is-selected {
    background-color: var(--accent-light);
  }

  .context-menu-item.is-selected .context-menu-label {
    color: var(--accent-primary);
  }

  .context-menu-meta {
    margin-left: auto;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    white-space: nowrap;
  }

  .context-menu-item.is-destructive .context-menu-label {
    color: var(--color-error);
  }

  .context-menu-item.is-destructive.is-selected {
    background-color: var(--color-error-bg);
  }

  .context-menu-item.is-destructive.is-selected .context-menu-label {
    color: var(--color-error);
  }

  .context-menu-item.is-disabled {
    cursor: default;
  }

  .context-menu-item.is-disabled .context-menu-label {
    color: var(--text-placeholder);
  }

  .context-menu-item.is-heading {
    min-height: 24px;
    padding-top: 4px;
    padding-bottom: 3px;
    cursor: default;
  }

  .context-menu-item.is-heading .context-menu-label {
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    font-weight: 650;
    text-transform: uppercase;
  }

  .context-menu-item.is-disabled:hover,
  .context-menu-item.is-disabled.is-selected {
    background: transparent;
  }

  .context-menu-separator {
    height: 1px;
    margin: 5px 6px;
    background: var(--border-light);
  }

  .context-menu-chevron {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
  }

  .context-menu-item.is-selected .context-menu-chevron {
    color: var(--accent-primary);
  }

  .context-submenu {
    position: absolute;
    left: calc(100% + 4px);
    width: 260px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-light);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-popover);
    overflow: hidden;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    animation: context-menu-in 120ms var(--ease-out-soft);
    transform-origin: top left;
    z-index: 1;
  }

  .context-submenu.flip-left {
    left: auto;
    right: calc(100% + 4px);
  }

  .context-menu-label {
    flex: 1;
    font-size: var(--text-small);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: 0;
  }

  .rename-form {
    padding: 6px;
  }

  .rename-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-medium);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--text-small);
    font-family: inherit;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .rename-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
