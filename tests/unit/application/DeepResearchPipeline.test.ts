import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import {
  AgentRunEngine,
  DeepResearchEvidence,
  DeepResearchPipeline,
  PhaseNarrator,
} from '$lib/application/services';
import { MemoryAgentRunStorageAdapter } from '$lib/adapters/memory/MemoryAgentRunStorageAdapter';
import { createAgentRun } from '$lib/domain/entities/AgentRun';
import type { AgentRun } from '$lib/domain/entities/AgentRun';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type {
  AIAssistantProviderPort,
  ContextProviderPort,
  ResearchSourcePort,
  WebFetchPort,
} from '$lib/ports/outbound';
import type { DocumentService, NoteCollaborationService } from '$lib/ports/inbound';

function aiResponse(chat: string): AIResponse {
  return {
    chat,
    toolCalls: [],
    meta: { provider: 'test', model: 'test-model', latencyMs: 1 },
    truncated: false,
    stopReason: 'end_turn',
  };
}

function buildProvider(): AIAssistantProviderPort {
  return {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: vi.fn(async (request) => {
      const message = request.message;
      if (message.includes('Decompose this research request')) {
        return ok(aiResponse(JSON.stringify({
          aspects: [
            { slug: 'origins', title: 'Origins and Definition', questions: ['Where did this come from?', 'What is the definition?'] },
            { slug: 'themes', title: 'Themes and Scope', questions: ['What themes does it cover?'] },
          ],
        })));
      }
      if (message.includes('Read this source about')) {
        return ok(aiResponse(JSON.stringify({
          title: 'Example Wikipedia page',
          claims: [
            'The topic was first formalised in 1995 by Alice Researcher in a paper titled Foundations.',
            'The most common application is in industrial automation, where it reduces error rates by 40 percent.',
          ],
          quotes: ['The topic remains the standard reference work in its field.'],
        })));
      }
      if (message.includes('Write the aspect note')) {
        return ok(aiResponse(JSON.stringify({
          title: 'Aspect note',
          content: '# Aspect Title\n\nThe topic was formalised in 1995 by Alice Researcher [1]. It is widely used in industrial automation where it reduces error rates by roughly 40 percent [1].\n\nThe theoretical foundation rests on three interconnected principles that together define the field. Practitioners apply these principles to a broad range of real-world problems, from production lines to financial systems.\n\nWhile critics have argued that the methodology is too rigid, defenders point to its measurable impact in domains where small improvements compound rapidly. The disagreement is unresolved in the literature.\n\nCurrent practice combines the original framework with modern tooling, producing systems that are both rigorous and ergonomic.',
          summary: 'Aspect note written from one verified source.',
          citationIndexes: [1],
        })));
      }
      if (message.includes('Write the overview note')) {
        return ok(aiResponse(JSON.stringify({
          title: 'Overview',
          content: '# Overview\n\nThis topic combines theoretical rigour with practical application [[Origins and Definition]]. The themes have evolved over three decades and now span multiple industries [[Themes and Scope]].\n\nReaders new to this subject should begin with the origins note before exploring the themes, which build on the foundational ideas in concrete domains.',
          summary: 'Overview synthesis.',
        })));
      }
      return ok(aiResponse('{}'));
    }),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: () => 0,
    getMaxContextSize: () => 100_000,
    getAvailableModels: async () => ['test-model'],
    getRateLimitStatus: async () => null,
  };
}

function buildContextProvider(): ContextProviderPort {
  return {
    getContext: vi.fn(async () => createEmptyContext()),
  };
}

function buildResearchSources(): ResearchSourcePort {
  return {
    search: vi.fn(async (_query) => ok([
      {
        title: 'Example source A',
        url: 'https://example.com/a',
        fetchedAt: new Date().toISOString(),
        sourceType: 'web' as const,
        status: 'unverified' as const,
      },
    ])),
  };
}

function buildWebFetch(): WebFetchPort {
  return {
    fetch: vi.fn(async (url) => ok({
      url,
      finalUrl: url,
      ok: true,
      status: 200,
      title: 'Fetched page',
      excerpt: 'A short excerpt from the page.',
      fetchedAt: new Date().toISOString(),
    })),
  };
}

