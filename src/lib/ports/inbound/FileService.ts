/**
 * File Service - Inbound Port
 *
 * This interface defines the application API for file operations.
 * Components and stores depend on this interface, NOT on concrete implementations.
 *
 * Part of Hexagonal Architecture inbound ports layer.
 */

import type { Result, FileEntry } from '$lib/core';

export interface FileService {
  /**
   * Read file contents as string
   */
  read(path: string): Promise<Result<string, Error>>;

  /**
   * Write content to a file (creates or overwrites)
   */
  write(path: string, content: string): Promise<Result<void, Error>>;

  /**
   * Delete a file
   */
  delete(path: string): Promise<Result<void, Error>>;

  /**
   * List files and directories in a path
   */
  list(path: string): Promise<Result<FileEntry[], Error>>;

  /**
   * Check if a file or directory exists.
   *
   * Returns `ok(true|false)` on success and `err` only when the underlying
   * I/O fails. Callers must distinguish "missing" from "broken".
   */
  exists(path: string): Promise<Result<boolean, Error>>;

  /**
   * Create a directory (including parent directories)
   */
  createDirectory(path: string): Promise<Result<void, Error>>;
}
