/**
 * AgentRunStoragePort - persistence for durable agent runs.
 */

import type { Result } from '$lib/core';
import type { AgentRun, AgentRunEvent, AgentWorkerMessage } from '$lib/domain/entities/AgentRun';

export interface AgentRunStoragePort {
  save(run: AgentRun): Promise<Result<void, Error>>;
  get(runId: string): Promise<Result<AgentRun | null, Error>>;
  list(): Promise<Result<AgentRun[], Error>>;
  appendEvent(runId: string, event: AgentRunEvent): Promise<Result<void, Error>>;
  listEvents(runId: string, fromEventId?: string): Promise<Result<AgentRunEvent[], Error>>;
  /** Append one worker message to per-worker JSONL log (scalable). */
  appendWorkerMessage(runId: string, message: AgentWorkerMessage): Promise<Result<void, Error>>;
  /** Read all worker messages for a run (merged across all workers + orchestrator). */
  listWorkerMessages(runId: string): Promise<Result<AgentWorkerMessage[], Error>>;
  delete(runId: string): Promise<Result<void, Error>>;
}
