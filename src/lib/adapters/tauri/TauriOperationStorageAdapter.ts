/**
 * TauriOperationStorageAdapter - File-based operation persistence
 *
 * Implements OperationStoragePort using Tauri's file system commands.
 * Stores operations as individual JSON files in a dedicated directory.
 *
 * Storage structure:
 *   {notesPath}/.void/operations/
 *     {operation-id}.json
 *     ...
 *
 * Part of Hexagonal Architecture secondary adapters layer.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import {
  toPersistedOperation,
  fromPersistedOperation,
  type PersistedOperation,
} from '$lib/domain/values/PersistedOperation';
import type { OperationStoragePort } from '$lib/ports/outbound/OperationStoragePort';
import { fileCommands } from './commands';

const OPERATIONS_DIR = '.void/operations';
const OPERATION_EXT = '.json';

export class TauriOperationStorageAdapter implements OperationStoragePort {
  private notesPath: string;
  private operationsDir: string;
  private initialized = false;

  constructor(notesPath: string) {
    this.notesPath = notesPath;
    this.operationsDir = `${notesPath}/${OPERATIONS_DIR}`;
  }

  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;

    const exists = await fileCommands.exists(this.operationsDir);
    if (!exists) {
      await fileCommands.createDirectory(this.operationsDir);
    }
    this.initialized = true;
  }

  private getFilePath(id: OperationId): string {
    return `${this.operationsDir}/${id}${OPERATION_EXT}`;
  }

  async save(operation: Operation): Promise<Result<void, Error>> {
    try {
      await this.ensureDirectory();

      const persisted = toPersistedOperation(operation);
      const filePath = this.getFilePath(operation.id);
      const content = JSON.stringify(persisted, null, 2);

      await fileCommands.writeFile(filePath, content);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async load(id: OperationId): Promise<Result<Operation | null, Error>> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(id);
      const exists = await fileCommands.exists(filePath);

      if (!exists) {
        return ok(null);
      }

      const content = await fileCommands.readFile(filePath);
      const raw = JSON.parse(content) as PersistedOperation;

      return ok(fromPersistedOperation(raw));
    } catch (e) {
      return err(toError(e));
    }
  }

  async delete(id: OperationId): Promise<Result<void, Error>> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(id);
      const exists = await fileCommands.exists(filePath);

      if (exists) {
        await fileCommands.deleteFile(filePath);
      }

      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async listAll(): Promise<Result<Operation[], Error>> {
    try {
      await this.ensureDirectory();

      const entries = await fileCommands.listDirectory(this.operationsDir);
      const jsonFiles = entries.filter(
        (e) => e.isFile && e.name.endsWith(OPERATION_EXT)
      );

      const operations: Operation[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fileCommands.readFile(file.path);
          const raw = JSON.parse(content) as PersistedOperation;
          operations.push(fromPersistedOperation(raw));
        } catch {
          console.warn(`[TauriOperationStorageAdapter] Failed to load ${file.path}`);
        }
      }

      // Sort by createdAt descending (newest first)
      operations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return ok(operations);
    } catch (e) {
      return err(toError(e));
    }
  }

  async count(): Promise<number> {
    try {
      await this.ensureDirectory();

      const entries = await fileCommands.listDirectory(this.operationsDir);
      return entries.filter(
        (e) => e.isFile && e.name.endsWith(OPERATION_EXT)
      ).length;
    } catch {
      return 0;
    }
  }

  async clearAll(): Promise<Result<number, Error>> {
    try {
      await this.ensureDirectory();

      const entries = await fileCommands.listDirectory(this.operationsDir);
      const jsonFiles = entries.filter(
        (e) => e.isFile && e.name.endsWith(OPERATION_EXT)
      );

      let deleted = 0;
      for (const file of jsonFiles) {
        try {
          await fileCommands.deleteFile(file.path);
          deleted++;
        } catch {
          console.warn(`[TauriOperationStorageAdapter] Failed to delete ${file.path}`);
        }
      }

      return ok(deleted);
    } catch (e) {
      return err(toError(e));
    }
  }

  setNotesPath(notesPath: string): void {
    this.notesPath = notesPath;
    this.operationsDir = `${notesPath}/${OPERATIONS_DIR}`;
    this.initialized = false;
  }
}

export function createTauriOperationStorageAdapter(notesPath: string): OperationStoragePort {
  return new TauriOperationStorageAdapter(notesPath);
}
