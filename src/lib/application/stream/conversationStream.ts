/**
 * buildConversationStream — merge a conversation's messages, tool
 * invocations, agent runs, and optimistic pending turns into one
 * chronological list of {@link StreamEntry} items for the command center
 * narrative stream.
 *
 * Pure and framework-free so it can be unit-tested directly. Per-run entry
 * slices are memoized by a cheap version key so streaming chunks only rebuild
 * the run that actually changed.
 */

import type { Message } from '$lib/domain/entities/Message';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type {
  AgentArtifact,
  AgentRun,
  AgentRunEvent,
  AgentWorkerMessageType,
} from '$lib/domain/entities/AgentRun';
import type {
  ArtifactChangedEntry,
  StreamArtifactAction,
  StreamArtifactEntity,
  StreamEntry,
  StreamOpenTarget,
  StreamPendingTurn,
} from '$lib/domain/values/StreamEntry';

export interface BuildConversationStreamInput {
  /** Visible conversation messages (caller filters internal/live-activity). */
  messages: Message[];
  /** Agent runs belonging to this conversation. */
  runs: AgentRun[];
  /** Optimistic user turns not yet reconciled to a message. */
  pendingTurns: StreamPendingTurn[];
}

/** Worker message types that count as milestones in "milestones" density. */
const MILESTONE_WORKER_TYPES: ReadonlySet<AgentWorkerMessageType> = new Set([
  'worker.response',
  'worker.result',
  'worker.failed',
  'worker.question',
  'orchestrator.instruction',
  'orchestrator.merge_decision',
  'user.followup',
  'user.directive',
]);

export function buildConversationStream(input: BuildConversationStreamInput): StreamEntry[] {
  const entries: StreamEntry[] = [];

  // Entity keys already represented by a run artifact. Message tool-call
  // echoes for the same note/media/folder are dropped so a created note
  // shows once (the run artifact wins — richer + correct created/updated).
  const runArtifactKeys = new Set<string>();
  for (const run of input.runs) {
    for (const artifact of run.artifacts) {
      const key = artifactEntityKey(artifact);
      if (key) runArtifactKeys.add(key);
    }
  }

  for (const message of input.messages) {
    const textEntry = messageEntry(message);
    if (textEntry) entries.push(textEntry);

    message.toolInvocations.forEach((invocation, index) => {
      const entry = toolInvocationEntry(invocation, message, index, runArtifactKeys);
      if (entry) entries.push(entry);
    });
  }

  for (const run of input.runs) {
    for (const entry of buildRunEntries(run)) entries.push(entry);
  }

  for (const turn of input.pendingTurns) {
    entries.push({
      kind: 'pending-turn',
      id: `pending:${turn.id}`,
      at: turn.createdAt.getTime(),
      seq: 0,
      runId: null,
      milestone: true,
      turn,
    });
  }

  entries.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return entries;
}

// ── messages ─────────────────────────────────────────────────────────────

function messageEntry(message: Message): StreamEntry | null {
  if (message.role === 'user') {
    return {
      kind: 'user-text',
      id: `msg:${message.id}`,
      at: message.createdAt.getTime(),
      seq: 0,
      runId: null,
      milestone: true,
      message,
    };
  }

  // Assistant / system. Skip empty shells whose meaning lives entirely in
  // their tool invocations (those render as their own entries).
  const hasText = message.text.trim().length > 0;
  const hasActivity = (message.activity?.length ?? 0) > 0;
  if (!hasText && !hasActivity && !message.isStreaming) return null;

  return {
    kind: 'assistant-text',
    id: `msg:${message.id}`,
    at: message.createdAt.getTime(),
    seq: 0,
    runId: null,
    milestone: true,
    message,
  };
}

