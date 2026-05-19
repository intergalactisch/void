import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import {
  AgentMergeService,
  AgentSwarmPlanner,
  AgentWorkerRunner,
  AgentWorkerScheduler,
  ScopedWorkerToolExecutor,
} from '$lib/application/services';
import { createAgentRun, type AgentWorkerSpec } from '$lib/domain/entities/AgentRun';
import { createTool } from '$lib/domain/entities/Tool';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import { toolSuccess } from '$lib/domain/values/ToolResult';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { AIAssistantProviderPort, ContextProviderPort, ToolExecutorPort } from '$lib/ports/outbound';
import type { ToolRegistryService } from '$lib/ports/inbound';

function response(chat: string, toolCalls: AIResponse['toolCalls'] = []): AIResponse {
  return {
    chat,
    toolCalls,
    meta: {
      provider: 'test',
      model: 'test-model',
      latencyMs: 1,
    },
    truncated: false,
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
  };
}

function providerWith(chats: string[]): AIAssistantProviderPort {
  const queue = [...chats];
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: vi.fn(async () => ok(response(queue.shift() ?? '{}'))),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

function unavailableProvider(): AIAssistantProviderPort {
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => false),
    configure: vi.fn(),
    prompt: vi.fn(),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

function contextProvider(): ContextProviderPort {
  return {
    getContext: vi.fn(async () => createEmptyContext()),
    getNotesBasePath: () => '/notes',
  } as unknown as ContextProviderPort;
}

describe('AgentSwarmPlanner', () => {
  it('creates bounded worker specs and filters unsafe worker tools', async () => {
    const provider = providerWith([JSON.stringify({
      summary: 'Plan',
      rationale: 'Parallel work helps',
      mergeCriteria: ['Merge safely'],
      workers: [
        { title: 'A', role: 'researcher', objective: 'Find A', deliverables: ['A'], allowedTools: ['search:content', 'note:create'] },
        { title: 'B', role: 'analyst', objective: 'Find B', deliverables: ['B'], allowedTools: ['note:read'] },
        { title: 'C', role: 'reviewer', objective: 'Find C', deliverables: ['C'], allowedTools: ['note:list'] },
      ],
    })]);

    const planner = new AgentSwarmPlanner(provider, contextProvider());
    const plan = await planner.plan('Research and create notes about local-first AI', { maxWorkers: 2 });

    expect(plan.workers).toHaveLength(2);
    expect(plan.workers[0]?.allowedTools).toEqual(['search:content']);
    expect(plan.workers[1]?.id).toBe('worker-2');
  });

  it('produces a research note constellation in the fallback plan', async () => {
    const planner = new AgentSwarmPlanner(unavailableProvider(), contextProvider());
    const plan = await planner.plan('Research local-first AI note systems and find useful YouTube videos and images', {
      maxWorkers: 8,
    });

    expect(plan.workers.length).toBeGreaterThanOrEqual(5);
    const roles = plan.workers.map((worker) => worker.assignedNote?.role);
    expect(roles).toContain('overview');
    expect(roles).toContain('aspect');
    expect(roles).toContain('further-reading');

    const overviewWorker = plan.workers.find((worker) => worker.assignedNote?.role === 'overview');
    expect(overviewWorker?.dependencies.length).toBeGreaterThan(0);
    expect(overviewWorker?.assignedNote?.title).toMatch(/Overview$/);

    const furtherReading = plan.workers.find((worker) => worker.assignedNote?.role === 'further-reading');
    expect(furtherReading?.allowedTools).toContain('search:media');
    expect(furtherReading?.assignedNote?.siblingTitles.length).toBeGreaterThan(0);

    for (const worker of plan.workers) {
      expect(worker.assignedNote?.folder).toMatch(/^Research\//);
    }
  });

  it('gives every constellation worker note:create authorship via staged_draft scope', async () => {
    const planner = new AgentSwarmPlanner(unavailableProvider(), contextProvider());
    const plan = await planner.plan('Research the history of Magic the Gathering', { maxWorkers: 8 });

    for (const worker of plan.workers) {
      expect(worker.assignedNote).toBeDefined();
      expect(worker.writeScope).toBe('staged_draft');
      expect(worker.allowedTools).toContain('note:create');
    }
  });
});

describe('AgentWorkerScheduler', () => {
  it('respects dependencies and concurrency limits', async () => {
    const scheduler = new AgentWorkerScheduler();
    const specs: AgentWorkerSpec[] = [
      spec('worker-1', []),
      spec('worker-2', []),
      spec('worker-3', ['worker-1']),
    ];
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const result = await scheduler.run(specs, 2, async (worker) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(worker.id);
      await Promise.resolve();
      active -= 1;
      return worker.id;
    });

    expect(result.results).toHaveLength(3);
    expect(result.failures).toEqual([]);
    expect(result.maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(order.indexOf('worker-3')).toBeGreaterThan(order.indexOf('worker-1'));
  });
});

describe('ScopedWorkerToolExecutor', () => {
  it('delegates read tools and rejects write tools', async () => {
    const delegate: ToolExecutorPort = {
      execute: vi.fn(async (invocation) => toolSuccess(invocation.toolId, { ok: true }, new Date())),
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      hasHandler: vi.fn(),
      executeSequence: vi.fn(),
      executeParallel: vi.fn(),
      cancel: vi.fn(),
      cancelAll: vi.fn(),
      isExecuting: vi.fn(),
      getExecutingIds: vi.fn(),
    } as unknown as ToolExecutorPort;
    const scoped = new ScopedWorkerToolExecutor(delegate);

    const read = await scoped.execute(createInvocation({
      toolId: 'note:read' as ToolId,
      args: {},
      confirmed: true,
    }));
    const write = await scoped.execute(createInvocation({
      toolId: 'note:create' as ToolId,
      args: {},
      confirmed: true,
    }));

    expect(read.status).toBe('success');
    expect(write.status).toBe('failure');
    expect(delegate.execute).toHaveBeenCalledTimes(1);
  });

  it('allows staged draft writes only inside the worker target resource', async () => {
    const delegate: ToolExecutorPort = {
      execute: vi.fn(async (invocation) => toolSuccess(invocation.toolId, { noteId: 'ok.md', title: 'Draft' }, new Date())),
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      hasHandler: vi.fn(),
      executeSequence: vi.fn(),
      executeParallel: vi.fn(),
      cancel: vi.fn(),
      cancelAll: vi.fn(),
      isExecuting: vi.fn(),
      getExecutingIds: vi.fn(),
    } as unknown as ToolExecutorPort;
    const scoped = new ScopedWorkerToolExecutor(delegate);
    const worker: AgentWorkerSpec = {
      ...spec('worker-1', []),
      allowedTools: ['note:create'],
      writeScope: 'staged_draft',
      capabilities: ['read_context', 'draft_artifact', 'stage_note'],
      targetResources: [{
        id: 'note:create:Research/topic/_worker-drafts/worker-1/',
        accessMode: 'create' as const,
      }],
    };

    const allowed = await scoped.execute(createInvocation({
      toolId: 'note:create' as ToolId,
      args: { folder: 'Research/topic/_worker-drafts/worker-1', title: 'Draft' },
      confirmed: true,
    }), worker);
    const blocked = await scoped.execute(createInvocation({
      toolId: 'note:create' as ToolId,
      args: { folder: 'Research/topic/final', title: 'Draft' },
      confirmed: true,
    }), worker);

    expect(allowed.status).toBe('success');
    expect(blocked.status).toBe('failure');
    expect(delegate.execute).toHaveBeenCalledTimes(1);
  });
});

describe('AgentWorkerRunner', () => {
  it('runs workers without visible conversation history and only exposes read tools', async () => {
    const provider = providerWith([JSON.stringify({
      summary: 'Worker done',
      findings: ['Finding'],
      artifactDrafts: [{ type: 'summary', title: 'Draft', summary: 'Draft summary', confidence: 0.8 }],
      risks: [],
      nextActions: [],
      confidence: 0.8,
    })]);
    const tools = [
      createTool({ id: 'note:read' as ToolId, name: 'Read', description: 'Read', category: 'note' }),
      createTool({ id: 'note:create' as ToolId, name: 'Create', description: 'Create', category: 'note' }),
    ];
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => tools),
    } as unknown as ToolRegistryService;
    const delegate: ToolExecutorPort = {
      execute: vi.fn(),
    } as unknown as ToolExecutorPort;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor(delegate)
    );

    const result = await runner.run({
      runId: 'run-1',
      prompt: 'Research AI',
      spec: spec('worker-1', []),
    });

    expect(result.summary).toBe('Worker done');
    expect(provider.prompt).toHaveBeenCalledWith(expect.objectContaining({
      conversationHistory: [],
      tools: [expect.objectContaining({ id: 'note:read' })],
    }));
  });

  it('emits worker prompt and response traces for command-center inspection', async () => {
    const provider = providerWith([JSON.stringify({
      summary: 'Worker done',
      findings: ['The worker captured a concrete finding.'],
      artifactDrafts: [],
      risks: [],
      nextActions: [],
      confidence: 0.82,
    })]);
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => [
        createTool({ id: 'note:read' as ToolId, name: 'Read', description: 'Read notes', category: 'note' }),
      ]),
    } as unknown as ToolRegistryService;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );
    const messages: Array<{
      type: string;
      message: string;
      data?: Record<string, unknown>;
    }> = [];

    const result = await runner.run({
      runId: 'run-trace',
      prompt: 'Research worker transparency',
      spec: spec('worker-trace', []),
      onMessage: async (message) => {
        messages.push(message);
      },
    });

    const promptTrace = messages.find((message) => message.type === 'worker.prompt');
    const responseTrace = messages.find((message) => message.type === 'worker.response');

    expect(result.summary).toBe('Worker done');
    expect(promptTrace?.data?.request).toEqual(expect.objectContaining({
      message: expect.stringContaining('Parent user request: Research worker transparency'),
      systemPrompt: expect.stringContaining('You are a bounded Void worker agent.'),
      tools: [expect.objectContaining({ id: 'note:read' })],
      conversationHistoryCount: 0,
    }));
    expect(responseTrace?.data?.response).toEqual(expect.objectContaining({
      chat: expect.stringContaining('Worker done'),
      stopReason: 'end_turn',
    }));
  });

  it('does not turn generic worker completion text into a Worker Summary draft', async () => {
    const provider = providerWith(['Completed Find relevant notes and context.']);
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );

    const result = await runner.run({
      runId: 'run-1',
      prompt: 'Do research on Bonsai trees',
      spec: spec('worker-1', []),
    });

    expect(result.quality).toBe('insufficient');
    expect(result.findings).toEqual([]);
    expect(result.artifactDrafts).toEqual([]);
    expect(result.risks[0]).toContain('did not return structured research findings');
    expect(provider.prompt).toHaveBeenCalledTimes(2);
  });

  it('repairs generic research completions into topic-specific findings when the model can recover', async () => {
    const provider = providerWith([
      'Completed Source scout.',
      JSON.stringify({
        summary: 'Found current Pokemon TCG set findings',
        findings: [
          'The latest Pokemon TCG set should be identified by official set name, release date, theme, featured cards, and any new mechanics before writing the final note.',
        ],
        artifactDrafts: [{
          type: 'note',
          title: 'Latest Pokemon TCG Set Findings',
          content: '# Latest Pokemon TCG Set Findings\n\n## Key Findings\n- Verify official set name and featured cards before publication.',
          confidence: 0.7,
        }],
        risks: ['Needs official source verification.'],
        nextActions: ['Check official Pokemon TCG announcements.'],
        confidence: 0.65,
      }),
    ]);
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );

    const result = await runner.run({
      runId: 'run-pokemon',
      prompt: 'Do research on the latest Pokemon TCG set',
      spec: spec('worker-source', []),
      webAccess: 'native',
    });

    expect(result.quality).toBe('substantive');
    expect(result.findings[0]).toContain('Pokemon TCG set');
    expect(result.artifactDrafts[0]?.title).toBe('Latest Pokemon TCG Set Findings');
    expect(provider.prompt).toHaveBeenCalledTimes(2);
  });

  it('normalizes media artifact drafts with URL and media kind', async () => {
    const provider = providerWith([JSON.stringify({
      summary: 'Media leads found',
      findings: ['A short explainer video would help the note.'],
      artifactDrafts: [{
        type: 'media',
        title: 'Local-first software explainer',
        url: 'https://www.youtube.com/watch?v=abc123',
        mediaKind: 'youtube',
        summary: 'Useful overview video for local-first concepts.',
        confidence: 0.78,
      }],
      risks: ['Verify source credibility before embedding.'],
      nextActions: ['Watch and summarize the video.'],
      confidence: 0.76,
    })]);
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => []),
    } as unknown as ToolRegistryService;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor({ execute: vi.fn() } as unknown as ToolExecutorPort)
    );

    const result = await runner.run({
      runId: 'run-media',
      prompt: 'Research local-first AI note systems and find useful media',
      spec: spec('worker-media', []),
    });

    expect(result.artifactDrafts).toHaveLength(1);
    expect(result.artifactDrafts[0]).toMatchObject({
      type: 'media',
      title: 'Local-first software explainer',
      url: 'https://www.youtube.com/watch?v=abc123',
      mediaKind: 'youtube',
    });
    expect(result.evidenceLevel).toBe('unverified_leads');
  });

  it('captures scoped staged note tool results as worker draft artifacts', async () => {
    const provider: AIAssistantProviderPort = {
      ...providerWith([]),
      prompt: vi.fn(async (request) => {
        if (request.tools.length > 0) {
          return ok(response('', [{
            id: 'call-create-draft',
            toolId: 'note:create' as ToolId,
            args: {
              folder: 'Research/topic/_worker-drafts/worker-1',
              title: 'Worker Draft',
              content: '# Worker Draft',
              autoFocus: false,
            },
          }]));
        }
        return ok(response(JSON.stringify({
          summary: 'Staged draft written',
          findings: [],
          artifactDrafts: [],
          risks: [],
          nextActions: [],
          confidence: 0.7,
        })));
      }),
    } as unknown as AIAssistantProviderPort;
    const registry: ToolRegistryService = {
      getAll: vi.fn(async () => [
        createTool({ id: 'note:create' as ToolId, name: 'Create', description: 'Create', category: 'note' }),
      ]),
    } as unknown as ToolRegistryService;
    const delegate: ToolExecutorPort = {
      execute: vi.fn(async (invocation) => toolSuccess(invocation.toolId, {
        noteId: 'Research/topic/_worker-drafts/worker-1/worker-draft.md',
        title: 'Worker Draft',
      }, new Date())),
    } as unknown as ToolExecutorPort;
    const runner = new AgentWorkerRunner(
      provider,
      contextProvider(),
      registry,
      new ScopedWorkerToolExecutor(delegate)
    );

    const result = await runner.run({
      runId: 'run-staged',
      prompt: 'Research and draft a topic brief',
      spec: {
        ...spec('worker-1', []),
        allowedTools: ['note:create'],
        writeScope: 'staged_draft',
        capabilities: ['read_context', 'draft_artifact', 'stage_note'],
        targetResources: [{
          id: 'note:create:Research/topic/_worker-drafts/worker-1/',
          accessMode: 'create',
        }],
      },
    });

    expect(delegate.execute).toHaveBeenCalledTimes(1);
    expect(result.artifactDrafts).toEqual([
      expect.objectContaining({
        type: 'note',
        title: 'Worker Draft',
        path: 'Research/topic/_worker-drafts/worker-1/worker-draft.md',
        metadata: expect.objectContaining({ staged: true, quality: 'substantive' }),
      }),
    ]);
    expect(result.quality).toBe('substantive');
  });
});

