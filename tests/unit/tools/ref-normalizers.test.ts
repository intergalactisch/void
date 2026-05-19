import { describe, expect, it } from 'vitest';
import { buildRefId } from '$lib/domain/values/RefId';
import { normalizeNotePath } from '$lib/tools/note/paths';
import { normalizeTodoId } from '$lib/tools/todo/refs';

const services = {
  settings: {
    load: async () => ({
      ok: true,
      value: { notesPath: '/Users/testuser/Notes' },
    }),
  },
} as any;

describe('ref-aware tool normalizers', () => {
  it('turns note refs into note paths', async () => {
    const ref = buildRefId({ kind: 'note', notePath: 'Projects/Roadmap.md' });

    await expect(normalizeNotePath(ref, services)).resolves.toBe('Projects/Roadmap.md');
  });

  it('turns block refs into the containing note path', async () => {
    const ref = buildRefId({ kind: 'block', notePath: 'Projects/Roadmap.md', blockId: 'block-1' });

    await expect(normalizeNotePath(ref, services)).resolves.toBe('Projects/Roadmap.md');
  });

  it('turns todo refs into existing todo ids', () => {
    const ref = buildRefId({ kind: 'todo', todoId: 'TODO.md:12' });

    expect(normalizeTodoId(ref)).toBe('TODO.md:12');
  });
});
