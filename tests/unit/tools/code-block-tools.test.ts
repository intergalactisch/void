import { describe, expect, it, vi } from 'vitest';
import insertCodeBlockTool from '$lib/tools/editor/insert-code-block.tool';
import updateCodeBlockTool from '$lib/tools/editor/update-code-block.tool';
import { ok } from '$lib/core';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import type { Block } from '$lib/domain/entities/Block';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { Selection } from '$lib/domain/values/Selection';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';

describe('editor code block tools', () => {
  it('inserts safe fenced markdown after a block', async () => {
    const insertBlocksAfter = vi.fn(async () => ok(undefined));
    const context = createContext('editor:insert-code-block', {
      collaboration: {
        insertBlocksAfter,
      },
    });

    const result = await insertCodeBlockTool.handler({
      afterBlockId: 'void://block/demo.md#para-1',
      code: 'Before\n```ts\nconst x = 1\n```\nAfter',
      language: 'md',
      title: 'example.md',
    }, context);

    expect(result).toEqual({ success: true, blockId: 'para-1' });
    expect(insertBlocksAfter).toHaveBeenCalledWith(expect.objectContaining({
      blockId: 'para-1',
      markdown: expect.stringMatching(/^````md title="example\.md"\n/),
    }));
  });

  it('replaces the active selection when requested', async () => {
    const replaceRange = vi.fn(async () => ok(undefined));
    const context = createContext('editor:insert-code-block', {
      selection: { from: 4, to: 12, text: 'snippet', anchorBlockId: 'p1', headBlockId: 'p1' },
      collaboration: {
        replaceRange,
      },
    });

    await insertCodeBlockTool.handler({
      code: 'console.log("hi")',
      language: 'js',
      replaceSelection: true,
    }, context);

    expect(replaceRange).toHaveBeenCalledWith(expect.objectContaining({
      from: 4,
      to: 12,
      markdown: '```js\nconsole.log("hi")\n```',
    }));
  });

  it('updates an existing code block while preserving unspecified attrs', async () => {
    const replaceBlock = vi.fn(async () => ok(undefined));
    const current: Block = {
      id: 'code-1',
      type: 'codeBlock',
      content: 'const oldName = 1;',
      marks: [],
      children: [],
      attrs: {
        type: 'codeBlock',
        language: 'ts',
        meta: 'title="old.ts" wrap',
      },
    };
    const context = createContext('editor:update-code-block', {
      collaboration: {
        getActiveBlocks: () => [current],
        replaceBlock,
      },
    });

    const result = await updateCodeBlockTool.handler({
      blockId: 'code-1',
      code: 'const newName = 1;',
      lineNumbers: true,
      highlightLines: '1',
    }, context);

    expect(result).toEqual({ success: true, blockId: 'code-1' });
    expect(replaceBlock).toHaveBeenCalledWith(expect.objectContaining({
      blockId: 'code-1',
      markdown: '```ts title="old.ts" wrap lineNumbers {1}\nconst newName = 1;\n```',
    }));
  });
});

function createContext(
  toolId: string,
  options: {
    selection?: Selection;
    collaboration?: Record<string, unknown>;
  }
): ToolExecutionContext {
  const selection = options.selection ?? {
    from: 0,
    to: 0,
    text: '',
    anchorBlockId: null,
    headBlockId: null,
  };
  const invocation = createInvocation({
    toolId: toolId as ToolId,
    args: {},
    confirmed: true,
  });
  const services = {
    editor: {
      getState: () => ({ selection }),
    },
    collaboration: {
      insertBlocksAfter: vi.fn(async () => ok(undefined)),
      insertAtCursor: vi.fn(async () => ok(undefined)),
      replaceRange: vi.fn(async () => ok(undefined)),
      replaceBlock: vi.fn(async () => ok(undefined)),
      getActiveBlocks: () => [],
      ...options.collaboration,
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
