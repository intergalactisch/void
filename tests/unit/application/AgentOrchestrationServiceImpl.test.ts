import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { AgentOrchestrationServiceImpl } from '$lib/application/services/AgentOrchestrationServiceImpl';
import { MemoryAgentRunStorageAdapter } from '$lib/adapters/memory/MemoryAgentRunStorageAdapter';
import { MemoryResearchSourceAdapter } from '$lib/adapters/memory/MemoryResearchSourceAdapter';
import { toolSuccess } from '$lib/domain/values/ToolResult';
import { createConversation } from '$lib/domain/entities/Conversation';
import type { AgentLoopService, AgentOptions, NotesService, DocumentService, ProvenanceService, IndexService, AIAssistantService } from '$lib/ports/inbound';
import { createAgentRun, type ResearchCitation } from '$lib/domain/entities/AgentRun';
import type { ApplicationNavigationPort } from '$lib/ports/outbound/ApplicationNavigationPort';
import type { ResearchSourcePort } from '$lib/ports/outbound/ResearchSourcePort';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';

const NOTE_ITEMS = [
  {
    path: 'AI/old-ai-topics.md',
    title: 'Old AI Topics',
    isFolder: false,
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
    tags: ['ai'],
  },
];

function createInvocation(): ToolInvocation {
  const startedAt = new Date();
  return {
    id: 'inv-create-overview',
    toolId: 'note:create' as ToolId,
    args: { title: 'AI Topics Overview' },
    status: 'completed',
    createdAt: startedAt,
    startedAt,
    completedAt: new Date(),
    result: toolSuccess(
      'note:create' as ToolId,
      { noteId: 'Research/AI Topics/overview.md', title: 'AI Topics Overview' },
      startedAt
    ),
    progress: 100,
    message: 'Completed',
    confirmed: true,
    messageId: null,
  };
}

