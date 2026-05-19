import { describe, expect, it, vi } from 'vitest';
import commitmentStaleCheck from '$lib/tools/commitment/stale-check.tool';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

describe('commitment:stale-check', () => {
  it('returns stale and orphaned commitment source issues', async () => {
    const checkStaleSources = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { status: 'current', reasons: [], sourceVersionIds: [], currentVersionId: 'lv_1', todo: { id: 'a' } },
        { status: 'stale', reasons: ['changed'], sourceVersionIds: ['lv_1'], currentVersionId: 'lv_2', todo: { id: 'b' } },
        { status: 'orphaned', reasons: ['deleted'], sourceVersionIds: ['lv_3'], currentVersionId: 'lv_4', todo: { id: 'c' } },
      ],
    });
    const services = {
      commitmentLineage: { checkStaleSources },
      settings: {
        load: vi.fn().mockResolvedValue({ ok: false, error: new Error('no settings in test') }),
      },
    } as unknown as ToolServices;

    const result = await commitmentStaleCheck.handler(
      { noteId: 'launch.md' },
      createContext(services),
    ) as { checked: number; stale: number; orphaned: number; items: unknown[] };

    expect(checkStaleSources).toHaveBeenCalledWith('launch.md');
    expect(result.checked).toBe(3);
    expect(result.stale).toBe(1);
    expect(result.orphaned).toBe(1);
    expect(result.items).toHaveLength(2);
  });
});

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-stale-check' } as ToolInvocation,
  } as ToolExecutionContext;
}
