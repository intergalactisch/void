import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { AIAssistedMediaSourceAdapter } from '$lib/adapters/agent/AIAssistedMediaSourceAdapter';
import { MemoryMediaSourceAdapter } from '$lib/adapters/memory/MemoryMediaSourceAdapter';
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

describe('media source search', () => {
  it('normalizes provider media leads and infers media kind from URL', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'openai',
      isAvailable: vi.fn(async () => true),
      configure: vi.fn(),
      prompt: vi.fn(async () => ok(response(JSON.stringify([
        {
          title: 'Agent video',
          url: 'https://www.youtube.com/watch?v=abc123',
          summary: 'Demo video',
          confidence: 0.9,
        },
        {
          title: 'Workflow image',
          url: 'https://example.com/workflow.png',
          mediaKind: 'image',
          thumbnailUrl: 'https://example.com/thumb.png',
        },
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

    const adapter = new AIAssistedMediaSourceAdapter(provider, contextProvider);
    const result = await adapter.search('agent note apps', { limit: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      expect.objectContaining({
        title: 'Agent video',
        mediaKind: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc123',
        summary: 'Demo video',
        confidence: 0.9,
      }),
      expect.objectContaining({
        title: 'Workflow image',
        mediaKind: 'image',
        thumbnailUrl: 'https://example.com/thumb.png',
      }),
    ]);
    expect(provider.prompt).toHaveBeenCalledWith(expect.objectContaining({
      webAccess: 'native',
    }));
  });

  it('filters memory media leads by requested kind and limit', async () => {
    const adapter = new MemoryMediaSourceAdapter([
      { title: 'Video', url: 'https://youtu.be/abc', mediaKind: 'youtube' },
      { title: 'Article', url: 'https://example.com/post', mediaKind: 'article' },
      { title: 'Image', url: 'https://example.com/image.png', mediaKind: 'image' },
    ]);

    const result = await adapter.search('topic', { kinds: ['image', 'article'], limit: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { title: 'Article', url: 'https://example.com/post', mediaKind: 'article' },
    ]);
  });
});
