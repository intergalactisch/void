import { describe, expect, it, vi } from 'vitest';
import replaceTool from '$lib/tools/editor/replace.tool';
import { ok } from '$lib/core';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { Selection } from '$lib/domain/values/Selection';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';

describe('editor:replace tool', () => {
  it('replaces the full active selection by range', async () => {
    const replaceRange = vi.fn(async () => ok(undefined));
    const context = createContext(
      { from: 2, to: 7, text: 'hello', anchorBlockId: 'p1', headBlockId: 'p1' },
      replaceRange
    );

    const result = await replaceTool.handler({ text: 'hi' }, context);

    expect(result).toEqual({ success: true, from: 2, to: 7 });
    expect(replaceRange).toHaveBeenCalledWith(expect.objectContaining({
      from: 2,
      to: 7,
      markdown: 'hi',
    }));
  });

  it('replaces a specific substring occurrence inside the active selection', async () => {
    const replaceRange = vi.fn(async () => ok(undefined));
    const context = createContext(
      { from: 10, to: 29, text: 'alpha beta alpha', anchorBlockId: 'p1', headBlockId: 'p1' },
      replaceRange
    );

    const result = await replaceTool.handler(
      { text: 'gamma', targetText: 'alpha', occurrence: 2 },
      context
    );

    expect(result).toEqual({ success: true, from: 21, to: 26 });
    expect(replaceRange).toHaveBeenCalledWith(expect.objectContaining({
      from: 21,
      to: 26,
      markdown: 'gamma',
    }));
  });

  it('fails duplicate substring replacement without occurrence', async () => {
    const replaceRange = vi.fn(async () => ok(undefined));
    const context = createContext(
      { from: 1, to: 12, text: 'one two one', anchorBlockId: 'p1', headBlockId: 'p1' },
      replaceRange
    );

    await expect(
      replaceTool.handler({ text: 'three', targetText: 'one' }, context)
    ).rejects.toThrow('targetText matched multiple times');
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('fails when there is no active selection or explicit range', async () => {
    const replaceRange = vi.fn(async () => ok(undefined));
    const context = createContext(
      { from: 5, to: 5, text: '', anchorBlockId: null, headBlockId: null },
      replaceRange
    );

    await expect(replaceTool.handler({ text: 'hello' }, context)).rejects.toThrow(
      'No active selection or valid explicit range'
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });
});

function createContext(
  selection: Selection,
  replaceRange: ReturnType<typeof vi.fn>
): ToolExecutionContext {
  const invocation = createInvocation({
    toolId: 'editor:replace' as ToolId,
    args: {},
    confirmed: true,
  });
  const services = {
    editor: {
      getState: () => ({ selection }),
    },
    collaboration: {
      replaceRange,
    },
  } as unknown as ToolServices;

  return {
    invocation,
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
  };
}