describe('AgentMergeService', () => {
  it('deduplicates worker drafts and preserves failures in the write prompt', () => {
    const run = createAgentRun({ id: 'run-1', prompt: 'Research AI', approvalRequired: false });
    const service = new AgentMergeService();

    const merge = service.merge({
      run,
      workerResults: [
        {
          workerId: 'worker-1',
          title: 'One',
          summary: 'Summary',
          findings: ['A'],
          artifactDrafts: [
            {
              id: 'draft-1',
              workerId: 'worker-1',
              type: 'summary',
              title: 'Same',
              summary: 'A',
              confidence: 0.7,
              createdAt: new Date().toISOString(),
            },
            {
              id: 'draft-2',
              workerId: 'worker-1',
              type: 'summary',
              title: 'Same',
              summary: 'B',
              confidence: 0.7,
              createdAt: new Date().toISOString(),
            },
          ],
          citations: [],
          risks: ['Weak source'],
          nextActions: [],
          confidence: 0.7,
          completedAt: new Date().toISOString(),
        },
      ],
      workerFailures: [{ workerId: 'worker-2', error: new Error('failed') }],
    });

    expect(merge.artifactDrafts).toHaveLength(1);
    expect(merge.risks).toContain('Weak source');
    expect(merge.writePrompt).toContain('worker-2: failed');
  });

  it('filters Worker Summary placeholders and creates a topical research overview draft', () => {
    const run = createAgentRun({ id: 'run-bonsai', prompt: 'Research the future of Coding Agents', approvalRequired: false });
    const service = new AgentMergeService();

    const merge = service.merge({
      run,
      workerResults: [
        {
          workerId: 'worker-1',
          title: 'Find relevant notes and context',
          summary: 'Completed Find relevant notes and context.',
          findings: [],
          artifactDrafts: [
            {
              id: 'draft-worker-summary',
              workerId: 'worker-1',
              type: 'summary',
              title: 'Worker Summary',
              summary: 'Completed Find relevant notes and context.',
              confidence: 0.6,
              createdAt: new Date().toISOString(),
              metadata: { quality: 'placeholder' },
            },
          ],
          citations: [
            {
              title: 'Future of coding agents source',
              url: 'https://example.com/future-coding-agents',
              excerpt: 'Coding agents are expected to become more autonomous and tool-rich.',
              fetchedAt: new Date().toISOString(),
              sourceType: 'web',
              status: 'verified',
            },
          ],
          risks: [],
          nextActions: [],
          confidence: 0.6,
          quality: 'insufficient',
          completedAt: new Date().toISOString(),
        },
      ],
      workerFailures: [],
    });

    expect(merge.artifactDrafts).toHaveLength(1);
    expect(merge.artifactDrafts[0]?.title).toBe('Future of Coding Agents Research Overview');
    expect(merge.artifactDrafts[0]?.content).toContain('## Key Takeaways');
    expect(merge.artifactDrafts[0]?.content).toContain('## Source Context');
    expect(merge.artifactDrafts[0]?.content).toContain('Coding agents are expected to become more autonomous and tool-rich.');
    expect(merge.artifactDrafts[0]?.title).not.toBe('Worker Summary');
    expect(merge.risks.some((risk) => risk.includes('placeholder worker draft'))).toBe(true);
  });

  it('creates a transparent research seed draft when workers have no evidence', () => {
    const run = createAgentRun({ id: 'run-bonsai', prompt: 'Do research on Bonsai trees', approvalRequired: false });
    const service = new AgentMergeService();

    const merge = service.merge({
      run,
      workerResults: [
        {
          workerId: 'worker-1',
          title: 'Find relevant notes and context',
          summary: 'Completed Find relevant notes and context.',
          findings: [],
          artifactDrafts: [],
          citations: [],
          risks: [],
          nextActions: [],
          confidence: 0.6,
          quality: 'insufficient',
          completedAt: new Date().toISOString(),
        },
      ],
      workerFailures: [],
    });

    expect(merge.artifactDrafts).toHaveLength(1);
    expect(merge.artifactDrafts[0]?.title).toBe('Bonsai Trees Research Overview');
    expect(merge.artifactDrafts[0]?.content).toContain('## Key Takeaways');
    expect(merge.artifactDrafts[0]?.content).toContain('There is not enough reliable content captured yet');
    expect(merge.artifactDrafts[0]?.content).not.toContain('## Run Receipt');
    expect(merge.evidenceLevel).toBe('scaffold_only');
    expect(merge.risks).toContain('Research workers did not produce substantive findings, citations, or existing-note evidence; the orchestrator will write a transparent seed note.');
  });

  it('uses preflight research evidence when worker results are empty', () => {
    const run = createAgentRun({ id: 'run-mtg', prompt: 'Doe onderzoek naar de laatste Magic the Gathering set', approvalRequired: false });
    const citation = {
      title: 'Latest MTG Sets and Products',
      url: 'https://magic.wizards.com/en/products',
      excerpt: 'Official product page with current sets.',
      fetchedAt: new Date().toISOString(),
      sourceType: 'web' as const,
      status: 'verified' as const,
    };
    run.plan = {
      summary: 'Research MTG',
      steps: [],
      suggestedNotes: [],
      existingNotes: [],
      citations: [citation],
      researchEvidence: {
        existingNotes: [],
        citations: [citation],
        collectedAt: new Date().toISOString(),
        source: 'preflight',
      },
    };
    const service = new AgentMergeService();

    const merge = service.merge({
      run,
      workerResults: [{
        workerId: 'worker-1',
        title: 'Source scout',
        summary: 'Completed Source scout.',
        findings: [],
        artifactDrafts: [],
        citations: [],
        risks: [],
        nextActions: [],
        confidence: 0.6,
        quality: 'insufficient',
        completedAt: new Date().toISOString(),
      }],
      workerFailures: [],
    });

    expect(merge.evidenceLevel).toBe('verified_sources');
    expect(merge.artifactDrafts[0]?.content).toContain('## Key Takeaways');
    expect(merge.artifactDrafts[0]?.content).toContain('Latest MTG Sets and Products');
    expect(merge.artifactDrafts[0]?.content).toContain('## Sources');
  });

  it('deduplicates media drafts and carries them into the write prompt', () => {
    const run = createAgentRun({ id: 'run-media', prompt: 'Research local-first note systems and find media', approvalRequired: false });
    const service = new AgentMergeService();

    const mediaDraft = {
      id: 'draft-media-1',
      workerId: 'worker-media',
      type: 'media' as const,
      title: 'Local-first software explainer',
      url: 'https://www.youtube.com/watch?v=abc123',
      mediaKind: 'youtube' as const,
      summary: 'Useful overview video.',
      confidence: 0.8,
      createdAt: new Date().toISOString(),
      metadata: { quality: 'substantive' },
    };
    const merge = service.merge({
      run,
      workerResults: [
        {
          workerId: 'worker-media',
          title: 'Media scout',
          summary: 'Media leads found',
          findings: ['The video is a useful starting point.'],
          artifactDrafts: [mediaDraft, { ...mediaDraft, id: 'draft-media-2', title: 'Duplicate video' }],
          citations: [],
          risks: [],
          nextActions: ['Verify the video.'],
          confidence: 0.8,
          completedAt: new Date().toISOString(),
        },
      ],
      workerFailures: [],
    });

    expect(merge.artifactDrafts).toHaveLength(1);
    expect(merge.artifactDrafts[0]?.type).toBe('media');
    expect(merge.evidenceLevel).toBe('unverified_leads');
    expect(merge.writePrompt).toContain('Type: media');
    expect(merge.writePrompt).toContain('Media kind: youtube');
    expect(merge.writePrompt).toContain('URL: https://www.youtube.com/watch?v=abc123');
  });
});

function spec(id: string, dependencies: string[]): AgentWorkerSpec {
  return {
    id,
    title: id,
    role: 'researcher',
    objective: `Objective ${id}`,
    input: 'Input',
    deliverables: ['Findings'],
    dependencies,
    allowedTools: ['note:read', 'search:content'],
  };
}
