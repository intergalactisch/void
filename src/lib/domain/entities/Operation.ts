/**
 * Operation - AI operation entity
 *
 * Represents a single AI operation with its full lifecycle:
 * creation, queueing, execution, completion/failure/cancellation.
 *
 * SessionOperation extends this for resumable CLI sessions.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { OperationId } from '../values/OperationId';
import { createOperationId } from '../values/OperationId';
import type { OperationStatus } from '../values/OperationStatus';
import type { OperationType } from '../values/OperationType';
import type { OperationContext } from '../values/OperationContext';
import type { OperationResult } from '../values/OperationResult';
import type { SessionId } from '../values/SessionId';
import type { AIWebAccess } from '../values/AIWebAccess';
import { createSessionId } from '../values/SessionId';

/**
 * Progress information for a running operation.
 */
export interface OperationProgress {
  /** 0-100 percentage */
  percent: number;
  /** Human-readable status message */
  message: string;
}

/**
 * Core operation entity.
 */
export interface Operation {
  id: OperationId;
  type: OperationType;
  status: OperationStatus;
  label: string;
  prompt: string;
  context: OperationContext | null;
  targetNotes: string[];
  result: OperationResult | null;
  progress: OperationProgress;
  parentId: OperationId | null;
  childIds: OperationId[];
  /** Template ID if created from a template */
  templateId: string | null;
  /** Internet access policy for the backing AI provider. */
  webAccess: AIWebAccess;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Session operation with persistent CLI session support.
 */
export interface SessionOperation extends Operation {
  type: 'session';
  sessionId: SessionId;
  sessionName: string;
  interactionCount: number;
  isResumable: boolean;
}

/**
 * Create a new operation.
 */
export function createOperation(params: {
  type: OperationType;
  label: string;
  prompt: string;
  context?: OperationContext | null;
  targetNotes?: string[];
  parentId?: OperationId | null;
  templateId?: string | null;
  webAccess?: AIWebAccess;
}): Operation {
  return {
    id: createOperationId(),
    type: params.type,
    status: 'pending',
    label: params.label,
    prompt: params.prompt,
    context: params.context ?? null,
    targetNotes: params.targetNotes ?? [],
    result: null,
    progress: { percent: 0, message: '' },
    parentId: params.parentId ?? null,
    childIds: [],
    templateId: params.templateId ?? null,
    webAccess: params.webAccess ?? 'off',
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Create a new session operation.
 */
export function createSessionOperation(params: {
  label: string;
  prompt: string;
  sessionName: string;
  context?: OperationContext | null;
  targetNotes?: string[];
  templateId?: string | null;
  webAccess?: AIWebAccess;
}): SessionOperation {
  return {
    ...createOperation({ ...params, type: 'session' }),
    type: 'session',
    sessionId: createSessionId(),
    sessionName: params.sessionName,
    interactionCount: 0,
    isResumable: true,
  };
}

// =========================================================================
// State transitions
// =========================================================================

/**
 * Transition operation to queued state.
 */
export function queueOperation(op: Operation): Operation {
  return { ...op, status: 'queued' };
}

/**
 * Transition operation to running state.
 */
export function startOperation(op: Operation): Operation {
  return { ...op, status: 'running', startedAt: new Date() };
}

/**
 * Transition operation to completed state with result.
 */
export function completeOperation(op: Operation, result: OperationResult): Operation {
  return { ...op, status: 'completed', result, completedAt: new Date() };
}

/**
 * Transition operation to failed state.
 */
export function failOperation(op: Operation, error: string): Operation {
  return {
    ...op,
    status: 'failed',
    result: {
      status: 'failed',
      outputs: [],
      rawResponse: error,
      durationMs: op.startedAt ? Date.now() - op.startedAt.getTime() : 0,
      metadata: { error },
    },
    completedAt: new Date(),
  };
}

/**
 * Transition operation to cancelled state.
 */
export function cancelOperation(op: Operation): Operation {
  return { ...op, status: 'cancelled', completedAt: new Date() };
}

/**
 * Update operation progress.
 */
export function updateOperationProgress(
  op: Operation,
  percent: number,
  message: string
): Operation {
  return { ...op, progress: { percent, message } };
}

/**
 * Check if an operation is a session operation.
 */
export function isSessionOperation(op: Operation): op is SessionOperation {
  return op.type === 'session' && 'sessionId' in op;
}
