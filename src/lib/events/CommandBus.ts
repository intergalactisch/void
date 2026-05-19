/**
 * CommandBus - High-level API for note operations with resource locking
 *
 * Provides a simple interface for note operations (create, delete, rename, etc.)
 * with per-resource locking to prevent concurrent modifications.
 *
 * Uses ResourceLock directly — no CommandQueue or NoteCommandHandler indirection.
 *
 * Usage:
 * ```typescript
 * const bus = new CommandBus(documentPort);
 *
 * // Create a note
 * const result = await bus.createNote('My Note', 'my-folder');
 *
 * // Delete a note
 * const result = await bus.deleteNote('my-folder/my-note.md');
 * ```
 */

import type { DocumentPort } from '$lib/ports/outbound';
import type { Document } from '$lib/domain';
import { ok, type Result } from '$lib/core';
import type { CommandResult } from './commands';
import { commandSuccess, commandFailure } from './commands';
import { ResourceLock } from './queue/ResourceLock';
import { events } from './bus';

/**
 * Options for the CommandBus.
 */
export interface CommandBusOptions {
  /** Whether to emit lifecycle events (default: true) */
  emitLifecycleEvents?: boolean;
  /** Whether to emit domain events (default: true) */
  emitDomainEvents?: boolean;
  /** Whether to log in development mode (default: true) */
  devLogging?: boolean;
}

/**
 * CommandBus provides a high-level API for note operations.
 *
 * Features:
 * - Type-safe note operations
 * - Per-resource locking (concurrent ops on same note are serialized)
 * - Domain event emission (note:created, note:deleted, etc.)
 * - Command lifecycle events (command:started, command:completed, command:failed)
 */
export class CommandBus {
  private readonly documentPort: DocumentPort;
  private readonly resourceLock = new ResourceLock();
  private readonly options: Required<CommandBusOptions>;

  /** Known command types for hasHandler() */
  private static readonly KNOWN_TYPES = new Set([
    'note:create', 'note:create-quick', 'note:delete',
    'note:rename', 'note:save', 'note:open', 'note:close',
  ]);

  constructor(documentPort: DocumentPort, options: CommandBusOptions = {}) {
    this.documentPort = documentPort;
    this.options = {
      emitLifecycleEvents: options.emitLifecycleEvents ?? true,
      emitDomainEvents: options.emitDomainEvents ?? true,
      devLogging: options.devLogging ?? true,
    };
  }

  // ============================================================================
  // Note Commands
  // ============================================================================

  /**
   * Create a new note.
   */
  async createNote(title: string, folder = ''): Promise<CommandResult<Document>> {
    const path = this.pathForTitle(folder, title);

    return this.execute('note:create', path, async (commandId) => {
      const exists = await this.documentPort.exists(path);
      if (!exists.ok) return commandFailure(commandId, exists.error);
      if (exists.value) {
        return commandFailure(commandId, new Error(`Note already exists: ${path}`));
      }

      const result = await this.documentPort.create(path, title);
      if (!result.ok) return commandFailure(commandId, result.error);

      if (this.options.emitDomainEvents) {
        events.emit('note:created', { path, document: result.value, source: 'user' });
      }

      return commandSuccess(commandId, result.value);
    });
  }

  /**
   * Create a quick note with auto-generated datetime title.
   */
  async createQuickNote(folder = ''): Promise<CommandResult<Document>> {
    return this.execute('note:create-quick', undefined, async (commandId) => {
      const pathResult = await this.findUniquePath(folder);
      if (!pathResult.ok) return commandFailure(commandId, pathResult.error);
      const path = pathResult.value;
      const filename = path.split('/').pop()!;
      const title = this.datetimeFilenameToTitle(filename);

      const result = await this.documentPort.create(path, title);
      if (!result.ok) return commandFailure(commandId, result.error);

      if (this.options.emitDomainEvents) {
        events.emit('note:created', { path, document: result.value, source: 'user' });
      }

      return commandSuccess(commandId, result.value);
    });
  }

