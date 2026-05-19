<script lang="ts">
  /**
   * SearchPanel — full-screen content search overlay.
   *
   * Triggered by `search.findInFiles` (Cmd+Shift+F). Streams hits as the user
   * types via `SearchService`. Selecting a hit navigates to the note and
   * scrolls the editor toward the matching line.
   */

  import { onMount, onDestroy } from 'svelte';
  import { notesStore, uiStore } from '$lib/stores';
  import { events } from '$lib/events';
  import { getAppContext } from '$lib/bootstrap';
  import type { SearchService, SearchHit } from '$lib/ports/inbound/SearchService';
  import { createFocusTrap } from '$lib/utils/focusTrap';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();

  let query = $state('');
  let regex = $state(false);
  let caseSensitive = $state(false);
  let wholeWord = $state(false);

  let hits = $state<SearchHit[]>([]);
  let totalScanned = $state(0);
  let isSearching = $state(false);
  let selectedIndex = $state(0);
  let activeRunId = 0;
  let inputRef: HTMLInputElement | null = $state(null);
  let panelRef: HTMLDivElement | null = $state(null);
  let listRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;
  let searchService: SearchService | null = null;

  onMount(() => {
    searchService = getAppContext()?.search ?? null;
  });

  onDestroy(() => {
    focusTrapCleanup?.();
  });

  $effect(() => {
    if (isOpen) {
      if (panelRef) {
        focusTrapCleanup?.();
        focusTrapCleanup = createFocusTrap({
          container: panelRef,
          initialFocus: inputRef,
          onEscape: handleClose,
        });
      }
    } else {
      focusTrapCleanup?.();
      focusTrapCleanup = null;
      hits = [];
      totalScanned = 0;
      isSearching = false;
    }
  });

  $effect(() => {
    // Re-run search when query or options change.
    const currentQuery = query;
    const currentRegex = regex;
    const currentCase = caseSensitive;
    const currentWord = wholeWord;
    if (!isOpen) return;
    if (!currentQuery.trim() || !searchService) {
      hits = [];
      totalScanned = 0;
      isSearching = false;
      return;
    }
    runSearch(currentQuery, currentRegex, currentCase, currentWord);
  });

  $effect(() => {
    if (listRef && hits.length > 0) {
      const node = listRef.querySelector(`[data-index="${selectedIndex}"]`);
      node?.scrollIntoView({ block: 'nearest' });
    }
  });

  async function runSearch(q: string, asRegex: boolean, cs: boolean, ww: boolean) {
    const runId = ++activeRunId;
    isSearching = true;
    hits = [];
    totalScanned = 0;
    selectedIndex = 0;

    if (!searchService) {
      isSearching = false;
      return;
    }

    try {
      for await (const hit of searchService.searchContent({
        query: q,
        regex: asRegex,
        caseSensitive: cs,
        wholeWord: ww,
        maxResults: 200,
        maxResultsPerFile: 20,
      })) {
        if (runId !== activeRunId) return;
        hits = [...hits, hit];
        totalScanned += 1;
      }
    } catch (e) {
      console.error('[SearchPanel] search failed:', e);
    } finally {
      if (runId === activeRunId) {
        isSearching = false;
      }
    }
  }

  function handleClose() {
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        handleClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, hits.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        event.preventDefault();
        const hit = hits[selectedIndex];
        if (hit) navigateToHit(hit);
        break;
    }
  }

  function navigateToHit(hit: SearchHit) {
    notesStore.selectNote(hit.path);
    events.emit('app:navigate', { view: 'note', path: hit.path });
    handleClose();
  }

  function highlight(line: string, start: number, end: number) {
    const before = line.slice(0, start);
    const match = line.slice(start, end);
    const after = line.slice(end);
    return { before, match, after };
  }

  function groupedHits(items: SearchHit[]) {
    const groups = new Map<string, { title: string; hits: SearchHit[] }>();
    for (const hit of items) {
      const group = groups.get(hit.path) ?? { title: hit.title, hits: [] };
      group.hits.push(hit);
      groups.set(hit.path, group);
    }
    return Array.from(groups.entries()).map(([path, value]) => ({ path, ...value }));
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="search-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    role="presentation"
  >
    <div
      bind:this={panelRef}
      class="search-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Find in files"
    >
      <div class="search-header">
        <input
          bind:this={inputRef}
          bind:value={query}
          type="text"
          placeholder="Find in all notes..."
          class="search-input"
          onkeydown={handleKeydown}
          autocomplete="off"
          spellcheck="false"
        />
        <div class="search-options">
          <button
            type="button"
            class="opt-btn"
            class:opt-active={caseSensitive}
            onclick={() => (caseSensitive = !caseSensitive)}
            aria-pressed={caseSensitive}
            title="Match case"
          >Aa</button>
          <button
            type="button"
            class="opt-btn"
            class:opt-active={wholeWord}
            onclick={() => (wholeWord = !wholeWord)}
            aria-pressed={wholeWord}
            title="Whole word"
          >W</button>
          <button
            type="button"
            class="opt-btn"
            class:opt-active={regex}
            onclick={() => (regex = !regex)}
            aria-pressed={regex}
            title="Regular expression"
          >.*</button>
        </div>
        <button type="button" class="close-btn" onclick={handleClose} aria-label="Close">×</button>
      </div>

      <div class="search-status">
        {#if !query.trim()}
          <span class="status-hint">Type to search across all notes</span>
        {:else if isSearching && hits.length === 0}
          <span class="status-hint">Searching…</span>
        {:else}
          <span class="status-count">{hits.length} match{hits.length === 1 ? '' : 'es'} in {groupedHits(hits).length} file{groupedHits(hits).length === 1 ? '' : 's'}{isSearching ? '…' : ''}</span>
        {/if}
      </div>

      <div class="search-results" bind:this={listRef}>
        {#each groupedHits(hits) as group (group.path)}
          <div class="result-group">
            <div class="result-file">
              <span class="result-title">{group.title}</span>
              <span class="result-path">{group.path}</span>
            </div>
            {#each group.hits as hit (hit.path + ':' + hit.line + ':' + hit.column)}
              {@const idx = hits.indexOf(hit)}
              {@const parts = highlight(hit.lineText, hit.matchStart, hit.matchEnd)}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div
                class="result-row"
                class:selected={idx === selectedIndex}
                data-index={idx}
                onclick={() => navigateToHit(hit)}
                onmouseenter={() => (selectedIndex = idx)}
                role="option"
                tabindex="-1"
                aria-selected={idx === selectedIndex}
              >
                <span class="result-line">{hit.line}</span>
                <span class="result-snippet">
                  <span>{parts.before}</span>
                  <mark>{parts.match}</mark>
                  <span>{parts.after}</span>
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .search-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    background-color: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .search-panel {
    width: 720px;
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

  .search-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 15px;
    outline: none;
    font-family: inherit;
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-options {
    display: flex;
    gap: 4px;
  }

  .opt-btn {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: 11px;
    font-family: var(--font-mono, ui-monospace, monospace);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .opt-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .opt-active {
    background: var(--accent-light);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 22px;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    line-height: 1;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .search-status {
    padding: 6px 14px;
    border-bottom: 1px solid var(--border-faint);
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .status-count {
    font-variant-numeric: tabular-nums;
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }

  .result-group {
    margin-bottom: 6px;
  }

  .result-file {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    color: var(--text-secondary);
  }

  .result-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .result-path {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 4px 10px 4px 24px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: 13px;
  }

  .result-row:hover,
  .result-row.selected {
    background: var(--accent-light);
  }

  .result-line {
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    min-width: 32px;
  }

  .result-snippet {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--text-primary);
  }

  .result-snippet mark {
    background: var(--color-warning-bg, rgba(255, 200, 0, 0.3));
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }

  .status-hint {
    color: var(--text-tertiary);
  }
</style>
