/**
 * NotesServiceImpl - Implementation of NotesService
 *
 * This service manages the notes list and folder tree navigation,
 * providing a unified API for the sidebar. It uses CommandBus for
 * note operations to ensure sequential processing and prevent race conditions.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { NotesService, NotesState, NotesListItem, TagGroup } from '$lib/ports/inbound';
import type { DocumentFolderItem, DocumentListItem, DocumentPort } from '$lib/ports/outbound';
import type { Document } from '$lib/domain';
import { normalizeNoteTag, normalizeNoteTags } from '$lib/domain/values';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';
import type { CommandBus } from '$lib/events';
import { events } from '$lib/events';
import { TODO_FILENAME } from '$lib/domain/values/TodoConstants';
import { TODO_LIST_FRONTMATTER_TYPE } from '$lib/domain/values/TodoListFile';
import type { OperationSource } from '$lib/pipeline/types';
import { USER_SOURCE } from '$lib/pipeline/types';

/**
 * Initial state for the notes service.
 */
const INITIAL_STATE: NotesState = {
  items: [],
  tagGroups: [],
  selectedPath: null,
  isLoading: false,
  searchQuery: '',
  expandedFolders: new Set(),
};

/**
 * Implementation of NotesService.
 *
 * Handles:
 * - Loading and refreshing the folder tree
 * - Creating, deleting, and renaming notes
 * - Searching notes by title
 * - Managing selection and folder expansion state
 */
export class NotesServiceImpl implements NotesService {
  private state: NotesState = { ...INITIAL_STATE, expandedFolders: new Set() };
  private subscribers: Set<(state: NotesState) => void> = new Set();
  private documentPort: DocumentPort;
  private commandBus: CommandBus | null;

  constructor(documentPort: DocumentPort, commandBus?: CommandBus) {
    this.documentPort = documentPort;
    this.commandBus = commandBus ?? null;
  }

  /**
   * Get current notes state.
   */
  getState(): NotesState {
    return {
      ...this.state,
      expandedFolders: new Set(this.state.expandedFolders),
      tagGroups: this.state.tagGroups.map((group) => ({
        ...group,
        notes: [...group.notes],
      })),
    };
  }

  // ========== List operations ==========

