/**
 * FileSystemPort - Outbound port for file system operations.
 *
 * This interface defines the contract for file system access.
 * Part of the Hexagonal Architecture - adapters implement this interface.
 *
 * Implementations:
 * - TauriFileSystemAdapter: Real file system via Tauri
 * - MemoryFileSystemAdapter: In-memory for testing
 */

import type { Result, FileEntry } from '$lib/core';

export interface FileSystemPort {
  /**
   * Read file content as a string
   * @param path - Absolute path to the file
   * @returns File content or error if file doesn't exist/can't be read
   */
  readFile(path: string): Promise<Result<string, Error>>;

  /**
   * Write content to a file, creating it if it doesn't exist
   * @param path - Absolute path to the file
   * @param content - Content to write
   * @returns Success or error if write fails
   */
  writeFile(path: string, content: string): Promise<Result<void, Error>>;

  /**
   * Delete a file
   * @param path - Absolute path to the file
   * @returns Success or error if deletion fails
   */
  deleteFile(path: string): Promise<Result<void, Error>>;

  /**
   * List contents of a directory
   * @param path - Absolute path to the directory
   * @returns Array of file entries or error if directory doesn't exist
   */
  listDirectory(path: string): Promise<Result<FileEntry[], Error>>;

  /**
   * Check if a file or directory exists.
   *
   * Returns `Result<true>` if the path exists, `Result<false>` if it does not,
   * and an `err` only when the check itself fails (e.g. permission denied,
   * I/O error). Callers must distinguish "missing" from "broken" — silently
   * treating both as `false` hides bugs.
   *
   * @param path - Absolute path to check
   */
  exists(path: string): Promise<Result<boolean, Error>>;

  /**
   * Create a directory, including parent directories if needed
   * @param path - Absolute path to the directory to create
   * @returns Success or error if creation fails
   */
  createDirectory(path: string): Promise<Result<void, Error>>;

  /**
   * Recursively delete a directory and all of its contents.
   * @param path - Absolute path to the directory
   * @returns Success or error if deletion fails
   */
  deleteDirectory(path: string): Promise<Result<void, Error>>;

  /**
   * Move a file or directory to the operating system Trash.
   * @param path - Absolute path to move to Trash
   * @returns Success or error if the Trash operation fails
   */
  moveToTrash(path: string): Promise<Result<void, Error>>;

  /**
   * Rename or move a file/directory.
   * @param from - Absolute source path
   * @param to - Absolute destination path
   * @returns Success or error if rename fails (e.g. destination exists)
   */
  renamePath(from: string, to: string): Promise<Result<void, Error>>;
}