function toolInvocationEntry(
  invocation: ToolInvocation,
  message: Message,
  index: number,
  runArtifactKeys: Set<string>
): StreamEntry | null {
  const at = toMs(invocation.startedAt ?? invocation.createdAt) || message.createdAt.getTime();
  const seq = index + 1;

  const artifact = describeToolArtifact(invocation);
  if (artifact) {
    // Dedupe note/media/folder against run artifacts; todos always render.
    if (artifact.entity !== 'todo' && artifact.entityKey && runArtifactKeys.has(artifact.entityKey)) {
      return null;
    }
    return {
      kind: 'artifact-changed',
      id: `inv:${invocation.id}`,
      at,
      seq,
      runId: null,
      milestone: true,
      action: artifact.action,
      entity: artifact.entity,
      title: artifact.title,
      ...(artifact.detail !== undefined ? { detail: artifact.detail } : {}),
      target: artifact.target,
    };
  }

  return {
    kind: 'tool-call',
    id: `inv:${invocation.id}`,
    at,
    seq,
    runId: null,
    milestone: false,
    invocation,
  };
}

// ── runs (memoized) ────────────────────────────────────────────────────────

interface CachedRunEntries {
  key: string;
  entries: StreamEntry[];
}

const runEntryCache = new Map<string, CachedRunEntries>();

function runVersionKey(run: AgentRun): string {
  return `${run.updatedAt}:${run.events.length}:${run.artifacts.length}:${run.workerMessages.length}:${run.workers.length}:${run.status}`;
}

function buildRunEntries(run: AgentRun): StreamEntry[] {
  const key = runVersionKey(run);
  const cached = runEntryCache.get(run.id);
  if (cached && cached.key === key) return cached.entries;

  const entries = computeRunEntries(run);
  runEntryCache.set(run.id, { key, entries });
  return entries;
}

function computeRunEntries(run: AgentRun): StreamEntry[] {
  const entries: StreamEntry[] = [];
  const runStart = toMs(run.createdAt);

  entries.push({
    kind: 'run-started',
    id: `run:${run.id}:start`,
    at: runStart,
    seq: -1,
    runId: run.id,
    milestone: true,
    run,
  });

  if (run.plan && (run.plan.summary || run.plan.steps.length > 0)) {
    entries.push({
      kind: 'plan',
      id: `run:${run.id}:plan`,
      at: runStart,
      seq: 0,
      runId: run.id,
      milestone: false,
      summary: run.plan.summary,
      steps: run.plan.steps,
    });
  }

  if (run.workers.length > 0) {
    const spawnAt = run.workers.reduce(
      (min, worker) => Math.min(min, toMs(worker.createdAt) || runStart),
      runStart
    );
    entries.push({
      kind: 'worker-spawn',
      id: `run:${run.id}:spawn`,
      at: spawnAt,
      seq: 1,
      runId: run.id,
      milestone: true,
      count: run.workers.length,
      mode: run.orchestrationMode,
    });
  }

  run.workerMessages.forEach((message, index) => {
    entries.push({
      kind: 'worker-message',
      id: `wmsg:${message.id}`,
      at: toMs(message.createdAt),
      seq: index,
      runId: run.id,
      milestone: MILESTONE_WORKER_TYPES.has(message.type),
      message,
    });
  });

  // Resolve created/updated/found action for each artifact from its event.
  const eventByArtifact = new Map<string, AgentRunEvent>();
  for (const event of run.events) {
    if (event.artifactId && !eventByArtifact.has(event.artifactId)) {
      eventByArtifact.set(event.artifactId, event);
    }
  }

  const seenArtifacts = new Set<string>();
  for (const artifact of run.artifacts) {
    const event = eventByArtifact.get(artifact.id);
    const action = artifactAction(artifact, event);
    const entityKey = artifactEntityKey(artifact);
    const dedupeKey = `${entityKey ?? artifact.id}:${action}`;
    if (seenArtifacts.has(dedupeKey)) continue;
    seenArtifacts.add(dedupeKey);

    entries.push({
      kind: 'artifact-changed',
      id: `art:${run.id}:${artifact.id}`,
      at: toMs(event?.createdAt ?? artifact.createdAt) || runStart,
      seq: event?.sequence ?? 5000,
      runId: run.id,
      milestone: true,
      action,
      entity: artifactEntity(artifact.type),
      title: artifact.title,
      ...(artifact.summary ? { detail: artifact.summary } : {}),
      target: artifactTarget(artifact),
    });
  }

  if (run.merge?.summary) {
    entries.push({
      kind: 'merge-summary',
      id: `run:${run.id}:merge`,
      at: toMs(run.merge.completedAt ?? run.merge.startedAt ?? run.updatedAt),
      seq: 8000,
      runId: run.id,
      milestone: true,
      summary: run.merge.summary,
    });
  }

  if (run.status === 'completed') {
    entries.push({
      kind: 'run-completed',
      id: `run:${run.id}:done`,
      at: toMs(run.completedAt ?? run.updatedAt),
      seq: 9000,
      runId: run.id,
      milestone: true,
      run,
      summary: run.finalSummary,
    });
  } else if (run.status === 'failed') {
    entries.push({
      kind: 'run-failed',
      id: `run:${run.id}:failed`,
      at: toMs(run.completedAt ?? run.updatedAt),
      seq: 9000,
      runId: run.id,
      milestone: true,
      run,
      error: run.error ?? 'Run failed',
    });
  }

  return entries;
}

