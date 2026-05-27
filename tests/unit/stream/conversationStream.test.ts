import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildConversationStream,
  describeToolArtifact,
  __resetConversationStreamCache,
} from '$lib/application/stream/conversationStream';
import { createUserMessage, createAssistantMessage } from '$lib/domain/entities/Message';
import type { Message } from '$lib/domain/entities/Message';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolId } from '$lib/domain/values/ToolId';
import { createAgentRun } from '$lib/domain/entities/AgentRun';
import type { AgentArtifact, AgentRun, AgentRunEvent } from '$lib/domain/entities/AgentRun';
import type { ArtifactChangedEntry, StreamEntry } from '$lib/domain/values/StreamEntry';

function at(message: Message, isoOffsetMs: number): Message {
  const date = new Date(1_700_000_000_000 + isoOffsetMs);
  return { ...message, createdAt: date, updatedAt: date };
}

function completedInvocation(
  toolId: string,
  args: Record<string, unknown>,
  data: Record<string, unknown>,
  offsetMs: number
): ToolInvocation {
  const started = new Date(1_700_000_000_000 + offsetMs);
  return {
    id: `inv_${toolId}_${offsetMs}`,
    toolId: toolId as ToolId,
    args,
    status: 'completed',
    createdAt: started,
    startedAt: started,
    completedAt: started,
    result: {
      status: 'success',
      toolId: toolId as ToolId,
      data,
      startedAt: started,
      completedAt: started,
      durationMs: 1,
    },
    progress: 100,
    message: 'Completed',
    confirmed: true,
    messageId: null,
  };
}

function noteArtifact(path: string, title: string, offsetMs: number): AgentArtifact {
  return {
    id: `art_${path}`,
    type: 'note',
    title,
    path,
    createdAt: new Date(1_700_000_000_000 + offsetMs).toISOString(),
  };
}

function runWith(partial: Partial<AgentRun>): AgentRun {
  const base = createAgentRun({ prompt: 'do research', conversationId: 'conv_1' });
  return { ...base, ...partial };
}

beforeEach(() => __resetConversationStreamCache());

