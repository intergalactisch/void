import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '$lib/core';
import {
  AgentMergeService,
  AgentOrchestrationServiceImpl,
  AgentSwarmPlanner,
  AgentWorkerBus,
  AgentWorkerRunner,
  AgentWorkerScheduler,
  ScopedWorkerToolExecutor,
} from '$lib/application/services';
import { MemoryAgentRunStorageAdapter } from '$lib/adapters/memory/MemoryAgentRunStorageAdapter';
import { MemoryResearchSourceAdapter } from '$lib/adapters/memory/MemoryResearchSourceAdapter';
import { createConversation } from '$lib/domain/entities/Conversation';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import { toolSuccess } from '$lib/domain/values/ToolResult';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type {
  AgentLoopService,
  AgentOptions,
  AIAssistantService,
  DocumentService,
  IndexService,
  NoteCollaborationService,
  NotesService,
  ProvenanceService,
  ToolRegistryService,
} from '$lib/ports/inbound';
import type {
  AIAssistantProviderPort,
  ApplicationNavigationPort,
  ContextProviderPort,
  ResearchSourcePort,
  ToolExecutorPort,
} from '$lib/ports/outbound';

function response(chat: string): AIResponse {
  return {
    chat,
    toolCalls: [],
    meta: {
      provider: 'test',
      model: 'test-model',
      latencyMs: 1,
    },
    truncated: false,
    stopReason: 'end_turn',
  };
}

function createInvocation(): ToolInvocation {
  const startedAt = new Date();
  return {
    id: 'inv-create-swarm',
    toolId: 'note:create' as ToolId,
    args: { title: 'AI Assistants Overview' },
    status: 'completed',
    createdAt: startedAt,
    startedAt,
    completedAt: new Date(),
    result: toolSuccess(
      'note:create' as ToolId,
      { noteId: 'Research/ai-assistants/overview.md', title: 'AI Assistants Overview' },
      startedAt
    ),
    progress: 100,
    message: 'Completed',
    confirmed: true,
    messageId: null,
  };
}

