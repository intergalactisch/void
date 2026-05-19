/**
 * OperationService - Inbound port for AI operation management
 *
 * Exposes the operation queue, session management, and result handling
 * to the UI layer (stores, components).
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import type { SessionId } from '$lib/domain/values/SessionId';
import type { OperationType } from '$lib/domain/values/OperationType';
import type { OperationTemplate, ContextRequirement } from '$lib/domain/values/OperationTemplate';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';

/**
 * Request to queue a new operation.
 */
export interface OperationRequest {
  type: OperationType;
  label: string;
  prompt: string;
  targetNotes?: string[];
  contextRequirements?: ContextRequirement[];
  templateId?: string;
  webAccess?: AIWebAccess;
}

export interface OperationSessionOptions {
  webAccess?: AIWebAccess;
}

/**
 * Queue status information.
 */
export interface QueueStatus {
  activeCount: number;
  queuedCount: number;
  concurrencyLimit: number;
}

/**
 * Operation state change event.
 */
export interface OperationStateChange {
  operations: Operation[];
  queueStatus: QueueStatus;
}

/**
 * OperationService inbound port.
 */
export interface OperationService {
  // Lifecycle
  initialize(): Promise<void>;
  persistRunningOperations(): Promise<void>;

  // Queue management
  queue(request: OperationRequest): Promise<Result<Operation, Error>>;
  queueFromTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean>
  ): Promise<Result<Operation, Error>>;
  cancel(operationId: OperationId): Promise<Result<void, Error>>;

  // Session management
  startSession(
    name: string,
    initialPrompt: string,
    contextRequirements?: ContextRequirement[],
    options?: OperationSessionOptions
  ): Promise<Result<Operation, Error>>;
  resumeSession(
    sessionId: SessionId,
    prompt: string,
    options?: OperationSessionOptions
  ): Promise<Result<Operation, Error>>;

  // Result handling
  applyResult(operationId: OperationId): Promise<Result<void, Error>>;
  discardResult(operationId: OperationId): void;

  // Queries
  getOperation(id: OperationId): Operation | null;
  getActiveOperations(): Operation[];
  getCompletedOperations(): Operation[];
  getAllOperations(): Operation[];
  getSessions(): Operation[];
  getQueueStatus(): QueueStatus;

  // History
  clearHistory(): Promise<Result<void, Error>>;

  // Templates
  getTemplates(): OperationTemplate[];
  getTemplate(id: string): OperationTemplate | null;

  // Subscription
  subscribe(callback: (state: OperationStateChange) => void): () => void;
}
