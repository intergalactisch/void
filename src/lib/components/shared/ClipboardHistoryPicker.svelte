<script lang="ts">
  /**
   * ClipboardHistoryPicker — searchable clipboard history modal.
   *
   * Triggered by `clipboard.openHistory` (Cmd+Shift+V). Lists every captured
   * clipboard entry newest-first with a search box. Enter pastes the selected
   * entry at the editor cursor (using EditorService.insertContent so it
   * goes through the normal autosave path). Cmd+Click copies an entry back
   * onto the system clipboard without inserting.
   */

  import { onMount, onDestroy } from 'svelte';
  import { clipboardStore, editorStore, uiStore, toastStore } from '$lib/stores';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { formatRelativeDate } from '$lib/utils/relativeDate';
  import { Clipboard, X, Copy, Trash2 } from '@lucide/svelte';
  import type { ClipboardEntry } from '$lib/ports/inbound/ClipboardService';

  let query = $state('');
  let selectedIndex = $state(0);
  let inputRef: HTMLInputElement | null = $state(null);
  let dialogRef: HTMLDivElement | null = $state(null);
  let listRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;

  let filtered = $derived.by(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return clipboardStore.history;
    return clipboardStore.history.filter((entry) =>
      entry.text.toLowerCase().includes(trimmed)
    );
  });

  $effect(() => {
    if (uiStore.clipboardPickerOpen) {
      query = '';
      selectedIndex = 0;
      if (dialogRef) {
        focusTrapCleanup = createFocusTrap({
          container: dialogRef,
          initialFocus: inputRef,
          onEscape: close,
        });
      }
    } else if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
  });

  $effect(() => {
    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }
  });

  $effect(() => {
    if (listRef && filtered.length > 0) {
      const item = listRef.querySelector(`[data-index="${selectedIndex}"]`);
      item?.scrollIntoView({ block: 'nearest' });
    }
  });

  onDestroy(() => focusTrapCleanup?.());

  function close() {
    uiStore.closeClipboardPicker();
  }

  function preview(text: string, max = 220): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= max) return collapsed;
    return collapsed.slice(0, max - 1) + '…';
  }

  async function pickEntry(entry: ClipboardEntry, copyOnly = false) {
    if (copyOnly) {
      await clipboardStore.copyToSystem(entry);
      toastStore.success('Copied to clipboard');
      close();
      return;
    }
    if (!editorStore.activePath) {
      // No active editor — fall back to copy-to-system so the entry is
      // useful elsewhere.
      await clipboardStore.copyToSystem(entry);
      toastStore.success('Copied to clipboard');
      close();
      return;
    }
    editorStore.insertContent(entry.text);
    close();
  }

  async function deleteEntry(entry: ClipboardEntry, event: MouseEvent) {
    event.stopPropagation();
    clipboardStore.remove(entry.id);
  }

  function clearAll() {
    clipboardStore.clear();
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (filtered.length === 0) break;
        selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (filtered.length === 0) break;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter': {
        event.preventDefault();
        const entry = filtered[selectedIndex];
        if (entry) void pickEntry(entry, event.metaKey || event.ctrlKey);
        break;
      }
      case 'Escape':
        event.preventDefault();
        close();
        break;
    }
  }
</script>

{#if uiStore.clipboardPickerOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="clip-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="clip-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Clipboard history"
    >
      <div class="clip-header">
        <span class="clip-title">
          <Clipboard size={13} strokeWidth={1.7} aria-hidden="true" />
          Clipboard
        </span>
        <input
          bind:this={inputRef}
          bind:value={query}
          type="text"
          class="clip-input"
          placeholder="Search clipboard history…"
          onkeydown={handleKeydown}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="clip-count">{clipboardStore.history.length}</span>
        <button
          type="button"
          class="clip-action"
          onclick={clearAll}
          disabled={clipboardStore.history.length === 0}
          title="Clear all entries"
        >
          Clear
        </button>
        <button type="button" class="clip-close" onclick={close} aria-label="Close clipboard history">
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>

      <div class="clip-body" bind:this={listRef}>
        {#if clipboardStore.history.length === 0}
          <div class="clip-empty">
            <Clipboard size={20} strokeWidth={1.2} aria-hidden="true" />
            <p>Nothing in clipboard history yet.</p>
            <p class="clip-hint">Anything you copy while Void is running will land here.</p>
          </div>
        {:else if filtered.length === 0}
          <div class="clip-empty">
            <p>No matches for "{query}"</p>
          </div>
        {:else}
          <ul class="clip-list" role="listbox">
            {#each filtered as entry, index (entry.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <li
                class="clip-row"
                class:selected={index === selectedIndex}
                data-index={index}
                role="option"
                aria-selected={index === selectedIndex}
                onclick={(e) => pickEntry(entry, e.metaKey || e.ctrlKey)}
                onmouseenter={() => (selectedIndex = index)}
              >
                <span class="clip-preview">{preview(entry.text)}</span>
                <span class="clip-meta">
                  <span class="clip-len">{entry.length}c</span>
                  <time datetime={new Date(entry.capturedAt).toISOString()}>
                    {formatRelativeDate(new Date(entry.capturedAt))}
                  </time>
                </span>
                <button
                  type="button"
                  class="clip-row-action"
                  onclick={(e) => { e.stopPropagation(); void pickEntry(entry, true); }}
                  title="Copy to system clipboard"
                  aria-label="Copy to system clipboard"
                >
                  <Copy size={12} strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  class="clip-row-action clip-row-action-danger"
                  onclick={(e) => deleteEntry(entry, e)}
                  title="Remove from history"
                  aria-label="Remove from history"
                >
                  <Trash2 size={12} strokeWidth={1.7} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="clip-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> paste at cursor</span>
        <span><kbd>⌘</kbd>+<kbd>Enter</kbd> copy to system</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .clip-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .clip-panel {
    width: 640px;
    max-width: 92vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
  }

  .clip-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-faint);
  }

  .clip-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .clip-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    font-family: inherit;
    min-width: 0;
  }

  .clip-input::placeholder {
    color: var(--text-tertiary);
  }

  .clip-count {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    padding: 1px 7px;
    background: var(--bg-subtle);
    border-radius: 9999px;
  }

  .clip-action {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 9px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
  }

  .clip-action:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .clip-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .clip-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .clip-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .clip-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 4px 8px;
  }

  .clip-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 36px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12.5px;
  }

  .clip-empty p {
    margin: 0;
  }

  .clip-hint {
    color: var(--text-muted);
    font-size: 11.5px;
  }

  .clip-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .clip-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 10px;
    align-items: center;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
    transition: background var(--transition-fast);
  }

  .clip-row:hover,
  .clip-row.selected {
    background: var(--accent-light);
  }

  .clip-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12.5px;
    color: var(--text-primary);
  }

  .clip-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .clip-len {
    background: var(--bg-subtle);
    padding: 0 5px;
    border-radius: 3px;
  }

  .clip-row-action {
    border: none;
    background: transparent;
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .clip-row-action:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .clip-row-action-danger:hover {
    color: var(--color-error);
  }

  .clip-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-app);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .clip-footer kbd {
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    padding: 0 5px;
    border-radius: 3px;
    font-size: 10.5px;
    font-family: var(--font-sans);
    color: var(--text-secondary);
    margin: 0 1px;
  }
</style>
