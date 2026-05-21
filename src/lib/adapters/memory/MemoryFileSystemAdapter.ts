/**
 * MemoryFileSystemAdapter - In-memory implementation of FileSystemPort
 *
 * This adapter stores files in memory, enabling testing without Tauri.
 * Part of the Hexagonal Architecture - implements the FileSystemPort interface.
 *
 * Use Cases:
 * - Unit testing services that depend on FileSystemPort
 * - Browser-only development mode
 * - Storybook component development
 */

import { ok, err, type Result } from '$lib/core';
import type { FileEntry } from '$lib/core';
import type { FileSystemPort } from '$lib/ports/outbound';

interface MemoryFile {
  content: string;
  modifiedAt: Date;
}

interface MemoryDirectory {
  isDirectory: true;
  modifiedAt: Date;
}

type MemoryEntry = MemoryFile | MemoryDirectory;

function isMemoryFile(entry: MemoryEntry): entry is MemoryFile {
  return !('isDirectory' in entry);
}

export class MemoryFileSystemAdapter implements FileSystemPort {
  private storage = new Map<string, MemoryEntry>();

  constructor() {
    // Initialize with root directory
    this.storage.set('/', { isDirectory: true, modifiedAt: new Date() });
  }

  async readFile(path: string): Promise<Result<string, Error>> {
    const entry = this.storage.get(this.normalizePath(path));

    if (entry === undefined) {
      return err(new Error(`File not found: ${path}`));
    }

    if (!isMemoryFile(entry)) {
      return err(new Error(`Path is a directory: ${path}`));
    }

    return ok(entry.content);
  }

  async writeFile(path: string, content: string): Promise<Result<void, Error>> {
    const normalizedPath = this.normalizePath(path);

    // Ensure parent directories exist
    const parentDir = this.getParentPath(normalizedPath);
    if (parentDir && !this.storage.has(parentDir)) {
      const createResult = await this.createDirectory(parentDir);
      if (!createResult.ok) {
        return createResult;
      }
    }

    this.storage.set(normalizedPath, {
      content,
      modifiedAt: new Date(),
    });

    return ok(undefined);
  }

  async deleteFile(path: string): Promise<Result<void, Error>> {
    const normalizedPath = this.normalizePath(path);
    const entry = this.storage.get(normalizedPath);

    if (entry === undefined) {
      return err(new Error(`File not found: ${path}`));
    }

    if (!isMemoryFile(entry)) {
      return err(new Error(`Path is a directory: ${path}`));
    }

    this.storage.delete(normalizedPath);
    return ok(undefined);
  }

  async listDirectory(path: string): Promise<Result<FileEntry[], Error>> {
    const normalizedPath = this.normalizePath(path);
    const entry = this.storage.get(normalizedPath);

    if (entry === undefined) {
      return err(new Error(`Directory not found: ${path}`));
    }

    if (isMemoryFile(entry)) {
      return err(new Error(`Path is not a directory: ${path}`));
    }

    const entries: FileEntry[] = [];
    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;

    for (const [storedPath, storedEntry] of this.storage.entries()) {
      // Skip the directory itself
      if (storedPath === normalizedPath) continue;

      // Check if it's a direct child (not nested)
      if (storedPath.startsWith(prefix)) {
        const relativePath = storedPath.slice(prefix.length);
        // Only include direct children (no nested paths)
        if (!relativePath.includes('/')) {
          const isDir = !isMemoryFile(storedEntry);
          const entry: FileEntry = {
            name: relativePath,
            path: storedPath,
            isDirectory: isDir,
            isFile: !isDir,
            modifiedAt: storedEntry.modifiedAt,
          };
          // Only add size for files
          if (isMemoryFile(storedEntry)) {
            entry.size = storedEntry.content.length;
          }
          entries.push(entry);
        }
      }
    }

    return ok(entries);
  }

  async exists(path: string): Promise<Result<boolean, Error>> {
    return ok(this.storage.has(this.normalizePath(path)));
  }

