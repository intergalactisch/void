<script lang="ts">
  import {
    Clock3,
    Copy,
    FileText,
    Folder,
    FolderOpen,
    GripVertical,
    Plus,
    Search,
    Sparkles,
  } from '@lucide/svelte';
  import type { FolderDropPosition } from '$lib/ports/inbound';
  import { createSortableState, type SortableState } from '$lib/components/dnd/sortable';
  import type { FolderOverview as FolderOverviewModel } from '$lib/stores/notes.svelte';
  import { createFolderReorderDnd } from './folderReorderDnd';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { toastStore } from '$lib/stores';

  interface Props {
    overview: FolderOverviewModel;
    onCreateNote: () => void;
    onOpenNote: (path: string) => void;
    onOpenFolder: (path: string) => void;
    onReorderFolder?: (path: string, targetPath: string, position: FolderDropPosition) => boolean | Promise<boolean>;
    onSearch: () => void;
    onSummarize: () => void;
  }

  let {
    overview,
    onCreateNote,
    onOpenNote,
    onOpenFolder,
    onReorderFolder,
    onSearch,
    onSummarize,
  }: Props = $props();

  let folderDndState = $state<SortableState>(createSortableState());
  const folderDnd = createFolderReorderDnd({
    onStateChange: (state) => {
      folderDndState = state;
    },
    onReorder: async (path, targetPath, position) => {
      const reordered = await onReorderFolder?.(path, targetPath, position);
      if (reordered === false) {
        folderDnd.cancel();
      }
    },
  });
  let folderListAction = $derived(folderDnd.listAction);
  let folderItemAction = $derived(folderDnd.itemAction);

  let nestedNotes = $derived.by(() => overview.allNotes.filter((note) =>
    !overview.directNotes.some((direct) => direct.path === note.path)
  ));

  function formatModified(date: Date | null): string {
    if (!date) return 'No notes yet';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function relativeNestedPath(path: string): string {
    const prefix = overview.path ? `${overview.path}/` : '';
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  function isDragging(path: string): boolean {
    return folderDndState.dragging?.id === path && folderDndState.dragging.groupId === overview.path;
  }

  function getDropPosition(path: string): FolderDropPosition | null {
    const target = folderDndState.dropTarget;
    if (!target || target.id !== path || target.groupId !== overview.path) return null;
    return target.position;
  }

  function handleDragHandleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function copyFolderRef() {
    const success = await copyTextToClipboard(buildRefId({ kind: 'folder', folderPath: overview.path }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }
</script>

<section class="folder-overview" aria-labelledby="folder-overview-title">
  <div class="overview-inner">
    <header class="overview-header">
      <div class="title-row">
        <span class="folder-mark" aria-hidden="true">
          <FolderOpen size={22} strokeWidth={1.7} />
        </span>
        <div class="title-copy">
          <h1 id="folder-overview-title">{overview.title}</h1>
          <p>{overview.path || 'Workspace'}</p>
        </div>
      </div>

      <div class="overview-actions" aria-label="Folder actions">
        <button type="button" class="action primary" onclick={onCreateNote}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          <span>New note</span>
        </button>
        <button type="button" class="action" onclick={copyFolderRef}>
          <Copy size={14} strokeWidth={1.9} aria-hidden="true" />
          <span>Copy Ref</span>
        </button>
        <button type="button" class="action" onclick={onSearch}>
          <Search size={14} strokeWidth={1.9} aria-hidden="true" />
          <span>Search</span>
        </button>
        <button type="button" class="action" onclick={onSummarize} disabled={overview.noteCount === 0}>
          <Sparkles size={14} strokeWidth={1.9} aria-hidden="true" />
          <span>Summarize</span>
        </button>
      </div>
    </header>

    <div class="stats" aria-label="Folder summary">
      <div class="stat">
        <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{overview.noteCount} note{overview.noteCount === 1 ? '' : 's'}</span>
      </div>
      <div class="stat">
        <Folder size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{overview.subfolderCount} subfolder{overview.subfolderCount === 1 ? '' : 's'}</span>
      </div>
      <div class="stat">
        <Clock3 size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{formatModified(overview.latestModifiedAt)}</span>
      </div>
    </div>

    {#if overview.directFolders.length === 0 && overview.directNotes.length === 0}
      <div class="empty-folder">
        <FolderOpen size={24} strokeWidth={1.6} aria-hidden="true" />
        <strong>This folder is empty</strong>
        <span>Create a note here, or use search to jump elsewhere.</span>
      </div>
    {:else}
      <div class="overview-grid">
        <section class="overview-section" aria-labelledby="subfolders-heading">
          <div class="section-heading">
            <h2 id="subfolders-heading">Subfolders</h2>
            <span>{overview.directFolders.length}</span>
          </div>
          {#if overview.directFolders.length > 0}
            <div
              class="row-list subfolder-list"
              use:folderListAction={{ groupId: overview.path }}
              role="group"
              aria-label="Subfolders"
            >
              {#each overview.directFolders as folder (folder.path)}
                <div
                  class="list-row folder-row"
                  class:dragging={isDragging(folder.path)}
                  class:drop-before={getDropPosition(folder.path) === 'before'}
                  class:drop-after={getDropPosition(folder.path) === 'after'}
                  use:folderItemAction={{ id: folder.path, groupId: overview.path, handle: '[data-folder-drag-handle]' }}
                  role="group"
                  aria-label={folder.title}
                  aria-grabbed={isDragging(folder.path)}
                >
                  <button
                    type="button"
                    class="folder-drag-handle"
                    data-folder-drag-handle
                    onclick={handleDragHandleClick}
                    title="Drag to reorder"
                    aria-label={`Drag ${folder.title} to reorder`}
                  >
                    <GripVertical size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="folder-open-button"
                    onclick={() => onOpenFolder(folder.path)}
                  >
                    <Folder size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span class="row-title">{folder.title}</span>
                    <span class="row-meta">{folder.children?.length ?? 0}</span>
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="section-empty">No direct subfolders.</p>
          {/if}
        </section>

        <section class="overview-section" aria-labelledby="notes-heading">
          <div class="section-heading">
            <h2 id="notes-heading">Notes</h2>
            <span>{overview.directNotes.length}</span>
          </div>
          {#if overview.directNotes.length > 0}
            <div class="row-list">
              {#each overview.directNotes as note (note.path)}
                <button type="button" class="list-row" onclick={() => onOpenNote(note.path)}>
                  <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span class="row-title">{note.title}</span>
                  <span class="row-meta">{formatModified(note.modifiedAt)}</span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="section-empty">No direct notes.</p>
          {/if}
        </section>
      </div>

      {#if nestedNotes.length > 0}
        <section class="overview-section nested-section" aria-labelledby="nested-heading">
          <div class="section-heading">
            <h2 id="nested-heading">Nested Notes</h2>
            <span>{nestedNotes.length}</span>
          </div>
          <div class="nested-list">
            {#each nestedNotes.slice(0, 12) as note (note.path)}
              <button type="button" class="nested-row" onclick={() => onOpenNote(note.path)}>
                <FileText size={14} strokeWidth={1.7} aria-hidden="true" />
                <span>{relativeNestedPath(note.path)}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {/if}
  </div>
</section>

<style>
  .folder-overview {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-editor);
  }

  .overview-inner {
    width: min(980px, 100%);
    margin: 0 auto;
    padding: 42px 36px 64px;
  }

  .overview-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--border-light);
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 13px;
    min-width: 0;
  }

  .folder-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    color: var(--accent-primary);
  }

  .title-copy {
    min-width: 0;
  }

  .title-copy h1 {
    margin: 0;
    color: var(--text-primary);
    font-size: 24px;
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }

  .title-copy p {
    margin: 7px 0 0;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .overview-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .action:hover:not(:disabled),
  .action:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-medium);
  }

  .action.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--text-inverse);
  }

  .action.primary:hover,
  .action.primary:focus-visible {
    filter: brightness(0.96);
    color: var(--text-inverse);
  }

  .action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stats {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    padding: 18px 0 24px;
    color: var(--text-secondary);
    font-size: var(--text-small);
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .stat :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
  }

  .overview-section {
    min-width: 0;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border-faint);
  }

  .section-heading h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
    letter-spacing: 0;
  }

  .section-heading span {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .row-list,
  .nested-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 8px;
  }

  .list-row,
  .nested-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 32px;
    padding: 5px 7px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast),
                box-shadow var(--transition-fast), opacity var(--transition-fast);
  }

  .folder-row {
    gap: 4px;
    cursor: default;
  }

  .folder-row.dragging .folder-drag-handle {
    cursor: grabbing;
  }

  .folder-drag-handle,
  .folder-open-button {
    display: flex;
    align-items: center;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .folder-drag-handle {
    justify-content: center;
    width: 18px;
    height: 22px;
    flex-shrink: 0;
    padding: 0;
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    cursor: grab;
  }

  .folder-drag-handle:hover,
  .folder-drag-handle:focus-visible {
    background: var(--bg-active);
    color: var(--text-primary);
    outline: none;
  }

  .folder-open-button {
    min-width: 0;
    flex: 1;
    gap: 9px;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }

  .list-row:hover,
  .list-row:focus-visible,
  .nested-row:hover,
  .nested-row:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .folder-row.dragging {
    background: var(--bg-active);
    color: var(--text-primary);
    opacity: 0.56;
    box-shadow: inset 0 0 0 1px var(--border-medium);
  }

  .folder-row.drop-before,
  .folder-row.drop-after {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .folder-row.drop-before::before,
  .folder-row.drop-after::before {
    content: '';
    position: absolute;
    left: 26px;
    right: 8px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent-primary);
    pointer-events: none;
  }

  .folder-row.drop-before::after,
  .folder-row.drop-after::after {
    content: '';
    position: absolute;
    left: 22px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent-primary);
    pointer-events: none;
  }

  .folder-row.drop-before::before {
    top: -2px;
  }

  .folder-row.drop-after::before {
    bottom: -2px;
  }

  .folder-row.drop-before::after {
    top: -4px;
  }

  .folder-row.drop-after::after {
    bottom: -4px;
  }

  .list-row :global(svg),
  .nested-row :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .row-title,
  .nested-row span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-title {
    flex: 1;
  }

  .row-meta {
    flex-shrink: 0;
    max-width: 45%;
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-empty {
    margin: 10px 0 0;
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }

  .nested-section {
    margin-top: 30px;
  }

  .empty-folder {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    padding: 22px 0;
    border-top: 1px solid var(--border-faint);
    color: var(--text-secondary);
  }

  .empty-folder :global(svg) {
    color: var(--text-tertiary);
  }

  .empty-folder strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
  }

  .empty-folder span {
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }

  @media (max-width: 760px) {
    .overview-inner {
      padding: 28px 18px 48px;
    }

    .overview-header {
      flex-direction: column;
      gap: 16px;
    }

    .overview-actions {
      justify-content: flex-start;
    }

    .overview-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