// ── tool → action card mapping ──────────────────────────────────────────────

interface ToolArtifactDescriptor {
  action: StreamArtifactAction;
  entity: StreamArtifactEntity;
  title: string;
  detail?: string;
  target: StreamOpenTarget;
  /** Normalized key for dedupe against run artifacts (null = never dedupe). */
  entityKey: string | null;
}

/**
 * Map a completed entity-touching tool invocation to an action card.
 * Returns null for non-entity tools (search/read/list/navigation/…), which
 * render as generic tool-call entries instead.
 */
export function describeToolArtifact(invocation: ToolInvocation): ToolArtifactDescriptor | null {
  if (invocation.status !== 'completed') return null;
  const data = resultData(invocation);
  const args = invocation.args ?? {};

  switch (invocation.toolId as string) {
    case 'note:create': {
      const path = str(data.noteId) ?? str(args.title);
      const title = str(data.title) ?? str(args.title) ?? 'Untitled note';
      return {
        action: 'created',
        entity: 'note',
        title,
        target: path ? { kind: 'note', path } : { kind: 'none' },
        entityKey: path ? `note:${normalize(path)}` : null,
      };
    }
    case 'note:create-folder': {
      const folder = str(data.folder) ?? str(args.folder) ?? 'Folder';
      return {
        action: 'created',
        entity: 'folder',
        title: folder,
        target: { kind: 'folder', path: folder },
        entityKey: `folder:${normalize(folder)}`,
      };
    }
    case 'note:update':
    case 'editor:apply-note-patch':
    case 'editor:insert-blocks':
    case 'editor:replace-block':
    case 'editor:convert-block':
    case 'editor:delete-block': {
      const path = str(data.noteId) ?? str(args.noteId);
      const title = str(args.title) ?? noteName(path) ?? 'Note';
      return {
        action: 'updated',
        entity: 'note',
        title,
        target: path ? { kind: 'note', path } : { kind: 'none' },
        entityKey: path ? `note:${normalize(path)}` : null,
      };
    }
    case 'note:move': {
      const path = str(data.newPath) ?? str(args.noteId);
      return {
        action: 'moved',
        entity: 'note',
        title: noteName(path) ?? 'Note',
        target: path ? { kind: 'note', path } : { kind: 'none' },
        entityKey: path ? `note:${normalize(path)}` : null,
      };
    }
    case 'note:tag': {
      const path = str(data.noteId) ?? str(args.noteId);
      return {
        action: 'tagged',
        entity: 'note',
        title: noteName(path) ?? 'Note',
        target: path ? { kind: 'note', path } : { kind: 'none' },
        entityKey: path ? `note:${normalize(path)}` : null,
      };
    }
    case 'note:delete': {
      const path = str(args.noteId);
      return {
        action: 'deleted',
        entity: 'note',
        title: noteName(path) ?? 'Note',
        target: { kind: 'none' },
        entityKey: null,
      };
    }
    case 'todo:create': {
      const todoId = str(data.todoId);
      const title = str(data.title) ?? str(args.title) ?? 'Todo';
      return {
        action: 'created',
        entity: 'todo',
        title,
        target: { kind: 'todo', ...(todoId ? { todoId } : {}) },
        entityKey: null,
      };
    }
    case 'todo:toggle': {
      const todoId = str(args.todoId);
      const checked = bool(data.checked) ?? bool(data.completed);
      return {
        action: checked === false ? 'reopened' : 'completed',
        entity: 'todo',
        title: str(data.title) ?? str(data.content) ?? 'Todo',
        target: { kind: 'todo', ...(todoId ? { todoId } : {}) },
        entityKey: null,
      };
    }
    case 'todo:update': {
      const todoId = str(args.todoId);
      return {
        action: 'updated',
        entity: 'todo',
        title: str(args.content) ?? str(data.title) ?? 'Todo',
        target: { kind: 'todo', ...(todoId ? { todoId } : {}) },
        entityKey: null,
      };
    }
    case 'todo:delete': {
      return { action: 'deleted', entity: 'todo', title: 'Todo', target: { kind: 'none' }, entityKey: null };
    }
    default:
      return null;
  }
}

