<script lang="ts">
  /**
   * PageLinkPopup
   *
   * Shared note-reference picker for typed [[wikilinks]] and selected text.
   */

  import { tick } from 'svelte';
  import { Clock, CornerDownLeft, FileText, Folder, Hash, Search } from '@lucide/svelte';
  import type { PageLinkState, PageLinkNote } from '$lib/adapters/prosemirror/plugins/pageLink';

  interface Props {
    state: PageLinkState;
    onSelect: (note: PageLinkNote) => void;
    onClose: () => void;
    onQueryChange?: (query: string) => void;
    onNavigate?: (direction: 'next' | 'prev') => void;
  }

  let { state: menuState, onSelect, onClose, onQueryChange, onNavigate }: Props = $props();

  let queryInput: HTMLInputElement | undefined = $state(undefined);
  let localQuery = $state('');

  const isSelectionMode = $derived(menuState.mode === 'selection');
  const selectedNote = $derived(menuState.filteredNotes[menuState.selectedIndex] ?? null);

  $effect(() => {
    if (!menuState.isOpen) return;
    localQuery = menuState.query;
    if (menuState.mode === 'selection') {
      tick().then(() => queryInput?.focus());
    }
  });

  function isSelected(index: number): boolean {
    return index === menuState.selectedIndex;
  }

  function handleClick(note: PageLinkNote): void {
    onSelect(note);
  }

  function handleBackdropClick(event: MouseEvent): void {
    event.stopPropagation();
    onClose();
  }

  function handleQueryInput(): void {
    onQueryChange?.(localQuery);
  }

  function handlePickerKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        onNavigate?.('next');
        break;
      case 'ArrowUp':
        event.preventDefault();
        onNavigate?.('prev');
        break;
      case 'Enter':
      case 'Tab':
        if (!selectedNote) return;
        event.preventDefault();
        onSelect(selectedNote);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }

  function getFolder(note: PageLinkNote): string | null {
    if (note.folder) return note.folder;
    const lastSlash = note.path.lastIndexOf('/');
    if (lastSlash === -1) return null;
    return note.path.slice(0, lastSlash);
  }

  function getMatchLabel(note: PageLinkNote): string | null {
    if (note.relation === 'attached') return 'Attached';
    if (note.relation === 'backlink') return 'Referenced by';
    if (note.matchLabel) return note.matchLabel;
    if (note.isRecent) return 'Recent';
    return null;
  }

  function getSelectionLabel(): string {
    const text = menuState.selectionRange?.text.trim();
    if (!text) return 'Insert reference';
    return `Link "${text}"`;
  }
</script>

