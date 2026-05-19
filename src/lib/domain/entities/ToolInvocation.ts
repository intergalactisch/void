/**
 * ToolInvocation - Tool execution state machine
 *
 * Represents a single invocation of a tool, tracking its state
 * from pending through execution to completion or failure.
 *
 * State machine:
 *   pending → executing → completed
 *                     ↘ failed
 *                     ↘ cancelled
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { ToolId } from '../values/ToolId';
import type { ToolResult } from '../values/ToolResult';

/**
 * Invocation states.
 */
export type InvocationStatus =
  | 'pending'    // Waiting to be executed
  | 'executing'  // Currently running
  | 'completed'  // Finished successfully
  | 'failed'     // Finished with error
  | 'cancelled'; // Cancelled before completion

/**
 * Tool invocation entity.
 */
export interface ToolInvocation {
  /** Unique invocation ID */
  id: string;

  /** Tool being invoked */
  toolId: ToolId;

  /** Arguments passed to the tool */
  args: Record<string, unknown>;

  /** Current status */
  status: InvocationStatus;

  /** When invocation was created */
  createdAt: Date;

  /** When execution started (null if pending) */
  startedAt: Date | null;

  /** When execution completed (null if not finished) */
  completedAt: Date | null;

  /** Result of execution (null if not completed) */
  result: ToolResult | null;

  /** Progress indicator (0-100, for long operations) */
  progress: number;

  /** Human-readable status message */
  message: string | null;

  /** Whether user confirmed this invocation (for requiresConfirmation tools) */
  confirmed: boolean;

  /** Parent conversation message ID (if from AI) */
  messageId: string | null;
}

/**
 * Create a new tool invocation.
 */
export function createInvocation(params: {
  toolId: ToolId;
  args: Record<string, unknown>;
  messageId?: string;
  confirmed?: boolean;
}): ToolInvocation {
  return {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: params.toolId,
    args: params.args,
    status: 'pending',
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    result: null,
    progress: 0,
    message: null,
    confirmed: params.confirmed ?? false,
    messageId: params.messageId ?? null,
  };
}

// =========================================================================
// State transitions
// =========================================================================

/**
 * Transition invocation to executing state.
 */
export function startInvocation(invocation: ToolInvocation): ToolInvocation {
  if (invocation.status !== 'pending') {
    throw new Error(`Cannot start invocation in ${invocation.status} state`);
  }

  return {
    ...invocation,
    status: 'executing',
    startedAt: new Date(),
    message: 'Executing...',
  };
}

/**
 * Update invocation progress.
 */
export function updateProgress(
  invocation: ToolInvocation,
  progress: number,
  message?: string
): ToolInvocation {
  if (invocation.status !== 'executing') {
    throw new Error(`Cannot update progress in ${invocation.status} state`);
  }

  return {
    ...invocation,
    progress: Math.max(0, Math.min(100, progress)),
    message: message ?? invocation.message,
  };
}

/**
 * Complete invocation with result.
 */
export function completeInvocation(
  invocation: ToolInvocation,
  result: ToolResult
): ToolInvocation {
  if (invocation.status !== 'executing') {
    throw new Error(`Cannot complete invocation in ${invocation.status} state`);
  }

  const status: InvocationStatus =
    result.status === 'success' || result.status === 'partial'
      ? 'completed'
      : result.status === 'cancelled'
        ? 'cancelled'
        : 'failed';

  return {
    ...invocation,
    status,
    completedAt: new Date(),
    result,
    progress: 100,
    message: status === 'completed' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Failed',
  };
}

/**
 * Cancel a pending or executing invocation.
 */
export function cancelInvocation(
  invocation: ToolInvocation,
  reason: string
): ToolInvocation {
  if (invocation.status !== 'pending' && invocation.status !== 'executing') {
    throw new Error(`Cannot cancel invocation in ${invocation.status} state`);
  }

  return {
    ...invocation,
    status: 'cancelled',
    completedAt: new Date(),
    message: reason,
  };
}

/**
 * Confirm a pending invocation (for tools that require confirmation).
 */
export function confirmInvocation(invocation: ToolInvocation): ToolInvocation {
  if (invocation.status !== 'pending') {
    throw new Error(`Cannot confirm invocation in ${invocation.status} state`);
  }

  return {
    ...invocation,
    confirmed: true,
  };
}

// =========================================================================
// State queries
// =========================================================================

/**
 * Check if invocation is in a terminal state.
 */
export function isTerminal(invocation: ToolInvocation): boolean {
  return (
    invocation.status === 'completed' ||
    invocation.status === 'failed' ||
    invocation.status === 'cancelled'
  );
}

/**
 * Check if invocation is pending.
 */
export function isPending(invocation: ToolInvocation): boolean {
  return invocation.status === 'pending';
}

/**
 * Check if invocation is executing.
 */
export function isExecuting(invocation: ToolInvocation): boolean {
  return invocation.status === 'executing';
}

/**
 * Check if invocation completed successfully.
 */
export function isSuccessful(invocation: ToolInvocation): boolean {
  return invocation.status === 'completed' && invocation.result?.status === 'success';
}

/**
 * Check if invocation needs user confirmation.
 */
export function needsConfirmation(invocation: ToolInvocation): boolean {
  return invocation.status === 'pending' && !invocation.confirmed;
}

/**
 * Get execution duration in milliseconds (0 if not started).
 */
export function getDuration(invocation: ToolInvocation): number {
  if (!invocation.startedAt) {
    return 0;
  }

  const endTime = invocation.completedAt ?? new Date();
  return endTime.getTime() - invocation.startedAt.getTime();
}

/**
 * Get a summary of the invocation for display.
 */
export function summarizeInvocation(invocation: ToolInvocation): string {
  const argsSummary = Object.entries(invocation.args)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');

  const truncated = Object.keys(invocation.args).length > 3 ? '...' : '';

  return `${invocation.toolId}(${argsSummary}${truncated}) [${invocation.status}]`;
}

/**
 * Serialize invocation for persistence/logging.
 */
export function serializeInvocation(invocation: ToolInvocation): Record<string, unknown> {
  return {
    id: invocation.id,
    toolId: invocation.toolId,
    args: invocation.args,
    status: invocation.status,
    createdAt: invocation.createdAt.toISOString(),
    startedAt: invocation.startedAt?.toISOString() ?? null,
    completedAt: invocation.completedAt?.toISOString() ?? null,
    progress: invocation.progress,
    message: invocation.message,
    messageId: invocation.messageId,
  };
}
