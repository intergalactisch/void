import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '$lib/core';
import { PhaseNarrator, type PhaseNarrationMap } from '$lib/application/services/PhaseNarrator';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { AIAssistantProviderPort, ContextProviderPort } from '$lib/ports/outbound';

function aiResponse(chat: string): AIResponse {
  return {
    chat,
    toolCalls: [],
    meta: { provider: 'test', model: 'test-model', latencyMs: 1 },
    truncated: false,
    stopReason: 'end_turn',
  };
}

function buildContextProvider(): ContextProviderPort {
  return { getContext: vi.fn(async () => createEmptyContext()) };
}

function fallbackMap(): PhaseNarrationMap {
  return new Map([
    ['outline', { title: 'Outline research aspects', detail: 'Outlining' }],
    ['discover', { title: 'Discover citeable sources', detail: 'Discovering' }],
    ['ingest', { title: 'Read sources and extract claims', detail: 'Reading' }],
    ['synthesize', { title: 'Write aspect notes', detail: 'Writing' }],
    ['overview', { title: 'Write overview note', detail: 'Synthesising' }],
    ['sources', { title: 'Write sources note', detail: 'Writing Sources' }],
  ]);
}

describe('PhaseNarrator', () => {
  it('passes locale and prompt into the provider call', async () => {
    const promptMock = vi.fn(async () => ok(aiResponse(JSON.stringify({
      items: [
        { phaseId: 'outline', title: 'Hoofdaspecten in kaart brengen', detail: '4 facetten van het onderwerp uitlichten' },
      ],
    }))));
    const provider = {
      getProviderType: () => 'openai',
      isAvailable: async () => true,
      configure: async () => {},
      prompt: promptMock,
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: () => 0,
      getMaxContextSize: () => 100_000,
      getAvailableModels: async () => [],
      getRateLimitStatus: async () => null,
    } as unknown as AIAssistantProviderPort;

    const narrator = new PhaseNarrator(provider, buildContextProvider());
    const result = await narrator.narrateOpenings({
      topic: 'Harry Potter',
      prompt: 'Doe uitgebreid onderzoek naar Harry Potter',
      locale: 'nl',
      fallback: fallbackMap(),
    });

    expect(promptMock).toHaveBeenCalledTimes(1);
    const sentMessage = (promptMock.mock.calls[0]![0] as { message: string }).message;
    expect(sentMessage).toContain('"nl"');
    expect(sentMessage).toContain('Doe uitgebreid onderzoek naar Harry Potter');
    expect(result.get('outline')?.title).toBe('Hoofdaspecten in kaart brengen');
  });

  it('falls back when the provider returns malformed JSON', async () => {
    const provider = {
      getProviderType: () => 'openai',
      isAvailable: async () => true,
      configure: async () => {},
      prompt: vi.fn(async () => ok(aiResponse('not json at all'))),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: () => 0,
      getMaxContextSize: () => 100_000,
      getAvailableModels: async () => [],
      getRateLimitStatus: async () => null,
    } as unknown as AIAssistantProviderPort;

    const narrator = new PhaseNarrator(provider, buildContextProvider());
    const fallback = fallbackMap();
    const result = await narrator.narrateOpenings({
      topic: 'X',
      prompt: 'p',
      locale: 'en',
      fallback,
    });

    expect(result.get('outline')).toEqual(fallback.get('outline'));
  });

  it('falls back when the provider returns err', async () => {
    const provider = {
      getProviderType: () => 'openai',
      isAvailable: async () => true,
      configure: async () => {},
      prompt: vi.fn(async () => err(new Error('network down'))),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: () => 0,
      getMaxContextSize: () => 100_000,
      getAvailableModels: async () => [],
      getRateLimitStatus: async () => null,
    } as unknown as AIAssistantProviderPort;

    const narrator = new PhaseNarrator(provider, buildContextProvider());
    const fallback = fallbackMap();
    const result = await narrator.narrateOpenings({ topic: 'X', prompt: 'p', locale: 'en', fallback });
    expect(result.get('synthesize')).toEqual(fallback.get('synthesize'));
  });

  it('returns the fallback synchronously when the signal is pre-aborted', async () => {
    const promptMock = vi.fn();
    const provider = {
      getProviderType: () => 'openai',
      isAvailable: async () => true,
      configure: async () => {},
      prompt: promptMock,
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: () => 0,
      getMaxContextSize: () => 100_000,
      getAvailableModels: async () => [],
      getRateLimitStatus: async () => null,
    } as unknown as AIAssistantProviderPort;

    const narrator = new PhaseNarrator(provider, buildContextProvider());
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await narrator.narrateOpenings({
      topic: 'X',
      prompt: 'p',
      locale: 'en',
      fallback: fallbackMap(),
      signal: ctrl.signal,
    });

    expect(promptMock).not.toHaveBeenCalled();
    expect(result.size).toBe(6);
  });

  it('replaces detail with fallback when narrated detail equals the title', async () => {
    const provider = {
      getProviderType: () => 'openai',
      isAvailable: async () => true,
      configure: async () => {},
      prompt: vi.fn(async () => ok(aiResponse(JSON.stringify({
        items: [
          { phaseId: 'outline', title: 'Outline aspects', detail: 'OUTLINE ASPECTS' },
        ],
      })))),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: () => 0,
      getMaxContextSize: () => 100_000,
      getAvailableModels: async () => [],
      getRateLimitStatus: async () => null,
    } as unknown as AIAssistantProviderPort;

    const narrator = new PhaseNarrator(provider, buildContextProvider());
    const fallback = fallbackMap();
    const result = await narrator.narrateOpenings({ topic: 'X', prompt: 'p', locale: 'en', fallback });
    const outline = result.get('outline');
    expect(outline?.title).toBe('Outline aspects');
    expect(outline?.detail).toBe(fallback.get('outline')!.detail);
  });
});