{#if menuState.isOpen && menuState.coords}
  <div
    class="page-link-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  ></div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="page-link-menu"
    class:page-link-menu-above={menuState.openAbove}
    style="{menuState.openAbove ? 'bottom' : 'top'}: {menuState.openAbove ? (window.innerHeight - menuState.coords.top) : menuState.coords.top}px; left: {menuState.coords.left}px;"
    role="listbox"
    tabindex="-1"
    aria-label="Note references"
    onkeydown={handlePickerKeydown}
  >
    <header class="page-link-header">
      {#if isSelectionMode}
        <div class="page-link-search-row">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <input
            bind:this={queryInput}
            bind:value={localQuery}
            class="page-link-input"
            name="note-reference-search"
            aria-label="Search notes"
            placeholder="Search notes..."
            autocomplete="off"
            spellcheck="false"
            oninput={handleQueryInput}
          />
        </div>
        <div class="page-link-mode">{getSelectionLabel()}</div>
      {:else}
        <div class="page-link-query">
          <span class="page-link-trigger">[[</span>
          {#if menuState.query}
            <span>{menuState.query}</span>
          {:else}
            <span class="page-link-placeholder">Type to search notes...</span>
          {/if}
        </div>
      {/if}
    </header>

    <div class="page-link-list">
      {#if menuState.filteredNotes.length === 0}
        <div class="page-link-empty">
          {#if menuState.query}
            No notes found for "{menuState.query}"
          {:else}
            No notes available
          {/if}
        </div>
      {:else}
        {#each menuState.filteredNotes as note, index}
          {@const folder = getFolder(note)}
          {@const matchLabel = getMatchLabel(note)}
          <button
            type="button"
            class="page-link-item"
            class:is-selected={isSelected(index)}
            role="option"
            aria-selected={isSelected(index)}
            onclick={() => handleClick(note)}
          >
            <FileText size={15} strokeWidth={1.8} aria-hidden="true" />

            <span class="page-link-content">
              <span class="page-link-title">{note.title}</span>
              <span class="page-link-meta">
                {#if folder}
                  <span class="page-link-meta-part">
                    <Folder size={11} strokeWidth={1.8} aria-hidden="true" />
                    {folder}
                  </span>
                {:else}
                  <span>{note.path}</span>
                {/if}
                {#if matchLabel}
                  <span class="page-link-meta-part">
                    {#if note.matchKind === 'tag'}
                      <Hash size={11} strokeWidth={1.8} aria-hidden="true" />
                    {:else if note.isRecent}
                      <Clock size={11} strokeWidth={1.8} aria-hidden="true" />
                    {/if}
                    {matchLabel}
                  </span>
                {/if}
              </span>
              {#if note.tags && note.tags.length > 0}
                <span class="page-link-tags">
                  {#each note.tags.slice(0, 3) as tag}
                    <span>#{tag}</span>
                  {/each}
                </span>
              {/if}
            </span>
          </button>
        {/each}
      {/if}
    </div>

    <footer class="page-link-footer">
      <span>Up/Down navigate</span>
      <span class="page-link-footer-sep">-</span>
      <span><CornerDownLeft size={11} strokeWidth={1.8} aria-hidden="true" /> select</span>
      {#if !isSelectionMode}
        <span class="page-link-footer-sep">-</span>
        <span>]] complete</span>
      {/if}
      <span class="page-link-footer-sep">-</span>
      <span>Esc close</span>
    </footer>
  </div>
{/if}

<style>
  .page-link-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .page-link-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: min(380px, calc(100vw - 24px));
    max-height: min(430px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-light);
    background-color: var(--bg-card);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: page-link-scale-in var(--duration-normal) ease-out;
    transform-origin: top left;
  }

  .page-link-menu-above {
    transform-origin: bottom left;
  }

  @keyframes page-link-scale-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .page-link-header {
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-secondary);
    padding: 8px;
  }

  .page-link-search-row,
  .page-link-query {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    color: var(--text-secondary);
  }

  .page-link-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
  }

  .page-link-input::placeholder,
  .page-link-placeholder {
    color: var(--text-muted);
  }

  .page-link-trigger {
    font-family: var(--font-mono);
    font-weight: 650;
    color: var(--accent-primary);
  }

  .page-link-mode {
    padding-left: 21px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .page-link-list {
    flex: 1;
    overflow-y: auto;
    padding: 5px;
  }

  .page-link-empty {
    padding: 24px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--text-muted);
  }

  .page-link-item {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 9px;
    padding: 8px;
    text-align: left;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
  }

  .page-link-item:hover,
  .page-link-item.is-selected {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .page-link-item.is-selected .page-link-title {
    color: var(--accent-primary);
  }

  .page-link-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .page-link-title {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-link-meta,
  .page-link-tags {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-link-meta-part {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  .page-link-tags span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .page-link-footer {
    display: flex;
    align-items: center;
    gap: 5px;
    border-top: 1px solid var(--border-light);
    padding: 7px 10px;
    font-size: 11px;
    color: var(--text-muted);
    background-color: var(--bg-secondary);
  }

  .page-link-footer span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .page-link-footer-sep {
    opacity: 0.5;
  }
</style>