  /**
   * Delete a note.
   */
  async deleteNote(path: string): Promise<CommandResult<void>> {
    return this.execute('note:delete', path, async (commandId) => {
      const result = await this.documentPort.delete(path);
      if (!result.ok) return commandFailure(commandId, result.error);

      if (this.options.emitDomainEvents) {
        events.emit('note:deleted', { path, source: 'user' });
      }

      return commandSuccess(commandId, undefined);
    });
  }

  /**
   * Rename a note.
   */
  async renameNote(path: string, newTitle: string): Promise<CommandResult<string>> {
    return this.execute('note:rename', path, async (commandId) => {
      // Load current document
      const loadResult = await this.documentPort.load(path);
      if (!loadResult.ok) return commandFailure(commandId, loadResult.error);

      const document = loadResult.value;
      document.meta.title = newTitle;
      document.meta.updatedAt = new Date();

      // Calculate new path
      const dirParts = path.split('/');
      dirParts.pop();
      const newFilename = this.titleToFilename(newTitle);
      const newPath = dirParts.length > 0
        ? `${dirParts.join('/')}/${newFilename}`
        : newFilename;

      // If path didn't change, just update the title
      if (newPath === path) {
        const saveResult = await this.documentPort.save(document);
        if (!saveResult.ok) return commandFailure(commandId, saveResult.error);

        if (this.options.emitDomainEvents) {
          events.emit('note:renamed', { oldPath: path, newPath, newTitle, source: 'user' });
        }
        return commandSuccess(commandId, newPath);
      }

      const targetExists = await this.documentPort.exists(newPath);
      if (!targetExists.ok) return commandFailure(commandId, targetExists.error);
      if (targetExists.value) {
        return commandFailure(commandId, new Error(`Cannot rename ${path}: ${newPath} already exists`));
      }

      // Save to new path
      const saveResult = await this.documentPort.save({ ...document, path: newPath });
      if (!saveResult.ok) return commandFailure(commandId, saveResult.error);

      // Delete old path
      const deleteResult = await this.documentPort.delete(path);
      if (!deleteResult.ok) {
        // Rollback: delete the new file
        await this.documentPort.delete(newPath);
        return commandFailure(commandId, new Error(
          `Failed to delete old note after rename. Rolled back. Error: ${deleteResult.error.message}`
        ));
      }

      if (this.options.emitDomainEvents) {
        events.emit('note:renamed', { oldPath: path, newPath, newTitle, source: 'user' });
      }
      return commandSuccess(commandId, newPath);
    });
  }

  /**
   * Save a note with the given document content.
   */
  async saveNote(document: Document): Promise<CommandResult<void>> {
    return this.execute('note:save', document.path, async (commandId) => {
      const result = await this.documentPort.save(document);
      if (!result.ok) return commandFailure(commandId, result.error);

      if (this.options.emitDomainEvents) {
        events.emit('note:saved', { path: document.path, savedAt: new Date(), source: 'user' });
      }
      return commandSuccess(commandId, undefined);
    });
  }

  /**
   * Open a note for editing.
   */
  async openNote(path: string): Promise<CommandResult<Document>> {
    return this.execute('note:open', path, async (commandId) => {
      const result = await this.documentPort.load(path);
      if (!result.ok) return commandFailure(commandId, result.error);

      if (this.options.emitDomainEvents) {
        events.emit('note:opened', { path, document: result.value });
      }
      return commandSuccess(commandId, result.value);
    });
  }

  /**
   * Close a note.
   */
  async closeNote(path: string): Promise<CommandResult<void>> {
    return this.execute('note:close', path, async (commandId) => {
      if (this.options.emitDomainEvents) {
        events.emit('note:closed', { path });
      }
      return commandSuccess(commandId, undefined);
    });
  }

  // ============================================================================
  // Status Methods
  // ============================================================================

  /**
   * Check if a resource is currently locked (being processed).
   */
  isResourceLocked(path: string): boolean {
    return this.resourceLock.isLocked(path);
  }

  /**
   * Get the number of pending commands for a resource.
   */
  pendingForResource(path: string): number {
    return this.resourceLock.queueLength(path);
  }

  /**
   * Get the total number of pending commands (always 0 — no global queue).
   */
  get pendingCount(): number {
    return 0;
  }

