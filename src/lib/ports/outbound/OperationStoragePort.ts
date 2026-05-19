/**
 * OperationStoragePort - Interface for operation persistence
 *
 * Defines the contract for storing and retrieving AI operations.
 * Implementations can use file system or in-memory storage.
 *
 * Part of Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';

/**
 * Port for operation persistence operations.
 *
 * All methods return Result types for explicit error handling.
 */
export interface OperationStoragePort {
  /**
   * Save an operation (create or update).
   */
  save(operation: Operation): Promise<Result<void, Error>>;

  /**
   * Load an operation by ID.
   */
  load(id: OperationId): Promise<Result<Operation | null, Error>>;

  /**
   * Delete an operation.
   */
  delete(id: OperationId): Promise<Result<void, Error>>;

  /**
   * Load all persisted operations.
   */
  listAll(): Promise<Result<Operation[], Error>>;

  /**
   * Get the count of stored operations.
   */
  count(): Promise<number>;

  /**
   * Clear all stored operations.
   */
  clearAll(): Promise<Result<number, Error>>;
}
