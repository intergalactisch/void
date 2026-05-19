/**
 * PersistedOperation - Serializable operation for disk storage
 *
 * Mirrors Operation but with ISO string dates, no context (has non-serializable Map),
 * and no progress (runtime-only). Session fields are optional.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { OperationId } from './OperationId';
import type { OperationType } from './OperationType';
import type { OperationStatus } from './OperationStatus';
import type { OperationResult } from './OperationResult';
import type { SessionId } from './SessionId';
import type { AIWebAccess } from './AIWebAccess';
import type { Operation, SessionOperation } from '../entities/Operation';
import { isSessionOperation } from '../entities/Operation';

/**
 * Serializable operation shape for JSON persistence.
 */
export interface PersistedOperation {
  id: OperationId;
  type: OperationType;
  status: OperationStatus;
  label: string;
  prompt: string;
  targetNotes: string[];
  result: OperationResult | null;
  parentId: OperationId | null;
  childIds: OperationId[];
  templateId?: string | null;
  webAccess?: AIWebAccess;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;

  // Session-specific fields (present when type === 'session')
  sessionId?: SessionId;
  sessionName?: string;
  interactionCount?: number;
  isResumable?: boolean;
}

/**
 * Convert an Operation to its persistable form.
 * Strips context (non-serializable Map) and progress (runtime-only).
 */
export function toPersistedOperation(op: Operation): PersistedOperation {
  const persisted: PersistedOperation = {
    id: op.id,
    type: op.type,
    status: op.status,
    label: op.label,
    prompt: op.prompt,
    targetNotes: op.targetNotes,
    result: op.result,
    parentId: op.parentId,
    childIds: op.childIds,
    templateId: op.templateId,
    webAccess: op.webAccess,
    createdAt: op.createdAt.toISOString(),
    startedAt: op.startedAt?.toISOString() ?? null,
    completedAt: op.completedAt?.toISOString() ?? null,
  };

  if (isSessionOperation(op)) {
    persisted.sessionId = op.sessionId;
    persisted.sessionName = op.sessionName;
    persisted.interactionCount = op.interactionCount;
    persisted.isResumable = op.isResumable;
  }

  return persisted;
}

/**
 * Restore an Operation from its persisted form.
 * Sets context to null and progress to default values.
 */
export function fromPersistedOperation(raw: PersistedOperation): Operation {
  const base: Operation = {
    id: raw.id,
    type: raw.type,
    status: raw.status,
    label: raw.label,
    prompt: raw.prompt,
    context: null,
    targetNotes: raw.targetNotes,
    result: raw.result,
    progress: { percent: 0, message: '' },
    parentId: raw.parentId,
    childIds: raw.childIds,
    templateId: raw.templateId ?? null,
    webAccess: raw.webAccess ?? 'off',
    createdAt: new Date(raw.createdAt),
    startedAt: raw.startedAt ? new Date(raw.startedAt) : null,
    completedAt: raw.completedAt ? new Date(raw.completedAt) : null,
  };

  // Restore SessionOperation shape if session fields are present
  if (raw.type === 'session' && raw.sessionId) {
    const sessionOp: SessionOperation = {
      ...base,
      type: 'session',
      sessionId: raw.sessionId,
      sessionName: raw.sessionName ?? '',
      interactionCount: raw.interactionCount ?? 0,
      isResumable: raw.isResumable ?? false,
    };
    return sessionOp;
  }

  return base;
}