  /**
   * Load the folder tree of notes.
   */
  async loadFolderTree(): Promise<Result<NotesListItem[], Error>> {
    this.updateState({ isLoading: true });

    try {
      const result = await this.documentPort.list();

      if (!result.ok) {
        this.updateState({ isLoading: false });
        return result;
      }

      const foldersResult = await this.documentPort.listFolders();
      if (!foldersResult.ok) {
        this.updateState({ isLoading: false });
        return foldersResult;
      }

      // Convert flat list to tree structure
      const items = this.buildFolderTree(result.value, foldersResult.value);
      const tagGroups = this.buildTagGroups(items);

      this.updateState({
        items,
        tagGroups,
        isLoading: false,
      });

      return ok(items);
    } catch (error) {
      this.updateState({ isLoading: false });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Refresh the notes list.
   */
  async refresh(): Promise<Result<NotesListItem[], Error>> {
    return this.loadFolderTree();
  }

  // ========== Note operations ==========

  /**
   * Create a new note.
   * Uses CommandBus if available for sequential processing and race condition prevention.
   */
  async createNote(folder: string, title: string, source: OperationSource = USER_SOURCE): Promise<Result<Document, Error>> {
    // Use CommandBus if available
    if (this.commandBus) {
      const result = await this.commandBus.createNote(title, folder);

      if (!result.success) {
        return err(result.error);
      }

      // Refresh the tree
      await this.loadFolderTree();

      // Only auto-select if source requests it
      if (source.autoFocus) {
        this.selectNote(result.value.path);
      }

      return ok(result.value);
    }

    // Fallback: direct DocumentPort call (backwards compatibility)
    const pathResult = await this.findUniquePathForTitle(folder, title);
    if (!pathResult.ok) return pathResult;
    const path = pathResult.value;

    // Create the document
    const result = await this.documentPort.create(path, title);

    if (!result.ok) {
      return result;
    }

    // Refresh the tree
    await this.loadFolderTree();

    // Only auto-select if source requests it
    if (source.autoFocus) {
      this.selectNote(path);
    }

    return result;
  }

  /**
   * Delete a note.
   * Uses CommandBus if available for sequential processing and race condition prevention.
   */
  async deleteNote(path: string): Promise<Result<void, Error>> {
    // Use CommandBus if available
    if (this.commandBus) {
      const result = await this.commandBus.deleteNote(path);

      if (!result.success) {
        return err(result.error);
      }

      // If the deleted note was selected, deselect
      if (this.state.selectedPath === path) {
        this.selectNote(null);
      }

      // Refresh the tree
      await this.loadFolderTree();

      return ok(undefined);
    }

    // Fallback: direct DocumentPort call (backwards compatibility)
    const result = await this.documentPort.delete(path);

    if (!result.ok) {
      return result;
    }

    // If the deleted note was selected, deselect
    if (this.state.selectedPath === path) {
      this.selectNote(null);
    }

    // Refresh the tree
    await this.loadFolderTree();

    return ok(undefined);
  }

  /**
   * Rename a note.
   * Uses CommandBus if available for sequential processing and race condition prevention.
   */
  async createFolder(parentPath: string | null, name: string): Promise<Result<string, Error>> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return err(new Error('Folder name cannot be empty'));
    if (/[\\/]/.test(trimmed)) return err(new Error('Folder name cannot contain slashes'));
    if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
      return err(new Error('Folder name cannot start with a dot'));
    }

    const normalisedParent = (parentPath ?? '').replace(/^\/+|\/+$/g, '');
    const relativePath = normalisedParent ? `${normalisedParent}/${trimmed}` : trimmed;

    const created = await this.documentPort.createFolder(relativePath);
    if (!created.ok) return err(created.error);

    await this.loadFolderTree();
    return ok(relativePath);
  }

  async deleteFolder(path: string): Promise<Result<void, Error>> {
    if (!path) return err(new Error('Folder path cannot be empty'));

    const notePaths = this.collectNotePathsUnder(path);

    const deleted = await this.documentPort.deleteFolder(path);
    if (!deleted.ok) return err(deleted.error);

    for (const notePath of notePaths) {
      events.emit('note:deleted', { path: notePath, source: 'user' });
    }

    if (this.state.selectedPath && this.isUnderFolder(this.state.selectedPath, path)) {
      this.selectNote(null);
    }

    await this.loadFolderTree();
    return ok(undefined);
  }

