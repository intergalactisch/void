<script lang="ts">
  /**
   * Tag detail view, embedded in the main app shell.
   *
   * Replaces the standalone /tags/[tag] route so that browsing a tag
   * keeps the sidebar, header, AI command center, and status bar in
   * place — the user stays "inside" the workspace instead of being
   * pushed onto a separate page.
   *
   * Selecting a row hands off to `notesStore.selectNote()`, which
   * automatically clears `activeTagView` (see store) and lets the
   * existing reactive flow load the document into the editor.
   */

  import { Copy, FileText, Hash, Plus } from '@lucide/svelte';
  import { notesStore, toastStore } from '$lib/stores';
  import { noteSource } from '$lib/components/dnd/paneDnd.svelte';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import type { NotesListItem, TagGroup } from '$lib/ports/inbound';

  interface Props {
    /** Tag name (without the leading `#`). */
    tag: string;
    onNoteContextMenu?: (path: string, title: string, position: { x: number; y: number }, isFolder?: boolean) => void;
  }

  type SortKey = 'modified' | 'title';

  let { tag, onNoteContextMenu }: Props = $props();

  function handleContextMenu(event: MouseEvent, path: string, title: string) {
    if (!onNoteContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onNoteContextMenu(path, title, { x: event.clientX, y: event.clientY }, false);
  }

  let group = $derived<TagGroup | null>(
    notesStore.tagGroups.find((entry) => entry.tag === tag) ?? null,
  );
  let isLoading = $derived(notesStore.isLoading && notesStore.tagGroups.length === 0);

  let sort = $state<SortKey>('modified');

  let notes = $derived.by<NotesListItem[]>(() => {
    if (!group) return [];
    const list = [...group.notes];
    if (sort === 'modified') {
      list.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  });

  function notePath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) return '';
    return path.slice(0, lastSlash);
  }

  function formatModified(date: Date): string {
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    const diffMs = now.getTime() - date.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (diffMs < 7 * dayMs) {
      return date.toLocaleDateString(undefined, { weekday: 'short' });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function openNote(path: string) {
    notesStore.selectNote(path);
  }

  function openTag(other: string) {
    if (other === tag) return;
    notesStore.selectTagView(other);
  }

  function handleRowKeydown(path: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openNote(path);
  }

  async function createNoteWithTag() {
    const doc = await notesStore.createQuickNoteWithTags([tag]);
    if (doc) {
      toastStore.success(`Note created with #${tag}`);
    }
  }

  async function copyTagRef() {
    const success = await copyTextToClipboard(buildRefId({ kind: 'tag', tag }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }
</script>

<section class="tag-view" aria-label={`Notes tagged ${tag}`}>
  <div class="tag-view-summary">
    <div class="summary-left">
      <span class="summary-glyph" aria-hidden="true">
        <Hash size={14} strokeWidth={1.7} />
      </span>
      <h2 class="summary-title">#{tag}</h2>
      {#if group}
        <span class="summary-count">{group.count} note{group.count === 1 ? '' : 's'}</span>
      {:else if isLoading}
        <span class="summary-count">Loading…</span>
      {/if}
    </div>

    <div class="summary-right">
      {#if group && notes.length > 0}
        <div class="sort-switch" role="group" aria-label="Sort order">
          <button
            type="button"
            class:active={sort === 'modified'}
            onclick={() => { sort = 'modified'; }}
          >
            Recent
          </button>
          <button
            type="button"
            class:active={sort === 'title'}
            onclick={() => { sort = 'title'; }}
          >
            A–Z
          </button>
        </div>
      {/if}

      <button
        type="button"
        class="new-tagged-btn"
        onclick={copyTagRef}
        title={`Copy ref for #${tag}`}
        aria-label={`Copy ref for #${tag}`}
      >
        <Copy size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>Copy Ref</span>
      </button>

      <button
        type="button"
        class="new-tagged-btn"
        onclick={createNoteWithTag}
        title={`New note tagged #${tag}`}
        aria-label={`New note tagged #${tag}`}
      >
        <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>New note</span>
      </button>
    </div>
  </div>

  <div class="tag-view-body" class:body-padded={!group || isLoading}>
    {#if isLoading}
      <div class="state-block" role="status">
        <span class="state-spinner" aria-hidden="true"></span>
        <p>Loading notes…</p>
      </div>
    {:else if !group}
      <div class="state-block">
        <div class="state-mark" aria-hidden="true">
          <Hash size={20} strokeWidth={1.6} />
        </div>
        <strong>No notes with #{tag}</strong>
        <p>Add the tag from any note to start grouping work here.</p>
        <button type="button" class="state-action" onclick={createNoteWithTag}>
          <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
          New note with #{tag}
        </button>
      </div>
    {:else}
      <div class="note-list" role="list">
        {#each notes as note (note.path)}
          {@const folder = notePath(note.path)}
          <div
            class="note-row"
            role="button"
            tabindex="0"
            use:noteSource={{ notePath: note.path, title: note.title }}
            onclick={() => openNote(note.path)}
            oncontextmenu={(event) => handleContextMenu(event, note.path, note.title)}
            onkeydown={(event) => handleRowKeydown(note.path, event)}
          >
            <span class="note-icon" aria-hidden="true">
              <FileText size={14} strokeWidth={1.7} />
            </span>
            <span class="note-main">
              <strong>{note.title}</strong>
              {#if folder}
                <span class="note-folder">{folder}</span>
              {/if}
            </span>
            <span class="note-tags-inline" aria-label="Other tags">
              {#each note.tags.filter((other) => other !== tag).slice(0, 4) as other (other)}
                <button
                  type="button"
                  class="note-tag-chip"
                  onclick={(event) => { event.stopPropagation(); openTag(other); }}
                  title={`Open #${other}`}
                  aria-label={`Open #${other}`}
                >#{other}</button>
              {/each}
            </span>
            <span class="note-modified">{formatModified(note.modifiedAt)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .tag-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-editor);
    color: var(--text-primary);
  }

  /* Compact summary strip — sits inside the editor area, not as a full-page header */
  .tag-view-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
    background: var(--bg-editor);
  }

  .summary-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .summary-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    background: var(--accent-soft);
    flex-shrink: 0;
  }

  .summary-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.005em;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .summary-count {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  .summary-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .sort-switch {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .sort-switch button {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: -0.003em;
  }

  .sort-switch button:hover {
    color: var(--text-primary);
  }

  .sort-switch button.active {
    background: var(--bg-app);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .new-tagged-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
  }

  .new-tagged-btn:hover {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .new-tagged-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  /* Body — scrolling area with constrained max-width that mirrors the editor */
  .tag-view-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 24px 24px;
  }

  .body-padded {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .note-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 960px;
    margin: 0 auto;
  }

  .note-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .note-row:hover {
    border-color: var(--border-light);
    background: var(--bg-card);
  }

  .note-row:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .note-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .note-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .note-main strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }

  .note-folder {
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-tags-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex-shrink: 1;
  }

  .note-tag-chip {
    padding: 2px 7px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-app);
    color: var(--text-tertiary);
    font: inherit;
    font-size: 10.5px;
    font-weight: 550;
    letter-spacing: -0.005em;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .note-tag-chip:hover {
    background: var(--accent-soft);
    color: var(--accent-primary);
  }

  .note-tag-chip:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .note-modified {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  /* States */
  .state-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin: 40px auto;
    max-width: 360px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .state-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--bg-subtle);
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .state-block strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
  }

  .state-block p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .state-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
  }

  .state-action:hover {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .state-action:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .state-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent-primary);
    border-radius: var(--radius-full);
    animation: tagSpin 0.9s linear infinite;
  }

  @keyframes tagSpin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 720px) {
    .tag-view-summary {
      padding: 12px 14px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tag-view-body {
      padding: 12px 14px 16px;
    }

    .summary-right {
      width: 100%;
      justify-content: space-between;
    }

    .note-row {
      grid-template-columns: 18px minmax(0, 1fr) auto;
    }

    .note-tags-inline {
      display: none;
    }
  }
</style>
