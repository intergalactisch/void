/**
 * AgentRunStoragePort - persistence for durable agent runs.
 */

import type { Result } from '$lib/core';
import type {
  AgentArtifactType,
  AgentOrchestrationMode,
  AgentRun,
  AgentRunEvent,
  AgentRunStatus,
  AgentWorkerMessage,
} from '$lib/domain/entities/AgentRun';
import type { PagedResult, SummaryQueryBase } from './PagedQuery';

export interface AgentRunSummary {
  id: string;
  prompt: string;
  status: AgentRunStatus;
  orchestrationMode: AgentOrchestrationMode;
  conversationId: string | null;
  sourceMessageId: string | null;
  workerCount: number;
  runningWorkerCount: number;
  completedWorkerCount: number;
  taskCount: number;
  completedTaskCount: number;
  artifactCount: number;
  artifactTypes: AgentArtifactType[];
  lastEventPreview: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentRunSummaryQuery extends SummaryQueryBase {
  status?: AgentRunStatus | 'active' | 'terminal' | 'all';
  orchestrationMode?: AgentOrchestrationMode | 'all';
  conversationId?: string | null;
}

export interface AgentRunStoragePort {
  save(run: AgentRun): Promise<Result<void, Error>>;
  get(runId: string): Promise<Result<AgentRun | null, Error>>;
  list(): Promise<Result<AgentRun[], Error>>;
  listSummaries(query?: AgentRunSummaryQuery): Promise<Result<PagedResult<AgentRunSummary>, Error>>;
  appendEvent(runId: string, event: AgentRunEvent): Promise<Result<void, Error>>;
  listEvents(runId: string, fromEventId?: string): Promise<Result<AgentRunEvent[], Error>>;
  /** Append one worker message to per-worker JSONL log (scalable). */
  appendWorkerMessage(runId: string, message: AgentWorkerMessage): Promise<Result<void, Error>>;
  /** Read all worker messages for a run (merged across all workers + orchestrator). */
  listWorkerMessages(runId: string): Promise<Result<AgentWorkerMessage[], Error>>;
  delete(runId: string): Promise<Result<void, Error>>;
}
