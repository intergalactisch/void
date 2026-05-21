/**
 * Notes Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the NotesService application service.
 *
 * Provides reactive state for notes navigation including:
 * - Folder tree structure
 * - Selected note path
 * - Expanded folder tracking
 * - Search functionality
 * - Favorites tracking
 * - Recent notes history
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
import { events } from '$lib/events';
import type {
  FolderDropPosition,
  FolderMoveDirection,
  NotesService,
  NotesListItem,
  NotesState,
  SidebarPreferencesService,
  TagGroup,
} from '$lib/ports/inbound';
import type { ActionHistoryService } from '$lib/ports/inbound/ActionHistoryService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { FrecencyService } from '$lib/ports/inbound/FrecencyService';
import {
  normalizeNoteTags,
  sidebarFavoriteKey,
  type Document,
  type SidebarFavoriteKind,
  type SidebarFavoriteRef,
  type SidebarPreferences,
} from '$lib/domain';
import { settingsStore } from './settings.svelte';

/**
 * Recent note entry for tracking access history.
 */
export interface RecentNote {
  path: string;
  title: string;
  accessedAt: Date;
}

export interface FolderOverview {
  path: string;
  title: string;
  directNotes: NotesListItem[];
  directFolders: NotesListItem[];
  allNotes: NotesListItem[];
  noteCount: number;
  subfolderCount: number;
  latestModifiedAt: Date | null;
}

export type FavoriteSidebarItem = NotesListItem & {
  favoriteKind: SidebarFavoriteKind;
};

/**
 * Operation result for tracking the last completed operation.
 */
export interface OperationResult {
  type: string;
  success: boolean;
  error?: Error | undefined;
  timestamp: Date;
}

function stripFileProtocol(path: string): string {
  if (!path.startsWith('file://')) return path;

  try {
    return decodeURIComponent(new URL(path).pathname);
  } catch {
    return path.slice('file://'.length);
  }
}

function normalizeArtifactPath(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  return stripFileProtocol(trimmed).replace(/\\/g, '/').replace(/\/+$/, '');
}

function relativeToNotesRootCandidates(path: string, notesPath: string | undefined): string[] {
  if (!notesPath) return [];

  const roots = notesRootVariants(notesPath);
  const candidates: string[] = [];
  for (const root of roots) {
    if (path === root) {
      candidates.push('');
      continue;
    }
    if (path.startsWith(`${root}/`)) {
      candidates.push(path.slice(root.length + 1));
    }
  }

  const tildeRoot = roots.find((root) => root.startsWith('~/'));
  if (tildeRoot) {
    const suffix = tildeRoot.slice(2);
    const marker = `/${suffix}/`;
    const markerIndex = path.indexOf(marker);
    if (markerIndex >= 0) {
      candidates.push(path.slice(markerIndex + marker.length));
    }
  }

  return candidates;
}

function notesRootVariants(notesPath: string): string[] {
  const normalized = normalizeArtifactPath(notesPath);
  const roots = new Set<string>();
  if (normalized) roots.add(normalized);

  const userHomeMatch = normalized.match(/^\/Users\/[^/]+\/(.+)$/);
  if (userHomeMatch?.[1]) {
    roots.add(`~/${userHomeMatch[1]}`);
  }

  return [...roots].sort((a, b) => b.length - a.length);
}

function isSafeRelativeNotePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('~/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return false;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return false;
  }
  return /\.(md|markdown)$/i.test(path);
}

