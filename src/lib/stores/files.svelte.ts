/**
 * Files Store - Primary Adapter
 *
 * Thin reactive wrapper around FileService for UI flows that need to
 * read or write files outside the notes vault (e.g. exporting markdown
 * to a user-chosen path via a save dialog). Components reach for this
 * store instead of resolving FileSystemPort from the container directly.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import type { FileService } from '$lib/ports/inbound';
import type { Result } from '$lib/core';

class FilesStore {
  #service: FileService | null = null;

  init(service: FileService): void {
    this.#service = service;
  }

  /** Whether the store has been wired to a FileService. */
  get ready(): boolean {
    return this.#service !== null;
  }

  /**
   * Write content to an absolute file path. The page-level export action
   * uses this after collecting a destination from a save dialog.
   */
  async write(path: string, content: string): Promise<Result<void, Error>> {
    if (!this.#service) throw new Error('FilesStore not initialized');
    return this.#service.write(path, content);
  }

  /** Read absolute file path as string. */
  async read(path: string): Promise<Result<string, Error>> {
    if (!this.#service) throw new Error('FilesStore not initialized');
    return this.#service.read(path);
  }

  /** Existence check that propagates I/O errors. */
  async exists(path: string): Promise<Result<boolean, Error>> {
    if (!this.#service) throw new Error('FilesStore not initialized');
    return this.#service.exists(path);
  }
}

/** Singleton FilesStore instance. */
export const filesStore = new FilesStore();