  async renameFolder(path: string, newName: string): Promise<Result<string, Error>> {
    if (!path) return err(new Error('Folder path cannot be empty'));

    const beforePaths = this.collectAllPathsUnder(path);

    const renamed = await this.documentPort.renameFolder(path, newName);
    if (!renamed.ok) return err(renamed.error);

    const newPath = renamed.value;
    const oldPrefix = path.endsWith('/') ? path : `${path}/`;
    const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`;

    for (const old of beforePaths) {
      if (old === path) continue;
      const remainder = old.startsWith(oldPrefix) ? old.slice(oldPrefix.length) : null;
      if (remainder === null) continue;
      const next = `${newPrefix}${remainder}`;
      events.emit('note:renamed', {
        oldPath: old,
        newPath: next,
        newTitle: remainder.replace(/\.md$/i, '').split('/').pop() ?? remainder,
        source: 'user',
      });
    }

    const selected = this.state.selectedPath;
    if (selected && selected.startsWith(oldPrefix)) {
      this.selectNote(`${newPrefix}${selected.slice(oldPrefix.length)}`);
    }

    await this.loadFolderTree();
    return ok(newPath);
  }

  countFolderContents(path: string): { notes: number; folders: number } {
    const folder = this.findFolder(this.state.items, path);
    if (!folder) return { notes: 0, folders: 0 };
    let notes = 0;
    let folders = 0;
    const walk = (items: NotesListItem[]) => {
      for (const item of items) {
        if (item.isFolder) {
          folders += 1;
          if (item.children) walk(item.children);
        } else {
          notes += 1;
        }
      }
    };
    if (folder.children) walk(folder.children);
    return { notes, folders };
  }

  private collectNotePathsUnder(path: string): string[] {
    const folder = this.findFolder(this.state.items, path);
    if (!folder) return [];
    const out: string[] = [];
    const walk = (items: NotesListItem[]) => {
      for (const item of items) {
        if (item.isFolder) {
          if (item.children) walk(item.children);
        } else {
          out.push(item.path);
        }
      }
    };
    if (folder.children) walk(folder.children);
    return out;
  }

  private collectAllPathsUnder(path: string): string[] {
    const folder = this.findFolder(this.state.items, path);
    if (!folder) return [path];
    const out: string[] = [folder.path];
    const walk = (items: NotesListItem[]) => {
      for (const item of items) {
        out.push(item.path);
        if (item.isFolder && item.children) walk(item.children);
      }
    };
    if (folder.children) walk(folder.children);
    return out;
  }

  private findFolder(items: NotesListItem[], path: string): NotesListItem | null {
    for (const item of items) {
      if (item.isFolder && item.path === path) return item;
      if (item.isFolder && item.children) {
        const found = this.findFolder(item.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  private isUnderFolder(notePath: string, folderPath: string): boolean {
    return notePath === folderPath || notePath.startsWith(`${folderPath}/`);
  }

  async renameNote(path: string, newTitle: string): Promise<Result<string, Error>> {
    // Use CommandBus if available
    if (this.commandBus) {
      const result = await this.commandBus.renameNote(path, newTitle);

      if (!result.success) {
        return err(result.error);
      }

      const newPath = result.value;

      const shouldSelectRenamedNote = this.state.selectedPath === path;

      // Refresh the tree
      await this.loadFolderTree();

      // Update selection after the tree contains the renamed note so
      // subscribers can resolve the new title/path immediately.
      if (shouldSelectRenamedNote) {
        this.selectNote(newPath);
      }

      return ok(newPath);
    }

    // Fallback: direct DocumentPort call (backwards compatibility)
    // Load the current document
    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      return loadResult;
    }

    const document = loadResult.value;

    // Update the title in metadata
    document.meta.title = newTitle;
    document.meta.updatedAt = new Date();

    // Generate new filename
    const dirParts = path.split('/');
    dirParts.pop(); // Remove old filename
    const newFilename = this.titleToFilename(newTitle);
    const newPath = dirParts.length > 0
      ? `${dirParts.join('/')}/${newFilename}`
      : newFilename;

    // If path changed, delete old and create new
    if (newPath !== path) {
      const targetExists = await this.documentPort.exists(newPath);
      if (!targetExists.ok) return targetExists;
      if (targetExists.value) {
        return err(new Error(`Cannot rename ${path}: ${newPath} already exists`));
      }

      // Create at new path
      const saveResult = await this.documentPort.save({
        ...document,
        path: newPath,
      });

      if (!saveResult.ok) {
        return err(saveResult.error);
      }

      // Delete old path
      const deleteResult = await this.documentPort.delete(path);
      if (!deleteResult.ok) {
        await this.documentPort.delete(newPath);
        return err(new Error(
          `Failed to delete old note after rename. Rolled back. Error: ${deleteResult.error.message}`
        ));
      }
    } else {
      // Just save with updated title
      const saveResult = await this.documentPort.save(document);
      if (!saveResult.ok) {
        return err(saveResult.error);
      }
    }

    const shouldSelectRenamedNote = this.state.selectedPath === path;

    // Refresh the tree
    await this.loadFolderTree();

    if (shouldSelectRenamedNote) {
      this.selectNote(newPath);
    }

    events.emit('note:renamed', { oldPath: path, newPath, newTitle, source: 'user' });

    return ok(newPath);
  }

  // ========== Read ==========

  /**
   * Load a document by path. Pure read — no editor or selection side effects.
   */
  async loadDocument(path: string): Promise<Result<Document, Error>> {
    return this.documentPort.load(path);
  }

  /**
   * Persist a document. Pure write — emits document:saved on success so
   * the rest of the app can react.
   */
  async saveDocument(document: Document): Promise<Result<void, Error>> {
    const result = await this.documentPort.save(document);
    if (result.ok) {
      events.emit('document:saved', { path: document.path });
    }
    return result;
  }

  // ========== Search ==========

  /**
   * Search notes by title.
   */
  async searchNotes(query: string): Promise<Result<NotesListItem[], Error>> {
    this.updateState({ searchQuery: query });

    if (!query.trim()) {
      // Return all items when no query
      return ok(this.state.items);
    }

    const lowerQuery = query.toLowerCase();
    const tagQuery = normalizeNoteTag(query);

    // Flatten tree and filter
    const flatItems = this.flattenTree(this.state.items);
    const filtered = flatItems.filter(item =>
      !item.isFolder && (
        item.title.toLowerCase().includes(lowerQuery) ||
        item.path.toLowerCase().includes(lowerQuery) ||
        (tagQuery !== null && item.tags.includes(tagQuery)) ||
        item.tags.some((tag) => tag.includes(lowerQuery.replace(/^#/, '')))
      )
    );

    return ok(filtered);
  }

  // ========== Selection ==========

  /**
   * Select a note.
   */
  selectNote(path: string | null): void {
    if (this.state.selectedPath !== path) {
      this.updateState({ selectedPath: path });
    }
  }

  /**
   * Get the currently selected path.
   */
  getSelectedPath(): string | null {
    return this.state.selectedPath;
  }

  // ========== Folder expansion ==========

  /**
   * Toggle folder expansion.
   */
  toggleFolder(path: string): void {
    const expandedFolders = new Set(this.state.expandedFolders);

    if (expandedFolders.has(path)) {
      expandedFolders.delete(path);
    } else {
      expandedFolders.add(path);
    }

    this.updateState({ expandedFolders });
  }

  /**
   * Expand a folder.
   */
  expandFolder(path: string): void {
    if (!this.state.expandedFolders.has(path)) {
      const expandedFolders = new Set(this.state.expandedFolders);
      expandedFolders.add(path);
      this.updateState({ expandedFolders });
    }
  }

  /**
   * Collapse a folder.
   */
  collapseFolder(path: string): void {
    if (this.state.expandedFolders.has(path)) {
      const expandedFolders = new Set(this.state.expandedFolders);
      expandedFolders.delete(path);
      this.updateState({ expandedFolders });
    }
  }

  /**
   * Check if a folder is expanded.
   */
  isFolderExpanded(path: string): boolean {
    return this.state.expandedFolders.has(path);
  }

  // ========== Subscriptions ==========

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: (state: NotesState) => void): () => void {
    this.subscribers.add(callback);

    // Immediately call with current state
    callback(this.getState());

    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ========== Private methods ==========

  /**
   * Update state and notify subscribers.
   */
  private updateState(partial: Partial<NotesState>): void {
    this.state = { ...this.state, ...partial };
    this.notifySubscribers();
  }

  /**
   * Notify all subscribers of state change.
   */
  private notifySubscribers(): void {
    const state = this.getState();
    this.subscribers.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in NotesService subscriber:', error);
      }
    });
  }

  /**
   * Convert a flat list of documents to a folder tree.
   */
  private buildFolderTree(
    documents: DocumentListItem[],
    folders: DocumentFolderItem[] = []
  ): NotesListItem[] {
    const root: NotesListItem[] = [];
    const folderMap = new Map<string, NotesListItem>();

    // Add discovered folders first so empty/manual directories are visible.
    const sortedFolders = [...folders].sort((a, b) => a.path.localeCompare(b.path));
    for (const folder of sortedFolders) {
      this.ensureFolderPath(folder.path, folderMap, root, folder.modifiedAt);
    }

    // Sort by path to ensure parents are created before children
    const sorted = [...documents].sort((a, b) => a.path.localeCompare(b.path));

    for (const doc of sorted) {
      const parts = doc.path.split('/');
      const filename = parts.pop()!;

      // Hide the dedicated TODO file from the sidebar
      if (filename.toLowerCase() === TODO_FILENAME.toLowerCase()) continue;
      if (doc.meta.custom?.void_type === TODO_LIST_FRONTMATTER_TYPE) continue;
      const dirPath = parts.join('/');

      // Create note item
      const noteItem: NotesListItem = {
        path: doc.path,
        title: doc.meta.title || this.filenameToTitle(filename),
        isFolder: false,
        modifiedAt: new Date(doc.meta.updatedAt),
        tags: normalizeNoteTags(doc.meta.tags),
        protection: doc.meta.protection ?? null,
      };

      if (!dirPath) {
        // Root level note
        root.push(noteItem);
      } else {
        // Ensure parent folders exist
        this.ensureFolderPath(dirPath, folderMap, root);

        // Add to parent folder
        const parent = folderMap.get(dirPath);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(noteItem);
        }
      }
    }

    // Sort items: folders first, then by title
    return this.sortItems(root);
  }

  /**
   * Ensure a folder path exists in the tree, creating parent folders as needed.
   */
  private ensureFolderPath(
    path: string,
    folderMap: Map<string, NotesListItem>,
    root: NotesListItem[],
    modifiedAt?: Date
  ): void {
    const parts = path.split('/');
    let currentPath = '';

    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      const existing = folderMap.get(currentPath);
      if (existing) {
        if (currentPath === path && modifiedAt) {
          existing.modifiedAt = modifiedAt;
        }
        continue;
      }

      if (!folderMap.has(currentPath)) {
        const folderItem: NotesListItem = {
          path: currentPath,
          title: part,
          isFolder: true,
          children: [],
          modifiedAt: currentPath === path && modifiedAt ? modifiedAt : new Date(),
          tags: [],
        };

        folderMap.set(currentPath, folderItem);

        if (!parentPath) {
          root.push(folderItem);
        } else {
          const parent = folderMap.get(parentPath);
          if (parent) {
            parent.children = parent.children || [];
            parent.children.push(folderItem);
          }
        }
      }
    }
  }

  /**
   * Sort items: folders first, then alphabetically by title.
   */
  private sortItems(items: NotesListItem[]): NotesListItem[] {
    return items
      .map((item): NotesListItem => {
        if (item.children) {
          return { ...item, children: this.sortItems(item.children) };
        }
        return item;
      })
      .sort((a, b) => {
        // Folders first
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        // Then by title
        return a.title.localeCompare(b.title);
      });
  }

  /**
   * Build virtual tag folders from the same notes shown in the file tree.
   */
  private buildTagGroups(items: NotesListItem[]): TagGroup[] {
    const groups = new Map<string, NotesListItem[]>();
    const untagged: NotesListItem[] = [];

    for (const note of this.flattenTree(items).filter((item) => !item.isFolder)) {
      if (note.tags.length === 0) {
        untagged.push(note);
        continue;
      }

      for (const tag of note.tags) {
        const bucket = groups.get(tag) ?? [];
        bucket.push(note);
        groups.set(tag, bucket);
      }
    }

    const tagGroups: TagGroup[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, notes]) => {
        const sortedNotes = this.sortNotes(notes);
        return {
          id: tag,
          tag,
          title: `#${tag}`,
          notes: sortedNotes,
          count: sortedNotes.length,
          isUntagged: false,
        };
      });

    if (untagged.length > 0) {
      const notes = this.sortNotes(untagged);
      tagGroups.push({
        id: '__untagged__',
        tag: null,
        title: 'Untagged',
        notes,
        count: notes.length,
        isUntagged: true,
      });
    }

    return tagGroups;
  }

  private sortNotes(notes: NotesListItem[]): NotesListItem[] {
    return [...notes].sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Flatten the tree to a list.
   */
  private flattenTree(items: NotesListItem[]): NotesListItem[] {
    const result: NotesListItem[] = [];

    for (const item of items) {
      result.push(item);
      if (item.children) {
        result.push(...this.flattenTree(item.children));
      }
    }

    return result;
  }

  /**
   * Convert a title to a safe filename.
   */
  private titleToFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '.md';
  }

  /**
   * Convert a filename to a title.
   */
  private filenameToTitle(filename: string): string {
    return filename
      .replace(/\.md$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Generate a datetime-based filename with optional suffix.
   */
  private generateDatetimeFilename(suffix?: number): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return suffix ? `${base}-${suffix}.md` : `${base}.md`;
  }

  /**
   * Convert a datetime filename to a human-readable title.
   */
  private datetimeFilenameToTitle(filename: string): string {
    // Match with optional suffix: 2026-01-31-14-30-45.md or 2026-01-31-14-30-45-1.md
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?\.md$/);
    if (!match) return this.filenameToTitle(filename);
    const [, year, month, day, hour, minute, second, suffix] = match;
    const date = new Date(+year!, +month! - 1, +day!, +hour!, +minute!, +second!);
    let title = date.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }) + ` ${hour}:${minute}`;
    if (suffix) {
      title += ` (${suffix})`;
    }
    return title;
  }

  /**
   * Find a unique path for a titled note, adding numeric suffix if needed.
   * "my-note.md" → "my-note-1.md" → "my-note-2.md" etc.
   */
  private async findUniquePathForTitle(folder: string, title: string): Promise<Result<string, Error>> {
    const baseFilename = this.titleToFilename(title);
    const basePath = folder ? `${folder}/${baseFilename}` : baseFilename;

    const baseExists = await this.documentPort.exists(basePath);
    if (!baseExists.ok) return baseExists;
    if (!baseExists.value) {
      return ok(basePath);
    }

    // Add numeric suffix: title-1.md, title-2.md, ...
    const stem = baseFilename.replace(/\.md$/, '');
    for (let suffix = 1; suffix <= 99; suffix++) {
      const filename = `${stem}-${suffix}.md`;
      const path = folder ? `${folder}/${filename}` : filename;
      const candidate = await this.documentPort.exists(path);
      if (!candidate.ok) return candidate;
      if (!candidate.value) {
        return ok(path);
      }
    }

    // Fallback: use timestamp
    const filename = `${stem}-${Date.now()}.md`;
    return ok(folder ? `${folder}/${filename}` : filename);
  }

  /**
   * Find a unique path for a quick note, adding suffix if needed.
   */
  private async findUniquePath(folder: string): Promise<Result<string, Error>> {
    // Try without suffix first
    let filename = this.generateDatetimeFilename();
    let path = folder ? `${folder}/${filename}` : filename;

    const firstExists = await this.documentPort.exists(path);
    if (!firstExists.ok) return firstExists;
    if (!firstExists.value) {
      return ok(path);
    }

    // Try with incrementing suffix
    for (let suffix = 1; suffix <= 99; suffix++) {
      filename = this.generateDatetimeFilename(suffix);
      path = folder ? `${folder}/${filename}` : filename;
      const candidate = await this.documentPort.exists(path);
      if (!candidate.ok) return candidate;
      if (!candidate.value) {
        return ok(path);
      }
    }

    // Fallback: use timestamp
    const ts = Date.now();
    filename = `${ts}.md`;
    return ok(folder ? `${folder}/${filename}` : filename);
  }

  /**
   * Create a new note instantly with datetime-based filename.
   * Uses CommandBus if available for sequential processing and race condition prevention.
   */
  async createQuickNote(folder = ''): Promise<Result<Document, Error>> {
    // Use CommandBus if available
    if (this.commandBus) {
      const result = await this.commandBus.createQuickNote(folder);

      if (!result.success) {
        return err(result.error);
      }

      await this.loadFolderTree();
      this.selectNote(result.value.path);
      return ok(result.value);
    }

    // Fallback: direct DocumentPort call (backwards compatibility)
    const pathResult = await this.findUniquePath(folder);
    if (!pathResult.ok) return pathResult;
    const path = pathResult.value;
    const filename = path.split('/').pop()!;
    const title = this.datetimeFilenameToTitle(filename);

    const result = await this.documentPort.create(path, title);
    if (!result.ok) return result;

    await this.loadFolderTree();
    this.selectNote(path);
    return result;
  }
}
