import { describe, expect, it, vi } from 'vitest';
import { JsContentSearchAdapter } from '$lib/adapters/search/JsContentSearchAdapter';
import type { NotesListItem, NotesService } from '$lib/ports/inbound/NotesService';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';
import { ok } from '$lib/core/result';

function setup() {
  const items = [
    { path: 'public.md', title: 'Public', isFolder: false },
    { path: 'private.md', title: 'Private', isFolder: false, protection: {} },
  ] as NotesListItem[];
  const readFile = vi.fn(async () => ok('hello world'));
  const getState = vi.fn(() => ({ items }));
  const adapter = new JsContentSearchAdapter(
    { readFile } as unknown as FileSystemPort,
    { getState } as unknown as NotesService,
    '/notes',
  );
  return { adapter, readFile, getState };
}

describe('scoped content search', () => {
  it('normalizes scope aliases, reads canonical paths once, and excludes protected or unknown notes', async () => {
    const { adapter, readFile, getState } = setup();
    const hits = [];
    for await (const hit of adapter.search({
      query: 'hello',
      scopePaths: ['public.md', '/public.md', 'private.md', '/unknown.md'],
    })) hits.push(hit);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('public.md');
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/notes/public.md');
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it('never reads protected notes in an unscoped search', async () => {
    const { adapter, readFile } = setup();
    for await (const _hit of adapter.search({ query: 'hello' })) { /* consume */ }
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/notes/public.md');
  });
});


it.each([false, true])('bounds results for a long line (regex: %s)', async (regex) => {
  const { adapter, readFile } = setup();
  readFile.mockResolvedValue(ok('hello '.repeat(10000)));
  const hits = [];
  for await (const hit of adapter.search({ query: 'hello', regex, maxResults: 3 })) hits.push(hit);
  expect(hits.map((hit) => hit.column)).toEqual([0, 6, 12]);
});
