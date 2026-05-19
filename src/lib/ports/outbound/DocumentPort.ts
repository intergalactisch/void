/**
 * DocumentPort - Outbound port for document persistence
 *
 * This port defines the contract between the application and the document
 * storage infrastructure (e.g., file system, database). The application layer
 * depends on this interface, never on concrete implementations.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Document, DocumentMeta } from '$lib/domain';
import type { Result } from '$lib/core';

/**
 * A lightweight document list item containing only the path and metadata.
 * Used for document listing without loading full content.
 */
export interface DocumentListItem {
  /** File path (relative to notes folder) */
  path: string;
  /** Document metadata */
  meta: DocumentMeta;
}

/**
 * A discovered folder under the notes root. Folders can be empty and still
 * participate in app navigation through virtual folder overview pages.
 */
export interface DocumentFolderItem {
  /** Folder path relative to notes folder */
  path: string;
  /** Folder name without parent path */
  name: string;
  /** Last modification timestamp when the adapter can provide it */
  modifiedAt: Date;
}

/**
 * Outbound port for document persistence operations.
 *
 * This interface is implemented by secondary adapters (e.g., MarkdownAdapter)
 * and defines how the application interacts with document storage.
 */
export interface DocumentPort {
  /**
   * Load document from path.
   * Parses the file content and converts to domain Document.
   * @param path - Relative path to the document
   * @returns Result containing the loaded document or an error
   */
  load(path: string): Promise<Result<Document, Error>>;

  /**
   * Save document to path.
   * Serializes the domain Document to file format.
   * @param document - The document to save
   * @returns Result indicating success or failure
   */
  save(document: Document): Promise<Result<void, Error>>;

  /**
   * Delete document at path.
   * @param path - Relative path to the document to delete
   * @returns Result indicating success or failure
   */
  delete(path: string): Promise<Result<void, Error>>;

  /**
   * List all documents.
   * Returns lightweight list items without full content.
   * @returns Result containing list of document items or an error
   */
  list(): Promise<Result<DocumentListItem[], Error>>;

  /**
   * List all folders under the notes root.
   * Returns folders even when they contain no markdown files.
   */
  listFolders(): Promise<Result<DocumentFolderItem[], Error>>;

  /**
   * Check if document exists at path.
   *
   * Returns `ok(true|false)` when the check succeeds and `err` only when the
   * underlying I/O fails. Callers must distinguish "missing" from "broken"
   * — silently treating both as `false` masks permission and disk errors.
   *
   * @param path - Relative path to check
   */
  exists(path: string): Promise<Result<boolean, Error>>;

  /**
   * Create new document at path.
   * @param path - Relative path for the new document
   * @param title - Optional title for the document
   * @returns Result containing the created document or an error
   */
  create(path: string, title?: string): Promise<Result<Document, Error>>;

  /**
   * Create an empty folder at path (creates parent directories as needed).
   * @param path - Relative folder path
   * @returns Result indicating success or failure
   */
  createFolder(path: string): Promise<Result<void, Error>>;

  /**
   * Recursively delete a folder and everything inside it.
   * @param path - Relative folder path
   */
  deleteFolder(path: string): Promise<Result<void, Error>>;

  /**
   * Rename a folder. The new name is a single path segment (no slashes);
   * the parent stays the same.
   * @param path - Relative folder path
   * @param newName - New folder name (single segment)
   * @returns Result with the new relative folder path
   */
  renameFolder(path: string, newName: string): Promise<Result<string, Error>>;

  /**
   * Watch for document changes (external modifications).
   * Useful for detecting when a file is modified outside the application.
   * @param path - Relative path to watch
   * @param callback - Called when the document changes
   * @returns Unsubscribe function to stop watching
   */
  watch(path: string, callback: (document: Document) => void): () => void;
}