function createServiceFixture(options: {
  citations?: ResearchCitation[];
  research?: ResearchSourcePort;
  noteItems?: typeof NOTE_ITEMS;
  documentContent?: string;
  finalResponse?: string;
  aiAssistant?: AIAssistantService;
} = {}) {
  const storage = new MemoryAgentRunStorageAdapter();
  const research = options.research ?? new MemoryResearchSourceAdapter(options.citations ?? [
    {
      title: 'AI source',
      url: 'https://example.com/ai-source',
      excerpt: 'Current AI research source',
      fetchedAt: '2026-05-04T00:00:00.000Z',
      sourceType: 'web',
    },
  ]);
  const agentLoop: AgentLoopService = {
    run: vi.fn(async (_prompt: string, runOptions?: AgentOptions) => {
      const invocation = createInvocation();
      await runOptions?.onToolCompleted?.(invocation);
      return {
        turns: 1,
        finalResponse: options.finalResponse ?? 'Created an overview note.',
        toolInvocations: [invocation],
        conversationId: options.aiAssistant ? 'conv-visible' : 'conv-1',
        cancelled: false,
      };
    }),
    cancel: vi.fn(),
    getState: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as AgentLoopService;
  const notes: NotesService = {
    getState: () => ({
      items: options.noteItems ?? NOTE_ITEMS,
      tagGroups: [],
      selectedPath: null,
      isLoading: false,
      searchQuery: '',
      expandedFolders: new Set(),
    }),
    refresh: vi.fn().mockResolvedValue(ok(options.noteItems ?? NOTE_ITEMS)),
  } as unknown as NotesService;
  const documents: DocumentService = {
    readContent: vi.fn().mockResolvedValue(ok(options.documentContent ?? 'This note mentions current AI topics and agents.')),
  } as unknown as DocumentService;
  const records: unknown[] = [];
  const provenance: ProvenanceService = {
    record: vi.fn(async (_noteName, event) => {
      records.push(event);
      return ok(undefined);
    }),
  } as unknown as ProvenanceService;
  const index: IndexService = {
    indexAll: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as IndexService;
  const opened: string[] = [];
  const navigation: ApplicationNavigationPort = {
    openNote: vi.fn(async (path) => {
      opened.push(path);
      return ok(undefined);
    }),
  } as unknown as ApplicationNavigationPort;

  const service = new AgentOrchestrationServiceImpl(
    agentLoop,
    storage,
    null,
    research,
    notes,
    documents,
    navigation,
    provenance,
    index,
    options.aiAssistant
  );

  return { service, storage, research, agentLoop, notes, documents, records, provenance, index, opened, navigation };
}

function fakeAIAssistant() {
  const conversation = createConversation({ title: 'Research chat' });
  conversation.id = 'conv-visible';
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  const liveUpdates: Array<{
    message: string;
    activity: { id?: string; status: string; label: string; detail?: string };
    conversationId?: string;
    groupId?: string;
  }> = [];
  const service = {
    appendUserMessage: vi.fn(async (message: string) => {
      userMessages.push(message);
      return ok(conversation);
    }),
    appendAssistantMessage: vi.fn(async (message: string) => {
      assistantMessages.push(message);
      return ok(conversation);
    }),
    appendOrUpdateAssistantActivity: vi.fn(async (message, activity, conversationId, groupId) => {
      liveUpdates.push({ message, activity, conversationId, groupId });
      return ok(conversation);
    }),
  } as unknown as AIAssistantService;
  return { service, userMessages, assistantMessages, liveUpdates };
}

describe('AgentOrchestrationServiceImpl', () => {
  it('plans, waits for approval, executes, records provenance, and opens the overview note', async () => {
    const aiAssistant = fakeAIAssistant();
    const { service, agentLoop, records, opened } = createServiceFixture({
      aiAssistant: aiAssistant.service,
    });

    const planned = await service.startRun('Research current interesting AI topics', {
      requireApproval: true,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.status).toBe('waiting_approval');
    expect(planned.value.conversationId).toBe('conv-visible');
    expect(planned.value.plan?.existingNotes[0]?.path).toBe('AI/old-ai-topics.md');
    expect(planned.value.plan?.citations[0]?.url).toBe('https://example.com/ai-source');
    expect(planned.value.webAccess).toBe('native');
    expect(planned.value.artifacts.some((artifact) => artifact.type === 'source' && artifact.url === 'https://example.com/ai-source')).toBe(true);
    expect(planned.value.plan?.suggestedNotes).toHaveLength(3);
    expect(planned.value.events.some((event) => event.type === 'run.started')).toBe(true);
    expect(aiAssistant.userMessages).toEqual(['Research current interesting AI topics']);
    expect(aiAssistant.assistantMessages.some((message) => message.includes('paused before writing files'))).toBe(true);

    const approved = await service.approveRun(planned.value.id);
    expect(approved.ok).toBe(true);

    const completed = await service.getRun(planned.value.id);
    expect(completed.ok).toBe(true);
    if (!completed.ok || !completed.value) return;

    expect(completed.value.status).toBe('completed');
    expect(completed.value.conversationId).toBe('conv-visible');
    expect(completed.value.artifacts.some((artifact) => artifact.path === 'Research/AI Topics/overview.md')).toBe(true);
    expect(completed.value.events.some((event) => event.type === 'note.created')).toBe(true);
    expect(completed.value.events.some((event) => event.type === 'narration' && event.message === 'note:create completed')).toBe(true);
    expect(records.length).toBe(1);
    expect(String(records[0]?.result)).toContain('Created an overview note.');
    expect(String(records[0]?.result)).toContain(`Run ID: ${planned.value.id}`);
    expect(String(records[0]?.result)).toContain('Verified sources: 1');
    expect(opened).toEqual(['Research/AI Topics/overview.md']);
    expect(aiAssistant.assistantMessages.length).toBeGreaterThan(3);
    expect(aiAssistant.assistantMessages.some((message) => message.includes('writing the findings into notes'))).toBe(true);
    expect(aiAssistant.assistantMessages.at(-1)).toBe('Created an overview note.');
    expect(aiAssistant.liveUpdates).toEqual([]);
    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.stringContaining('Use your own reasoning to choose the best note clusters'),
      expect.objectContaining({
        conversationId: 'conv-visible',
        displayMessage: null,
        hideInternalMessages: true,
        webAccess: 'native',
      })
    );

    const approvedAgain = await service.approveRun(planned.value.id);
    expect(approvedAgain.ok).toBe(false);
    expect(agentLoop.run).toHaveBeenCalledTimes(1);
  });

  it('can attach a retry run to an existing user message without duplicating it', async () => {
    const aiAssistant = fakeAIAssistant();
    const { service } = createServiceFixture({
      aiAssistant: aiAssistant.service,
    });

    const planned = await service.startRun('Doe full research on Ai coding agents', {
      conversationId: 'conv-visible',
      sourceMessageId: 'msg-source',
      appendUserMessage: false,
      requireApproval: true,
      orchestrationMode: 'swarm',
      maxWorkers: 4,
      webAccess: 'native',
    });

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(aiAssistant.userMessages).toEqual([]);
    expect(planned.value.conversationId).toBe('conv-visible');
    expect(planned.value.sourceMessageId).toBe('msg-source');
  });

  it('allows multiple runs to stay active while they wait for approval', async () => {
    const { service } = createServiceFixture();

    const first = await service.startRun('Research current interesting AI topics', {
      requireApproval: true,
    });
    expect(first.ok).toBe(true);

    const second = await service.startRun('Research another topic', {
      requireApproval: true,
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.status).toBe('waiting_approval');
    expect(second.value.status).toBe('waiting_approval');
    expect(service.getState().runs.map((run) => run.id)).toEqual([second.value.id, first.value.id]);
    expect(service.getState().isRunning).toBe(true);
    expect(service.getState().currentRun?.id).toBe(second.value.id);
  });

  it('can approve multiple legacy single-agent runs concurrently', async () => {
    const { service, agentLoop } = createServiceFixture();

    const first = await service.startRun('Research current interesting AI topics', {
      requireApproval: true,
      orchestrationMode: 'single',
    });
    const second = await service.startRun('Research another topic', {
      requireApproval: true,
      orchestrationMode: 'single',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const order: string[] = [];
    vi.mocked(agentLoop.run).mockImplementation(async (prompt: string, runOptions?: AgentOptions) => {
      const runLabel = prompt.includes('another topic') ? 'second' : 'first';
      order.push(`start:${runLabel}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const invocation = createInvocation();
      await runOptions?.onToolCompleted?.(invocation);
      order.push(`end:${runLabel}`);
      return {
        turns: 1,
        finalResponse: `Completed ${runLabel}`,
        toolInvocations: [invocation],
        conversationId: `conv-${runLabel}`,
        cancelled: false,
      };
    });

    const results = await Promise.all([
      service.approveRun(first.value.id),
      service.approveRun(second.value.id),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(order.slice(0, 2)).toEqual(['start:first', 'start:second']);
    expect(agentLoop.run).toHaveBeenCalledTimes(2);

    const completedFirst = await service.getRun(first.value.id);
    const completedSecond = await service.getRun(second.value.id);
    expect(completedFirst.ok && completedFirst.value?.status).toBe('completed');
    expect(completedSecond.ok && completedSecond.value?.status).toBe('completed');
  });

  it('keeps other active runs visible when one run completes', async () => {
    const { service } = createServiceFixture();

    const waiting = await service.startRun('Research current interesting AI topics', {
      requireApproval: true,
    });
    expect(waiting.ok).toBe(true);

    const completed = await service.startRun('Research another topic', {
      requireApproval: false,
    });
    expect(completed.ok).toBe(true);
    if (!waiting.ok || !completed.ok) return;

    expect(completed.value.status).toBe('completed');
    expect(service.getState().runs).toHaveLength(2);
    expect(service.getState().isRunning).toBe(true);
    expect(service.getState().currentRun?.id).toBe(waiting.value.id);
  });

  it('can execute immediately when approval is explicitly not required', async () => {
    const { service, agentLoop } = createServiceFixture();

    const run = await service.startRun('Research current interesting AI topics', {
      requireApproval: false,
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.status).toBe('completed');
    expect(run.value.approval.status).toBe('not_required');
    expect(agentLoop.run).toHaveBeenCalledTimes(1);
  });

  it('does not match unrelated notes through generic prompt words', async () => {
    const noteItems = [
      {
        path: 'Weather/weer-in-alkmaar-op-zondag-10-mei-2026.md',
        title: 'Weer in Alkmaar op zondag 10 mei 2026',
        isFolder: false,
        modifiedAt: new Date('2026-05-01T00:00:00Z'),
        tags: ['weather'],
      },
    ];
    const { service } = createServiceFixture({
      noteItems,
      documentContent: 'The best weather note for Alkmaar with no company research.',
    });

    const planned = await service.startRun('Do research on Anthropic and create the best notes', {
      requireApproval: true,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.plan?.existingNotes).toEqual([]);
  });

  it('forbids invented web citations when no verified sources are available', async () => {
    const research: ResearchSourcePort = {
      search: vi.fn(async () => ok([])),
    };
    const { service, agentLoop } = createServiceFixture({ research });

    const planned = await service.startRun('Do research on Anthropic and create the best notes', {
      requireApproval: true,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.plan?.summary).toContain('no verified web citations');
    const approved = await service.approveRun(planned.value.id);
    expect(approved.ok).toBe(true);

    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.stringContaining('Do not invent current facts, URLs, dates, citations, or source titles.'),
      expect.any(Object)
    );
  });

  it('reports agent loop failures instead of completing the run', async () => {
    const { service, agentLoop } = createServiceFixture();
    vi.mocked(agentLoop.run).mockResolvedValueOnce({
      turns: 0,
      finalResponse: '',
      toolInvocations: [],
      conversationId: 'conv-1',
      cancelled: false,
      error: new Error('provider failed'),
    });

    const planned = await service.startRun('Research current interesting AI topics', {
      requireApproval: true,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const approved = await service.approveRun(planned.value.id);
    expect(approved.ok).toBe(false);

    const failed = await service.getRun(planned.value.id);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value?.status).toBe('failed');
    expect(failed.value?.error).toBe('provider failed');
  });

  it('restores persisted active runs as running when listing after restart', async () => {
    const { service, storage } = createServiceFixture();
    const run = createAgentRun({
      id: 'run-waiting',
      prompt: 'Research Anthropic',
      approvalRequired: true,
    });
    run.status = 'waiting_approval';
    await storage.save(run);

    const listed = await service.listRuns();

    expect(listed.ok).toBe(true);
    expect(service.getState().currentRun?.id).toBe('run-waiting');
    expect(service.getState().isRunning).toBe(true);
  });

  it('resolves a new research folder when the conversation has no prior research', async () => {
    const { service } = createServiceFixture();

    const target = await service.resolveResearchTarget('Do research on OpenAI', {
      conversationId: 'conv-empty',
    });

    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.value.action).toBe('use');
    if (target.value.action !== 'use') return;
    expect(target.value.target.mode).toBe('new');
    expect(target.value.target.folder).toMatch(/^Research\/openai /);
  });

  it('reuses the previous deep research folder for a same-conversation follow-up', async () => {
    const { service, storage } = createServiceFixture();
    const prior = createAgentRun({
      id: 'run-openai',
      prompt: 'Do research on OpenAI',
      conversationId: 'conv-research',
      approvalRequired: false,
      orchestrationMode: 'swarm',
    });
    prior.deepResearch = {
      topic: 'OpenAI',
      topicSlug: 'openai',
      folder: 'Research/openai 2026-05-26',
      phase: 'sources',
      aspects: [],
      evidence: [],
      startedAt: '2026-05-26T10:00:00.000Z',
    };
    await storage.save(prior);

    const target = await service.resolveResearchTarget('Add more about model releases', {
      conversationId: 'conv-research',
    });

    expect(target.ok).toBe(true);
    if (!target.ok || target.value.action !== 'use') return;
    expect(target.value.target).toEqual({
      folder: 'Research/openai 2026-05-26',
      mode: 'reuse',
      previousRunId: 'run-openai',
    });
  });

  it('finds prior research folders from plan and note artifacts', async () => {
    const { service, storage } = createServiceFixture();
    const planned = createAgentRun({
      id: 'run-planned',
      prompt: 'Do research on OpenAI',
      conversationId: 'conv-plan',
      approvalRequired: false,
    });
    planned.plan = {
      summary: 'Research OpenAI',
      steps: [],
      suggestedFolder: 'Research/openai-from-plan',
      suggestedNotes: [],
      existingNotes: [],
      citations: [],
    };
    await storage.save(planned);

    const fromPlan = await service.resolveResearchTarget('More details about leadership', {
      conversationId: 'conv-plan',
    });
    expect(fromPlan.ok && fromPlan.value.action === 'use' && fromPlan.value.target.folder).toBe('Research/openai-from-plan');

    const artifactRun = createAgentRun({
      id: 'run-artifact',
      prompt: 'Do research on Anthropic',
      conversationId: 'conv-artifact',
      approvalRequired: false,
    });
    artifactRun.artifacts.push({
      id: 'artifact-note',
      type: 'note',
      title: 'Anthropic Overview',
      path: 'Research/anthropic-existing/Overview.md',
      createdAt: '2026-05-26T10:00:00.000Z',
    });
    await storage.save(artifactRun);

    const fromArtifact = await service.resolveResearchTarget('Also add funding history', {
      conversationId: 'conv-artifact',
    });
    expect(fromArtifact.ok && fromArtifact.value.action === 'use' && fromArtifact.value.target.folder).toBe('Research/anthropic-existing');
  });

  it('asks for confirmation when a same-conversation research prompt is clearly a different topic', async () => {
    const { service, storage } = createServiceFixture();
    const prior = createAgentRun({
      id: 'run-openai',
      prompt: 'Do research on OpenAI',
      conversationId: 'conv-research',
      approvalRequired: false,
    });
    prior.plan = {
      summary: 'Research OpenAI',
      steps: [],
      suggestedFolder: 'Research/openai 2026-05-26',
      suggestedNotes: [],
      existingNotes: [],
      citations: [],
    };
    await storage.save(prior);

    const target = await service.resolveResearchTarget('Do research on Anthropic', {
      conversationId: 'conv-research',
    });

    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.value).toEqual(expect.objectContaining({
      action: 'needs_confirmation',
      previousFolder: 'Research/openai 2026-05-26',
      previousRunId: 'run-openai',
    }));
  });

  it('asks for confirmation for another research prompt with a different explicit topic', async () => {
    const { service, storage } = createServiceFixture();
    const prior = createAgentRun({
      id: 'run-openai',
      prompt: 'Do research on OpenAI',
      conversationId: 'conv-another-topic',
      approvalRequired: false,
    });
    prior.deepResearch = {
      topic: 'OpenAI',
      topicSlug: 'openai',
      folder: 'Research/openai 2026-05-26',
      phase: 'sources',
      aspects: [],
      evidence: [],
      startedAt: '2026-05-26T10:00:00.000Z',
    };
    await storage.save(prior);

    const target = await service.resolveResearchTarget('Do another research on Anthropic', {
      conversationId: 'conv-another-topic',
    });

    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.value).toEqual(expect.objectContaining({
      action: 'needs_confirmation',
      previousFolder: 'Research/openai 2026-05-26',
      previousRunId: 'run-openai',
    }));
  });
});
