import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { CommitmentLineageServiceImpl } from '$lib/application/services/CommitmentLineageServiceImpl';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { MemoryLineageStorageAdapter } from '$lib/adapters/memory';
import type { TodoService } from '$lib/ports/inbound';
import type { Todo } from '$lib/domain/entities/Todo';

describe('CommitmentLineageServiceImpl', () => {
  it('detects stale todo sources when the source line changes', async () => {
    const lineage = new LineageServiceImpl(new MemoryLineageStorageAdapter());
    const initial = await lineage.recordMarkdownChange('launch.md', 'Maya will send rollout numbers');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const sourceVersionId = Object.values(initial.value.snapshot.versions)[0]!.id;

    const extracted = await lineage.recordMarkdownChange(
      'launch.md',
      'Maya will send rollout numbers\n- [ ] Ask Maya for rollout numbers',
      {
        intentKind: 'commitment-create',
        actor: { kind: 'ai-agent' },
        lineSources: [{ lineIndex: 1, sourceVersionIds: [sourceVersionId] }],
      },
    );
    expect(extracted.ok).toBe(true);

    await lineage.recordMarkdownChange(
      'launch.md',
      'Maya might send rollout numbers\n- [ ] Ask Maya for rollout numbers',
      { actor: { kind: 'user' }, intentKind: 'update' },
    );

    const todo = createTodo();
    const service = new CommitmentLineageServiceImpl(createTodoService([todo]), lineage);
    const stale = await service.checkStaleSources('launch.md');

    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value[0]?.status).toBe('stale');
    expect(stale.value[0]?.reasons[0]).toContain('Source changed');
  });

  it('returns unknown when a todo has no explicit source link', async () => {
    const lineage = new LineageServiceImpl(new MemoryLineageStorageAdapter());
    await lineage.recordMarkdownChange('launch.md', '- [ ] Ask Maya');

    const service = new CommitmentLineageServiceImpl(createTodoService([createTodo('Ask Maya')]), lineage);
    const source = await service.getSourceForTodo('launch.md:0');

    expect(source.ok).toBe(true);
    expect(source.ok ? source.value?.status : null).toBe('unknown');
  });
});

function createTodo(content = 'Ask Maya for rollout numbers'): Todo {
  const lineNumber = content === 'Ask Maya' ? 0 : 1;
  return {
    id: `launch.md:${lineNumber}`,
    content,
    isCompleted: false,
    source: 'inline',
    sourceFile: 'launch.md',
    lineNumber,
    indent: 0,
    dates: {},
    tags: [],
    rawLine: `- [ ] ${content}`,
  };
}

function createTodoService(todos: Todo[]): TodoService {
  return {
    getById: vi.fn(async (id: string) => ok(todos.find((todo) => todo.id === id) ?? null)),
    getAll: vi.fn(async () => ok(todos)),
  } as unknown as TodoService;
}
