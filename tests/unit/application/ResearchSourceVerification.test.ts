import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { AIAssistedResearchSourceAdapter } from '$lib/adapters/agent/AIAssistedResearchSourceAdapter';
import { MemoryWebFetchAdapter } from '$lib/adapters/memory/MemoryWebFetchAdapter';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { AIResponse } from '$lib/domain/values/AIResponse';

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

describe('research source verification', () => {
  it('accepts fetched sources and excludes failed fetches by default', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'openai',
      isAvailable: vi.fn(async () => true),
      configure: vi.fn(),
      prompt: vi.fn(async () => ok(response(JSON.stringify([
        { title: 'Good source', url: 'https://example.com/good', excerpt: 'Candidate' },
        { title: 'Bad source', url: 'https://example.com/bad', excerpt: 'Candidate' },
      ])))),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: (text: string) => text.length,
      getMaxContextSize: () => 128_000,
      getAvailableModels: vi.fn(async () => []),
      getRateLimitStatus: vi.fn(async () => null),
    } as unknown as AIAssistantProviderPort;
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
    } as unknown as ContextProviderPort;
    const fetch = new MemoryWebFetchAdapter(new Map([
      ['https://example.com/good', {
        ok: true,
        status: 200,
        title: 'Fetched good source',
        excerpt: 'Verified excerpt',
      }],
      ['https://example.com/bad', {
        ok: false,
        status: 500,
        error: 'HTTP 500',
      }],
    ]));

    const adapter = new AIAssistedResearchSourceAdapter(provider, contextProvider, fetch);
    const sources = await adapter.search('research AI', { limit: 5 });

    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    expect(sources.value).toHaveLength(1);
    expect(sources.value[0]).toMatchObject({
      title: 'Fetched good source',
      url: 'https://example.com/good',
      status: 'verified',
      excerpt: 'Verified excerpt',
    });
    expect(provider.prompt).toHaveBeenCalledWith(expect.objectContaining({
      webAccess: 'native',
    }));
  });

  it('returns an empty source set when native web search is unavailable', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'openai',
      isAvailable: vi.fn(async () => true),
      configure: vi.fn(),
      prompt: vi.fn(async () => ({
        ok: false,
        error: new Error("unexpected argument '--search' found"),
      })),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: (text: string) => text.length,
      getMaxContextSize: () => 128_000,
      getAvailableModels: vi.fn(async () => []),
      getRateLimitStatus: vi.fn(async () => null),
    } as unknown as AIAssistantProviderPort;
    const contextProvider: ContextProviderPort = {
      getContext: vi.fn(async () => createEmptyContext()),
    } as unknown as ContextProviderPort;

    const adapter = new AIAssistedResearchSourceAdapter(
      provider,
      contextProvider,
      new MemoryWebFetchAdapter()
    );
    const sources = await adapter.search('latest AI research');

    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    expect(sources.value).toEqual([]);
  });
});
