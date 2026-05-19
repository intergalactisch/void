import { describe, expect, it } from 'vitest';
import { buildRefId, extractRefIds, isRefId, parseRefId } from '$lib/domain/values/RefId';

describe('RefId', () => {
  it('builds and parses note refs with readable slash paths', () => {
    const ref = buildRefId({ kind: 'note', notePath: 'Projects/Roadmap 2026.md' });

    expect(ref).toBe('void://note/Projects/Roadmap%202026.md');
    expect(parseRefId(ref)).toMatchObject({
      kind: 'note',
      notePath: 'Projects/Roadmap 2026.md',
    });
  });

  it('builds and parses block refs with encoded path segments and hash block ids', () => {
    const ref = buildRefId({
      kind: 'block',
      notePath: 'Research/A&B.md',
      blockId: 'block:1',
    });

    expect(ref).toBe('void://block/Research/A%26B.md#block%3A1');
    expect(parseRefId(ref)).toMatchObject({
      kind: 'block',
      notePath: 'Research/A&B.md',
      blockId: 'block:1',
    });
  });

  it('extracts multiple unique refs from a prompt', () => {
    const note = buildRefId({ kind: 'note', notePath: 'Projects/Roadmap.md' });
    const todo = buildRefId({ kind: 'todo', todoId: 'TODO.md:12' });

    expect(extractRefIds(`Gebruik ${note}, daarna ${todo}. En opnieuw ${note}`)).toEqual([note, todo]);
  });

  it('rejects invalid and incomplete refs', () => {
    expect(parseRefId('void://missing/x')).toBeNull();
    expect(parseRefId('void://note/')).toBeNull();
    expect(parseRefId('void://block/Projects/Roadmap.md')).toBeNull();
    expect(isRefId('void://todo/TODO.md%3A12')).toBe(true);
  });
});
