/**
 * TauriFileSystemAdapter - Secondary adapter for file system operations
 *
 * Implements FileSystemPort using Tauri's file system commands.
 * Part of the Hexagonal Architecture - this adapter translates between
 * the domain's FileSystemPort interface and Tauri's infrastructure.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { FileEntry } from '$lib/core';
import type { FileSystemPort } from '$lib/ports/outbound';
import { fileCommands } from './commands';

export class TauriFileSystemAdapter implements FileSystemPort {
  /**
   * Read file content as string
   */
  async readFile(path: string): Promise<Result<string, Error>> {
    try {
      const content = await fileCommands.readFile(path);
      return ok(content);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Write content to file
   */
  async writeFile(path: string, content: string): Promise<Result<void, Error>> {
    try {
      await fileCommands.writeFile(path, content);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<Result<void, Error>> {
    try {
      await fileCommands.deleteFile(path);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string): Promise<Result<FileEntry[], Error>> {
    try {
      const entries = await fileCommands.listDirectory(path);
      return ok(entries);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Check if path exists.
   *
   * Returns `ok(true|false)` when the underlying check succeeds and
   * `err(...)` only when the check itself fails (permission denied, I/O
   * error). Hiding those failures behind `false` is what shipped CVEs.
   */
  async exists(path: string): Promise<Result<boolean, Error>> {
    try {
      return ok(await fileCommands.exists(path));
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Create directory (including parent directories)
   */
  async createDirectory(path: string): Promise<Result<void, Error>> {
    try {
      await fileCommands.createDirectory(path);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async deleteDirectory(path: string): Promise<Result<void, Error>> {
    try {
      await fileCommands.removeDirectory(path);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async renamePath(from: string, to: string): Promise<Result<void, Error>> {
    try {
      await fileCommands.renamePath(from, to);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }
}
