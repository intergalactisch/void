import { describe, expect, it } from 'vitest';
import {
  resolveNoteLinkTarget,
  wikiLinkForNoteTitle,
} from '$lib/application/services/NoteLinkResolver';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

function note(path: string, title: string): NotesListItem {
  return {
    path,
    title,
    isFolder: false,
    modifiedAt: new Date('2026-05-13T00:00:00.000Z'),
    tags: [],
  };
}

describe('NoteLinkResolver', () => {
  it('resolves title-only wikilinks to slugged sibling notes', () => {
    const items = [
      note(
        'Research/bonsai-bomen 2026-05-13/bonsai-bomen-follow-ups.md',
        'Bonsai Bomen Follow-ups',
      ),
      note(
        'Research/bonsai-bomen 2026-05-13/bonsai-bomen-research-overview.md',
        'Bonsai Bomen Research Overview',
      ),
    ];

    expect(resolveNoteLinkTarget(
      'Bonsai Bomen Research Overview',
      'Research/bonsai-bomen 2026-05-13/bonsai-bomen-follow-ups.md',
      items,
    )).toBe('Research/bonsai-bomen 2026-05-13/bonsai-bomen-research-overview.md');
  });

  it('resolves relative slug filenames against the current note folder', () => {
    const items = [
      note('Research/bonsai/overview.md', 'Overview'),
      note('Research/bonsai/bonsai-bomen-research-overview.md', 'Bonsai Bomen Research Overview'),
    ];

    expect(resolveNoteLinkTarget(
      'bonsai-bomen-research-overview.md',
      'Research/bonsai/overview.md',
      items,
    )).toBe('Research/bonsai/bonsai-bomen-research-overview.md');
  });

  it('formats generated wiki links as explicit filename plus display title', () => {
    expect(wikiLinkForNoteTitle('Bonsai Bomen Research Overview')).toBe(
      '[[bonsai-bomen-research-overview.md|Bonsai Bomen Research Overview]]',
    );
  });
});