  /**
   * Check if a handler is registered for a command type.
   */
  hasHandler(type: string): boolean {
    return CommandBus.KNOWN_TYPES.has(type);
  }

  /**
   * Clear state. Use only for testing or cleanup.
   */
  clear(): void {
    this.resourceLock.clear();
  }

  // ============================================================================
  // Private: Execution with lifecycle events and locking
  // ============================================================================

  /**
   * Execute an operation with optional resource locking and lifecycle events.
   */
  private async execute<T>(
    commandType: string,
    resourceId: string | undefined,
    fn: (commandId: string) => Promise<CommandResult<T>>
  ): Promise<CommandResult<T>> {
    const commandId = crypto.randomUUID();

    if (this.options.devLogging && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.log(`[CommandBus] ${commandType}`, resourceId ?? '');
    }

    // Emit started
    if (this.options.emitLifecycleEvents) {
      events.emit('command:started', { commandId, commandType, resourceId });
    }

    const run = async (): Promise<CommandResult<T>> => {
      try {
        const result = await fn(commandId);

        if (this.options.emitLifecycleEvents) {
          if (result.success) {
            events.emit('command:completed', { commandId, commandType, resourceId });
          } else {
            events.emit('command:failed', { commandId, commandType, error: result.error.message, resourceId });
          }
        }
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (this.options.emitLifecycleEvents) {
          events.emit('command:failed', { commandId, commandType, error: err.message, resourceId });
        }
        return commandFailure(commandId, err);
      }
    };

    // Use resource lock if resourceId is provided
    if (resourceId) {
      return this.resourceLock.withLock(resourceId, run);
    }
    return run();
  }

  // ============================================================================
  // Private: Path helpers (absorbed from NoteCommandHandler)
  // ============================================================================

  private titleToFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '.md';
  }

  private generateDatetimeFilename(suffix?: number): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return suffix ? `${base}-${suffix}.md` : `${base}.md`;
  }

  private datetimeFilenameToTitle(filename: string): string {
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?\.md$/);
    if (!match) {
      return filename.replace(/\.md$/, '').replace(/-/g, ' ');
    }
    const [, year, month, day, hour, minute, , suffix] = match;
    const date = new Date(+year!, +month! - 1, +day!, +hour!, +minute!);
    let title = date.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }) + ` ${hour}:${minute}`;
    if (suffix) {
      title += ` (${suffix})`;
    }
    return title;
  }

  private async findUniquePathForTitle(folder: string, title: string): Promise<Result<string, Error>> {
    const baseFilename = this.titleToFilename(title);
    const basePath = folder ? `${folder}/${baseFilename}` : baseFilename;

    const baseExists = await this.documentPort.exists(basePath);
    if (!baseExists.ok) return baseExists;
    if (!baseExists.value) {
      return ok(basePath);
    }

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

    const filename = `${stem}-${Date.now()}.md`;
    return ok(folder ? `${folder}/${filename}` : filename);
  }

  private pathForTitle(folder: string, title: string): string {
    const filename = this.titleToFilename(title);
    return folder ? `${folder}/${filename}` : filename;
  }

  private async findUniquePath(folder: string): Promise<Result<string, Error>> {
    let filename = this.generateDatetimeFilename();
    let path = folder ? `${folder}/${filename}` : filename;

    const firstExists = await this.documentPort.exists(path);
    if (!firstExists.ok) return firstExists;
    if (!firstExists.value) {
      return ok(path);
    }

    for (let suffix = 1; suffix <= 99; suffix++) {
      filename = this.generateDatetimeFilename(suffix);
      path = folder ? `${folder}/${filename}` : filename;
      const candidate = await this.documentPort.exists(path);
      if (!candidate.ok) return candidate;
      if (!candidate.value) {
        return ok(path);
      }
    }

    const ts = Date.now();
    filename = `${ts}.md`;
    return ok(folder ? `${folder}/${filename}` : filename);
  }
}

/**
 * Factory function to create a CommandBus.
 * Used by the DI container.
 */
export function createCommandBus(
  documentPort: DocumentPort,
  options?: CommandBusOptions
): CommandBus {
  return new CommandBus(documentPort, options);
}