function fakeProvider(): AIAssistantProviderPort {
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: vi.fn(async (request) => {
      if (request.message.includes('Decompose this Void command-center request')) {
        return ok(response(JSON.stringify({
          summary: 'Swarm plan',
          rationale: 'Parallel workers can split context and drafting.',
          mergeCriteria: ['Preserve caveats'],
          workers: [
            {
              title: 'Context worker',
              role: 'researcher',
              objective: 'Find relevant context',
              input: 'AI assistants',
              deliverables: ['Context'],
              dependencies: [],
              allowedTools: ['note:read'],
            },
            {
              title: 'Draft worker',
              role: 'drafter',
              objective: 'Draft useful note material',
              input: 'AI assistants',
              deliverables: ['Draft'],
              dependencies: [],
              allowedTools: ['note:read'],
            },
          ],
        })));
      }
      if (request.message.includes('Context worker')) {
        return ok(response(JSON.stringify({
          summary: 'Context found',
          findings: ['Existing notes mention orchestration and receipts.'],
          artifactDrafts: [
            { type: 'summary', title: 'Context Summary', summary: 'Context draft', confidence: 0.8 },
            {
              type: 'media',
              title: 'AI assistant demo video',
              url: 'https://www.youtube.com/watch?v=agent-demo',
              mediaKind: 'youtube',
              summary: 'Useful demo video for the brief.',
              confidence: 0.76,
            },
          ],
          risks: [],
          nextActions: [],
          confidence: 0.8,
        })));
      }
      return ok(response(JSON.stringify({
        summary: 'Draft ready',
        findings: ['The final note should explain the orchestrator and worker boundaries.'],
        artifactDrafts: [{ type: 'note', title: 'AI Assistants Overview', content: '# AI Assistants\n\nDraft body', confidence: 0.82 }],
        risks: ['Citations still need review.'],
        nextActions: ['Review sources'],
        confidence: 0.82,
      })));
    }),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

function genericCompletionProvider(): AIAssistantProviderPort {
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: vi.fn(async (request) => {
      if (request.message.includes('Decompose this Void command-center request')) {
        return ok(response(JSON.stringify({
          summary: 'Swarm plan',
          rationale: 'Parallel workers can split context and drafting.',
          mergeCriteria: ['Create one clear overview note'],
          workers: [
            {
              title: 'Find relevant notes and context',
              role: 'researcher',
              objective: 'Find relevant context',
              input: 'Bonsai trees',
              deliverables: ['Context'],
              dependencies: [],
              allowedTools: ['note:read'],
            },
            {
              title: 'Draft artifact material',
              role: 'drafter',
              objective: 'Draft useful note material',
              input: 'Bonsai trees',
              deliverables: ['Draft'],
              dependencies: [],
              allowedTools: ['note:read'],
            },
          ],
        })));
      }
      if (request.message.includes('Find relevant notes and context')) {
        return ok(response('Completed Find relevant notes and context.'));
      }
      return ok(response('Completed Draft artifact material.'));
    }),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

function diffDraftProvider(): AIAssistantProviderPort {
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: vi.fn(async (request) => {
      if (request.message.includes('Decompose this Void command-center request')) {
        return ok(response(JSON.stringify({
          summary: 'Swarm plan',
          rationale: 'One worker can prepare an existing-note patch while the orchestrator owns writes.',
          mergeCriteria: ['Append without overwriting existing content'],
          workers: [
            {
              title: 'Patch existing note',
              role: 'drafter',
              objective: 'Prepare a safe append for an existing project note',
              input: 'Existing/project.md',
              deliverables: ['Existing-note patch'],
              dependencies: [],
              allowedTools: ['note:read'],
            },
          ],
        })));
      }
      return ok(response(JSON.stringify({
        summary: 'Patch ready',
        findings: ['The existing note should include a resource lane explanation.'],
        artifactDrafts: [{
          type: 'diff',
          title: 'Resource Lane Notes',
          path: 'Existing/project.md',
          content: 'Resource-scoped write lanes let independent swarm edits proceed while same-note appends remain ordered.',
          confidence: 0.9,
        }],
        risks: [],
        nextActions: [],
        confidence: 0.9,
      })));
    }),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

describe('AgentOrchestrationServiceImpl swarm mode', () => {
  it('runs workers, merges outputs, writes once through the orchestrator, and records receipts', async () => {
    const provider = fakeProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const scopedExecutor = new ScopedWorkerToolExecutor({
      execute: vi.fn(),
    } as unknown as ToolExecutorPort);
    const workerRunner = new AgentWorkerRunner(provider, contextProvider, toolRegistry, scopedExecutor);
    const agentLoop: AgentLoopService = {
      run: vi.fn(async (_prompt: string, options?: AgentOptions) => {
        const invocation = createInvocation();
        await options?.onToolCompleted?.(invocation);
        return {
          turns: 1,
          finalResponse: 'Created the swarm overview note.',
          toolInvocations: [invocation],
          conversationId: 'conv-swarm',
          cancelled: false,
        };
      }),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'Swarm chat' });
    conversation.id = 'conv-swarm';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const provenanceRecords: unknown[] = [];
    const provenance: ProvenanceService = {
      record: vi.fn(async (_noteName, event) => {
        provenanceRecords.push(event);
        return ok(undefined);
      }),
    } as unknown as ProvenanceService;
    const index: IndexService = {
      indexAll: vi.fn(async () => ok(undefined)),
    } as unknown as IndexService;
    const opened: string[] = [];
    const navigation: ApplicationNavigationPort = {
      openNote: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
      openFolder: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
    } as unknown as ApplicationNavigationPort;
    const notes: NotesService = {
      getState: () => ({
        items: [],
        tagGroups: [],
        selectedPath: null,
        isLoading: false,
        searchQuery: '',
        expandedFolders: new Set(),
      }),
      refresh: vi.fn(async () => ok([])),
    } as unknown as NotesService;
    const documents: DocumentService = {
      readContent: vi.fn(async () => ok('')),
    } as unknown as DocumentService;

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      new MemoryResearchSourceAdapter([{
        title: 'Bonsai care source',
        url: 'https://example.com/bonsai-care',
        excerpt: 'Bonsai trees require long-term pruning, wiring, and species-specific care.',
        fetchedAt: new Date().toISOString(),
        sourceType: 'web',
        status: 'verified',
      }]),
      notes,
      documents,
      navigation,
      provenance,
      index,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService()
    );

    const result = await service.startRun('Create a project brief about AI assistants', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('completed');
    expect(result.value.orchestrationMode).toBe('swarm');
    expect(result.value.workers).toHaveLength(2);
    expect(result.value.workers.every((worker) => worker.status === 'completed')).toBe(true);
    expect(result.value.workerMessages.some((message) => message.type === 'orchestrator.merge_decision')).toBe(true);
    expect(result.value.workerMessages.some((message) => message.type === 'worker.prompt')).toBe(true);
    expect(result.value.workerMessages.some((message) => message.type === 'worker.response')).toBe(true);
    expect(result.value.workerMessages.find((message) => message.type === 'worker.prompt')?.data?.request).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Parent user request: Create a project brief about AI assistants'),
        systemPrompt: expect.stringContaining('You are a bounded Void worker agent.'),
      })
    );
    expect(result.value.events.some((event) => event.type === 'worker.completed')).toBe(true);
    expect(result.value.events.some((event) => event.type === 'merge.completed')).toBe(true);
    expect(result.value.artifacts.some((artifact) => artifact.path === 'Research/ai-assistants/overview.md')).toBe(true);
    expect(result.value.artifacts.filter((artifact) => artifact.type === 'media')).toEqual([
      expect.objectContaining({
        url: 'https://www.youtube.com/watch?v=agent-demo',
        mediaKind: 'youtube',
      }),
    ]);
    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.stringContaining('Worker results:'),
      expect.objectContaining({ hideInternalMessages: true })
    );
    expect(provenanceRecords).toHaveLength(1);
    expect(index.indexAll).toHaveBeenCalled();
    expect(opened).toEqual(['Research/ai-assistants/overview.md']);
  });

  it('writes merged worker drafts itself when the model claims success without note tools', async () => {
    const provider = fakeProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const scopedExecutor = new ScopedWorkerToolExecutor({
      execute: vi.fn(),
    } as unknown as ToolExecutorPort);
    const workerRunner = new AgentWorkerRunner(provider, contextProvider, toolRegistry, scopedExecutor);
    const agentLoop: AgentLoopService = {
      run: vi.fn(async () => ({
        turns: 1,
        finalResponse: 'Aangemaakt in Research/local-first-multi-agent-note-systems-brief 2026-05-11:\n\nBrief - Local-first multi-agent note systems',
        toolInvocations: [],
        conversationId: 'conv-swarm',
        cancelled: false,
      })),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'Swarm chat' });
    conversation.id = 'conv-swarm';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const provenanceRecords: unknown[] = [];
    const provenance: ProvenanceService = {
      record: vi.fn(async (_noteName, event) => {
        provenanceRecords.push(event);
        return ok(undefined);
      }),
    } as unknown as ProvenanceService;
    const index: IndexService = {
      indexAll: vi.fn(async () => ok(undefined)),
    } as unknown as IndexService;
    const opened: string[] = [];
    const navigation: ApplicationNavigationPort = {
      openNote: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
      openFolder: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
    } as unknown as ApplicationNavigationPort;
    const notes: NotesService = {
      getState: () => ({
        items: [],
        tagGroups: [],
        selectedPath: null,
        isLoading: false,
        searchQuery: '',
        expandedFolders: new Set(),
      }),
      refresh: vi.fn(async () => ok([])),
    } as unknown as NotesService;
    const createdNotes: Array<{ folder: string; title: string; content: string }> = [];
    const documents: DocumentService = {
      readContent: vi.fn(async () => ok('')),
      createWithContent: vi.fn(async (folder: string, title: string, content?: string) => {
        createdNotes.push({ folder, title, content: content ?? '' });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
    } as unknown as DocumentService;
    const collaboration: NoteCollaborationService = {
      createNote: vi.fn(async ({ folder = '', title = 'Untitled', content = '' }) => {
        createdNotes.push({ folder, title, content });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
      isActiveNote: vi.fn(() => false),
      appendNoteContent: vi.fn(async () => ok(undefined)),
    } as unknown as NoteCollaborationService;

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      new MemoryResearchSourceAdapter([{
        title: 'Bonsai care source',
        url: 'https://example.com/bonsai-care',
        excerpt: 'Bonsai trees require long-term pruning, wiring, and species-specific care.',
        fetchedAt: new Date().toISOString(),
        sourceType: 'web',
        status: 'verified',
      }]),
      notes,
      documents,
      navigation,
      provenance,
      index,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService(),
      collaboration
    );

    const result = await service.startRun('Research and create a project brief about local-first multi-agent note systems', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(collaboration.createNote).toHaveBeenCalled();
    expect(documents.createWithContent).not.toHaveBeenCalled();
    expect(createdNotes.length).toBeGreaterThan(0);
    expect(createdNotes[0]!.content).toContain('## Key Takeaways');
    expect(createdNotes[0]!.content).toContain('## Connections');
    expect(createdNotes.some((note) => note.title.includes('Media') && note.content.includes('AI assistant demo video'))).toBe(true);
    expect(result.value.artifacts.some((artifact) => artifact.type === 'note')).toBe(true);
    expect(result.value.artifacts.some((artifact) => artifact.type === 'media')).toBe(true);
    expect(result.value.finalSummary).toMatch(/created or updated/i);
    expect(result.value.finalSummary).not.toContain('Aangemaakt in Research/local-first');
    expect(provenanceRecords.length).toBe(result.value.artifacts.filter((artifact) => artifact.type === 'note').length);
    expect(index.indexAll).toHaveBeenCalled();
    expect(navigation.openFolder).toHaveBeenCalled();
    expect(opened[0]).toContain('ai-assistants');
  });

  it('appends diff drafts through collaboration instead of direct document transforms', async () => {
    const provider = diffDraftProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const scopedExecutor = new ScopedWorkerToolExecutor({
      execute: vi.fn(),
    } as unknown as ToolExecutorPort);
    const workerRunner = new AgentWorkerRunner(provider, contextProvider, toolRegistry, scopedExecutor);
    const agentLoop: AgentLoopService = {
      run: vi.fn(async () => ({
        turns: 1,
        finalResponse: 'Done.',
        toolInvocations: [],
        conversationId: 'conv-swarm',
        cancelled: false,
      })),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'Swarm chat' });
    conversation.id = 'conv-swarm';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const provenance: ProvenanceService = {
      record: vi.fn(async () => ok(undefined)),
    } as unknown as ProvenanceService;
    const index: IndexService = {
      indexAll: vi.fn(async () => ok(undefined)),
    } as unknown as IndexService;
    const navigation: ApplicationNavigationPort = {
      openNote: vi.fn(async () => ok(undefined)),
      openFolder: vi.fn(async () => ok(undefined)),
    } as unknown as ApplicationNavigationPort;
    const notes: NotesService = {
      getState: () => ({
        items: [],
        tagGroups: [],
        selectedPath: null,
        isLoading: false,
        searchQuery: '',
        expandedFolders: new Set(),
      }),
      refresh: vi.fn(async () => ok([])),
    } as unknown as NotesService;
    const files = new Map<string, string>([
      ['Existing/project.md', '# Project\n\nExisting content'],
    ]);
    const documents: DocumentService = {
      readContent: vi.fn(async (path: string) => {
        const content = files.get(path);
        return content === undefined ? err(new Error(`Missing ${path}`)) : ok(content);
      }),
      transformContent: vi.fn(async (path: string, transform: (current: string) => string | Promise<string>) => {
        const current = files.get(path);
        if (current === undefined) throw new Error(`Missing ${path}`);
        const next = await transform(current);
        files.set(path, next);
        return ok(next);
      }),
      createWithContent: vi.fn(async (folder: string, title: string, content?: string) => {
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const path = `${folder}/${filename}.md`;
        files.set(path, content ?? '');
        return ok({ path, title });
      }),
    } as unknown as DocumentService;
    const collaboration: NoteCollaborationService = {
      isActiveNote: vi.fn(() => false),
      appendNoteContent: vi.fn(async (path: string, markdown: string) => {
        files.set(path, `${files.get(path) ?? ''}\n\n${markdown}`);
        return ok(undefined);
      }),
      createNote: vi.fn(async ({ folder = '', title = 'Untitled', content = '' }) => {
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const path = `${folder}/${filename}.md`;
        files.set(path, content);
        return ok({ path, title });
      }),
    } as unknown as NoteCollaborationService;

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      new MemoryResearchSourceAdapter([]),
      notes,
      documents,
      navigation,
      provenance,
      index,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService(),
      collaboration
    );

    const result = await service.startRun('Use a swarm to update the existing project note', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(collaboration.appendNoteContent).toHaveBeenCalledWith(
      'Existing/project.md',
      '## Resource Lane Notes\n\nResource-scoped write lanes let independent swarm edits proceed while same-note appends remain ordered.',
      'Resource Lane Notes',
      expect.objectContaining({
        commandId: 'agent:swarm',
        intentKind: 'rewrite',
      }),
    );
    expect(documents.transformContent).not.toHaveBeenCalled();
    expect(files.get('Existing/project.md')).toContain('## Resource Lane Notes');
    expect(files.get('Existing/project.md')).toContain('Resource-scoped write lanes');
    expect(result.value.artifacts.some((artifact) => artifact.path === 'Existing/project.md')).toBe(true);
    expect(result.value.status).toBe('completed');
  });

  it('routes active-note diff drafts through note collaboration instead of headless writes', async () => {
    const provider = diffDraftProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const workerRunner = new AgentWorkerRunner(
      provider,
      contextProvider,
      toolRegistry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );
    const agentLoop: AgentLoopService = {
      run: vi.fn(async () => ({
        turns: 1,
        finalResponse: 'Done.',
        toolInvocations: [],
        conversationId: 'conv-swarm',
        cancelled: false,
      })),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'Swarm chat' });
    conversation.id = 'conv-swarm';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const files = new Map<string, string>([
      ['Existing/project.md', '# Project\n\nUnsaved editor content'],
    ]);
    const documents: DocumentService = {
      readContent: vi.fn(async (path: string) => {
        const content = files.get(path);
        return content === undefined ? err(new Error(`Missing ${path}`)) : ok(content);
      }),
      transformContent: vi.fn(),
      createWithContent: vi.fn(async (folder: string, title: string, content?: string) => {
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const path = `${folder}/${filename}.md`;
        files.set(path, content ?? '');
        return ok({ path, title });
      }),
    } as unknown as DocumentService;
    const collaboration: NoteCollaborationService = {
      isActiveNote: vi.fn((path: string) => path === 'Existing/project.md'),
      appendNoteContent: vi.fn(async (path: string, markdown: string) => {
        files.set(path, `${files.get(path) ?? ''}\n\n${markdown}`);
        return ok(undefined);
      }),
      createNote: vi.fn(async ({ folder = '', title = 'Untitled', content = '' }) => {
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const path = `${folder}/${filename}.md`;
        files.set(path, content);
        return ok({ path, title });
      }),
    } as unknown as NoteCollaborationService;

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      new MemoryResearchSourceAdapter([]),
      {
        getState: () => ({ items: [], tagGroups: [], selectedPath: null, isLoading: false, searchQuery: '', expandedFolders: new Set() }),
        refresh: vi.fn(async () => ok([])),
      } as unknown as NotesService,
      documents,
      { openNote: vi.fn(async () => ok(undefined)), openFolder: vi.fn(async () => ok(undefined)) } as unknown as ApplicationNavigationPort,
      { record: vi.fn(async () => ok(undefined)) } as unknown as ProvenanceService,
      { indexAll: vi.fn(async () => ok(undefined)) } as unknown as IndexService,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService(),
      collaboration
    );

    const result = await service.startRun('Use a swarm to update the existing project note', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(collaboration.appendNoteContent).toHaveBeenCalledWith(
      'Existing/project.md',
      '## Resource Lane Notes\n\nResource-scoped write lanes let independent swarm edits proceed while same-note appends remain ordered.',
      'Resource Lane Notes',
      expect.objectContaining({
        commandId: 'agent:swarm',
        intentKind: 'rewrite',
      }),
    );
    expect(documents.transformContent).not.toHaveBeenCalled();
    expect(files.get('Existing/project.md')).toContain('Unsaved editor content');
    expect(files.get('Existing/project.md')).toContain('Resource-scoped write lanes');
  });

  it('creates a real research overview instead of Worker Summary when workers return only generic completions', async () => {
    const provider = genericCompletionProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const scopedExecutor = new ScopedWorkerToolExecutor({
      execute: vi.fn(),
    } as unknown as ToolExecutorPort);
    const workerRunner = new AgentWorkerRunner(provider, contextProvider, toolRegistry, scopedExecutor);
    const agentLoop: AgentLoopService = {
      run: vi.fn(async () => ({
        turns: 1,
        finalResponse: 'Created the research note.',
        toolInvocations: [],
        conversationId: 'conv-bonsai',
        cancelled: false,
      })),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'Bonsai chat' });
    conversation.id = 'conv-bonsai';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const provenance: ProvenanceService = {
      record: vi.fn(async () => ok(undefined)),
    } as unknown as ProvenanceService;
    const index: IndexService = {
      indexAll: vi.fn(async () => ok(undefined)),
    } as unknown as IndexService;
    const opened: string[] = [];
    const navigation: ApplicationNavigationPort = {
      openNote: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
      openFolder: vi.fn(async (path) => {
        opened.push(path);
        return ok(undefined);
      }),
    } as unknown as ApplicationNavigationPort;
    const notes: NotesService = {
      getState: () => ({
        items: [],
        tagGroups: [],
        selectedPath: null,
        isLoading: false,
        searchQuery: '',
        expandedFolders: new Set(),
      }),
      refresh: vi.fn(async () => ok([])),
    } as unknown as NotesService;
    const createdNotes: Array<{ folder: string; title: string; content: string }> = [];
    const documents: DocumentService = {
      readContent: vi.fn(async () => ok('')),
      createWithContent: vi.fn(async (folder: string, title: string, content?: string) => {
        createdNotes.push({ folder, title, content: content ?? '' });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
    } as unknown as DocumentService;
    const collaboration: NoteCollaborationService = {
      createNote: vi.fn(async ({ folder = '', title = 'Untitled', content = '' }) => {
        createdNotes.push({ folder, title, content });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
      isActiveNote: vi.fn(() => false),
      appendNoteContent: vi.fn(async () => ok(undefined)),
    } as unknown as NoteCollaborationService;

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      new MemoryResearchSourceAdapter([{
        title: 'Bonsai care source',
        url: 'https://example.com/bonsai-care',
        excerpt: 'Bonsai trees require long-term pruning, wiring, and species-specific care.',
        fetchedAt: new Date().toISOString(),
        sourceType: 'web',
        status: 'verified',
      }]),
      notes,
      documents,
      navigation,
      provenance,
      index,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService(),
      collaboration
    );

    const result = await service.startRun('Do research on Bonsai trees', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createdNotes.length).toBeGreaterThanOrEqual(1);
    expect(createdNotes[0]?.title).toBe('Bonsai Trees Research Overview');
    expect(createdNotes[0]?.title).not.toBe('Worker Summary');
    expect(createdNotes.every((note) => note.title !== 'Worker Summary')).toBe(true);
    expect(createdNotes[0]?.content).toContain('## Key Takeaways');
    expect(createdNotes[0]?.content).toContain('## Sources');
    expect(createdNotes[0]?.content).toContain('Bonsai care source');
    expect(createdNotes[0]?.content).not.toContain('## Run Receipt');
    expect(createdNotes[0]?.content).toContain('[[bonsai-trees-sources.md|Bonsai Trees Sources]]');
    expect(createdNotes.some((note) =>
      note.content.includes('Related note: [[bonsai-trees-research-overview.md|Bonsai Trees Research Overview]]')
    )).toBe(true);
    expect(result.value.plan?.citations).toEqual([
      expect.objectContaining({ title: 'Bonsai care source' }),
    ]);
    expect(result.value.artifacts.some((artifact) => artifact.path?.endsWith('/worker-summary.md'))).toBe(false);
    expect(result.value.finalSummary).toContain('Research completed');
    expect(result.value.finalSummary).toContain('Bonsai Trees Research Overview');
    expect(result.value.finalSummary).not.toContain('Swarm run completed');
    const activityTexts = vi.mocked(aiAssistant.appendAssistantMessage).mock.calls
      .map((call) => String(call[0]));
    expect(activityTexts.length).toBeGreaterThan(3);
    expect(activityTexts.some((text) => text.includes('Now I’m starting the write-down of the findings'))).toBe(true);
    expect(activityTexts.some((text) => text.includes('I created "Bonsai Trees Research Overview"'))).toBe(true);
    expect(aiAssistant.appendOrUpdateAssistantActivity).not.toHaveBeenCalled();
    expect(opened[0]).toContain('bonsai-trees-research-overview');
  });

  it('writes a needs-verification research note when recovery finds no verified evidence', async () => {
    const provider = genericCompletionProvider();
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
      getNotesBasePath: () => '/notes',
    } as unknown as ContextProviderPort;
    const toolRegistry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const workerRunner = new AgentWorkerRunner(
      provider,
      contextProvider,
      toolRegistry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );
    const agentLoop: AgentLoopService = {
      run: vi.fn(),
      cancel: vi.fn(),
      getState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as AgentLoopService;
    const conversation = createConversation({ title: 'No evidence chat' });
    conversation.id = 'conv-empty-research';
    const aiAssistant: AIAssistantService = {
      appendUserMessage: vi.fn(async () => ok(conversation)),
      appendOrUpdateAssistantActivity: vi.fn(async () => ok(conversation)),
      appendAssistantMessage: vi.fn(async () => ok(conversation)),
    } as unknown as AIAssistantService;
    const createdNotes: Array<{ folder: string; title: string; content: string }> = [];
    const documents: DocumentService = {
      readContent: vi.fn(async () => ok('')),
      createWithContent: vi.fn(async (folder: string, title: string, content?: string) => {
        createdNotes.push({ folder, title, content: content ?? '' });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
    } as unknown as DocumentService;
    const collaboration: NoteCollaborationService = {
      createNote: vi.fn(async ({ folder = '', title = 'Untitled', content = '' }) => {
        createdNotes.push({ folder, title, content });
        const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return ok({ path: `${folder}/${filename}.md`, title });
      }),
      isActiveNote: vi.fn(() => false),
      appendNoteContent: vi.fn(async () => ok(undefined)),
    } as unknown as NoteCollaborationService;
    const emptyResearchSources: ResearchSourcePort = {
      search: vi.fn(async () => ok([])),
    };

    const service = new AgentOrchestrationServiceImpl(
      agentLoop,
      new MemoryAgentRunStorageAdapter(),
      null,
      emptyResearchSources,
      {
        getState: () => ({ items: [], tagGroups: [], selectedPath: null, isLoading: false, searchQuery: '', expandedFolders: new Set() }),
        refresh: vi.fn(async () => ok([])),
      } as unknown as NotesService,
      documents,
      { openNote: vi.fn(), openFolder: vi.fn() } as unknown as ApplicationNavigationPort,
      { record: vi.fn(async () => ok(undefined)) } as unknown as ProvenanceService,
      { indexAll: vi.fn(async () => ok(undefined)) } as unknown as IndexService,
      aiAssistant,
      new AgentSwarmPlanner(provider, contextProvider),
      workerRunner,
      new AgentWorkerBus(),
      new AgentWorkerScheduler(),
      new AgentMergeService(),
      collaboration
    );

    const result = await service.startRun('Research the future of Coding Agents', {
      orchestrationMode: 'swarm',
      requireApproval: false,
      maxWorkers: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('completed');
    expect(result.value.merge?.evidenceLevel).toBe('model_prior');
    expect(createdNotes.length).toBeGreaterThanOrEqual(1);
    expect(createdNotes[0]?.title).toBe('Future of Coding Agents Research Overview');
    expect(createdNotes[0]?.folder).toContain('Research/future-of-coding-agents');
    expect(createdNotes[0]?.content).toContain('## Key Takeaways');
    expect(createdNotes[0]?.content).toContain('## Sources');
    expect(createdNotes[0]?.content).not.toContain('## Run Receipt');
    expect(createdNotes[0]?.content).not.toContain('Evidence level: model_prior');
    expect(createdNotes[0]?.content).toContain('Research seed: identify the current highest-authority facts');
    expect(createdNotes[0]?.content).not.toContain('adoption signals');
    expect(createdNotes[0]?.content).not.toContain('Worker Summary');
  });
});
