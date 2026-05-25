/**
 * NoteCommandHandler - Handles all note-related commands
 *
 * This handler is responsible for:
 * - Validating commands before execution
 * - Executing operations via the DocumentPort
 * - Emitting domain events on success
 * - Handling errors and rollbacks
 *
 * Commands are processed with resource locking to prevent
 * concurrent modifications to the same note.
 */

import type { DocumentPort } from '$lib/ports/outbound';
import type { Document } from '$lib/domain';
import { ok, type Result } from '$lib/core';
import type { CommandResult } from '../commands';
import {
  commandSuccess,
  commandFailure,
  type NoteCreateCommand,
  type NoteCreateQuickCommand,
  type NoteDeleteCommand,
  type NoteRenameCommand,
  type NoteSaveCommand,
  type NoteOpenCommand,
  type NoteCloseCommand,
} from '../commands';
import { events } from '../bus';

/**
 * Configuration for NoteCommandHandler.
 */
export interface NoteCommandHandlerOptions {
  /** Whether to emit domain events (default: true) */
  emitDomainEvents?: boolean;
}

/**
 * Handler for all note-related commands.
 *
 * Uses the DocumentPort for persistence operations and emits
 * domain events to notify listeners of state changes.
 */
export class NoteCommandHandler {
  private documentPort: DocumentPort;
  private options: Required<NoteCommandHandlerOptions>;

  constructor(documentPort: DocumentPort, options: NoteCommandHandlerOptions = {}) {
    this.documentPort = documentPort;
    this.options = {
      emitDomainEvents: options.emitDomainEvents ?? true,
    };
  }

  /**
   * Handle note:create command.
   *
   * Creates a new note with the specified title in the specified folder.
   * Validates that the note doesn't already exist.
   */
  async handleCreate(command: NoteCreateCommand): Promise<CommandResult<Document>> {
    const { folder, title } = command.payload;
    const pathResult = await this.findUniquePathForTitle(folder, title);
    if (!pathResult.ok) {
      return commandFailure(command.id, pathResult.error);
    }
    const path = pathResult.value;

    // Execute: create the document
    const result = await this.documentPort.create(path, title);
    if (!result.ok) {
      return commandFailure(command.id, result.error);
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:created', { path, document: result.value, source: 'user' });
    }

    return commandSuccess(command.id, result.value);
  }

  /**
   * Handle note:create-quick command.
   *
   * Creates a new note with an auto-generated datetime-based filename.
   * Handles collision by adding a numeric suffix.
   */
  async handleCreateQuick(command: NoteCreateQuickCommand): Promise<CommandResult<Document>> {
    const { folder } = command.payload;

    // Find a unique path
    const pathResult = await this.findUniquePath(folder);
    if (!pathResult.ok) {
      return commandFailure(command.id, pathResult.error);
    }
    const path = pathResult.value;
    const filename = path.split('/').pop()!;
    const title = this.datetimeFilenameToTitle(filename);

    // Execute: create the document
    const result = await this.documentPort.create(path, title);
    if (!result.ok) {
      return commandFailure(command.id, result.error);
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:created', { path, document: result.value, source: 'user' });
    }

    return commandSuccess(command.id, result.value);
  }

  /**
   * Handle note:delete command.
   *
   * Deletes a note at the specified path.
   */
  async handleDelete(command: NoteDeleteCommand): Promise<CommandResult<void>> {
    const { path } = command.payload;

    // Execute: move the document into recoverable Trash.
    const result = await this.documentPort.trash(path);
    if (!result.ok) {
      return commandFailure(command.id, result.error);
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:deleted', { path, source: 'user' });
    }

    return commandSuccess(command.id, undefined);
  }

  /**
   * Handle note:rename command.
   *
   * Renames a note to a new title. This involves:
   * 1. Loading the current document
   * 2. Updating the title in metadata
   * 3. Saving to the new path
   * 4. Deleting the old path
   *
   * If any step fails, we attempt to rollback.
   */
  async handleRename(command: NoteRenameCommand): Promise<CommandResult<string>> {
    const { path, newTitle } = command.payload;

    // Step 1: Load the current document
    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      return commandFailure(command.id, loadResult.error);
    }

    const document = loadResult.value;

    // Update the title in metadata
    document.meta.title = newTitle;
    document.meta.updatedAt = new Date();

    // Calculate new path
    const dirParts = path.split('/');
    dirParts.pop(); // Remove old filename
    const newFilename = this.titleToFilename(newTitle);
    const newPath = dirParts.length > 0
      ? `${dirParts.join('/')}/${newFilename}`
      : newFilename;

    // If path didn't change, just update the title
    if (newPath === path) {
      const saveResult = await this.documentPort.save(document);
      if (!saveResult.ok) {
        return commandFailure(command.id, saveResult.error);
      }

      // Emit domain event
      if (this.options.emitDomainEvents) {
        events.emit('note:renamed', { oldPath: path, newPath, newTitle, source: 'user' });
      }

      return commandSuccess(command.id, newPath);
    }

    // Step 2: Save to new path
    const saveResult = await this.documentPort.save({
      ...document,
      path: newPath,
    });

    if (!saveResult.ok) {
      return commandFailure(command.id, saveResult.error);
    }

    // Step 3: Delete old path
    const deleteResult = await this.documentPort.delete(path);
    if (!deleteResult.ok) {
      // Attempt rollback: delete the new file we just created
      await this.documentPort.delete(newPath);
      return commandFailure(command.id, new Error(
        `Failed to delete old note after rename. Rolled back. Error: ${deleteResult.error.message}`
      ));
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:renamed', { oldPath: path, newPath, newTitle, source: 'user' });
    }

    return commandSuccess(command.id, newPath);
  }

  /**
   * Handle note:save command.
   *
   * Saves the current content of a note.
   * Note: The actual document content must be provided by the caller
   * since this handler doesn't have access to editor state.
   */
  async handleSave(command: NoteSaveCommand, document: Document): Promise<CommandResult<void>> {
    const { path } = command.payload;

    // Validate path matches document
    if (document.path !== path) {
      return commandFailure(command.id, new Error(
        `Document path mismatch: expected ${path}, got ${document.path}`
      ));
    }

    // Execute: save the document
    const result = await this.documentPort.save(document);
    if (!result.ok) {
      return commandFailure(command.id, result.error);
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:saved', { path, savedAt: new Date(), source: 'user' });
    }

    return commandSuccess(command.id, undefined);
  }

  /**
   * Handle note:open command.
   *
   * Opens a note for editing by loading it from storage.
   */
  async handleOpen(command: NoteOpenCommand): Promise<CommandResult<Document>> {
    const { path } = command.payload;

    // Execute: load the document
    const result = await this.documentPort.load(path);
    if (!result.ok) {
      return commandFailure(command.id, result.error);
    }

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:opened', { path, document: result.value });
    }

    return commandSuccess(command.id, result.value);
  }

  /**
   * Handle note:close command.
   *
   * Closes a note. This is primarily for event emission;
   * the actual cleanup is handled by the calling service.
   */
  handleClose(command: NoteCloseCommand): CommandResult<void> {
    const { path } = command.payload;

    // Emit domain event
    if (this.options.emitDomainEvents) {
      events.emit('note:closed', { path });
    }

    return commandSuccess(command.id, undefined);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

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
}
