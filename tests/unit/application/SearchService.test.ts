import { describe, it, expect, beforeEach } from 'vitest';
import { SearchServiceImpl } from '$lib/application/services/SearchServiceImpl';
import { MemoryContentSearchAdapter } from '$lib/adapters/search';
import type { NotesService, NotesState, NotesListItem } from '$lib/ports/inbound/NotesService';

function createMockNotesService(items: NotesListItem[]): NotesService {
  const state: NotesState = {
    items,
    isLoading: false,
    error: null,
  };
  // Cast through unknown; only `getState` is exercised by SearchServiceImpl.
  const stub = {
    getState: () => state,
  } as unknown as NotesService;
  return stub;
}

function noteItem(path: string, title: string): NotesListItem {
  return {
    path,
    title,
    isFolder: false,
    children: [],
    modifiedAt: new Date(),
  };
}

describe('SearchServiceImpl', () => {
  let adapter: MemoryContentSearchAdapter;

  beforeEach(() => {
    adapter = new MemoryContentSearchAdapter({
      'a.md': 'foo\nbar baz\nfoo bar',
      'b.md': 'nothing matches here',
      'c.md': 'BAR is uppercase',
    });
  });

  it('finds simple substring matches', async () => {
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([noteItem('a.md', 'A')])
    );
    const hits = await service.searchAll({ query: 'foo' });
    expect(hits.length).toBe(2);
    expect(hits[0]?.path).toBe('a.md');
    expect(hits[0]?.line).toBe(1);
    expect(hits[1]?.line).toBe(3);
  });

  it('attaches display titles from NotesService', async () => {
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([
        noteItem('a.md', 'My Note A'),
        noteItem('c.md', 'Note C'),
      ])
    );
    const hits = await service.searchAll({ query: 'foo' });
    expect(hits[0]?.title).toBe('My Note A');
  });

  it('falls back to filename-based title when notes service has no entry', async () => {
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([])
    );
    const hits = await service.searchAll({ query: 'foo' });
    expect(hits[0]?.title).toBe('a');
  });

  it('respects case sensitivity', async () => {
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([noteItem('c.md', 'C')])
    );
    const lower = await service.searchAll({ query: 'bar' });
    // case-insensitive: 'a.md' (line 2 'bar baz' + line 3 'foo bar') + 'c.md' (line 1 'BAR')
    expect(lower.length).toBe(3);

    const upper = await service.searchAll({ query: 'BAR', caseSensitive: true });
    expect(upper.length).toBe(1);
    expect(upper[0]?.path).toBe('c.md');
  });

  it('returns empty when query is blank', async () => {
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([])
    );
    const hits = await service.searchAll({ query: '' });
    expect(hits).toEqual([]);
  });

  it('honors maxResults cap', async () => {
    adapter.setFile('big.md', Array.from({ length: 100 }, () => 'foo').join('\n'));
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([noteItem('big.md', 'Big')])
    );
    const hits = await service.searchAll({ query: 'foo', maxResults: 10 });
    expect(hits.length).toBe(10);
  });

  it('reports correct match offsets within line text', async () => {
    adapter.setFile('o.md', 'hello world');
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([])
    );
    const hits = await service.searchAll({ query: 'world' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.matchStart).toBe(6);
    expect(hits[0]?.matchEnd).toBe(11);
    expect(hits[0]?.lineText).toBe('hello world');
  });

  it('supports regex queries', async () => {
    adapter.setFile('r.md', 'one1 two2 three3');
    const service = new SearchServiceImpl(
      adapter,
      createMockNotesService([])
    );
    const hits = await service.searchAll({ query: '\\w+\\d', regex: true });
    expect(hits.length).toBe(3);
  });
});
