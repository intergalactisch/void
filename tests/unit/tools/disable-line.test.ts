import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import disableLine from '$lib/tools/editor/disable-line.tool';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

describe('editor:disable-line', () => {
  it('writes through collaboration so active editor content is protected', async () => {
    const applyNoteContent = vi.fn().mockResolvedValue(ok(undefined));
    const writeContent = vi.fn();
    const services = {
      notes: { getSelectedPath: () => 'active.md' },
      documents: {
        readContent: vi.fn().mockResolvedValue(ok('Keep this\nDisable this')),
        writeContent,
      },
      collaboration: { applyNoteContent },
    } as unknown as ToolServices;

    const result = await disableLine.handler({ line: 2, reason: 'stale' }, createContext(services));

    expect(result).toEqual({
      success: true,
      noteId: 'active.md',
      line: 2,
      disabledText: '<!-- void-disabled: reason="stale" Disable this -->',
    });
    expect(applyNoteContent).toHaveBeenCalledWith(
      'active.md',
      'Keep this\n<!-- void-disabled: reason="stale" Disable this -->',
      'AI disable line'
    );
    expect(writeContent).not.toHaveBeenCalled();
  });
});

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-disable-line' } as ToolInvocation,
  } as ToolExecutionContext;
}