function buildCollaboration(): NoteCollaborationService & { calls: Array<{ folder: string; title: string; content: string }> } {
  const calls: Array<{ folder: string; title: string; content: string }> = [];
  return {
    calls,
    createNote: vi.fn(async (params) => {
      calls.push({ folder: params.folder ?? '', title: params.title ?? '', content: params.content ?? '' });
      return ok({ path: `${params.folder}/${params.title}.md`, title: params.title ?? '' });
    }),
    updateNote: vi.fn(async () => ok(undefined)),
    applyNoteContent: vi.fn(async () => ok(undefined)),
    appendNoteContent: vi.fn(async () => ok(undefined)),
    replaceBlock: vi.fn(async () => ok(undefined)),
    insertBlocksAfter: vi.fn(async () => ok(undefined)),
    deleteBlock: vi.fn(async () => ok(undefined)),
    insertAtCursor: vi.fn(async () => ok(undefined)),
    isActiveNote: () => false,
    getActiveBlocks: () => [],
  } as unknown as NoteCollaborationService & { calls: Array<{ folder: string; title: string; content: string }> };
}

function buildDocumentService(): DocumentService {
  return {
    readContent: vi.fn(async () => ok('# Aspect Note\n\nSubstantive subject prose paragraph.')),
  } as unknown as DocumentService;
}

