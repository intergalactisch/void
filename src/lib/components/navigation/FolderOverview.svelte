<script lang="ts">
  import {
    Clock3,
    Copy,
    Download,
    Ellipsis,
    ExternalLink,
    FileText,
    Folder,
    FolderOpen,
    FolderSearch,
    GripVertical,
    Image as ImageIcon,
    Plus,
    Search,
    Sparkles,
    Trash2,
  } from '@lucide/svelte';
  import type { FolderDropPosition } from '$lib/ports/inbound';
  import { createSortableState, type SortableState } from '$lib/components/dnd/sortable';
  import type { FolderOverview as FolderOverviewModel, FolderImage } from '$lib/stores/notes.svelte';
  import ImageLightbox from './ImageLightbox.svelte';
  import { createFolderReorderDnd } from './folderReorderDnd';
  import { noteSource } from '$lib/components/dnd/paneDnd.svelte';
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
    onNoteContextMenu?: (path: string, title: string, position: { x: number; y: number }, isFolder?: boolean) => void;
    /** Resolve the image assets that live directly in a folder (for the gallery). */
    onLoadFolderImages?: (folderPath: string) => Promise<FolderImage[]>;
    onOpenImageSourceNote?: (relativePath: string) => void;
    onRevealImage?: (relativePath: string) => void;
    onSaveImageAs?: (relativePath: string) => void;
    onCopyImagePath?: (relativePath: string) => void;
    /** Delete an asset; resolve true when removed so the gallery can refresh. */
    onDeleteImage?: (relativePath: string) => boolean | Promise<boolean>;
  }

  let {
    overview,
    onCreateNote,
    onOpenNote,
    onOpenFolder,
    onReorderFolder,
    onSearch,
    onSummarize,
    onNoteContextMenu,
    onLoadFolderImages,
    onOpenImageSourceNote,
    onRevealImage,
    onSaveImageAs,
    onCopyImagePath,
    onDeleteImage,
  }: Props = $props();

  function handleItemContextMenu(event: MouseEvent, path: string, title: string, isFolder = false) {
    if (!onNoteContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onNoteContextMenu(path, title, { x: event.clientX, y: event.clientY }, isFolder);
  }

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

  // --- Image gallery -------------------------------------------------------

  let images = $state<FolderImage[]>([]);
  let lightboxIndex = $state(-1);
  let menuPath = $state<string | null>(null);
  // Non-reactive guard so a slow load for a previous folder can't overwrite a newer one.
  let loadToken = 0;

  function applyImages(token: number, next: FolderImage[]): void {
    if (token === loadToken) images = next;
  }

  function runImageLoad(folderPath: string, load: (folderPath: string) => Promise<FolderImage[]>): void {
    const token = ++loadToken;
    void (async () => {
      try {
        applyImages(token, await load(folderPath));
      } catch {
        applyImages(token, []);
      }
    })();
  }

  // Reload images only when the folder path actually changes. `overview` is
  // recreated on unrelated store updates, so guarding on the path avoids
  // needless refetches and thumbnail flicker while viewing one folder.
  let lastLoadedPath: string | null = null;
  $effect(() => {
    const folderPath = overview.path;
    const load = onLoadFolderImages;
    if (folderPath === lastLoadedPath) return;
    lastLoadedPath = folderPath;
    images = [];
    lightboxIndex = -1;
    menuPath = null;
    loadToken++;
    if (load) runImageLoad(folderPath, load);
  });

  // Close the open action menu on Escape or an outside click.
  $effect(() => {
    if (!menuPath) return;
    function onPointerDown(event: PointerEvent): void {
      if ((event.target as HTMLElement | null)?.closest('.image-menu-wrap')) return;
      menuPath = null;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      menuPath = null;
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  function imageDimensions(image: FolderImage): string {
    return image.width && image.height ? `${image.width} × ${image.height}` : '';
  }

  function toggleImageMenu(relativePath: string): void {
    menuPath = menuPath === relativePath ? null : relativePath;
  }

  function handleImageContextMenu(event: MouseEvent, relativePath: string): void {
    event.preventDefault();
    event.stopPropagation();
    menuPath = relativePath;
  }

  function runImageAction(relativePath: string, action?: (relativePath: string) => void): void {
    menuPath = null;
    action?.(relativePath);
  }

  async function deleteImage(relativePath: string): Promise<void> {
    menuPath = null;
    if (!onDeleteImage) return;
    const removed = await onDeleteImage(relativePath);
    if (!removed) return;
    if (onLoadFolderImages) runImageLoad(overview.path, onLoadFolderImages);
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
      {#if images.length > 0}
        <div class="stat">
          <ImageIcon size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>{images.length} image{images.length === 1 ? '' : 's'}</span>
        </div>
      {/if}
      <div class="stat">
        <Clock3 size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{formatModified(overview.latestModifiedAt)}</span>
      </div>
    </div>

    {#if overview.directFolders.length === 0 && overview.directNotes.length === 0 && images.length === 0}
      <div class="empty-folder">
        <FolderOpen size={24} strokeWidth={1.6} aria-hidden="true" />
        <strong>This folder is empty</strong>
        <span>Create a note here, or use search to jump elsewhere.</span>
      </div>
    {:else}
      {#if overview.directFolders.length > 0 || overview.directNotes.length > 0}
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
                    oncontextmenu={(event) => handleItemContextMenu(event, folder.path, folder.title, true)}
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
                <button
                  type="button"
                  class="list-row"
                  use:noteSource={{ notePath: note.path, title: note.title }}
                  onclick={() => onOpenNote(note.path)}
                  oncontextmenu={(event) => handleItemContextMenu(event, note.path, note.title)}
                >
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
      {/if}

      {#if images.length > 0}
        <section class="overview-section images-section" aria-labelledby="images-heading">
          <div class="section-heading">
            <h2 id="images-heading">Images</h2>
            <span>{images.length}</span>
          </div>
          <div class="image-grid">
            {#each images as image, index (image.relativePath)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="image-cell"
                class:menu-open={menuPath === image.relativePath}
                oncontextmenu={(event) => handleImageContextMenu(event, image.relativePath)}
                role="group"
                aria-label={image.fileName}
              >
                <button
                  type="button"
                  class="image-thumb"
                  onclick={() => (lightboxIndex = index)}
                  title={image.fileName}
                  aria-label={`Preview ${image.fileName}`}
                >
                  <img src={image.url} alt={image.fileName} loading="lazy" />
                </button>
                <div class="image-meta">
                  <span class="image-name" title={image.fileName}>{image.fileName}</span>
                  {#if imageDimensions(image)}
                    <span class="image-dims">{imageDimensions(image)}</span>
                  {/if}
                </div>
                <div class="image-menu-wrap">
                  <button
                    type="button"
                    class="image-menu-button"
                    class:active={menuPath === image.relativePath}
                    onclick={() => toggleImageMenu(image.relativePath)}
                    aria-label="Image actions"
                    aria-expanded={menuPath === image.relativePath}
                    aria-haspopup="menu"
                    title="More actions"
                  >
                    <Ellipsis size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                  {#if menuPath === image.relativePath}
                    <div class="image-menu" role="menu">
                      <button type="button" role="menuitem" onclick={() => runImageAction(image.relativePath, onOpenImageSourceNote)}>
                        <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Open source note</span>
                      </button>
                      <button type="button" role="menuitem" onclick={() => runImageAction(image.relativePath, onRevealImage)}>
                        <FolderSearch size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Show in Finder</span>
                      </button>
                      <button type="button" role="menuitem" onclick={() => runImageAction(image.relativePath, onCopyImagePath)}>
                        <Copy size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Copy path</span>
                      </button>
                      <button type="button" role="menuitem" onclick={() => runImageAction(image.relativePath, onSaveImageAs)}>
                        <Download size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Save as…</span>
                      </button>
                      <div class="image-menu-sep" role="separator"></div>
                      <button type="button" role="menuitem" class="danger" onclick={() => deleteImage(image.relativePath)}>
                        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if nestedNotes.length > 0}
        <section class="overview-section nested-section" aria-labelledby="nested-heading">
          <div class="section-heading">
            <h2 id="nested-heading">Nested Notes</h2>
            <span>{nestedNotes.length}</span>
          </div>
          <div class="nested-list">
            {#each nestedNotes.slice(0, 12) as note (note.path)}
              <button
                type="button"
                class="nested-row"
                use:noteSource={{ notePath: note.path, title: note.title }}
                onclick={() => onOpenNote(note.path)}
                oncontextmenu={(event) => handleItemContextMenu(event, note.path, note.title)}
              >
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

{#if lightboxIndex >= 0 && lightboxIndex < images.length}
  <ImageLightbox
    {images}
    index={lightboxIndex}
    onClose={() => (lightboxIndex = -1)}
    onIndexChange={(index) => (lightboxIndex = index)}
  />
{/if}

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
    flex-wrap: wrap;
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 13px;
    min-width: 0;
    flex: 1 1 240px;
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
    /* Break only at word boundaries by default; long unbroken strings
       fall back to per-character so they still wrap instead of overflowing. */
    word-break: break-word;
    overflow-wrap: break-word;
  }

  .title-copy p {
    margin: 7px 0 0;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    line-height: 1.4;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  .overview-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
    /* Anchor to the right but never crush the title-row below 240px. */
    flex: 0 1 auto;
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

  .images-section {
    margin-top: 30px;
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
    padding-top: 12px;
  }

  .image-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /* Raise the active cell so its absolute action menu paints over neighbours. */
  .image-cell.menu-open {
    z-index: 5;
  }

  .image-thumb {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    padding: 0;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    cursor: pointer;
    overflow: hidden;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .image-thumb:hover,
  .image-thumb:focus-visible {
    border-color: var(--border-medium);
    box-shadow: var(--shadow-sm);
    outline: none;
  }

  .image-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 0 2px;
  }

  .image-name {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .image-dims {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .image-menu-wrap {
    position: absolute;
    top: 6px;
    right: 6px;
  }

  .image-menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
  }

  .image-cell:hover .image-menu-button,
  .image-menu-button:focus-visible,
  .image-menu-button.active {
    opacity: 1;
  }

  .image-menu-button:hover,
  .image-menu-button.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-menu {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: var(--z-popover);
    width: 190px;
    padding: 4px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
  }

  .image-menu button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .image-menu button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-menu button :global(svg) {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .image-menu button:hover :global(svg) {
    color: var(--text-primary);
  }

  .image-menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border-light);
  }

  .image-menu button.danger,
  .image-menu button.danger :global(svg) {
    color: var(--color-error);
  }

  .image-menu button.danger:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  /* Tablet landscape & compact desktop: tighten outer padding,
     allow the action row to wrap below the title naturally. */
  @media (max-width: 879px) {
    .overview-inner {
      padding: 32px 24px 56px;
    }

    .overview-header {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }

    /* `flex: 1 1 240px` only makes sense in a horizontal header — in
       column flow it would stretch the title block to fill all the
       remaining height. Reset it. */
    .title-row {
      flex: 0 1 auto;
    }

    .overview-actions {
      justify-content: flex-start;
    }
  }

  /* Two-column grid → single-column at this point: the section list
     becomes much more readable when each row spans full width. */
  @media (max-width: 720px) {
    .overview-grid {
      grid-template-columns: 1fr;
      gap: 24px;
    }
  }

  /* Phone: stack actions full-width so they're easy to tap. */
  @media (max-width: 479px) {
    .overview-inner {
      padding: 24px 16px 48px;
    }

    .title-copy h1 {
      font-size: 22px;
    }

    .overview-actions {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }

    .action {
      width: 100%;
      justify-content: center;
    }

    .stats {
      gap: 10px 14px;
      padding: 14px 0 18px;
    }
  }
</style>
