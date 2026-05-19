import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import searchMedia from '$lib/tools/search/media.tool';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';

describe('search:media', () => {
  it('returns media leads from the media source port', async () => {
    const search = vi.fn(async () => ok([
      {
        title: 'Agent demo',
        url: 'https://www.youtube.com/watch?v=abc123',
        mediaKind: 'youtube' as const,
        summary: 'Useful demo video.',
        confidence: 0.82,
      },
    ]));
    const services = {
      mediaSources: { search },
    } as unknown as ToolServices;

    const context = createContext(services);
    const result = await searchMedia.handler(
      { query: 'local-first AI notes', kinds: ['youtube', 'image'], limit: 3 },
      context,
    );

    expect(search).toHaveBeenCalledWith('local-first AI notes', {
      limit: 3,
      kinds: ['youtube', 'image'],
      signal: context.signal,
    });
    expect(result).toEqual({
      query: 'local-first AI notes',
      total: 1,
      results: [
        expect.objectContaining({
          title: 'Agent demo',
          mediaKind: 'youtube',
          url: 'https://www.youtube.com/watch?v=abc123',
        }),
      ],
    });
  });

  it('rejects empty queries', async () => {
    const services = {
      mediaSources: { search: vi.fn() },
    } as unknown as ToolServices;

    await expect(searchMedia.handler({ query: '   ' }, createContext(services)))
      .rejects.toThrow('Media search query cannot be empty');
  });
});

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-media-search' } as ToolInvocation,
  } as ToolExecutionContext;
}
