/**
 * StreamEntry — a single item in the AI Command Center narrative stream.
 *
 * The command center center column merges several sources (conversation
 * messages, their tool invocations, agent-run events/workers/artifacts, and
 * optimistic pending turns) into one chronological list of typed entries.
 * This file owns only the shape; `application/stream/conversationStream.ts`
 * builds the list and `CommandStream.svelte` renders it.
 */

import type { Message } from '../entities/Message';
import type { ToolInvocation } from '../entities/ToolInvocation';
import type { AgentRun, AgentWorkerMessage } from '../entities/AgentRun';

/** The kind of app entity an action card points at. */
export type StreamArtifactEntity = 'note' | 'todo' | 'source' | 'media' | 'folder';

/** What happened to an entity, used for the action card's verb. */
export type StreamArtifactAction =
  | 'created'
  | 'updated'
  | 'found'
  | 'completed'
  | 'reopened'
  | 'deleted'
  | 'moved'
  | 'tagged';

/** Where an action card navigates when clicked. */
export type StreamOpenTarget =
  | { kind: 'note'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'todo'; todoId?: string }
  | { kind: 'none' };

/** Minimal optimistic-turn shape (decoupled from the command-center store). */
export interface StreamPendingTurn {
  id: string;
  text: string;
  createdAt: Date;
  status: 'routing' | 'submitted' | 'failed';
  error?: string;
}

interface StreamEntryBase {
  /** Stable id for keyed rendering. */
  id: string;
  /** Epoch ms used as the primary chronological sort key. */
  at: number;
  /** Tiebreaker when timestamps collide (run event sequence / array index). */
  seq: number;
  /** Owning run, or null for plain conversation entries. */
  runId: string | null;
  /** Whether this entry survives the "milestones" density filter. */
  milestone: boolean;
}

export interface UserTextEntry extends StreamEntryBase {
  kind: 'user-text';
  message: Message;
}

export interface AssistantTextEntry extends StreamEntryBase {
  kind: 'assistant-text';
  message: Message;
}

export interface PendingTurnEntry extends StreamEntryBase {
  kind: 'pending-turn';
  turn: StreamPendingTurn;
}

export interface RunStartedEntry extends StreamEntryBase {
  kind: 'run-started';
  run: AgentRun;
}

export interface PlanEntry extends StreamEntryBase {
  kind: 'plan';
  summary: string;
  steps: string[];
}

export interface WorkerSpawnEntry extends StreamEntryBase {
  kind: 'worker-spawn';
  count: number;
  mode: AgentRun['orchestrationMode'];
}

export interface WorkerMessageEntry extends StreamEntryBase {
  kind: 'worker-message';
  message: AgentWorkerMessage;
}

export interface ToolCallEntry extends StreamEntryBase {
  kind: 'tool-call';
  invocation: ToolInvocation;
}

export interface ArtifactChangedEntry extends StreamEntryBase {
  kind: 'artifact-changed';
  action: StreamArtifactAction;
  entity: StreamArtifactEntity;
  title: string;
  detail?: string;
  target: StreamOpenTarget;
}

export interface MergeSummaryEntry extends StreamEntryBase {
  kind: 'merge-summary';
  summary: string;
}

export interface RunCompletedEntry extends StreamEntryBase {
  kind: 'run-completed';
  run: AgentRun;
  summary: string | null;
}

export interface RunFailedEntry extends StreamEntryBase {
  kind: 'run-failed';
  run: AgentRun;
  error: string;
}

export type StreamEntry =
  | UserTextEntry
  | AssistantTextEntry
  | PendingTurnEntry
  | RunStartedEntry
  | PlanEntry
  | WorkerSpawnEntry
  | WorkerMessageEntry
  | ToolCallEntry
  | ArtifactChangedEntry
  | MergeSummaryEntry
  | RunCompletedEntry
  | RunFailedEntry;

export type StreamEntryKind = StreamEntry['kind'];
