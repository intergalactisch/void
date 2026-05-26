/**
 * AgentRun - durable orchestration state for multi-step AI work.
 *
 * The domain layer owns only the shape and pure helpers. Services decide how
 * runs execute, adapters decide where they are stored.
 */

import type { ResearchCitation } from '../values/ResearchCitation';
import type { AIWebAccess } from '../values/AIWebAccess';
import type { DeepResearchState } from '../values/DeepResearchPhase';

export type AgentRunStatus =
  | 'planning'
  | 'searching'
  | 'coordinating'
  | 'waiting_approval'
  | 'executing'
  | 'merging'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTaskKind =
  | 'plan'
  | 'search'
  | 'web'
  | 'media'
  | 'worker'
  | 'approval'
  | 'create'
  | 'update'
  | 'navigate'
  | 'link'
  | 'merge'
  | 'review'
  | 'tool'
  | 'other';

export type AgentArtifactType =
  | 'note'
  | 'folder'
  | 'source'
  | 'media'
  | 'diff'
  | 'operation'
  | 'summary';

export type AgentRunEventType =
  | 'run.started'
  | 'run.status'
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'source.verified'
  | 'source.failed'
  | 'worker.started'
  | 'worker.message'
  | 'worker.completed'
  | 'worker.failed'
  | 'worker.cancelled'
  | 'merge.started'
  | 'merge.completed'
  | 'merge.failed'
  | 'note.created'
  | 'note.updated'
  | 'artifact.created'
  | 'link.reviewed'
  | 'narration'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export type { ResearchCitation } from '../values/ResearchCitation';

export type AgentOrchestrationMode = 'single' | 'swarm';

export type AgentResearchEvidenceLevel =
  | 'verified_sources'
  | 'unverified_leads'
  | 'vault_context'
  | 'model_prior'
  | 'scaffold_only';

export type AgentWorkerWriteScope =
  | 'read_only'
  | 'staged_draft'
  | 'proposed_patch'
  | 'direct_scoped';

export type AgentWorkerCapability =
  | 'read_context'
  | 'research'
  | 'draft_artifact'
  | 'stage_note'
  | 'propose_patch'
  | 'direct_write';

export interface AgentWorkerTargetResource {
  id: string;
  accessMode?: 'read' | 'write' | 'create';
}

