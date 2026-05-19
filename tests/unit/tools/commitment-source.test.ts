import { describe, expect, it, vi } from 'vitest';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { MemoryLineageStorageAdapter } from '$lib/adapters/memory';
import commitmentSource from '$lib/tools/commitment/source.tool';
import type { Todo } from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

describe('commitment:source', () => {
  it('explains the lineage source of a todo line', async () => {
    const lineage = new LineageServiceImpl(new MemoryLineageStorageAdapter());
    const recorded = await lineage.recordMarkdownChange('launch.md', '- [ ] Ask Maya for rollout numbers', {
      actor: { kind: 'ai-agent', model: 'codex' },
      intentKind: 'commitment-create',
      summary: 'Extract rollout follow-up',
    });
    expect(recorded.ok).toBe(true);

    const todo = {
      id: 'launch.md:0' as TodoId,
      content: 'Ask Maya for rollout numbers',
      isCompleted: false,
      source: 'inline',
      sourceFile: 'launch.md',
      lineNumber: 0,
      indent: 0,
      dates: {},
      tags: [],
      rawLine: '- [ ] Ask Maya for rollout numbers',
    } as Todo;
    const services = {
      todos: { getById: vi.fn().mockResolvedValue({ ok: true, value: todo }) },
      lineage,
      commitmentLineage: {
        getSourceForTodo: vi.fn().mockResolvedValue({
          ok: true,
          value: { status: 'unknown', reasons: ['No source'], sourceVersions: [] },
        }),
      },
    } as unknown as ToolServices;

    const result = await commitmentSource.handler(
      { todoId: todo.id },
      createContext(services),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      todoId: todo.id,
      todoContent: 'Ask Maya for rollout numbers',
      noteId: 'launch.md',
      line: 1,
      content: '- [ ] Ask Maya for rollout numbers',
      actor: 'AI agent (codex)',
      intent: 'Extract rollout follow-up',
      sourceStatus: 'unknown',
    });
  });
});

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-commitment-source' } as ToolInvocation,
  } as ToolExecutionContext;
}