// ── artifact helpers ────────────────────────────────────────────────────────

function artifactEntity(type: AgentArtifact['type']): StreamArtifactEntity {
  if (type === 'note' || type === 'diff' || type === 'summary') return 'note';
  if (type === 'folder') return 'folder';
  if (type === 'source') return 'source';
  if (type === 'media') return 'media';
  return 'note';
}

function artifactAction(artifact: AgentArtifact, event: AgentRunEvent | undefined): StreamArtifactAction {
  if (event?.type === 'note.updated') return 'updated';
  if (artifact.type === 'source') return 'found';
  if (artifact.type === 'media') return 'found';
  return 'created';
}

function artifactTarget(artifact: AgentArtifact): StreamOpenTarget {
  if (artifact.type === 'note' || artifact.type === 'diff' || artifact.type === 'summary') {
    const path = artifact.path ?? artifact.noteId;
    return path ? { kind: 'note', path } : { kind: 'none' };
  }
  if (artifact.type === 'folder') {
    return artifact.path ? { kind: 'folder', path: artifact.path } : { kind: 'none' };
  }
  if (artifact.url) return { kind: 'external', url: artifact.url };
  if (artifact.path) return { kind: 'note', path: artifact.path };
  return { kind: 'none' };
}

function artifactEntityKey(artifact: AgentArtifact): string | null {
  switch (artifact.type) {
    case 'note':
    case 'diff':
    case 'summary': {
      const path = artifact.path ?? artifact.noteId;
      return path ? `note:${normalize(path)}` : null;
    }
    case 'folder':
      return artifact.path ? `folder:${normalize(artifact.path)}` : null;
    case 'source':
      return artifact.url ? `source:${artifact.url}` : null;
    case 'media':
      return artifact.url ? `media:${artifact.url}` : artifact.path ? `media:${normalize(artifact.path)}` : null;
    default:
      return null;
  }
}

// ── primitives ───────────────────────────────────────────────────────────────

function resultData(invocation: ToolInvocation): Record<string, unknown> {
  const result = invocation.result;
  if (result && (result.status === 'success' || result.status === 'partial')) {
    const data = result.data;
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function noteName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '') || undefined;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim().toLowerCase();
}

function toMs(value: string | Date | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Test-only: clear the per-run memoization cache. */
export function __resetConversationStreamCache(): void {
  runEntryCache.clear();
}
