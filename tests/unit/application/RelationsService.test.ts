import { describe, it, expect } from 'vitest';
import { RelationsServiceImpl } from '$lib/application/services/RelationsServiceImpl';
import { ok, type Result } from '$lib/core';
import { events } from '$lib/events';
import type { NotesService, NotesListItem, NotesState } from '$lib/ports/inbound/NotesService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';

function noteItem(path: string, title: string): NotesListItem {
  return {
    path,
    title,
    isFolder: false,
    children: [],
    modifiedAt: new Date(),
    tags: [],
  };
}

function notesService(items: NotesListItem[]): NotesService {
  const state: NotesState = { items, isLoading: false, error: null };
  return { getState: () => state } as unknown as NotesService;
}

function documentService(files: Record<string, string>): DocumentService {
  return {
    readContent: async (path: string): Promise<Result<string, Error>> => {
      const content = files[path];
      if (content === undefined) {
        return { ok: false, error: new Error(`Not found: ${path}`) };
      }
      return ok(content);
    },
  } as unknown as DocumentService;
}

describe('RelationsServiceImpl', () => {
  it('finds backlinks via [[wikilinks]]', async () => {
    const service = new RelationsServiceImpl(
      notesService([
        noteItem('a.md', 'A'),
        noteItem('b.md', 'B'),
      ]),
      documentService({
        'a.md': 'See [[b]] for context.',
        'b.md': 'No links here.',
      })
    );
    const back = await service.getBacklinks('b.md');
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.length).toBe(1);
      expect(back.value[0]?.path).toBe('a.md');
      expect(back.value[0]?.title).toBe('A');
    }
  });

  it('finds outgoing links via markdown [text](path) syntax', async () => {
    const service = new RelationsServiceImpl(
      notesService([
        noteItem('hub.md', 'Hub'),
        noteItem('topic.md', 'Topic'),
      ]),
      documentService({
        'hub.md': 'Click [Topic](topic.md) to read.',
        'topic.md': '',
      })
    );
    const out = await service.getOutgoingLinks('hub.md');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.length).toBe(1);
      expect(out.value[0]?.path).toBe('topic.md');
      expect(out.value[0]?.linkText).toBe('Topic');
    }
  });

  it('resolves [[wikilinks]] without .md extension', async () => {
    const service = new RelationsServiceImpl(
      notesService([
        noteItem('alpha.md', 'Alpha'),
        noteItem('beta.md', 'Beta'),
      ]),
      documentService({
        'alpha.md': 'Refer to [[beta]].',
        'beta.md': '',
      })
    );
    const out = await service.getOutgoingLinks('alpha.md');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value[0]?.path).toBe('beta.md');
    }
  });

  it('resolves title-only wikilinks whose note files use slug filenames', async () => {
    const sourcePath = 'Research/bonsai-bomen 2026-05-13/bonsai-bomen-follow-ups.md';
    const overviewPath = 'Research/bonsai-bomen 2026-05-13/bonsai-bomen-research-overview.md';
    const service = new RelationsServiceImpl(
      notesService([
        noteItem(sourcePath, 'Bonsai Bomen Follow-ups'),
        noteItem(overviewPath, 'Bonsai Bomen Research Overview'),
      ]),
      documentService({
        [sourcePath]: 'Related brief: [[Bonsai Bomen Research Overview]]',
        [overviewPath]: '',
      })
    );

    const out = await service.getOutgoingLinks(sourcePath);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value[0]?.path).toBe(overviewPath);
    }
  });

  it('ignores image embeds and absolute URLs', async () => {
    const service = new RelationsServiceImpl(
      notesService([noteItem('a.md', 'A'), noteItem('other.md', 'Other')]),
      documentService({
        'a.md': '![alt](https://example.com/img.png) [external](https://x.org) [Other](other.md)',
        'other.md': '',
      })
    );
    const out = await service.getOutgoingLinks('a.md');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.length).toBe(1);
      expect(out.value[0]?.path).toBe('other.md');
    }
  });

  it('returns empty arrays when no links exist', async () => {
    const service = new RelationsServiceImpl(
      notesService([noteItem('x.md', 'X')]),
      documentService({ 'x.md': 'No relevant links.' })
    );
    const back = await service.getBacklinks('x.md');
    const out = await service.getOutgoingLinks('x.md');
    expect(back.ok && back.value).toEqual([]);
    expect(out.ok && out.value).toEqual([]);
  });

  it('captures the source line as context', async () => {
    const service = new RelationsServiceImpl(
      notesService([noteItem('a.md', 'A'), noteItem('b.md', 'B')]),
      documentService({
        'a.md': 'Line one\nA reference to [[b]] in line two.\nLine three',
        'b.md': '',
      })
    );
    const back = await service.getBacklinks('b.md');
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value[0]?.line).toBe(2);
      expect(back.value[0]?.context).toContain('reference to [[b]]');
    }
  });

  it('refreshes a note when document:saved fires', async () => {
    const files = {
      'a.md': 'No links yet.',
      'b.md': '',
    };
    const service = new RelationsServiceImpl(
      notesService([noteItem('a.md', 'A'), noteItem('b.md', 'B')]),
      documentService(files)
    );

    const before = await service.getOutgoingLinks('a.md');
    expect(before.ok && before.value).toEqual([]);

    files['a.md'] = 'Now see [[b]].';
    events.emit('document:saved', { path: 'a.md' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = await service.getOutgoingLinks('a.md');
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value).toHaveLength(1);
      expect(after.value[0]?.path).toBe('b.md');
    }
  });
});