describe('DeepResearchPipeline', () => {
  it('produces aspect notes, an overview, and a sources note with no methodology language', async () => {
    const provider = buildProvider();
    const contextProvider = buildContextProvider();
    const researchSources = buildResearchSources();
    const webFetch = buildWebFetch();
    const collaboration = buildCollaboration();
    const documents = buildDocumentService();
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    const evidence = new DeepResearchEvidence(provider, contextProvider, webFetch);
    const narrator = new PhaseNarrator(provider, contextProvider);
    const pipeline = new DeepResearchPipeline(engine, provider, contextProvider, researchSources, evidence, collaboration, documents, narrator);

    const run = createAgentRun({ prompt: 'Research topic X', webAccess: 'native', orchestrationMode: 'swarm', approvalRequired: false });
    await storage.save(run);
    let current = run;
    const mutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      current = await mutator(current);
      return current;
    };

    const result = await pipeline.run({
      run: current,
      prompt: 'Research topic X',
      targetFolder: 'Research/existing-topic-folder',
      webAccess: 'native',
      mutateRun,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.createdNotePaths.length).toBeGreaterThanOrEqual(3);
    const titles = collaboration.calls.map((call) => call.title);
    expect(titles.some((title) => /Origins and Definition/.test(title))).toBe(true);
    expect(titles.some((title) => /Themes and Scope/.test(title))).toBe(true);
    expect(titles.some((title) => /Overview/.test(title))).toBe(true);
    expect(titles.some((title) => /Sources/.test(title))).toBe(true);
    expect(new Set(collaboration.calls.map((call) => call.folder))).toEqual(new Set(['Research/existing-topic-folder']));

    for (const call of collaboration.calls) {
      expect(call.content).not.toMatch(/\b(?:I|We) (?:searched|found|investigated|gathered|looked)\b/);
      expect(call.content).not.toMatch(/research (?:process|methodology|approach)/i);
      expect(call.content).not.toMatch(/as the \w+ worker/i);
    }

    const aspectNote = collaboration.calls.find((call) => /Origins and Definition/.test(call.title));
    expect(aspectNote?.content).toMatch(/\[\d+\]/);
    expect(aspectNote?.content.split(/\n{2,}/).length).toBeGreaterThanOrEqual(3);

    const promptTrace = result.value.run.workerMessages.find((message) => message.type === 'worker.prompt');
    const responseTrace = result.value.run.workerMessages.find((message) => message.type === 'worker.response');
    expect(promptTrace?.workerId).toBeTruthy();
    expect(promptTrace?.data?.request).toEqual(expect.objectContaining({
      message: expect.stringContaining('Write the aspect note'),
      systemPrompt: expect.stringContaining('Void deep research synthesizer'),
    }));
    expect(responseTrace?.data?.response).toEqual(expect.objectContaining({
      chat: expect.stringContaining('Aspect note written from one verified source'),
      stopReason: 'end_turn',
    }));
  });

  it('writes transparent stubs when web access is off', async () => {
    const provider = buildProvider();
    const contextProvider = buildContextProvider();
    const researchSources = buildResearchSources();
    const webFetch = buildWebFetch();
    const collaboration = buildCollaboration();
    const documents = buildDocumentService();
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    const evidence = new DeepResearchEvidence(provider, contextProvider, webFetch);
    const narrator = new PhaseNarrator(provider, contextProvider);
    const pipeline = new DeepResearchPipeline(engine, provider, contextProvider, researchSources, evidence, collaboration, documents, narrator);

    const run = createAgentRun({ prompt: 'Research topic Y', webAccess: 'off', orchestrationMode: 'swarm', approvalRequired: false });
    await storage.save(run);
    let current = run;
    const mutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      current = await mutator(current);
      return current;
    };

    const result = await pipeline.run({ run: current, prompt: 'Research topic Y', webAccess: 'off', mutateRun });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Discovery is skipped, but synthesis still runs and writes notes.
    expect(result.value.createdNotePaths.length).toBeGreaterThan(0);

    // Sources note acknowledges offline mode
    const sourcesNote = collaboration.calls.find((call) => /Sources/.test(call.title));
    expect(sourcesNote?.content).toMatch(/Web access was off/);

    // Aspect note prepended with offline banner
    const aspectNote = collaboration.calls.find((call) => /Origins and Definition/.test(call.title));
    expect(aspectNote?.content).toMatch(/written without web access/);
  });

  it('marks phase:outline failed when the outline LLM call errors', async () => {
    const provider = buildProvider();
    (provider.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (request: { message: string }) => {
      if (request.message.includes('Decompose this research request')) {
        throw new Error('outline LLM blew up');
      }
      return ok(aiResponse('{}'));
    });
    const contextProvider = buildContextProvider();
    const researchSources = buildResearchSources();
    const webFetch = buildWebFetch();
    const collaboration = buildCollaboration();
    const documents = buildDocumentService();
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    const evidence = new DeepResearchEvidence(provider, contextProvider, webFetch);
    const narrator = new PhaseNarrator(provider, contextProvider);
    const pipeline = new DeepResearchPipeline(engine, provider, contextProvider, researchSources, evidence, collaboration, documents, narrator);

    const run = createAgentRun({ prompt: 'Research topic Z', webAccess: 'native', orchestrationMode: 'swarm', approvalRequired: false });
    await storage.save(run);
    let current = run;
    const mutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      current = await mutator(current);
      return current;
    };

    const result = await pipeline.run({ run: current, prompt: 'Research topic Z', webAccess: 'native', mutateRun });

    expect(result.ok).toBe(false);
    const outlineTask = current.tasks.find((t) => t.id === 'phase:outline');
    expect(outlineTask?.status).toBe('failed');
    expect(outlineTask?.error).toContain('outline LLM blew up');
    const stillRunning = current.tasks.filter((t) => t.status === 'running');
    expect(stillRunning).toHaveLength(0);
  });

  it('marks one aspect failed without blocking siblings when synthesis throws for it', async () => {
    const provider = buildProvider();
    (provider.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (request: { message: string }) => {
      if (request.message.includes('Decompose this research request')) {
        return ok(aiResponse(JSON.stringify({
          aspects: [
            { slug: 'origins', title: 'Origins and Definition', questions: ['?'] },
            { slug: 'themes', title: 'Themes and Scope', questions: ['?'] },
          ],
        })));
      }
      if (request.message.includes('Read this source about')) {
        return ok(aiResponse(JSON.stringify({ title: 'src', claims: ['claim'], quotes: [] })));
      }
      if (/^Write the aspect note "[^"]*Themes and Scope"/.test(request.message)) {
        throw new Error('themes synthesis exploded');
      }
      if (request.message.includes('Write the aspect note')) {
        return ok(aiResponse(JSON.stringify({
          title: 'Aspect',
          content: '# Origins and Definition\n\nA fact [1].\n\nAnother paragraph.\n\nA third paragraph.',
          summary: 'ok',
          citationIndexes: [1],
        })));
      }
      if (request.message.includes('Write the overview note')) {
        return ok(aiResponse(JSON.stringify({
          title: 'Overview', content: '# Overview\n\n[[Origins and Definition]] body.', summary: 'ok',
        })));
      }
      return ok(aiResponse('{}'));
    });
    const contextProvider = buildContextProvider();
    const researchSources = buildResearchSources();
    const webFetch = buildWebFetch();
    const collaboration = buildCollaboration();
    const documents = buildDocumentService();
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    const evidence = new DeepResearchEvidence(provider, contextProvider, webFetch);
    const narrator = new PhaseNarrator(provider, contextProvider);
    const pipeline = new DeepResearchPipeline(engine, provider, contextProvider, researchSources, evidence, collaboration, documents, narrator);

    const run = createAgentRun({ prompt: 'Research mixed', webAccess: 'native', orchestrationMode: 'swarm', approvalRequired: false });
    await storage.save(run);
    let current = run;
    const mutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      current = await mutator(current);
      return current;
    };

    let mutationQueue: Promise<void> = Promise.resolve();
    const serializedMutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      const next = mutationQueue.then(async () => {
        current = await mutator(current);
        return current;
      });
      mutationQueue = next.then(() => undefined, () => undefined);
      return next;
    };
    void mutateRun;
    await pipeline.run({ run: current, prompt: 'Research mixed', webAccess: 'native', mutateRun: serializedMutateRun });

    const themesAspect = current.deepResearch?.aspects.find((a) => a.slug === 'themes');
    const originsAspect = current.deepResearch?.aspects.find((a) => a.slug === 'origins');
    const themesTask = current.tasks.find((t) => t.id === `aspect:${themesAspect?.id}:synthesize`);
    const originsTask = current.tasks.find((t) => t.id === `aspect:${originsAspect?.id}:synthesize`);
    expect(themesTask?.status).toBe('failed');
    expect(originsTask?.status).toBe('completed');
  });

  it('marks the outline phase failed when the watchdog timeout fires', async () => {
    const provider = buildProvider();
    (provider.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (request: { message: string }) => {
      if (request.message.includes('Decompose this research request')) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return ok(aiResponse('{}'));
      }
      return ok(aiResponse('{}'));
    });
    const contextProvider = buildContextProvider();
    const researchSources = buildResearchSources();
    const webFetch = buildWebFetch();
    const collaboration = buildCollaboration();
    const documents = buildDocumentService();
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    const evidence = new DeepResearchEvidence(provider, contextProvider, webFetch);
    const narrator = new PhaseNarrator(provider, contextProvider);
    const pipeline = new DeepResearchPipeline(
      engine, provider, contextProvider, researchSources, evidence, collaboration, documents, narrator,
      { timeouts: { outline: 50, discover: 1000, ingest: 1000, synthesize: 1000, overview: 1000, sources: 1000 } }
    );

    const run = createAgentRun({ prompt: 'Research slow', webAccess: 'native', orchestrationMode: 'swarm', approvalRequired: false });
    await storage.save(run);
    let current = run;
    const mutateRun = async (mutator: (cur: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
      current = await mutator(current);
      return current;
    };

    const t0 = Date.now();
    const result = await pipeline.run({ run: current, prompt: 'Research slow', webAccess: 'native', mutateRun });
    const elapsed = Date.now() - t0;

    expect(result.ok).toBe(false);
    expect(elapsed).toBeLessThan(450);
    const outlineTask = current.tasks.find((t) => t.id === 'phase:outline');
    expect(outlineTask?.status).toBe('failed');
    expect(outlineTask?.error).toMatch(/timed out/);
  });
});
