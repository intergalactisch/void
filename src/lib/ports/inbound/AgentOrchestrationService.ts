/**
 * AgentOrchestrationService - durable multi-step AI work.
 *
 * This is the public application API used by the UI to start, approve,
 * cancel, resume, and inspect full agent runs.
 */

import type { Result } from '$lib/core';
import type { AgentRun } from '$lib/domain/entities/AgentRun';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { AgentRunSummary, AgentRunSummaryQuery, PagedResult } from '$lib/ports/outbound';

export interface AgentRunState {
  currentRun: AgentRun | null;
  runs: AgentRun[];
  isRunning: boolean;
  error: Error | null;
}

export interface ResearchRunTarget {
  folder: string;
  mode: 'reuse' | 'new';
  previousRunId?: string;
}

export type ResearchTargetResolution =
  | {
      action: 'use';
      target: ResearchRunTarget;
      proposedFolder: string;
      previousFolder?: string;
      previousRunId?: string;
      rationale: string;
    }
  | {
      action: 'needs_confirmation';
      previousFolder: string;
      proposedFolder: string;
      previousRunId: string;
      rationale: string;
    };

export interface ResolveResearchTargetOptions {
  conversationId?: string | null;
}

export interface StartAgentRunOptions {
  conversationId?: string;
  requireApproval?: boolean;
  clientTurnId?: string;
  appendUserMessage?: boolean;
  sourceMessageId?: string;
  webAccess?: AIWebAccess;
  orchestrationMode?: 'auto' | 'single' | 'swarm';
  maxWorkers?: number;
  researchTarget?: ResearchRunTarget;
}

export interface ContinueWorkerOptions {
  runId: string;
  workerId: string;
  message: string;
  target: 'worker' | 'orchestrator';
}

export interface AgentOrchestrationService {
  startRun(prompt: string, options?: StartAgentRunOptions): Promise<Result<AgentRun, Error>>;
  resolveResearchTarget(prompt: string, options?: ResolveResearchTargetOptions): Promise<Result<ResearchTargetResolution, Error>>;
  approveRun(runId: string): Promise<Result<void, Error>>;
  cancelRun(runId: string): Promise<Result<void, Error>>;
  resumeRun(runId: string): Promise<Result<AgentRun, Error>>;
  continueWorker(options: ContinueWorkerOptions): Promise<Result<AgentRun, Error>>;
  getRun(runId: string): Promise<Result<AgentRun | null, Error>>;
  listRuns(): Promise<Result<AgentRun[], Error>>;
  listRunSummaries(query?: AgentRunSummaryQuery): Promise<Result<PagedResult<AgentRunSummary>, Error>>;
  reconcileStuckRuns(): Promise<void>;
  getState(): AgentRunState;
  subscribe(callback: (state: AgentRunState) => void): () => void;
}
