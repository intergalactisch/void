/**
 * AgentOrchestrationService - durable multi-step AI work.
 *
 * This is the public application API used by the UI to start, approve,
 * cancel, resume, and inspect full agent runs.
 */

import type { Result } from '$lib/core';
import type { AgentRun } from '$lib/domain/entities/AgentRun';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';

export interface AgentRunState {
  currentRun: AgentRun | null;
  runs: AgentRun[];
  isRunning: boolean;
  error: Error | null;
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
}

export interface ContinueWorkerOptions {
  runId: string;
  workerId: string;
  message: string;
  target: 'worker' | 'orchestrator';
}

export interface AgentOrchestrationService {
  startRun(prompt: string, options?: StartAgentRunOptions): Promise<Result<AgentRun, Error>>;
  approveRun(runId: string): Promise<Result<void, Error>>;
  cancelRun(runId: string): Promise<Result<void, Error>>;
  resumeRun(runId: string): Promise<Result<AgentRun, Error>>;
  continueWorker(options: ContinueWorkerOptions): Promise<Result<AgentRun, Error>>;
  getRun(runId: string): Promise<Result<AgentRun | null, Error>>;
  listRuns(): Promise<Result<AgentRun[], Error>>;
  reconcileStuckRuns(): Promise<void>;
  getState(): AgentRunState;
  subscribe(callback: (state: AgentRunState) => void): () => void;
}
