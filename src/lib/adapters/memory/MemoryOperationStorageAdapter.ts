/**
 * MemoryOperationStorageAdapter - In-memory operation persistence for testing
 *
 * Implements OperationStoragePort using an in-memory Map.
 * Deep clones via toPersistedOperation/fromPersistedOperation round-trip.
 *
 * Part of Hexagonal Architecture secondary adapters layer.
 */

import { ok, type Result } from '$lib/core';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import {
  toPersistedOperation,
  fromPersistedOperation,
  type PersistedOperation,
} from '$lib/domain/values/PersistedOperation';
import type { OperationStoragePort } from '$lib/ports/outbound/OperationStoragePort';

export class MemoryOperationStorageAdapter implements OperationStoragePort {
  private store = new Map<OperationId, PersistedOperation>();

  async save(operation: Operation): Promise<Result<void, Error>> {
    this.store.set(operation.id, toPersistedOperation(operation));
    return ok(undefined);
  }

  async load(id: OperationId): Promise<Result<Operation | null, Error>> {
    const persisted = this.store.get(id);
    if (!persisted) {
      return ok(null);
    }
    return ok(fromPersistedOperation(persisted));
  }

  async delete(id: OperationId): Promise<Result<void, Error>> {
    this.store.delete(id);
    return ok(undefined);
  }

  async listAll(): Promise<Result<Operation[], Error>> {
    const operations = Array.from(this.store.values())
      .map(fromPersistedOperation)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return ok(operations);
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async clearAll(): Promise<Result<number, Error>> {
    const count = this.store.size;
    this.store.clear();
    return ok(count);
  }
}
