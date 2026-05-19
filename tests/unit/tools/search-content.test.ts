import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import searchContent from '$lib/tools/search/content.tool';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';

describe('search:content', () => {
  it('reads markdown bodies and returns line-level matches with context', async () => {
    const services = {
      notes: {
        getState: () => ({
          items: [
            {
              path: 'projects/launch.md',
              title: 'Launch Plan',
              isFolder: false,
              modifiedAt: new Date(),
              tags: [],
            },
          ],
        }),
      },
      documents: {
        readContent: vi.fn().mockResolvedValue(ok('Intro\nDeadline is Friday\nOwner: Sara')),
      },
    } as unknown as ToolServices;

    const context = {
      services,
      reportProgress: vi.fn(),
      isCancelled: () => false,
      signal: new AbortController().signal,
      invocation: { id: 'inv-search' } as ToolInvocation,
    } as ToolExecutionContext;

    const result = await searchContent.handler({ query: 'deadline' }, context);

    expect(result).toEqual({
      results: [
        {
          noteId: 'projects/launch.md',
          title: 'Launch Plan',
          path: 'projects/launch.md',
          matches: [
            {
              line: 2,
              text: 'Deadline is Friday',
              context: 'Intro\nDeadline is Friday\nOwner: Sara',
            },
          ],
        },
      ],
      totalMatches: 1,
    });
  });
});
