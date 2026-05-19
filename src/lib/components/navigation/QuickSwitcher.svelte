<script lang="ts">
  /**
   * QuickSwitcher - Modal overlay for quick note navigation
   *
   * A command palette style modal activated by Cmd+P that provides:
   * - Search input for fuzzy finding notes
   * - Recent notes shown by default
   * - Keyboard navigation (up/down arrows)
   * - Click or Enter to select
   * - Escape to close
   * - Focus trap (WCAG 2.1 compliant)
   */

  import { notesStore } from '$lib/stores';
  import type { NotesListItem, TagGroup } from '$lib/ports/inbound';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { formatRelativeDate } from '$lib/utils/relativeDate';
  import { events } from '$lib/events';

  /** A command entry for the palette */
  interface PaletteCommand {
    id: string;
    label: string;
    shortcut?: string;
    action: () => void;
  }

  interface Props {
    /** Whether the quick switcher is open */
    isOpen?: boolean;
    /** Callback when a note is selected */
    onSelect?: (path: string) => void;
    /** Callback when the switcher should close */
    onClose?: () => void;
    /** Available commands for > prefix mode */
    commands?: PaletteCommand[];
  }

  let { isOpen = false, onSelect, onClose, commands = [] }: Props = $props();

  /** Search query */
  let query = $state('');

  /** Selected index for keyboard navigation */
  let selectedIndex = $state(0);

  /** Reference to the input element */
  let inputRef: HTMLInputElement | null = $state(null);

  /** Reference to the list container for scrolling */
  let listRef: HTMLDivElement | null = $state(null);

  /** Reference to the dialog window for focus trapping */
  let dialogRef: HTMLDivElement | null = $state(null);

  /** Focus trap cleanup function */
  let focusTrapCleanup: (() => void) | null = null;

  /**
   * Get all notes (flattened from the store).
   */
  let allNotes = $derived(notesStore.allNotes);

  /**
   * Get recent notes - sorted by modification date.
   * Shows the 10 most recently modified notes when no search query.
   */
  let recentNotes = $derived.by(() => {
    return [...allNotes]
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
      .slice(0, 10);
  });

  /**
   * Fuzzy search notes by title.
   * Simple case-insensitive substring match.
   */
  function fuzzyMatch(note: NotesListItem, searchQuery: string): boolean {
    const normalizedQuery = searchQuery.toLowerCase();
    const normalizedTitle = note.title.toLowerCase();

    // Check if all characters in query appear in order
    let queryIndex = 0;
    for (let i = 0; i < normalizedTitle.length && queryIndex < normalizedQuery.length; i++) {
      if (normalizedTitle[i] === normalizedQuery[queryIndex]) {
        queryIndex++;
      }
    }

    return queryIndex === normalizedQuery.length;
  }

  /** Mode prefixes — exclusive: only one matches at a time. */
  let isCommandMode = $derived(query.startsWith('>'));
  let isTagMode = $derived(query.startsWith('#'));

  /** Command search query (without the > prefix) */
  let commandQuery = $derived(isCommandMode ? query.slice(1).trim().toLowerCase() : '');

  /** Tag search query (without the # prefix) */
  let tagQuery = $derived(isTagMode ? query.slice(1).trim().toLowerCase() : '');

  /** Filtered commands based on search query */
  let filteredCommands = $derived.by(() => {
    if (!isCommandMode) return [];
    if (!commandQuery) return commands;
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(commandQuery)
    );
  });

  /**
   * Filtered tags from notesStore. Excludes the synthetic Untagged group
   * because there's no meaningful navigation target for it from here.
   */
  let filteredTags = $derived.by(() => {
    if (!isTagMode) return [] as TagGroup[];
    const tagGroups = notesStore.tagGroups.filter((g) => !g.isUntagged && g.tag);
    if (!tagQuery) return tagGroups;
    return tagGroups.filter((g) => g.title.toLowerCase().includes(tagQuery));
  });

  /**
   * Filtered notes based on search query.
   */
  let filteredNotes = $derived.by(() => {
    if (isCommandMode || isTagMode) return [];

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return recentNotes;
    }

    return allNotes.filter((note) => fuzzyMatch(note, trimmedQuery));
  });

  /** Total items count for keyboard navigation */
  let totalItems = $derived.by(() => {
    if (isCommandMode) return filteredCommands.length;
    if (isTagMode) return filteredTags.length;
    return filteredNotes.length;
  });

  /**
   * Reset state and set up focus trap when opening.
   */
  $effect(() => {
    if (isOpen) {
      query = '';
      selectedIndex = 0;

      // Set up focus trap when dialog opens
      if (dialogRef) {
        focusTrapCleanup = createFocusTrap({
          container: dialogRef,
          initialFocus: inputRef,
          onEscape: handleClose,
        });
      }
    } else {
      // Clean up focus trap when closing
      if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
      }
    }
  });

  /**
   * Clamp selected index when items change.
   */
  $effect(() => {
    if (selectedIndex >= totalItems) {
      selectedIndex = Math.max(0, totalItems - 1);
    }
  });

  /**
   * Scroll selected item into view.
   */
  $effect(() => {
    if (listRef && totalItems > 0) {
      const selectedItem = listRef.querySelector(`[data-index="${selectedIndex}"]`);
      selectedItem?.scrollIntoView({ block: 'nearest' });
    }
  });

  /**
   * Handle selecting a note.
   */
  function handleSelect(note: NotesListItem) {
    notesStore.selectNote(note.path);
    onSelect?.(note.path);
    handleClose();
  }

  /**
   * Handle selecting a command.
   */
  function handleSelectCommand(command: PaletteCommand) {
    handleClose();
    command.action();
  }

  /**
   * Handle selecting a tag — opens its detail view.
   */
  function handleSelectTag(group: TagGroup) {
    if (!group.tag) return;
    handleClose();
    events.emit('app:navigate', { view: 'tag', tag: group.tag });
  }

  /**
   * Handle keyboard navigation in input.
   */
  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, totalItems - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        event.preventDefault();
        if (isCommandMode) {
          const cmd = filteredCommands[selectedIndex];
          if (cmd) handleSelectCommand(cmd);
        } else if (isTagMode) {
          const tag = filteredTags[selectedIndex];
          if (tag) handleSelectTag(tag);
        } else {
          const selectedNote = filteredNotes[selectedIndex];
          if (selectedNote) handleSelect(selectedNote);
        }
        break;
      case 'Escape':
        event.preventDefault();
        handleClose();
        break;
    }
  }

  /**
   * Handle global keydown for the window.
   */
  function handleWindowKeydown(event: KeyboardEvent) {
    if (!isOpen) return;

    // Close on Escape (backup if input doesn't have focus)
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }

  /**
   * Handle backdrop click.
   */
  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  /**
   * Close the switcher.
   */
  function handleClose() {
    onClose?.();
  }

  /**
   * Get folder path from note path.
   */
  function getFolderPath(path: string): string | null {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) return null;
    return path.substring(0, lastSlash);
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="switcher-backdrop"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="switcher-window"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Switcher"
      aria-describedby="switcher-description"
    >
      <span id="switcher-description" class="sr-only">
        Search and navigate to notes. Use arrow keys to navigate, Enter to select, Escape to close.
      </span>
      <!-- Search input -->
      <div class="switcher-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          bind:this={inputRef}
          bind:value={query}
          class="switcher-input"
          type="text"
          placeholder={isCommandMode
            ? 'Type a command...'
            : isTagMode
              ? 'Filter tags...'
              : 'Search notes... (> commands, # tags)'}
          onkeydown={handleKeydown}
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button
            type="button"
            class="clear-btn"
            onclick={() => { query = ''; inputRef?.focus(); }}
            aria-label="Clear search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        {/if}
      </div>

      <!-- Results list -->
      <div class="switcher-list" bind:this={listRef}>
        {#if isCommandMode}
          <!-- Command mode -->
          {#if filteredCommands.length === 0}
            <div class="empty-state">
              <p class="empty-text">No commands matching "{commandQuery}"</p>
            </div>
          {:else}
            <div class="section-header">Commands</div>
            {#each filteredCommands as cmd, index (cmd.id)}
              <div
                class="switcher-item"
                class:selected={index === selectedIndex}
                data-index={index}
                role="option"
                tabindex={index === selectedIndex ? 0 : -1}
                aria-selected={index === selectedIndex}
                onclick={() => handleSelectCommand(cmd)}
                onkeydown={(e) => e.key === 'Enter' && handleSelectCommand(cmd)}
                onmouseenter={() => { selectedIndex = index; }}
              >
                <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
                </svg>
                <div class="note-info">
                  <span class="note-title">{cmd.label}</span>
                </div>
                {#if cmd.shortcut}
                  <kbd class="cmd-shortcut">{cmd.shortcut}</kbd>
                {/if}
              </div>
            {/each}
          {/if}
        {:else if isTagMode}
          <!-- Tag mode -->
          {#if filteredTags.length === 0}
            <div class="empty-state">
              <p class="empty-text">No tags matching "{tagQuery}"</p>
            </div>
          {:else}
            <div class="section-header">Tags</div>
            {#each filteredTags as group, index (group.id)}
              <div
                class="switcher-item"
                class:selected={index === selectedIndex}
                data-index={index}
                role="option"
                tabindex={index === selectedIndex ? 0 : -1}
                aria-selected={index === selectedIndex}
                onclick={() => handleSelectTag(group)}
                onkeydown={(e) => e.key === 'Enter' && handleSelectTag(group)}
                onmouseenter={() => { selectedIndex = index; }}
              >
                <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                  <line x1="4" y1="9" x2="20" y2="9" />
                  <line x1="4" y1="15" x2="20" y2="15" />
                  <line x1="10" y1="3" x2="8" y2="21" />
                  <line x1="16" y1="3" x2="14" y2="21" />
                </svg>
                <div class="note-info">
                  <span class="note-title">{group.title}</span>
                </div>
                <kbd class="cmd-shortcut">{group.count}</kbd>
              </div>
            {/each}
          {/if}
        {:else}
          <!-- Note search mode -->
          {#if filteredNotes.length === 0}
            <div class="empty-state">
              {#if query}
                <p class="empty-text">No notes matching "{query}"</p>
              {:else}
                <p class="empty-text">No notes yet</p>
                <p class="empty-hint">Press Cmd+N to create your first note</p>
              {/if}
            </div>
          {:else}
            {#if !query}
              <div class="section-header">Recent</div>
            {/if}
            {#each filteredNotes as note, index (note.path)}
              <div
                class="switcher-item"
                class:selected={index === selectedIndex}
                data-index={index}
                role="option"
                tabindex={index === selectedIndex ? 0 : -1}
                aria-selected={index === selectedIndex}
                onclick={() => handleSelect(note)}
                onkeydown={(e) => e.key === 'Enter' && handleSelect(note)}
                onmouseenter={() => { selectedIndex = index; }}
              >
                <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div class="note-info">
                  <span class="note-title">{note.title}</span>
                  <div class="note-meta">
                    {#if getFolderPath(note.path)}
                      <span class="note-folder">{getFolderPath(note.path)}</span>
                    {/if}
                    <span class="note-date">{formatRelativeDate(note.modifiedAt)}</span>
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        {/if}
      </div>

      <!-- Footer hints -->
      <div class="switcher-footer">
        <span class="hint">
          <kbd>&#8593;</kbd><kbd>&#8595;</kbd> to navigate
        </span>
        <span class="hint">
          <kbd>Enter</kbd> to open
        </span>
        <span class="hint">
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ─── Quick switcher / command palette ─── */
  .switcher-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 14vh;
    background-color: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
    animation: backdrop-fade-in var(--duration-normal) var(--ease-out-soft);
  }

  @keyframes backdrop-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .switcher-window {
    display: flex;
    flex-direction: column;
    width: 580px;
    max-width: 92vw;
    max-height: 460px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    animation: switcher-scale-in 240ms var(--ease-out-soft);
    transform-origin: top center;
  }

  @keyframes switcher-scale-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ─── Search input ─── */
  .switcher-input-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .search-icon {
    width: 18px;
    height: 18px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .switcher-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 15px;
    line-height: 1.4;
    outline: none;
    letter-spacing: -0.005em;
    font-family: inherit;
  }

  .switcher-input::placeholder {
    color: var(--text-tertiary);
  }

  .clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .clear-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .clear-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ─── Results list ─── */
  .switcher-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    min-height: 0;
  }

  .section-header {
    padding: 8px 10px 4px;
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .switcher-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 10px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .switcher-item:hover {
    background-color: var(--bg-hover);
  }

  .switcher-item.selected {
    background-color: var(--accent-light);
    color: var(--text-primary);
  }

  .switcher-item.selected .note-folder,
  .switcher-item.selected .note-date {
    color: var(--text-tertiary);
  }

  .note-icon {
    width: 16px;
    height: 16px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .switcher-item.selected .note-icon {
    color: var(--accent-primary);
  }

  .note-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .note-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.005em;
  }

  .note-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-tertiary);
  }

  .note-folder {
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .note-date {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .cmd-shortcut {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  /* ─── Empty state ─── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 36px 16px 28px;
    text-align: center;
  }

  .empty-text {
    margin: 0;
    font-size: 14px;
    color: var(--text-secondary);
    font-weight: 500;
    letter-spacing: -0.005em;
  }

  .empty-hint {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--text-tertiary);
  }

  /* ─── Footer ─── */
  .switcher-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 9px 16px;
    border-top: 1px solid var(--border-faint);
    background-color: var(--bg-app);
    flex-shrink: 0;
  }

  .hint {
    font-size: 11px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 4px;
    letter-spacing: 0.005em;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding: 1px 5px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: 4px;
    font-size: 10.5px;
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
  }
</style>
