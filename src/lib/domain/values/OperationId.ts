/**
 * OperationId - Unique identifier for AI operations
 *
 * Operations are identified by a prefixed string: 'op_<timestamp>_<random>'.
 * Branded type for type safety.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Operation ID branded type.
 */
export type OperationId = string & { readonly __brand: 'OperationId' };

/**
 * Create a new unique OperationId.
 */
export function createOperationId(): OperationId {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `op_${timestamp}_${random}` as OperationId;
}

/**
 * Check if a string is a valid OperationId.
 */
export function isValidOperationId(id: string): id is OperationId {
  return /^op_\d+_[a-z0-9]+$/.test(id);
}