  async createDirectory(path: string): Promise<Result<void, Error>> {
    const normalizedPath = this.normalizePath(path);

    // Check if already exists as a file
    const existing = this.storage.get(normalizedPath);
    if (existing && isMemoryFile(existing)) {
      return err(new Error(`Path exists as a file: ${path}`));
    }

    // Create parent directories if needed
    const parts = normalizedPath.split('/').filter(Boolean);
    let currentPath = '';
    for (const part of parts) {
      currentPath += '/' + part;
      if (!this.storage.has(currentPath)) {
        this.storage.set(currentPath, { isDirectory: true, modifiedAt: new Date() });
      }
    }

    return ok(undefined);
  }

  async deleteDirectory(path: string): Promise<Result<void, Error>> {
    const normalizedPath = this.normalizePath(path);
    const entry = this.storage.get(normalizedPath);

    if (entry === undefined) {
      return err(new Error(`Directory not found: ${path}`));
    }
    if (isMemoryFile(entry)) {
      return err(new Error(`Path is not a directory: ${path}`));
    }

    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
    for (const storedPath of Array.from(this.storage.keys())) {
      if (storedPath === normalizedPath || storedPath.startsWith(prefix)) {
        if (storedPath === '/') continue;
        this.storage.delete(storedPath);
      }
    }
    return ok(undefined);
  }

  async moveToTrash(path: string): Promise<Result<void, Error>> {
    const normalizedPath = this.normalizePath(path);
    const entry = this.storage.get(normalizedPath);

    if (entry === undefined) {
      return err(new Error(`Path not found: ${path}`));
    }
    if (isMemoryFile(entry)) {
      return this.deleteFile(normalizedPath);
    }
    return this.deleteDirectory(normalizedPath);
  }

  async renamePath(from: string, to: string): Promise<Result<void, Error>> {
    const normalizedFrom = this.normalizePath(from);
    const normalizedTo = this.normalizePath(to);

    if (!this.storage.has(normalizedFrom)) {
      return err(new Error(`Path not found: ${from}`));
    }
    if (this.storage.has(normalizedTo)) {
      return err(new Error(`Destination already exists: ${to}`));
    }

    const fromPrefix = normalizedFrom === '/' ? '/' : `${normalizedFrom}/`;
    const toPrefix = normalizedTo === '/' ? '/' : `${normalizedTo}/`;

    const updates: Array<[string, MemoryEntry, string]> = [];
    for (const [storedPath, storedEntry] of this.storage.entries()) {
      if (storedPath === normalizedFrom) {
        updates.push([storedPath, storedEntry, normalizedTo]);
      } else if (storedPath.startsWith(fromPrefix)) {
        const remainder = storedPath.slice(fromPrefix.length);
        updates.push([storedPath, storedEntry, `${toPrefix}${remainder}`]);
      }
    }

    for (const [oldPath, _entry, _newPath] of updates) {
      this.storage.delete(oldPath);
    }
    for (const [_oldPath, entry, newPath] of updates) {
      this.storage.set(newPath, entry);
    }
    return ok(undefined);
  }

  // --- Testing utilities ---

  /**
   * Seed the file system with initial files.
   * Useful for setting up test fixtures.
   * @param files - Record of path to content
   */
  seed(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      this.storage.set(this.normalizePath(path), {
        content,
        modifiedAt: new Date(),
      });

      // Ensure parent directories exist
      const parts = this.normalizePath(path).split('/').filter(Boolean);
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath += '/' + parts[i];
        if (!this.storage.has(currentPath)) {
          this.storage.set(currentPath, { isDirectory: true, modifiedAt: new Date() });
        }
      }
    }
  }

  /**
   * Clear all stored files and directories.
   */
  clear(): void {
    this.storage.clear();
    this.storage.set('/', { isDirectory: true, modifiedAt: new Date() });
  }

  /**
   * Get all stored paths (for debugging/testing)
   */
  getPaths(): string[] {
    return Array.from(this.storage.keys());
  }

  // --- Private helpers ---

  private normalizePath(path: string): string {
    // Remove trailing slashes, handle empty path
    let normalized = path.replace(/\/+$/, '');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    return normalized || '/';
  }

  private getParentPath(path: string): string | null {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    return path.slice(0, lastSlash);
  }
}
