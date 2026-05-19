/**
 * FileServiceImpl - Application service for file operations
 *
 * This is a use case implementation that orchestrates file system operations.
 * It depends ONLY on port interfaces, never on concrete adapters.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { FileService } from '$lib/ports/inbound';
import type { FileSystemPort } from '$lib/ports/outbound';
import type { Result, FileEntry } from '$lib/core';

export class FileServiceImpl implements FileService {
  constructor(private fileSystem: FileSystemPort) {}

  /**
   * Read file contents as string
   */
  async read(path: string): Promise<Result<string, Error>> {
    return this.fileSystem.readFile(path);
  }

  /**
   * Write content to a file (creates or overwrites)
   */
  async write(path: string, content: string): Promise<Result<void, Error>> {
    return this.fileSystem.writeFile(path, content);
  }

  /**
   * Delete a file
   */
  async delete(path: string): Promise<Result<void, Error>> {
    return this.fileSystem.deleteFile(path);
  }

  /**
   * List files and directories in a path
   */
  async list(path: string): Promise<Result<FileEntry[], Error>> {
    return this.fileSystem.listDirectory(path);
  }

  /**
   * Check if a file or directory exists.
   * Propagates I/O errors so callers can distinguish "missing" from "broken".
   */
  async exists(path: string): Promise<Result<boolean, Error>> {
    return this.fileSystem.exists(path);
  }

  /**
   * Create a directory (including parent directories)
   */
  async createDirectory(path: string): Promise<Result<void, Error>> {
    return this.fileSystem.createDirectory(path);
  }
}
