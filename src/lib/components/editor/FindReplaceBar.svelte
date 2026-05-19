<script lang="ts">
  /**
   * FindReplaceBar — in-document find/replace overlay.
   *
   * Reads plugin state from editorStore.getFindReplaceState() and dispatches
   * mutations through editorStore.* so undo behaves atomically and the
   * editor service stays the single source of truth.
   */

  import { uiStore, editorStore } from '$lib/stores';

  let query = $state('');
  let replacement = $state('');
  let regex = $state(false);
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let inputRef: HTMLInputElement | null = $state(null);

  // Polling-style read of plugin state. The plugin state is derived from the
  // editor's transaction stream; this component re-reads on every reactive
  // tick by depending on uiStore.findBarOpen + the transaction trigger flag
  // (any editor change signals via editorStore.tabs / .document update).
  let findState = $derived.by(() => {
    if (!uiStore.findBarOpen) return null;
    void editorStore.document;
    return editorStore.getFindReplaceState();
  });

  let totalMatches = $derived(findState?.matches.length ?? 0);
  let activePosition = $derived.by(() => {
    if (!findState || findState.matches.length === 0) return 0;
    return findState.activeIndex + 1;
  });

  $effect(() => {
    if (uiStore.findBarOpen && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  $effect(() => {
    if (!uiStore.findBarOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      editorStore.setFindQuery('');
      return;
    }
    editorStore.setFindQuery(query, { regex, caseSensitive, wholeWord });
  });

  function close() {
    editorStore.closeFindReplace();
    uiStore.closeFindBar();
    query = '';
    replacement = '';
  }

  function next() {
    editorStore.findNextMatch();
  }
  function prev() {
    editorStore.findPrevMatch();
  }
  function replaceOne() {
    editorStore.replaceCurrentMatch(replacement);
  }
  function replaceAll() {
    editorStore.replaceAllMatches(replacement);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) prev();
      else next();
      return;
    }
  }
</script>

{#if uiStore.findBarOpen}
  <div class="find-bar" role="dialog" aria-label="Find in document">
    <div class="find-row">
      <input
        bind:this={inputRef}
        bind:value={query}
        type="text"
        class="find-input"
        placeholder="Find in document…"
        onkeydown={handleKeydown}
        autocomplete="off"
        spellcheck="false"
      />
      <span class="find-status" aria-live="polite">
        {#if totalMatches > 0}
          {activePosition} / {totalMatches}
        {:else if query.trim()}
          No matches
        {:else}
          0 / 0
        {/if}
      </span>
      <div class="find-options">
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
      <button type="button" class="nav-btn" onclick={prev} aria-label="Previous match" title="Previous (Shift+Enter)">‹</button>
      <button type="button" class="nav-btn" onclick={next} aria-label="Next match" title="Next (Enter)">›</button>
      <button type="button" class="close-btn" onclick={close} aria-label="Close">×</button>
    </div>
    {#if uiStore.findBarMode === 'replace'}
      <div class="find-row">
        <input
          bind:value={replacement}
          type="text"
          class="find-input"
          placeholder="Replace with…"
          onkeydown={(e) => { if (e.key === 'Escape') close(); }}
          autocomplete="off"
          spellcheck="false"
        />
        <button type="button" class="nav-btn nav-btn-text" onclick={replaceOne} disabled={totalMatches === 0}>Replace</button>
        <button type="button" class="nav-btn nav-btn-text" onclick={replaceAll} disabled={totalMatches === 0}>All</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-bar {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 30;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg, 0 4px 12px rgba(20,19,16,0.08));
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 380px;
  }

  .find-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .find-input {
    flex: 1;
    border: none;
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: 13px;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    outline: none;
    font-family: inherit;
    min-width: 0;
  }

  .find-input:focus {
    box-shadow: 0 0 0 2px var(--accent-light);
  }

  .find-status {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    min-width: 56px;
    text-align: right;
    flex-shrink: 0;
  }

  .find-options {
    display: flex;
    gap: 2px;
  }

  .opt-btn {
    border: 1px solid var(--border-light);
    background: var(--bg-app);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-size: 10px;
    font-family: var(--font-mono, ui-monospace, monospace);
    cursor: pointer;
  }

  .opt-btn:hover {
    background: var(--bg-hover);
  }

  .opt-active {
    background: var(--accent-light);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .nav-btn {
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }

  .nav-btn-text {
    font-size: 11px;
    padding: 3px 9px;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 18px;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    line-height: 1;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  :global(.pm-find-match) {
    background: rgba(255, 200, 0, 0.28);
    border-radius: 2px;
  }

  :global(.pm-find-match-active) {
    background: rgba(255, 168, 0, 0.55);
    outline: 1px solid rgba(255, 140, 0, 0.5);
  }
</style>