describe('buildConversationStream', () => {
  it('renders user and assistant text chronologically', () => {
    const user = at(createUserMessage('research moose'), 0);
    const assistant = at(createAssistantMessage({ text: 'On it.' }), 1000);

    const stream = buildConversationStream({
      messages: [user, assistant],
      runs: [],
      pendingTurns: [],
    });

    expect(stream.map((e) => e.kind)).toEqual(['user-text', 'assistant-text']);
    expect(stream.every((e) => e.milestone)).toBe(true);
  });

  it('always keeps user messages as milestones', () => {
    const user = at(createUserMessage('continue'), 0);
    const [entry] = buildConversationStream({ messages: [user], runs: [], pendingTurns: [] });
    expect(entry?.kind).toBe('user-text');
    expect(entry?.milestone).toBe(true);
  });

  it('maps a note:create invocation to a created-note action card', () => {
    const assistant: Message = {
      ...at(createAssistantMessage({ text: 'Created it.' }), 0),
      toolInvocations: [
        completedInvocation('note:create', { title: 'Moose' }, { noteId: 'Research/moose.md', title: 'Moose' }, 500),
      ],
    };

    const stream = buildConversationStream({ messages: [assistant], runs: [], pendingTurns: [] });
    const card = stream.find((e): e is ArtifactChangedEntry => e.kind === 'artifact-changed');
    expect(card).toBeDefined();
    expect(card?.action).toBe('created');
    expect(card?.entity).toBe('note');
    expect(card?.target).toEqual({ kind: 'note', path: 'Research/moose.md' });
  });

  it('dedupes a note tool-call echo against the run artifact (run wins)', () => {
    const assistant: Message = {
      ...at(createAssistantMessage({ text: 'Done.' }), 0),
      toolInvocations: [
        completedInvocation('note:create', { title: 'Moose' }, { noteId: 'Research/Moose.md', title: 'Moose' }, 500),
      ],
    };
    const run = runWith({
      status: 'completed',
      artifacts: [noteArtifact('Research/moose.md', 'Moose', 600)],
      events: [],
    });

    const stream = buildConversationStream({ messages: [assistant], runs: [run], pendingTurns: [] });
    const cards = stream.filter((e): e is ArtifactChangedEntry => e.kind === 'artifact-changed');
    expect(cards).toHaveLength(1);
    // The surviving card is the run artifact.
    expect(cards[0]?.id.startsWith('art:')).toBe(true);
  });

  it('shows create-then-update as two cards', () => {
    const created: AgentRunEvent = {
      id: 'e1', runId: 'r', type: 'note.created', createdAt: new Date(1_700_000_000_700).toISOString(),
      sequence: 1, artifactId: 'art_a',
    };
    const updated: AgentRunEvent = {
      id: 'e2', runId: 'r', type: 'note.updated', createdAt: new Date(1_700_000_000_800).toISOString(),
      sequence: 2, artifactId: 'art_b',
    };
    const run = runWith({
      status: 'completed',
      artifacts: [
        { id: 'art_a', type: 'note', title: 'X', path: 'A/x.md', createdAt: new Date(1_700_000_000_700).toISOString() },
        { id: 'art_b', type: 'note', title: 'X', path: 'A/x.md', createdAt: new Date(1_700_000_000_800).toISOString() },
      ],
      events: [created, updated],
    });

    const stream = buildConversationStream({ messages: [], runs: [run], pendingTurns: [] });
    const actions = stream
      .filter((e): e is ArtifactChangedEntry => e.kind === 'artifact-changed')
      .map((e) => e.action);
    expect(actions).toContain('created');
    expect(actions).toContain('updated');
  });

  it('always renders todo cards from tool invocations', () => {
    const assistant: Message = {
      ...at(createAssistantMessage({ text: 'Added.' }), 0),
      toolInvocations: [
        completedInvocation('todo:create', { title: 'DPIA' }, { todoId: 't1', title: 'DPIA' }, 100),
      ],
    };
    const stream = buildConversationStream({ messages: [assistant], runs: [], pendingTurns: [] });
    const card = stream.find((e): e is ArtifactChangedEntry => e.kind === 'artifact-changed');
    expect(card?.entity).toBe('todo');
    expect(card?.target).toEqual({ kind: 'todo', todoId: 't1' });
  });

  it('orders a swarm run: started, spawn, worker message, artifact, completed', () => {
    const run = runWith({
      status: 'completed',
      createdAt: new Date(1_700_000_000_000).toISOString(),
      orchestrationMode: 'swarm',
      workers: [
        { id: 'w1', runId: 'r', spec: { id: 'w1', title: 'Sources', role: 'researcher', objective: 'o', input: '', deliverables: [], dependencies: [], allowedTools: [] }, status: 'completed', progress: 100, createdAt: new Date(1_700_000_000_100).toISOString(), updatedAt: new Date(1_700_000_000_100).toISOString() },
      ],
      workerMessages: [
        { id: 'm1', runId: 'r', workerId: 'w1', type: 'worker.result', createdAt: new Date(1_700_000_000_300).toISOString(), message: 'found 3 sources' },
      ],
      artifacts: [noteArtifact('Research/moose.md', 'Moose', 400)],
      finalSummary: 'Done',
      completedAt: new Date(1_700_000_000_500).toISOString(),
    });

    const kinds = buildConversationStream({ messages: [], runs: [run], pendingTurns: [] }).map((e) => e.kind);
    expect(kinds).toEqual([
      'run-started',
      'worker-spawn',
      'worker-message',
      'artifact-changed',
      'run-completed',
    ]);
  });

  it('marks low-signal worker messages as non-milestones', () => {
    const run = runWith({
      status: 'executing',
      workerMessages: [
        { id: 'p1', runId: 'r', workerId: 'w1', type: 'worker.progress', createdAt: new Date(1_700_000_000_100).toISOString(), message: 'searching' },
        { id: 'r1', runId: 'r', workerId: 'w1', type: 'worker.result', createdAt: new Date(1_700_000_000_200).toISOString(), message: 'done' },
      ],
    });
    const stream = buildConversationStream({ messages: [], runs: [run], pendingTurns: [] });
    const progress = stream.find((e) => e.kind === 'worker-message' && e.id === 'wmsg:p1');
    const result = stream.find((e) => e.kind === 'worker-message' && e.id === 'wmsg:r1');
    expect(progress?.milestone).toBe(false);
    expect(result?.milestone).toBe(true);
  });

  it('places pending turns chronologically', () => {
    const user = at(createUserMessage('first'), 0);
    const stream: StreamEntry[] = buildConversationStream({
      messages: [user],
      runs: [],
      pendingTurns: [{ id: 'p', text: 'second', createdAt: new Date(1_700_000_001_000), status: 'routing' }],
    });
    expect(stream.map((e) => e.kind)).toEqual(['user-text', 'pending-turn']);
  });
});

describe('describeToolArtifact', () => {
  it('returns null for non-entity tools', () => {
    const inv = completedInvocation('search:notes', { query: 'x' }, { results: [] }, 0);
    expect(describeToolArtifact(inv)).toBeNull();
  });

  it('returns null for non-completed invocations', () => {
    const inv = { ...completedInvocation('note:create', {}, {}, 0), status: 'executing' as const };
    expect(describeToolArtifact(inv)).toBeNull();
  });

  it('labels todo:toggle completed vs reopened from result data', () => {
    const done = completedInvocation('todo:toggle', { todoId: 't1' }, { checked: true }, 0);
    const reopened = completedInvocation('todo:toggle', { todoId: 't1' }, { checked: false }, 0);
    expect(describeToolArtifact(done)?.action).toBe('completed');
    expect(describeToolArtifact(reopened)?.action).toBe('reopened');
  });
});
