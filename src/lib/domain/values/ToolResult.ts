/**
 * ToolResult - Result of tool execution
 *
 * Represents the outcome of executing a tool, which can be:
 * - Success with data
 * - Partial success with warnings
 * - Failure with error details
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { ToolId } from './ToolId';

/**
 * Severity levels for result messages.
 */
export type ResultSeverity = 'info' | 'warning' | 'error';

/**
 * A message attached to a tool result.
 */
export interface ResultMessage {
  /** Message severity */
  severity: ResultSeverity;
  /** Human-readable message */
  text: string;
  /** Optional error code for programmatic handling */
  code?: string;
}

/**
 * Base properties shared by all result types.
 */
interface BaseToolResult {
  /** Tool that was executed */
  toolId: ToolId;
  /** When execution started */
  startedAt: Date;
  /** When execution completed */
  completedAt: Date;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Successful tool execution result.
 */
export interface ToolResultSuccess<T = unknown> extends BaseToolResult {
  status: 'success';
  /** Result data from the tool */
  data: T;
  /** Optional informational messages */
  messages?: ResultMessage[];
}

/**
 * Partial success (completed but with warnings).
 */
export interface ToolResultPartial<T = unknown> extends BaseToolResult {
  status: 'partial';
  /** Partial result data */
  data: T;
  /** Warning messages explaining limitations */
  messages: ResultMessage[];
}

/**
 * Failed tool execution.
 */
export interface ToolResultFailure extends BaseToolResult {
  status: 'failure';
  /** Error that caused the failure */
  error: Error;
  /** Additional error context */
  messages?: ResultMessage[];
}

/**
 * Cancelled tool execution.
 */
export interface ToolResultCancelled extends BaseToolResult {
  status: 'cancelled';
  /** Reason for cancellation */
  reason: string;
}

/**
 * Union of all possible tool results.
 */
export type ToolResult<T = unknown> =
  | ToolResultSuccess<T>
  | ToolResultPartial<T>
  | ToolResultFailure
  | ToolResultCancelled;

function makeErrorSerializable(error: Error): Error {
  if (!Object.prototype.hasOwnProperty.call(error, 'toJSON')) {
    Object.defineProperty(error, 'toJSON', {
      value: () => ({
        name: error.name,
        message: error.message,
      }),
      configurable: true,
    });
  }
  return error;
}

// =========================================================================
// Result constructors
// =========================================================================

/**
 * Create a successful tool result.
 */
export function toolSuccess<T>(
  toolId: ToolId,
  data: T,
  startedAt: Date,
  messages?: ResultMessage[]
): ToolResultSuccess<T> {
  const completedAt = new Date();
  const result: ToolResultSuccess<T> = {
    status: 'success',
    toolId,
    data,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };

  if (messages !== undefined) {
    result.messages = messages;
  }

  return result;
}

/**
 * Create a partial success result.
 */
export function toolPartial<T>(
  toolId: ToolId,
  data: T,
  startedAt: Date,
  messages: ResultMessage[]
): ToolResultPartial<T> {
  const completedAt = new Date();
  return {
    status: 'partial',
    toolId,
    data,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    messages,
  };
}

/**
 * Create a failure result.
 */
export function toolFailure(
  toolId: ToolId,
  error: Error,
  startedAt: Date,
  messages?: ResultMessage[]
): ToolResultFailure {
  const completedAt = new Date();
  const result: ToolResultFailure = {
    status: 'failure',
    toolId,
    error: makeErrorSerializable(error),
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };

  if (messages !== undefined) {
    result.messages = messages;
  }

  return result;
}

/**
 * Create a cancelled result.
 */
export function toolCancelled(
  toolId: ToolId,
  reason: string,
  startedAt: Date
): ToolResultCancelled {
  const completedAt = new Date();
  return {
    status: 'cancelled',
    toolId,
    reason,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
}

// =========================================================================
// Type guards
// =========================================================================

/**
 * Check if result is successful.
 */
export function isToolSuccess<T>(result: ToolResult<T>): result is ToolResultSuccess<T> {
  return result.status === 'success';
}

/**
 * Check if result is partial success.
 */
export function isToolPartial<T>(result: ToolResult<T>): result is ToolResultPartial<T> {
  return result.status === 'partial';
}

/**
 * Check if result is failure.
 */
export function isToolFailure(result: ToolResult): result is ToolResultFailure {
  return result.status === 'failure';
}

/**
 * Check if result is cancelled.
 */
export function isToolCancelled(result: ToolResult): result is ToolResultCancelled {
  return result.status === 'cancelled';
}

/**
 * Check if result completed successfully (success or partial).
 */
export function isToolCompleted<T>(
  result: ToolResult<T>
): result is ToolResultSuccess<T> | ToolResultPartial<T> {
  return result.status === 'success' || result.status === 'partial';
}

/**
 * Get data from result if successful, otherwise undefined.
 */
export function getToolData<T>(result: ToolResult<T>): T | undefined {
  if (isToolCompleted(result)) {
    return result.data;
  }
  return undefined;
}

/**
 * Serialize a tool result for AI/logging.
 */
export function serializeToolResult(result: ToolResult): string {
  switch (result.status) {
    case 'success':
      return `Tool ${result.toolId} succeeded: ${JSON.stringify(result.data)}`;
    case 'partial':
      return `Tool ${result.toolId} partially succeeded: ${JSON.stringify(result.data)} (warnings: ${result.messages.map(m => m.text).join(', ')})`;
    case 'failure':
      return `Tool ${result.toolId} failed: ${result.error.message}`;
    case 'cancelled':
      return `Tool ${result.toolId} cancelled: ${result.reason}`;
  }
}