export interface AgentExistingNoteEvidence {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface AgentResearchEvidenceBundle {
  existingNotes: AgentExistingNoteEvidence[];
  citations: ResearchCitation[];
  collectedAt: string;
  source: 'preflight' | 'recovery' | 'mixed';
}

export type AgentWorkerStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentWorkerMessageType =
  | 'worker.prompt'
  | 'worker.response'
  | 'worker.progress'
  | 'worker.tool_result'
  | 'worker.artifact_draft'
  | 'worker.question'
  | 'worker.result'
  | 'worker.failed'
  | 'orchestrator.instruction'
  | 'orchestrator.merge_decision'
  | 'user.followup'
  | 'user.directive';

export type AgentArtifactDraftType =
  | 'note'
  | 'folder'
  | 'source'
  | 'media'
  | 'summary'
  | 'todo'
  | 'diff';

export type AgentMediaKind =
  | 'article'
  | 'youtube'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'other';

export interface AgentArtifactDraft {
  id: string;
  workerId: string;
  type: AgentArtifactDraftType;
  title: string;
  path?: string;
  url?: string;
  thumbnailUrl?: string;
  mediaKind?: AgentMediaKind;
  content?: string;
  summary?: string;
  citation?: ResearchCitation;
  confidence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type AgentAssignedNoteRole =
  | 'overview'
  | 'aspect'
  | 'sources'
  | 'media'
  | 'further-reading';

export interface AgentAssignedNote {
  title: string;
  folder: string;
  siblingTitles: string[];
  role?: AgentAssignedNoteRole;
}

export interface AgentWorkerSpec {
  id: string;
  title: string;
  role: string;
  objective: string;
  input: string;
  deliverables: string[];
  dependencies: string[];
  allowedTools: string[];
  writeScope?: AgentWorkerWriteScope;
  capabilities?: AgentWorkerCapability[];
  targetResources?: AgentWorkerTargetResource[];
  assignedNote?: AgentAssignedNote;
}

export interface AgentWorkerResult {
  workerId: string;
  title: string;
  summary: string;
  findings: string[];
  artifactDrafts: AgentArtifactDraft[];
  citations: ResearchCitation[];
  risks: string[];
  nextActions: string[];
  confidence: number;
  quality?: 'substantive' | 'weak' | 'insufficient';
  evidenceLevel?: AgentResearchEvidenceLevel;
  completedAt: string;
}

export interface AgentWorker {
  id: string;
  runId: string;
  spec: AgentWorkerSpec;
  status: AgentWorkerStatus;
  progress: number;
  result?: AgentWorkerResult;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkerMessage {
  id: string;
  runId: string;
  workerId?: string;
  type: AgentWorkerMessageType;
  createdAt: string;
  message: string;
  progress?: number;
  toolId?: string;
  artifactDraft?: AgentArtifactDraft;
  result?: AgentWorkerResult;
  data?: Record<string, unknown>;
}

export interface AgentMergeState {
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed';
  summary: string | null;
  writePrompt: string | null;
  sourceWorkerIds: string[];
  artifactDrafts: AgentArtifactDraft[];
  touchedExistingNotes: string[];
  risks: string[];
  evidenceLevel?: AgentResearchEvidenceLevel;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface AgentArtifact {
  id: string;
  type: AgentArtifactType;
  title: string;
  path?: string;
  url?: string;
  thumbnailUrl?: string;
  mediaKind?: AgentMediaKind;
  noteId?: string;
  summary?: string;
  citation?: ResearchCitation;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  runId: string;
  title: string;
  kind: AgentTaskKind;
  status: AgentTaskStatus;
  progress: number;
  dependencies: string[];
  aiOnly: boolean;
  parentId?: string | null;
  targetResource?: string;
  detail?: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  type: AgentRunEventType;
  createdAt: string;
  sequence: number;
  taskId?: string;
  artifactId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface AgentRunPlan {
  summary: string;
  steps: string[];
  suggestedFolder?: string;
  researchTarget?: {
    folder: string;
    mode: 'reuse' | 'new';
    previousRunId?: string;
  };
  suggestedNotes: string[];
  existingNotes: AgentExistingNoteEvidence[];
  citations: ResearchCitation[];
  researchEvidence?: AgentResearchEvidenceBundle;
}

export interface AgentRunApproval {
  required: boolean;
  status: 'not_required' | 'pending' | 'approved' | 'rejected';
  requestedAt?: string;
  decidedAt?: string;
  reason?: string;
}

export interface AgentRun {
  id: string;
  prompt: string;
  status: AgentRunStatus;
  orchestrationMode: AgentOrchestrationMode;
  conversationId: string | null;
  /** Existing user message that caused this run, used by retry/recovery flows. */
  sourceMessageId?: string;
  /** Internet access policy for provider turns inside this run. */
  webAccess?: AIWebAccess;
  approval: AgentRunApproval;
  plan: AgentRunPlan | null;
  workers: AgentWorker[];
  workerMessages: AgentWorkerMessage[];
  merge: AgentMergeState | null;
  tasks: AgentTask[];
  artifacts: AgentArtifact[];
  events: AgentRunEvent[];
  finalSummary: string | null;
  error: string | null;
  /** Deep research pipeline state when the run is in research mode. */
  deepResearch?: DeepResearchState;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export const ACTIVE_AGENT_RUN_STATUSES = [
  'planning',
  'searching',
  'coordinating',
  'waiting_approval',
  'executing',
  'merging',
  'reviewing',
] as const satisfies readonly AgentRunStatus[];

export function isActiveAgentRunStatus(status: AgentRunStatus): boolean {
  return (ACTIVE_AGENT_RUN_STATUSES as readonly AgentRunStatus[]).includes(status);
}

export function isActiveAgentRun<T extends Pick<AgentRun, 'status'>>(run: T | null | undefined): run is T {
  return !!run && isActiveAgentRunStatus(run.status);
}

export function createAgentRun(params: {
  id?: string;
  prompt: string;
  conversationId?: string | null;
  sourceMessageId?: string;
  approvalRequired?: boolean;
  webAccess?: AIWebAccess;
  orchestrationMode?: AgentOrchestrationMode;
}): AgentRun {
  const now = new Date().toISOString();
  const id = params.id ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const approvalRequired = params.approvalRequired ?? true;

  const run: AgentRun = {
    id,
    prompt: params.prompt,
    status: 'planning',
    orchestrationMode: params.orchestrationMode ?? 'single',
    conversationId: params.conversationId ?? null,
    webAccess: params.webAccess ?? 'off',
    approval: {
      required: approvalRequired,
      status: approvalRequired ? 'pending' : 'not_required',
    },
    plan: null,
    workers: [],
    workerMessages: [],
    merge: null,
    tasks: [],
    artifacts: [],
    events: [],
    finalSummary: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  if (params.sourceMessageId !== undefined) run.sourceMessageId = params.sourceMessageId;
  return run;
}

export function normalizeAgentRun(run: AgentRun): AgentRun {
  const next: AgentRun = {
    ...run,
    orchestrationMode: run.orchestrationMode ?? 'single',
    workers: run.workers ?? [],
    workerMessages: run.workerMessages ?? [],
    merge: run.merge ?? null,
    webAccess: run.webAccess ?? 'off',
    events: run.events ?? [],
    artifacts: run.artifacts ?? [],
    tasks: run.tasks ?? [],
  };
  if (run.deepResearch !== undefined) next.deepResearch = run.deepResearch;
  return next;
}

export function createAgentWorker(params: {
  runId: string;
  spec: AgentWorkerSpec;
  status?: AgentWorkerStatus;
}): AgentWorker {
  const now = new Date().toISOString();
  return {
    id: params.spec.id,
    runId: params.runId,
    spec: params.spec,
    status: params.status ?? 'pending',
    progress: params.status === 'completed' ? 100 : 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function setAgentWorkerStatus(
  worker: AgentWorker,
  status: AgentWorkerStatus,
  params: { progress?: number; result?: AgentWorkerResult; error?: string } = {}
): AgentWorker {
  const now = new Date().toISOString();
  const next: AgentWorker = {
    ...worker,
    status,
    progress: params.progress ?? (status === 'completed' ? 100 : worker.progress),
    updatedAt: now,
  };

  if (status === 'running' && !next.startedAt) next.startedAt = now;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    next.completedAt = now;
  }
  if (params.result !== undefined) next.result = params.result;
  if (params.error !== undefined) next.error = params.error;

  return next;
}

export function createAgentWorkerMessage(params: {
  runId: string;
  type: AgentWorkerMessageType;
  message: string;
  workerId?: string;
  progress?: number;
  toolId?: string;
  artifactDraft?: AgentArtifactDraft;
  result?: AgentWorkerResult;
  data?: Record<string, unknown>;
  id?: string;
}): AgentWorkerMessage {
  const item: AgentWorkerMessage = {
    id: params.id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId: params.runId,
    type: params.type,
    createdAt: new Date().toISOString(),
    message: params.message,
  };

  if (params.workerId !== undefined) item.workerId = params.workerId;
  if (params.progress !== undefined) item.progress = params.progress;
  if (params.toolId !== undefined) item.toolId = params.toolId;
  if (params.artifactDraft !== undefined) item.artifactDraft = params.artifactDraft;
  if (params.result !== undefined) item.result = params.result;
  if (params.data !== undefined) item.data = params.data;

  return item;
}

export function createAgentTask(params: {
  runId: string;
  title: string;
  kind: AgentTaskKind;
  id?: string;
  status?: AgentTaskStatus;
  dependencies?: string[];
  aiOnly?: boolean;
  parentId?: string | null;
  targetResource?: string;
  detail?: string;
}): AgentTask {
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: params.id ?? `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId: params.runId,
    title: params.title,
    kind: params.kind,
    status: params.status ?? 'pending',
    progress: params.status === 'completed' ? 100 : 0,
    dependencies: params.dependencies ?? [],
    aiOnly: params.aiOnly ?? true,
    createdAt: now,
    updatedAt: now,
  };

  if (params.parentId !== undefined) task.parentId = params.parentId;
  if (params.targetResource !== undefined) task.targetResource = params.targetResource;
  if (params.detail !== undefined) task.detail = params.detail;

  return task;
}

export function createAgentRunEvent(params: {
  runId: string;
  type: AgentRunEventType;
  sequence?: number;
  id?: string;
  taskId?: string;
  artifactId?: string;
  message?: string;
  data?: Record<string, unknown>;
}): AgentRunEvent {
  const event: AgentRunEvent = {
    id: params.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId: params.runId,
    type: params.type,
    createdAt: new Date().toISOString(),
    sequence: params.sequence ?? 0,
  };

  if (params.taskId !== undefined) event.taskId = params.taskId;
  if (params.artifactId !== undefined) event.artifactId = params.artifactId;
  if (params.message !== undefined) event.message = params.message;
  if (params.data !== undefined) event.data = params.data;

  return event;
}

export function touchAgentRun(run: AgentRun): AgentRun {
  return { ...run, updatedAt: new Date().toISOString() };
}

export function setAgentTaskStatus(
  task: AgentTask,
  status: AgentTaskStatus,
  params: { progress?: number; detail?: string; result?: string; error?: string } = {}
): AgentTask {
  const now = new Date().toISOString();
  const next: AgentTask = {
    ...task,
    status,
    progress: params.progress ?? (status === 'completed' ? 100 : task.progress),
    updatedAt: now,
  };

  if (status === 'running' && !next.startedAt) next.startedAt = now;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    next.completedAt = now;
  }
  if (params.detail !== undefined) next.detail = params.detail;
  if (params.result !== undefined) next.result = params.result;
  if (params.error !== undefined) next.error = params.error;

  return next;
}
