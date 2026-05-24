/**
 * NotesService - Inbound port for notes list and navigation
 *
 * This port defines the application API for browsing, creating, and managing
 * notes in the sidebar. Primary adapters (Svelte components, stores)
 * depend on this interface.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Document } from '$lib/domain';
import type { Result } from '$lib/core';
import type { OperationSource } from '$lib/pipeline/types';
import type { ProtectedNoteMeta } from '$lib/domain/values/Protection';

/**
 * A note item in the folder tree.
 */
export interface NotesListItem {
  /** Relative path from notes folder */
  path: string;
  /** Note title (from frontmatter or filename) */
  title: string;
  /** Whether this is a folder */
  isFolder: boolean;
  /** Children if this is a folder */
  children?: NotesListItem[];
  /** Last modified date */
  modifiedAt: Date;
  /** Normalized frontmatter tags for this note */
  tags: string[];
  /** Protection state for selected protected notes. */
  protection?: ProtectedNoteMeta | null;
}

/**
 * A virtual tag folder in the sidebar.
 */
export interface TagGroup {
  /** Stable group ID; tag name or "__untagged__" */
  id: string;
  /** Tag name without '#', or null for Untagged */
  tag: string | null;
  /** Display label */
  title: string;
  /** Notes that belong to this tag */
  notes: NotesListItem[];
  /** Number of notes in this group */
  count: number;
  /** Whether this is the fallback group for notes with no tags */
  isUntagged: boolean;
}

/**
 * Notes list state exposed to the UI.
 */
export interface NotesState {
  /** The folder tree of notes */
  items: NotesListItem[];
  /** Tag-first virtual folders derived from note frontmatter */
  tagGroups: TagGroup[];
  /** Currently selected note path, or null */
  selectedPath: string | null;
  /** Whether the notes are loading */
  isLoading: boolean;
  /** Search query if filtering */
  searchQuery: string;
  /** Expanded folder paths */
  expandedFolders: Set<string>;
}

/**
 * Inbound port - notes list and navigation service API.
 *
 * This interface is implemented by application services (NotesServiceImpl)
 * and defines the API available to UI components and stores.
 */
export interface NotesService {
  /**
   * Get current notes state.
   * @returns The current notes state
   */
  getState(): NotesState;

  // ========== List operations ==========

  /**
   * Load the folder tree of notes.
   * Scans the notes folder and builds a hierarchical tree.
   * @returns Result containing the folder tree or an error
   */
  loadFolderTree(): Promise<Result<NotesListItem[], Error>>;

  /**
   * Refresh the notes list.
   * Reloads from disk to pick up external changes.
   * @returns Result containing the refreshed tree or an error
   */
  refresh(): Promise<Result<NotesListItem[], Error>>;

  // ========== Note operations ==========

  /**
   * Create a new note.
   * @param folder - Folder path to create in (empty for root)
   * @param title - Note title
   * @param source - Who initiated this operation (controls side effects like auto-focus)
   * @returns Result containing the created document or an error
   */
  createNote(folder: string, title: string, source?: OperationSource): Promise<Result<Document, Error>>;

  /**
   * Create a new note instantly with datetime-based filename.
   * @param folder - Folder path to create in (empty for root)
   * @returns Result containing the created document or an error
   */
  createQuickNote(folder?: string): Promise<Result<Document, Error>>;

  /**
   * Delete a note.
   * @param path - Path to the note to delete
   * @returns Result indicating success or failure
   */
  deleteNote(path: string): Promise<Result<void, Error>>;

  /**
   * Rename a note.
   * @param path - Current path
   * @param newTitle - New title
   * @returns Result containing the new path or an error
   */
  renameNote(path: string, newTitle: string): Promise<Result<string, Error>>;

  /**
   * Create a new folder.
   * @param parentPath - Parent folder path (empty/null for root inside notes dir)
   * @param name - Folder name (single segment; no slashes)
   * @returns Result containing the relative path of the new folder or an error
   */
  createFolder(parentPath: string | null, name: string): Promise<Result<string, Error>>;

  /**
   * Recursively delete a folder and everything inside it.
   * Emits note:deleted for every note that was inside.
   */
  deleteFolder(path: string): Promise<Result<void, Error>>;

  /**
   * Rename a folder. Children paths are remapped; note:renamed is emitted
   * for each contained note so sessions, frecency, etc. stay consistent.
   * @returns Result containing the folder's new relative path
   */
  renameFolder(path: string, newName: string): Promise<Result<string, Error>>;

  /**
   * Count notes (and folders) inside a given folder path. Used by the
   * delete-confirm dialog to show "Delete folder X and N notes inside?".
   */
  countFolderContents(path: string): { notes: number; folders: number };

  /**
   * Load a document by path.
   *
   * Returns the full Document (frontmatter + blocks). Used by primary
   * adapters (UI) to fetch the content for the active selection without
   * routing through the editor service. Pure read; no side effects on
   * editor state.
   */
  loadDocument(path: string): Promise<Result<Document, Error>>;

  /**
   * Persist a document. Pure write; the editor shell uses this for the
   * autosave path, sidestepping the editor service when it manages the
   * ProseMirror lifecycle itself.
   */
  saveDocument(document: Document): Promise<Result<void, Error>>;

  // ========== Search ==========

  /**
   * Search notes by title.
   * @param query - Search query
   * @returns Result containing matching notes or an error
   */
  searchNotes(query: string): Promise<Result<NotesListItem[], Error>>;

  // ========== Selection ==========

  /**
   * Select a note.
   * @param path - Path to select, or null to deselect
   */
  selectNote(path: string | null): void;

  /**
   * Get the currently selected path.
   * @returns The selected path or null
   */
  getSelectedPath(): string | null;

  // ========== Folder expansion ==========

  /**
   * Toggle folder expansion.
   * @param path - Folder path to toggle
   */
  toggleFolder(path: string): void;

  /**
   * Expand a folder.
   * @param path - Folder path to expand
   */
  expandFolder(path: string): void;

  /**
   * Collapse a folder.
   * @param path - Folder path to collapse
   */
  collapseFolder(path: string): void;

  /**
   * Check if a folder is expanded.
   * @param path - Folder path to check
   * @returns True if expanded
   */
  isFolderExpanded(path: string): boolean;

  // ========== Subscriptions ==========

  /**
   * Subscribe to state changes.
   * @param callback - Called whenever the notes state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: NotesState) => void): () => void;
}
