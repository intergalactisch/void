import { describe, expect, it } from 'vitest';
import { ok } from '$lib/core';
import { ReferenceServiceImpl } from '$lib/application/services/ReferenceServiceImpl';
import { buildRefId } from '$lib/domain/values/RefId';
import { createDocumentMeta } from '$lib/domain/values/DocumentMeta';

const notesState = {
  items: [
    {
      path: 'Projects',
      title: 'Projects',
      isFolder: true,
      children: [
        {
          path: 'Projects/Roadmap.md',
          title: 'Roadmap',
          isFolder: false,
          tags: ['strategy'],
        },
      ],
    },
  ],
  tagGroups: [
    {
      tag: 'strategy',
      count: 1,
      notes: [{ path: 'Projects/Roadmap.md', title: 'Roadmap' }],
    },
  ],
};

function makeService() {
  const documents = {
    readMeta: async (path: string) => path === 'Projects/Roadmap.md'
      ? ok(createDocumentMeta({ id: 'note-1', title: 'Roadmap', tags: ['strategy'] }))
      : ok(null),
    readContent: async (path: string) => path === 'Projects/Roadmap.md'
      ? ok('# Roadmap\n\nShip the ref layer.')
      : ok(''),
  };
  const todos = {
    getById: async (todoId: string) => ok(todoId === 'TODO.md:12'
      ? {
          id: 'TODO.md:12',
          content: 'Wire Copy Ref into tabs',
          isCompleted: false,
          sourceFile: 'TODO.md',
          lineNumber: 12,
          dates: {},
          rawLine: '- [ ] Wire Copy Ref into tabs',
          priority: 'high',
          tags: ['ai'],
        }
      : null),
  };
  const contextProvider = {
    getCurrentDocument: async () => ({
      path: 'Projects/Roadmap.md',
      meta: createDocumentMeta({ id: 'note-1', title: 'Roadmap' }),
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          content: 'Block scoped content',
          marks: [],
          children: [],
          attrs: { type: 'paragraph' },
        },
      ],
      isDirty: false,
    }),
  };
  const conversations = {
    load: async (id: string) => ok(id === 'conv-1'
      ? {
          id,
          title: 'Planning chat',
          messages: [{ id: 'm1', role: 'user', text: 'Hello', content: [], createdAt: new Date() }],
          status: 'active',
          initialContext: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          totalTokens: { input: 0, output: 0 },
          tags: [],
          documentPath: 'Projects/Roadmap.md',
        }
      : null),
  };
  const runs = {
    get: async (id: string) => ok(id === 'run-1'
      ? {
          id,
          prompt: 'Make a plan',
          status: 'completed',
          tasks: [{ status: 'completed', title: 'Plan', detail: 'Done' }],
          workers: [{ id: 'worker-1', status: 'completed', spec: { title: 'Planner', objective: 'Plan', role: 'planner' }, result: { summary: 'Done', findings: ['A'] } }],
          artifacts: [],
          finalSummary: 'Finished',
          orchestrationMode: 'swarm',
          conversationId: 'conv-1',
        }
      : null),
  };
  const operations = {
    load: async (id: string) => ok(id === 'op-1'
      ? {
          id,
          label: 'Rewrite',
          type: 'rewrite',
          status: 'completed',
          result: { rawResponse: 'Improved text' },
          prompt: 'Rewrite this',
          targetNotes: ['Projects/Roadmap.md'],
        }
      : null),
  };

  return new ReferenceServiceImpl(
    { getState: () => notesState } as any,
    documents as any,
    todos as any,
    contextProvider as any,
    conversations as any,
    runs as any,
    operations as any,
  );
}

describe('ReferenceServiceImpl', () => {
  it('resolves every supported ref kind into bounded prompt references', async () => {
    const service = makeService();
    const refs = [
      buildRefId({ kind: 'note', notePath: 'Projects/Roadmap.md' }),
      buildRefId({ kind: 'folder', folderPath: 'Projects' }),
      buildRefId({ kind: 'tag', tag: 'strategy' }),
      buildRefId({ kind: 'todo', todoId: 'TODO.md:12' }),
      buildRefId({ kind: 'block', notePath: 'Projects/Roadmap.md', blockId: 'block-1' }),
      buildRefId({ kind: 'conversation', conversationId: 'conv-1' }),
      buildRefId({ kind: 'run', runId: 'run-1' }),
      buildRefId({ kind: 'worker', runId: 'run-1', workerId: 'worker-1' }),
      buildRefId({ kind: 'operation', operationId: 'op-1' }),
    ];

    const result = await service.resolveMany(refs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((reference) => reference.status)).toEqual(Array(refs.length).fill('resolved'));
    expect(result.value.map((reference) => reference.kind)).toEqual([
      'note',
      'folder',
      'tag',
      'todo',
      'block',
      'conversation',
      'run',
      'worker',
      'operation',
    ]);
  });

  it('marks missing block anchors as stale instead of guessing', async () => {
    const service = makeService();

    const result = await service.resolve(buildRefId({
      kind: 'block',
      notePath: 'Projects/Roadmap.md',
      blockId: 'missing-block',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('stale');
    expect(result.value.reason).toContain('Open the note');
  });

  it('extracts and resolves multiple refs from prompt text', async () => {
    const service = makeService();
    const note = buildRefId({ kind: 'note', notePath: 'Projects/Roadmap.md' });
    const todo = buildRefId({ kind: 'todo', todoId: 'TODO.md:12' });

    const result = await service.resolvePrompt(`Gebruik ${note} en ${todo}.`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((reference) => reference.refId)).toEqual([note, todo]);
  });
});
