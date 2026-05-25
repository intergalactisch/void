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
  }

  let { path, title, isFolder = false, position, onClose, onRequestDeleteNote, onRequestCreateFolder, onRequestDeleteFolder }: Props = $props();

  let menuElement: HTMLDivElement | undefined = $state(undefined);
  let selectedIndex = $state(0);
  let isRenaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state(undefined);

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
    destructive?: boolean;
    disabled?: boolean;
  }

  const menuItems = $derived<MenuItem[]>(
    isFolder
      ? [
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

  onMount(() => {
    menuElement?.focus();
  });

  async function handleAction(id: string) {
    const selected = menuItems.find((item) => item.id === id);
    if (!selected || selected.id.startsWith('separator') || selected.disabled) return;

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

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = nextSelectableIndex(selectedIndex, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = nextSelectableIndex(selectedIndex, -1);
        break;
      case 'Enter': {
        event.preventDefault();
        const item = menuItems[selectedIndex];
        if (item) handleAction(item.id);
        break;
      }
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }

  function nextSelectableIndex(current: number, delta: 1 | -1): number {
    let next = current;
    for (let i = 0; i < menuItems.length; i++) {
      next = Math.max(0, Math.min(menuItems.length - 1, next + delta));
      const item = menuItems[next];
      if (item && !item.id.startsWith('separator') && !item.disabled) {
        return next;
      }
      if (next === 0 || next === menuItems.length - 1) break;
    }
    return current;
  }
</script>

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
            type="button"
            class="context-menu-item"
            class:is-selected={idx === selectedIndex}
            class:is-destructive={item.destructive}
            class:is-disabled={item.disabled}
            role="menuitem"
            disabled={item.disabled}
            onclick={() => handleAction(item.id)}
            onmouseenter={() => { selectedIndex = idx; }}
          >
            <span class="context-menu-label">{item.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 220px;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-light);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-popover);
    overflow: hidden;
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
    transition: background var(--transition-fast), color var(--transition-fast);
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

  .context-menu-item.is-disabled:hover,
  .context-menu-item.is-disabled.is-selected {
    background: transparent;
  }

  .context-menu-separator {
    height: 1px;
    margin: 5px 6px;
    background: var(--border-light);
  }

  .context-menu-label {
    flex: 1;
    font-size: var(--text-small);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: -0.003em;
    transition: color var(--transition-fast);
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