function isSafeRelativeFolderPath(path: string): boolean {
  if (path === '') return true;
  if (path.startsWith('/') || path.startsWith('~/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => !!segment && segment !== '.' && segment !== '..');
}

/**
 * Notes Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to notes navigation and methods
 * to manage selection, folders, and search.
 */
class NotesStore {
  #service: NotesService | null = null;
  #unsubscribe: (() => void) | null = null;
  #actionHistory: ActionHistoryService | null = null;
  #documentService: DocumentService | null = null;
  #frecency: FrecencyService | null = null;
  #sidebarPreferences: SidebarPreferencesService | null = null;
  #sidebarPreferencesUnsubscribe: (() => void) | null = null;

  /** Maximum number of recent notes to track */
  static readonly MAX_RECENT_NOTES = 5;

  // Reactive state
  items = $state<NotesListItem[]>([]);
  tagGroups = $state<TagGroup[]>([]);
  selectedPath = $state<string | null>(null);
  /**
   * Active tag detail view (rendered inline in the main app shell).
   * When non-null, the main content area shows the embedded tag detail
   * instead of the editor or empty state. Mutually exclusive with
   * `selectedPath` — selecting either one clears the other.
   */
  activeTagView = $state<string | null>(null);
  /**
   * Active virtual folder overview. Mutually exclusive with selected notes
   * and tag detail views; no markdown overview file is created.
   */
  activeFolderPath = $state<string | null>(null);
  isLoading = $state(false);
  searchQuery = $state('');
  searchResults = $state<NotesListItem[]>([]);
  expandedFolders = $state<Set<string>>(new Set());
  error = $state<Error | null>(null);

  // Sidebar visibility
  sidebarVisible = $state(true);

  // Favorites and recent notes
  favorites = $state<Set<string>>(new Set());
  favoriteRefs = $state<SidebarFavoriteRef[]>([]);
  folderOrder = $state<Record<string, string[]>>({});
  recentNotes = $state<RecentNote[]>([]);
  favoritesExpanded = $state(true);
  recentExpanded = $state(true);
  expandedTagGroups = $state<Set<string>>(new Set());

  // Multi-select state (Wave 4.3)
  // Set of note paths currently multi-selected in the sidebar. The store
  // holds the paths; UI components observe and read membership for highlight.
  selectedPaths = $state<Set<string>>(new Set());

  /** True when at least one note is multi-selected. */
  get hasMultiSelection(): boolean {
    return this.selectedPaths.size > 0;
  }

  // Navigation history (back/forward)
  #navHistory = $state<string[]>([]);
  #navIndex = $state(-1);
  #navLock = false; // Prevent history push during back/forward

  /** Whether back navigation is available */
  get canGoBack(): boolean {
    return this.#navIndex > 0;
  }

  /** Whether forward navigation is available */
  get canGoForward(): boolean {
    return this.#navIndex < this.#navHistory.length - 1;
  }

  /** Navigate back in history */
  goBack(): void {
    if (!this.canGoBack) return;
    this.#navIndex--;
    this.#navLock = true;
    this.selectNote(this.#navHistory[this.#navIndex] ?? null);
    this.#navLock = false;
  }

  /** Navigate forward in history */
  goForward(): void {
    if (!this.canGoForward) return;
    this.#navIndex++;
    this.#navLock = true;
    this.selectNote(this.#navHistory[this.#navIndex] ?? null);
    this.#navLock = false;
  }

  // Operation tracking (for event-driven architecture)
  /** Currently executing operation type, or null if idle */
  operationInProgress = $state<string | null>(null);
  /** Result of the last completed operation */
  lastOperation = $state<OperationResult | null>(null);

  /** Event listener cleanup functions */
  #eventCleanup: (() => void)[] = [];

  /**
   * Initialize the store with a NotesService instance.
   * Must be called before using any other methods.
   *
   * @param service - The NotesService to use
   */
  init(service: NotesService, deps?: {
    actionHistory?: ActionHistoryService;
    documentService?: DocumentService;
    frecency?: FrecencyService;
    sidebarPreferences?: SidebarPreferencesService;
  }) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;
    this.#actionHistory = deps?.actionHistory ?? null;
    this.#documentService = deps?.documentService ?? null;
    this.#frecency = deps?.frecency ?? null;
    this.#sidebarPreferences = deps?.sidebarPreferences ?? null;

    if (this.#sidebarPreferences) {
      this.#sidebarPreferencesUnsubscribe = this.#sidebarPreferences.subscribe((state) => {
        this.#syncSidebarPreferences(state);
      });
    }

    // Subscribe to service state updates. The service is the source of
    // truth for `selectedPath` — when it changes (e.g. after a note is
    // created with autoFocus), we mirror it AND track it in the recent
    // list, so newly-created notes show up there immediately. Without
    // this, recents only updated through the store's own `selectNote`
    // and notes were missed when the service drove the selection.
    this.#unsubscribe = service.subscribe((state: NotesState) => {
      const previouslySelected = this.selectedPath;
      this.items = state.items;
      this.tagGroups = state.tagGroups;
      this.selectedPath = state.selectedPath;
      this.isLoading = state.isLoading;
      this.expandedFolders = new Set(state.expandedFolders);
      this.#syncExpandedTagGroups(state.tagGroups);
      if (state.selectedPath) {
        this.activeTagView = null;
        this.activeFolderPath = null;
      }
      if (state.selectedPath && state.selectedPath !== previouslySelected) {
        this.#addToRecent(state.selectedPath);
      }
    });

    // Initialize with current state
    const initialState = service.getState();
    this.items = initialState.items;
    this.tagGroups = initialState.tagGroups;
    this.selectedPath = initialState.selectedPath;
    if (initialState.selectedPath) {
      this.activeTagView = null;
      this.activeFolderPath = null;
    }
    this.isLoading = initialState.isLoading;
    this.expandedFolders = new Set(initialState.expandedFolders);
    this.#syncExpandedTagGroups(initialState.tagGroups);
    this.#hydrateRecentNotes();

    // Subscribe to command lifecycle events for operation tracking
    this.#subscribeToEvents();
  }

  /**
   * Subscribe to command lifecycle events to track operation state.
   */
  #subscribeToEvents() {
    // Track when commands start
    const handleStarted = (event: { commandId: string; commandType: string }) => {
      if (event.commandType.startsWith('note:')) {
        this.operationInProgress = event.commandType;
      }
    };

    // Track when commands complete
    const handleCompleted = (event: { commandId: string; commandType: string }) => {
      if (event.commandType.startsWith('note:')) {
        this.operationInProgress = null;
        this.lastOperation = {
          type: event.commandType,
          success: true,
          timestamp: new Date(),
        };
      }
    };

    // Track when commands fail
    const handleFailed = (event: { commandId: string; commandType: string; error: string }) => {
      if (event.commandType.startsWith('note:')) {
        this.operationInProgress = null;
        this.lastOperation = {
          type: event.commandType,
          success: false,
          error: new Error(event.error),
          timestamp: new Date(),
        };
      }
    };

    events.on('command:started', handleStarted);
    events.on('command:completed', handleCompleted);
    events.on('command:failed', handleFailed);

    const handleDocumentSaved = () => {
      if (this.#service) {
        void this.refresh();
      }
    };

    events.on('document:saved', handleDocumentSaved);

    // Store cleanup functions
    this.#eventCleanup = [
      () => events.off('command:started', handleStarted),
      () => events.off('command:completed', handleCompleted),
      () => events.off('command:failed', handleFailed),
      () => events.off('document:saved', handleDocumentSaved),
    ];
  }

  // =========================================================================
  // Lifecycle methods
  // =========================================================================

  /**
   * Load notes from the service.
   */
  async load(): Promise<void> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.isLoading = true;
    this.error = null;

    try {
      const result = await this.#service.loadFolderTree();
      if (!result.ok) {
        this.error = result.error;
        events.emit('error:user-facing', { source: 'Loading notes', error: result.error });
      } else {
        this.#hydrateRecentNotes();
      }
    } catch (e) {
      this.error = toError(e);
      events.emit('error:user-facing', { source: 'Loading notes', error: this.error });
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Refresh notes from the service.
   */
  async refresh(): Promise<void> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    try {
      const result = await this.#service.refresh();
      if (!result.ok) {
        this.error = result.error;
        events.emit('error:user-facing', { source: 'Refreshing notes', error: result.error });
      } else {
        this.#hydrateRecentNotes();
      }
    } catch (e) {
      this.error = toError(e);
      events.emit('error:user-facing', { source: 'Refreshing notes', error: this.error });
    }
  }

  // =========================================================================
  // Note operations
  // =========================================================================

  /**
   * Create a new note.
   *
   * @param title - Note title
   * @param folder - Optional folder path
   * @returns The created document or null on error
   */
  async createNote(title: string, folder = ''): Promise<Document | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    const result = await this.#service.createNote(folder, title);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Creating note', error: result.error });
      return null;
    }

    return result.value;
  }

  /**
   * Create a new note instantly with datetime-based filename.
   *
   * @param folder - Optional folder path
   * @returns The created document or null on error
   */
  /**
   * Create a new folder.
   * Refreshes the tree, expands the new folder, and selects it as the folder view.
   * @returns the new folder's relative path, or null on failure (this.error set).
   */
  async createFolder(parentPath: string | null, name: string): Promise<string | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;
    const result = await this.#service.createFolder(parentPath, name);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Creating folder', error: result.error });
      return null;
    }

    const newPath = result.value;
    if (parentPath) this.#service.expandFolder(parentPath);
    this.#service.expandFolder(newPath);
    this.selectFolderView(newPath);
    return newPath;
  }

  /**
   * Recursively delete a folder and everything inside. Refreshes the tree
   * and clears active selection if it was inside the deleted folder.
   */
  async deleteFolder(path: string): Promise<boolean> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;
    const result = await this.#service.deleteFolder(path);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Deleting folder', error: result.error });
      return false;
    }

    const active = this.activeFolderPath;
    if (active && (active === path || active.startsWith(`${path}/`))) {
      this.selectFolderView(null);
    }
    await this.#deleteSidebarPath(path, 'folder');
    return true;
  }

  /**
   * Rename a folder. Children paths are remapped via note:renamed events.
   * Returns the new folder path, or null on failure (this.error is set).
   */
  async renameFolder(path: string, newName: string): Promise<string | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;
    const result = await this.#service.renameFolder(path, newName);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Renaming folder', error: result.error });
      return null;
    }

    const newPath = result.value;
    const oldPrefix = `${path}/`;
    const newPrefix = `${newPath}/`;
    const active = this.activeFolderPath;
    if (active === path) {
      this.selectFolderView(newPath);
    } else if (active && active.startsWith(oldPrefix)) {
      this.selectFolderView(`${newPrefix}${active.slice(oldPrefix.length)}`);
    }
    await this.#renameSidebarPath(path, newPath, 'folder');
    return newPath;
  }

  /**
   * Count notes + folders inside a folder. Used by the delete-confirm dialog.
   */
  countFolderContents(path: string): { notes: number; folders: number } {
    if (!this.#service) return { notes: 0, folders: 0 };
    return this.#service.countFolderContents(path);
  }

  async createQuickNote(folder = ''): Promise<Document | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    const result = await this.#service.createQuickNote(folder);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Creating note', error: result.error });
      return null;
    }

    return result.value;
  }

  /**
   * Create a quick note in a virtual tag folder.
   *
   * The file still lives in the normal markdown tree; only frontmatter tags
   * define membership in the sidebar's tag folders.
   */
  async createQuickNoteWithTags(tags: string[], folder = ''): Promise<Document | null> {
    const normalizedTags = normalizeNoteTags(tags);
    const document = await this.createQuickNote(folder);
    if (!document) return null;

    if (normalizedTags.length === 0) {
      return document;
    }

    const taggedDocument: Document = {
      ...document,
      meta: {
        ...document.meta,
        tags: normalizedTags,
        updatedAt: new Date(),
      },
      isDirty: true,
    };

    const saveResult = await this.saveDocument(taggedDocument);
    if (!saveResult.ok) {
      return null;
    }

    this.#expandTagGroups(normalizedTags);
    await this.refresh();
    this.selectNote(document.path);

    return {
      ...taggedDocument,
      isDirty: false,
    };
  }

  /**
   * Load a document by path. Pure read; does not change selection or
   * editor state. Used by the page component to fetch the active document
   * for the editor shell.
   *
   * @param path - Relative path to the document
   * @returns The loaded document, or null if loading failed (error stored on `this.error`)
   */
  async loadDocument(path: string): Promise<Document | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    const result = await this.#service.loadDocument(path);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: `Loading ${path}`, error: result.error });
      return null;
    }

    return result.value;
  }

  /**
   * Persist a document. Returns the underlying Result so the editor shell
   * can distinguish "saved" from "save failed".
   */
  async saveDocument(document: Document): Promise<{ ok: true } | { ok: false; error: Error }> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    const result = await this.#service.saveDocument(document);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: `Saving ${document.path}`, error: result.error });
      return { ok: false, error: result.error };
    }
    return { ok: true };
  }

  /**
   * Duplicate a note by creating a copy with "(copy)" appended to title.
   *
   * @param path - Path of the note to duplicate
   * @returns The duplicated document or null on error
   */
  async duplicateNote(path: string): Promise<Document | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    // Extract folder from path
    const lastSlash = path.lastIndexOf('/');
    const folder = lastSlash > 0 ? path.substring(0, lastSlash) : '';
    const filename = lastSlash > 0 ? path.substring(lastSlash + 1) : path;
    const titleBase = filename.replace(/\.md$/, '');
    const newTitle = `${titleBase} (copy)`;

    const result = await this.#service.createNote(folder, newTitle);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }

    return result.value;
  }

  /**
   * Delete a note.
   *
   * @param path - Path to the note to delete
   */
  async deleteNote(path: string): Promise<boolean> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    // Capture content before delete so the action-history undo can restore.
    let restorePayload: { content: string; title: string; folder: string } | null = null;
    if (this.#documentService && this.#actionHistory) {
      const contentResult = await this.#documentService.readContent(path);
      if (contentResult.ok) {
        const lastSlash = path.lastIndexOf('/');
        const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
        const filename = (lastSlash >= 0 ? path.slice(lastSlash + 1) : path).replace(/\.md$/i, '');
        restorePayload = { content: contentResult.value, title: filename, folder };
      }
    }

    const result = await this.#service.deleteNote(path);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: `Deleting ${path}`, error: result.error });
      return false;
    }

    if (this.selectedPath === path) {
      this.selectNote(null);
    }
    await this.#deleteSidebarPath(path, 'note');
    this.#forgetDeletedNote(path);

    // Record an action so Mod+Shift+Z can resurrect the note.
    if (restorePayload && this.#actionHistory && this.#documentService) {
      const docService = this.#documentService;
      const { content, title, folder } = restorePayload;
      this.#actionHistory.record({
        type: 'note.delete',
        summary: `Deleted "${title}"`,
        undo: async () => {
          const result = await docService.createWithContent(folder, title, content);
          if (!result.ok) throw result.error;
        },
      });
    }

    return true;
  }

  // ─── Multi-select operations (Wave 4.3) ───

  /**
   * Toggle a path in/out of the multi-selection. Returns the new selection size.
   */
  toggleSelection(path: string): number {
    const next = new Set(this.selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this.selectedPaths = next;
    return next.size;
  }

  /** Add a path to the multi-selection (no-op if already selected). */
  addToSelection(path: string): void {
    if (this.selectedPaths.has(path)) return;
    const next = new Set(this.selectedPaths);
    next.add(path);
    this.selectedPaths = next;
  }

  /** Add a range of paths in document order (e.g., shift-click). */
  addRangeToSelection(paths: string[]): void {
    const next = new Set(this.selectedPaths);
    for (const path of paths) next.add(path);
    this.selectedPaths = next;
  }

  /** Clear the multi-selection. */
  clearSelection(): void {
    if (this.selectedPaths.size === 0) return;
    this.selectedPaths = new Set();
  }

  /**
   * Delete every multi-selected note. Each deletion captures content and
   * registers an undo entry, so a single Cmd+Shift+Z resurrects the most
   * recent. Returns the count of successful deletions.
   */
  async deleteSelected(): Promise<number> {
    const paths = Array.from(this.selectedPaths);
    if (paths.length === 0) return 0;

    let deleted = 0;
    for (const path of paths) {
      const ok = await this.deleteNote(path);
      if (ok) deleted += 1;
    }
    this.clearSelection();
    return deleted;
  }

  /**
   * Add a tag to every multi-selected note. Records a single bulk action
   * in ActionHistoryService so Cmd+Shift+Z removes the tag from all
   * affected notes in one step.
   */
  async tagSelected(rawTag: string): Promise<number> {
    const docService = this.#documentService;
    if (!docService) return 0;
    const tag = normalizeNoteTags([rawTag])[0];
    if (!tag) return 0;
    const paths = Array.from(this.selectedPaths);
    if (paths.length === 0) return 0;

    // Track which notes were actually modified so undo only affects those.
    const modifiedPaths: string[] = [];
    let added = 0;
    for (const path of paths) {
      const metaResult = await docService.readMeta(path);
      if (!metaResult.ok) continue;
      const existingTags = metaResult.value.tags ?? [];
      if (existingTags.includes(tag)) continue;
      const next = normalizeNoteTags([...existingTags, tag]);
      const writeResult = await docService.updateMeta(path, { tags: next });
      if (writeResult.ok) {
        modifiedPaths.push(path);
        added += 1;
      }
    }

    if (added > 0 && this.#actionHistory) {
      this.#actionHistory.record({
        type: 'notes.bulkTag',
        summary: `Tagged ${added} note${added === 1 ? '' : 's'} with #${tag}`,
        undo: async () => {
          for (const path of modifiedPaths) {
            const metaResult = await docService.readMeta(path);
            if (!metaResult.ok) continue;
            const existing = metaResult.value.tags ?? [];
            const without = existing.filter((t) => t !== tag);
            await docService.updateMeta(path, { tags: without });
          }
        },
      });
    }

    return added;
  }

  /**
   * Rename a note.
   *
   * @param path - Current path
   * @param newTitle - New title
   * @returns The new path or null on error
   */
  async renameNote(path: string, newTitle: string): Promise<string | null> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.error = null;

    const result = await this.#service.renameNote(path, newTitle);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: `Renaming ${path}`, error: result.error });
      return null;
    }

    this.#moveRenamedNoteReferences(path, result.value, newTitle);
    await this.#renameSidebarPath(path, result.value, 'note');
    return result.value;
  }

  // =========================================================================
  // Selection
  // =========================================================================

  /**
   * Select a note by path.
   * Also tracks the note in recent history.
   *
   * @param path - Path to select, or null to deselect
   */
  selectNote(path: string | null): void {
    if (!this.#service) throw new Error('NotesStore not initialized');
    this.#service.selectNote(path);

    // Plain selection clears any multi-select — switching focus to a single
    // note implies the user is no longer batch-managing.
    if (this.selectedPaths.size > 0) {
      this.selectedPaths = new Set();
    }

    // Selecting any note exits the embedded tag detail view.
    if (path) {
      this.activeTagView = null;
      this.activeFolderPath = null;
    } else {
      this.activeFolderPath = null;
    }

    // Track in navigation history (skip during back/forward)
    if (path && !this.#navLock) {
      // Truncate any forward history
      this.#navHistory = this.#navHistory.slice(0, this.#navIndex + 1);
      // Don't push duplicate
      if (this.#navHistory[this.#navHistory.length - 1] !== path) {
        this.#navHistory.push(path);
      }
      this.#navIndex = this.#navHistory.length - 1;
    }

    // Track in recent notes if a valid note is selected
    if (path) {
      this.#addToRecent(path);
    }
  }

  /**
   * Show the embedded tag detail view for the given tag (or close it
   * with `null`). Mutually exclusive with `selectedPath` — selecting a
   * tag deselects any currently open note. The sidebar is forced visible
   * so users have a navigational anchor while browsing the tag.
   */
  selectTagView(tag: string | null): void {
    if (tag === null) {
      this.activeTagView = null;
      return;
    }

    if (this.selectedPath !== null) {
      this.selectNote(null);
    }
    this.activeFolderPath = null;
    this.activeTagView = tag;
    this.sidebarVisible = true;
  }

  /**
   * Show the virtual overview for a folder. No note file is opened or
   * created; this is a navigation state over the current folder tree.
   */
  selectFolderView(path: string | null): void {
    if (!this.#service) throw new Error('NotesStore not initialized');

    if (!path) {
      this.activeFolderPath = null;
      return;
    }

    const resolved = this.resolveFolderPathByAnyPath(path);
    if (resolved === null) {
      this.error = new Error(`Could not find folder in current notes folder: ${path}`);
      return;
    }

    this.expandFolderPath(resolved);
    this.#service.selectNote(null);
    this.selectedPath = null;
    this.activeTagView = null;
    this.activeFolderPath = resolved;
    this.sidebarVisible = true;
    if (this.selectedPaths.size > 0) {
      this.selectedPaths = new Set();
    }
  }

  selectFolderByAnyPath(path: string | null): boolean {
    if (!path) {
      this.selectFolderView(null);
      return true;
    }

    const resolved = this.resolveFolderPathByAnyPath(path);
    if (resolved === null) {
      this.error = new Error(`Could not find folder in current notes folder: ${path}`);
      return false;
    }

    this.selectFolderView(resolved);
    return true;
  }

  /**
   * Select a note from either a relative note path or an absolute source file path.
   */
  selectNoteByAnyPath(path: string | null): boolean {
    if (!path) {
      this.selectNote(null);
      return true;
    }

    const resolved = this.resolveNotePathByAnyPath(path);
    if (!resolved) {
      this.error = new Error(`Could not find note in current notes folder: ${path}`);
      return false;
    }

    this.selectNote(resolved);
    return true;
  }

  /**
   * Resolve an artifact/source path into the relative note path used by the app.
   */
  resolveNotePathByAnyPath(path: string | null): string | null {
    if (!path) return null;

    const candidates = this.#notePathCandidates(path);
    for (const candidate of candidates) {
      const exact = this.#findNoteByPath(this.items, candidate);
      if (exact && !exact.isFolder) {
        return exact.path;
      }
    }

    const all = this.#flattenNotes(this.items);
    for (const candidate of candidates) {
      const match = all.find((note) => candidate.endsWith('/' + note.path) || candidate === note.path);
      if (match) return match.path;
    }

    return candidates.find((candidate) => isSafeRelativeNotePath(candidate)) ?? null;
  }

  resolveFolderPathByAnyPath(path: string | null): string | null {
    if (path === null) return null;

    const candidates = this.#folderPathCandidates(path);
    for (const candidate of candidates) {
      const exact = this.#findNoteByPath(this.items, candidate);
      if (exact?.isFolder) return exact.path;
    }

    return candidates.find((candidate) => isSafeRelativeFolderPath(candidate)) ?? null;
  }

  // =========================================================================
  // Favorites
  // =========================================================================

  /**
   * Toggle a note or folder's favorite status.
   *
   * @param path - Path of the note/folder to toggle
   * @param kind - Favorite item kind
   */
  toggleFavorite(path: string, kind: SidebarFavoriteKind = 'note'): void {
    const ref = this.#favoriteRef(path, kind);
    if (!ref) return;

    if (this.#sidebarPreferences) {
      void this.#sidebarPreferences.toggleFavorite(ref).then((result) => {
        if (!result.ok) {
          events.emit('error:user-facing', { source: 'Updating favorites', error: result.error });
        }
      });
      return;
    }

    this.#toggleLocalFavorite(ref);
  }

  /**
   * Add a note to favorites. Kept for compatibility with older note-only callers.
   */
  addFavorite(path: string): void {
    const ref = this.#favoriteRef(path, 'note');
    if (!ref || this.isFavorite(ref.path, ref.kind)) return;

    if (this.#sidebarPreferences) {
      void this.#sidebarPreferences.toggleFavorite(ref).then((result) => {
        if (!result.ok) {
          events.emit('error:user-facing', { source: 'Updating favorites', error: result.error });
        }
      });
      return;
    }

    this.#addLocalFavorite(ref);
  }

  /**
   * Remove a note from favorites. Kept for compatibility with older note-only callers.
   */
  removeFavorite(path: string): void {
    const ref = this.#favoriteRef(path, 'note');
    if (!ref) return;

    if (this.#sidebarPreferences) {
      void this.#sidebarPreferences.removeFavorite(ref).then((result) => {
        if (!result.ok) {
          events.emit('error:user-facing', { source: 'Updating favorites', error: result.error });
        }
      });
      return;
    }

    this.#removeLocalFavorite(ref);
  }

  /**
   * Check if a note or folder is a favorite.
   */
  isFavorite(path: string, kind: SidebarFavoriteKind = 'note'): boolean {
    const ref = this.#favoriteRef(path, kind);
    if (!ref) return false;
    const key = sidebarFavoriteKey(ref);
    return this.favoriteRefs.some((favorite) => sidebarFavoriteKey(favorite) === key);
  }

  canMoveFolder(path: string, direction: FolderMoveDirection): boolean {
    const parentPath = this.getFolderParentPath(path);
    const siblings = this.getSiblingFolders(parentPath);
    const index = siblings.findIndex((folder) => folder.path === path);
    if (index < 0) return false;
    return direction === 'up' ? index > 0 : index < siblings.length - 1;
  }

  async moveFolder(path: string, direction: FolderMoveDirection): Promise<boolean> {
    if (!this.#sidebarPreferences) return false;
    const parentPath = this.getFolderParentPath(path);
    const siblingPaths = this.getSiblingFolders(parentPath).map((folder) => folder.path);
    const result = await this.#sidebarPreferences.moveFolder(parentPath, path, direction, siblingPaths);
    if (!result.ok) {
      events.emit('error:user-facing', { source: 'Moving folder', error: result.error });
      return false;
    }
    return true;
  }

  async reorderFolder(
    path: string,
    targetPath: string,
    position: FolderDropPosition
  ): Promise<boolean> {
    if (!this.#sidebarPreferences) return false;
    const parentPath = this.getFolderParentPath(path);
    if (parentPath !== this.getFolderParentPath(targetPath)) return false;
    const siblingPaths = this.getSiblingFolders(parentPath).map((folder) => folder.path);
    const result = await this.#sidebarPreferences.reorderFolder(parentPath, path, targetPath, position, siblingPaths);
    if (!result.ok) {
      events.emit('error:user-facing', { source: 'Reordering folders', error: result.error });
      return false;
    }
    return true;
  }

  getFolderParentPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  }

  getSiblingFolders(parentPath: string): NotesListItem[] {
    const parent = parentPath ? this.#findNoteByPath(this.items, parentPath) : null;
    const children = parentPath ? parent?.children ?? [] : this.items;
    return this.#orderItems(children, parentPath).filter((item) => item.isFolder);
  }

  /**
   * Toggle favorites section expansion.
   */
  toggleFavoritesExpanded(): void {
    this.favoritesExpanded = !this.favoritesExpanded;
  }

  /**
   * Toggle recent notes section expansion.
   */
  toggleRecentExpanded(): void {
    this.recentExpanded = !this.recentExpanded;
  }

  /**
   * Toggle a virtual tag folder.
   */
  toggleTagGroup(id: string): void {
    const next = new Set(this.expandedTagGroups);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.expandedTagGroups = next;
  }

  /**
   * Check if a virtual tag folder is expanded.
   */
  isTagGroupExpanded(id: string): boolean {
    return this.expandedTagGroups.has(id);
  }

  // =========================================================================
  // Recent Notes
  // =========================================================================

  /**
   * Add a note to recent history.
   * Removes duplicates and maintains max count.
   *
   * @param path - Path of the note to add
   */
  #addToRecent(path: string): void {
    // Find the note title from items
    const note = this.#findNoteByPath(this.items, path);
    if (!note || note.isFolder) return;

    this.#frecency?.record('note', path);

    const newRecent: RecentNote = {
      path,
      title: note.title,
      accessedAt: new Date(),
    };

    // Remove existing entry for this path
    const filtered = this.recentNotes.filter((r) => r.path !== path);

    // Add to front and limit to max
    this.recentNotes = [newRecent, ...filtered].slice(0, NotesStore.MAX_RECENT_NOTES);
  }

  /**
   * Rebuild sidebar recents from persisted note access history, while keeping
   * any current-session entries when persistence is unavailable.
   */
  #hydrateRecentNotes(): void {
    const byPath = new Map<string, RecentNote>();

    if (this.#frecency) {
      for (const entry of this.#frecency.lastAccessed('note', NotesStore.MAX_RECENT_NOTES)) {
        const note = this.#findNoteByPath(this.items, entry.id);
        if (!note || note.isFolder) continue;
        byPath.set(entry.id, {
          path: entry.id,
          title: note.title,
          accessedAt: new Date(entry.lastAt),
        });
      }
    }

    for (const recent of this.recentNotes) {
      if (byPath.has(recent.path)) continue;
      const note = this.#findNoteByPath(this.items, recent.path);
      if (!note || note.isFolder) continue;
      byPath.set(recent.path, {
        ...recent,
        title: note.title,
      });
    }

    this.recentNotes = Array.from(byPath.values())
      .sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
      .slice(0, NotesStore.MAX_RECENT_NOTES);
  }

  /**
   * Find a note by path in the tree.
   */
  #findNoteByPath(items: NotesListItem[], path: string): NotesListItem | null {
    for (const item of items) {
      if (item.path === path) return item;
      if (item.isFolder && item.children) {
        const found = this.#findNoteByPath(item.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  #notePathCandidates(path: string): string[] {
    const cleaned = normalizeArtifactPath(path);
    const candidates = new Set<string>();
    if (cleaned) candidates.add(cleaned);

    for (const relative of relativeToNotesRootCandidates(cleaned, settingsStore.get('notesPath'))) {
      if (relative) candidates.add(relative);
    }

    return [...candidates];
  }

  #folderPathCandidates(path: string): string[] {
    const cleaned = normalizeArtifactPath(path);
    const candidates = new Set<string>();

    const add = (candidate: string) => {
      const normalized = candidate
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');

      if (/\.(md|markdown)$/i.test(normalized)) {
        const parts = normalized.split('/');
        parts.pop();
        candidates.add(parts.join('/'));
        return;
      }

      candidates.add(normalized);
    };

    if (cleaned) add(cleaned);

    for (const relative of relativeToNotesRootCandidates(cleaned, settingsStore.get('notesPath'))) {
      add(relative);
    }

    return [...candidates];
  }

  /**
   * Clear recent notes history.
   */
  clearRecentNotes(): void {
    this.recentNotes = [];
    this.#frecency?.clear('note');
  }

  /**
   * Remove a single note from recent history without touching the note.
   */
  removeRecentNote(path: string): void {
    this.recentNotes = this.recentNotes.filter((recent) => recent.path !== path);
    this.#frecency?.forget('note', path);
  }

  // =========================================================================
  // Folder operations
  // =========================================================================

  /**
   * Toggle folder expansion.
   *
   * @param path - Folder path to toggle
   */
  toggleFolder(path: string): void {
    if (!this.#service) throw new Error('NotesStore not initialized');
    this.#service.toggleFolder(path);
  }

  /**
   * Expand a folder.
   *
   * @param path - Folder path to expand
   */
  expandFolder(path: string): void {
    if (!this.#service) throw new Error('NotesStore not initialized');
    this.#service.expandFolder(path);
  }

  /**
   * Expand a nested folder and all of its ancestors.
   */
  expandFolderPath(path: string): void {
    if (!this.#service) throw new Error('NotesStore not initialized');
    if (!path) return;

    const segments = path.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.#service.expandFolder(current);
    }
  }

  /**
   * Collapse a folder.
   *
   * @param path - Folder path to collapse
   */
  collapseFolder(path: string): void {
    if (!this.#service) throw new Error('NotesStore not initialized');
    this.#service.collapseFolder(path);
  }

  /**
   * Check if a folder is expanded.
   *
   * @param path - Folder path to check
   * @returns True if expanded
   */
  isFolderExpanded(path: string): boolean {
    return this.expandedFolders.has(path);
  }

  // =========================================================================
  // Search
  // =========================================================================

  /**
   * Search notes by title.
   *
   * @param query - Search query
   */
  async search(query: string): Promise<void> {
    if (!this.#service) throw new Error('NotesStore not initialized');

    this.searchQuery = query;

    if (!query.trim()) {
      this.searchResults = [];
      return;
    }

    const result = await this.#service.searchNotes(query);
    if (result.ok) {
      this.searchResults = result.value;
    }
  }

  /**
   * Clear search query and results.
   */
  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
  }

  // =========================================================================
  // Sidebar visibility
  // =========================================================================

  /**
   * Toggle sidebar visibility.
   */
  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
  }

  /**
   * Show the sidebar.
   */
  showSidebar(): void {
    this.sidebarVisible = true;
  }

  /**
   * Hide the sidebar.
   */
  hideSidebar(): void {
    this.sidebarVisible = false;
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  /**
   * Check if the store has been initialized.
   * Note: This remains a getter because it depends on a private non-reactive field.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if there are any notes.
   * Uses $derived for proper Svelte 5 reactivity.
   */
  hasNotes = $derived(this.items.length > 0);

  /**
   * Check if a search is active.
   * Uses $derived for proper Svelte 5 reactivity.
   */
  isSearching = $derived(this.searchQuery.trim().length > 0);

  /**
   * Get the total note count (excluding folders).
   * Uses $derived.by for proper Svelte 5 reactivity with method calls.
   */
  noteCount = $derived.by(() => this.#countNotes(this.items));

  /**
   * Get flattened list of all notes (for quick switcher).
   * Uses $derived.by for proper Svelte 5 reactivity with method calls.
   */
  allNotes = $derived.by(() => this.#flattenNotes(this.items));

  /**
   * Folder tree with visual per-parent folder order applied.
   */
  orderedItems = $derived.by(() => this.#orderItems(this.items, ''));

  /**
   * Overview model for the currently selected virtual folder.
   */
  activeFolderOverview = $derived.by(() => (
    this.activeFolderPath === null ? null : this.getFolderOverview(this.activeFolderPath)
  ));

  /**
   * Check if any operation is currently in progress.
   */
  isBusy = $derived(this.operationInProgress !== null);

  /**
   * Check if the last operation succeeded.
   */
  lastOperationSucceeded = $derived(this.lastOperation?.success ?? true);

  /**
   * Get list of favorite notes/folders as sidebar items.
   */
  favoriteItems = $derived.by(() => {
    const favList: FavoriteSidebarItem[] = [];
    for (const ref of this.favoriteRefs) {
      const item = this.#findNoteByPath(this.items, ref.path);
      if (!item) continue;
      if (ref.kind === 'folder' && !item.isFolder) continue;
      if (ref.kind === 'note' && item.isFolder) continue;
      favList.push({ ...item, favoriteKind: ref.kind });
    }
    return favList;
  });

  /**
   * Get list of favorite notes as NotesListItem.
   * Uses $derived.by for proper Svelte 5 reactivity.
   */
  favoriteNotes = $derived.by(() => this.favoriteItems.filter((item) => !item.isFolder));

  /**
   * Check if there are any favorites.
   */
  hasFavorites = $derived(this.favoriteItems.length > 0);

  /**
   * Check if there are any recent notes.
   */
  hasRecentNotes = $derived(this.recentNotes.length > 0);

  getFolderOverview(path: string): FolderOverview | null {
    const folder = this.#findNoteByPath(this.items, path);
    if (folder && !folder.isFolder) return null;

    const children = folder?.children ?? [];
    const orderedChildren = this.#orderItems(children, path);
    const directFolders = orderedChildren.filter((item) => item.isFolder);
    const directNotes = children.filter((item) => !item.isFolder);
    const allNotes = this.#flattenNotes(children);
    const latestModifiedAt = allNotes.reduce<Date | null>((latest, note) => {
      if (!latest || note.modifiedAt.getTime() > latest.getTime()) return note.modifiedAt;
      return latest;
    }, null);

    return {
      path,
      title: folder?.title ?? path.split('/').filter(Boolean).at(-1) ?? 'Workspace',
      directNotes,
      directFolders,
      allNotes,
      noteCount: allNotes.length,
      subfolderCount: this.#countFolders(children),
      latestModifiedAt,
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Count notes recursively (excluding folders).
   */
  #countNotes(items: NotesListItem[]): number {
    let count = 0;
    for (const item of items) {
      if (item.isFolder) {
        count += this.#countNotes(item.children || []);
      } else {
        count++;
      }
    }
    return count;
  }

  /**
   * Count folders recursively.
   */
  #countFolders(items: NotesListItem[]): number {
    let count = 0;
    for (const item of items) {
      if (!item.isFolder) continue;
      count++;
      count += this.#countFolders(item.children || []);
    }
    return count;
  }

  /**
   * Flatten notes recursively (excluding folders).
   */
  #flattenNotes(items: NotesListItem[]): NotesListItem[] {
    const result: NotesListItem[] = [];
    for (const item of items) {
      if (item.isFolder) {
        result.push(...this.#flattenNotes(item.children || []));
      } else {
        result.push(item);
      }
    }
    return result;
  }

  #orderItems(items: NotesListItem[], parentPath: string): NotesListItem[] {
    const folders = items
      .filter((item) => item.isFolder)
      .map((item) => ({
        ...item,
        children: item.children ? this.#orderItems(item.children, item.path) : [],
      }));
    const notes = items.filter((item) => !item.isFolder);

    const order = this.folderOrder[parentPath] ?? [];
    const orderIndex = new Map(order.map((path, index) => [path, index]));

    folders.sort((a, b) => {
      const aIndex = orderIndex.get(a.path);
      const bIndex = orderIndex.get(b.path);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return a.title.localeCompare(b.title);
    });

    return [...folders, ...notes];
  }

  #favoriteRef(path: string, kind: SidebarFavoriteKind): SidebarFavoriteRef | null {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    return { kind, path: normalized };
  }

  #syncSidebarPreferences(state: SidebarPreferences): void {
    this.favoriteRefs = state.favorites.map((favorite) => ({ ...favorite }));
    this.folderOrder = Object.fromEntries(
      Object.entries(state.folderOrder).map(([parent, order]) => [parent, [...order]])
    );
    this.favorites = new Set(
      this.favoriteRefs
        .filter((favorite) => favorite.kind === 'note')
        .map((favorite) => favorite.path)
    );
  }

  #toggleLocalFavorite(ref: SidebarFavoriteRef): void {
    if (this.isFavorite(ref.path, ref.kind)) {
      this.#removeLocalFavorite(ref);
    } else {
      this.#addLocalFavorite(ref);
    }
  }

  #addLocalFavorite(ref: SidebarFavoriteRef): void {
    const key = sidebarFavoriteKey(ref);
    if (this.favoriteRefs.some((favorite) => sidebarFavoriteKey(favorite) === key)) return;
    this.favoriteRefs = [...this.favoriteRefs, ref];
    if (ref.kind === 'note') {
      this.favorites = new Set([...this.favorites, ref.path]);
    }
  }

  #removeLocalFavorite(ref: SidebarFavoriteRef): void {
    const key = sidebarFavoriteKey(ref);
    this.favoriteRefs = this.favoriteRefs.filter((favorite) => sidebarFavoriteKey(favorite) !== key);
    if (ref.kind === 'note') {
      const next = new Set(this.favorites);
      next.delete(ref.path);
      this.favorites = next;
    }
  }

  async #renameSidebarPath(
    oldPath: string,
    newPath: string,
    kind: SidebarFavoriteKind
  ): Promise<void> {
    if (this.#sidebarPreferences) {
      const result = await this.#sidebarPreferences.renamePath(oldPath, newPath, kind);
      if (!result.ok) {
        events.emit('error:user-facing', { source: 'Updating sidebar preferences', error: result.error });
      }
      return;
    }

    if (kind === 'note') {
      this.favoriteRefs = this.favoriteRefs.map((favorite) =>
        favorite.kind === 'note' && favorite.path === oldPath
          ? { ...favorite, path: newPath }
          : favorite
      );
      return;
    }

    this.favoriteRefs = this.favoriteRefs.map((favorite) =>
      this.#isSameOrUnder(favorite.path, oldPath)
        ? { ...favorite, path: this.#remapPathUnder(favorite.path, oldPath, newPath) }
        : favorite
    );

    const nextOrder: Record<string, string[]> = {};
    for (const [parent, order] of Object.entries(this.folderOrder)) {
      const nextParent = this.#remapPathUnder(parent, oldPath, newPath);
      nextOrder[nextParent] = order.map((folderPath) =>
        this.#remapPathUnder(folderPath, oldPath, newPath)
      );
    }
    this.folderOrder = nextOrder;
  }

  async #deleteSidebarPath(path: string, kind: SidebarFavoriteKind): Promise<void> {
    if (this.#sidebarPreferences) {
      const result = await this.#sidebarPreferences.deletePath(path, kind);
      if (!result.ok) {
        events.emit('error:user-facing', { source: 'Updating sidebar preferences', error: result.error });
      }
      return;
    }

    this.favoriteRefs = this.favoriteRefs.filter((favorite) =>
      kind === 'folder'
        ? !this.#isSameOrUnder(favorite.path, path)
        : !(favorite.kind === 'note' && favorite.path === path)
    );
    this.favorites = new Set(this.favoriteRefs.filter((favorite) => favorite.kind === 'note').map((favorite) => favorite.path));

    if (kind !== 'folder') return;

    const nextOrder: Record<string, string[]> = {};
    for (const [parent, order] of Object.entries(this.folderOrder)) {
      if (this.#isSameOrUnder(parent, path)) continue;
      const next = order.filter((folderPath) => !this.#isSameOrUnder(folderPath, path));
      if (next.length > 0) nextOrder[parent] = next;
    }
    this.folderOrder = nextOrder;
  }

  #isSameOrUnder(path: string, parent: string): boolean {
    return path === parent || path.startsWith(`${parent}/`);
  }

  #remapPathUnder(path: string, oldPath: string, newPath: string): string {
    if (path === oldPath) return newPath;
    const oldPrefix = `${oldPath}/`;
    if (!path.startsWith(oldPrefix)) return path;
    return `${newPath}/${path.slice(oldPrefix.length)}`;
  }

  #syncExpandedTagGroups(groups: TagGroup[]): void {
    const currentIds = new Set(groups.map((group) => group.id));
    const next = new Set([...this.expandedTagGroups].filter((id) => currentIds.has(id)));
    this.expandedTagGroups = next;
  }

  #expandTagGroups(ids: string[]): void {
    const next = new Set(this.expandedTagGroups);
    for (const id of ids) {
      next.add(id);
    }
    this.expandedTagGroups = next;
  }

  /**
   * Remove deleted notes from local-only navigation affordances.
   */
  #forgetDeletedNote(path: string): void {
    if (this.favorites.has(path)) {
      const nextFavorites = new Set(this.favorites);
      nextFavorites.delete(path);
      this.favorites = nextFavorites;
    }
    this.favoriteRefs = this.favoriteRefs.filter((favorite) =>
      !(favorite.kind === 'note' && favorite.path === path)
    );

    this.recentNotes = this.recentNotes.filter((recent) => recent.path !== path);
    this.#frecency?.forget('note', path);
    this.searchResults = this.searchResults.filter((item) => item.path !== path);

    this.#navHistory = this.#navHistory.filter((entry) => entry !== path);
    if (this.#navHistory.length === 0) {
      this.#navIndex = -1;
    } else {
      this.#navIndex = Math.min(this.#navIndex, this.#navHistory.length - 1);
    }
  }

  #moveRenamedNoteReferences(oldPath: string, newPath: string, newTitle: string): void {
    if (oldPath === newPath) {
      this.#refreshLocalNoteTitle(newPath, newTitle);
      return;
    }

    if (this.favorites.has(oldPath)) {
      const nextFavorites = new Set(this.favorites);
      nextFavorites.delete(oldPath);
      nextFavorites.add(newPath);
      this.favorites = nextFavorites;
    }
    this.favoriteRefs = this.favoriteRefs.map((favorite) =>
      favorite.kind === 'note' && favorite.path === oldPath
        ? { ...favorite, path: newPath }
        : favorite
    );

    if (this.selectedPaths.has(oldPath)) {
      const nextSelected = new Set<string>();
      for (const selectedPath of this.selectedPaths) {
        nextSelected.add(selectedPath === oldPath ? newPath : selectedPath);
      }
      this.selectedPaths = nextSelected;
    }

    const resolvedTitle = this.#findNoteByPath(this.items, newPath)?.title ?? newTitle;
    const renamedRecent = this.recentNotes.find((recent) => recent.path === oldPath);
    const existingNewRecent = this.recentNotes.find((recent) => recent.path === newPath);
    const accessedAt = renamedRecent?.accessedAt ?? existingNewRecent?.accessedAt ?? new Date();
    this.recentNotes = [
      { path: newPath, title: resolvedTitle, accessedAt },
      ...this.recentNotes.filter((recent) => recent.path !== oldPath && recent.path !== newPath),
    ].slice(0, NotesStore.MAX_RECENT_NOTES);

    this.searchResults = this.searchResults.map((item) =>
      item.path === oldPath
        ? { ...item, path: newPath, title: resolvedTitle }
        : item
    );

    this.#navHistory = this.#navHistory.map((entry) => entry === oldPath ? newPath : entry);
    this.#frecency?.move('note', oldPath, newPath);
  }

  #refreshLocalNoteTitle(path: string, title: string): void {
    this.recentNotes = this.recentNotes.map((recent) =>
      recent.path === path ? { ...recent, title } : recent
    );
    this.searchResults = this.searchResults.map((item) =>
      item.path === path ? { ...item, title } : item
    );
  }

  /**
   * Cleanup subscriptions and event listeners.
   */
  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    if (this.#sidebarPreferencesUnsubscribe) {
      this.#sidebarPreferencesUnsubscribe();
      this.#sidebarPreferencesUnsubscribe = null;
    }

    // Cleanup event listeners
    for (const cleanup of this.#eventCleanup) {
      cleanup();
    }
    this.#eventCleanup = [];
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    this.#cleanup();
    this.#service = null;
    this.#actionHistory = null;
    this.#documentService = null;
    this.#frecency = null;
    this.#sidebarPreferences = null;
    this.items = [];
    this.tagGroups = [];
    this.selectedPath = null;
    this.activeTagView = null;
    this.activeFolderPath = null;
    this.isLoading = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.expandedFolders = new Set();
    this.error = null;
    this.sidebarVisible = true;
    this.operationInProgress = null;
    this.lastOperation = null;
    this.favorites = new Set();
    this.favoriteRefs = [];
    this.folderOrder = {};
    this.recentNotes = [];
    this.favoritesExpanded = true;
    this.recentExpanded = true;
    this.expandedTagGroups = new Set();
  }
}

export const notesStore = new NotesStore();
