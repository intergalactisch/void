/**
 * OperationStatus - Lifecycle state of an AI operation
 *
 * Operations progress through: pending -> queued -> running -> completed/failed/cancelled
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * All possible operation statuses.
 */
export type OperationStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Check if a status represents a terminal state (no further transitions).
 */
export function isTerminalStatus(status: OperationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Check if a status represents a running operation.
 */
export function isRunningStatus(status: OperationStatus): boolean {
  return status === 'running';
}

/**
 * Check if a status represents an active (non-terminal) operation.
 */
export function isActiveStatus(status: OperationStatus): boolean {
  return !isTerminalStatus(status);
}
