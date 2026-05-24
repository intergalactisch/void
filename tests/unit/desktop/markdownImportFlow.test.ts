import { describe, expect, it, vi } from 'vitest';
import {
  formatMarkdownDropAcceptedLabel,
  formatMarkdownDropSkippedLabel,
  formatMarkdownImportTargetFolder,
  openImportedMarkdownSummary,
  resolveMarkdownImportTargetFolder,
  summarizeMarkdownDropPaths,
} from '$lib/desktop/markdownImportFlow';

describe('markdownImportFlow', () => {
  it('resolves import target from folder overview, selected note parent, then root', () => {
    expect(resolveMarkdownImportTargetFolder({
      activeFolderPath: 'projects/alpha',
      selectedPath: 'inbox/today.md',
    })).toBe('projects/alpha');
    expect(resolveMarkdownImportTargetFolder({
      activeFolderPath: null,
      selectedPath: 'inbox/today.md',
    })).toBe('inbox');
    expect(resolveMarkdownImportTargetFolder({
      activeFolderPath: null,
      selectedPath: 'today.md',
    })).toBe('');
    expect(resolveMarkdownImportTargetFolder({
      activeFolderPath: null,
      selectedPath: null,
    })).toBe('');
  });

  it('refreshes notes, opens imported files as tabs, and selects the last import', async () => {
    const refreshNotes = vi.fn().mockResolvedValue(undefined);
    const openDocument = vi.fn().mockResolvedValue(undefined);
    const selectNote = vi.fn();

    await openImportedMarkdownSummary({
      imported: [
        { path: 'a.md', title: 'A' },
        { path: 'folder/b.md', title: 'B' },
      ],
      skipped: [],
    }, {
      refreshNotes,
      openDocument,
      selectNote,
    });

    expect(refreshNotes).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenNthCalledWith(1, 'a.md');
    expect(openDocument).toHaveBeenNthCalledWith(2, 'folder/b.md');
    expect(selectNote).toHaveBeenCalledWith('folder/b.md');
  });

  it('summarizes drag/drop previews for valid, mixed, and invalid drops', () => {
    expect(summarizeMarkdownDropPaths(['/tmp/a.md', '/tmp/B.MD'])).toMatchObject({
      totalCount: 2,
      markdownCount: 2,
      unsupportedCount: 0,
      state: 'valid',
    });
    expect(summarizeMarkdownDropPaths(['/tmp/a.md', '/tmp/a.txt'])).toMatchObject({
      totalCount: 2,
      markdownCount: 1,
      unsupportedCount: 1,
      state: 'mixed',
    });
    expect(summarizeMarkdownDropPaths(['/tmp/a.markdown', '/tmp/a.txt'])).toMatchObject({
      totalCount: 2,
      markdownCount: 0,
      unsupportedCount: 2,
      state: 'invalid',
    });
  });

  it('formats import destination labels', () => {
    expect(formatMarkdownImportTargetFolder('')).toBe('Workspace root');
    expect(formatMarkdownImportTargetFolder('projects/alpha')).toBe('projects / alpha');
  });

  it('formats drop chips as filenames for single files and counts for batches', () => {
    const single = summarizeMarkdownDropPaths(['/tmp/dit-is-een-test.md']);
    expect(formatMarkdownDropAcceptedLabel(single)).toBe('dit-is-een-test.md');

    const encoded = summarizeMarkdownDropPaths(['file:///tmp/dit%20is%20een%20test.md']);
    expect(formatMarkdownDropAcceptedLabel(encoded)).toBe('dit is een test.md');

    const batch = summarizeMarkdownDropPaths(['/tmp/a.md', '/tmp/b.md']);
    expect(formatMarkdownDropAcceptedLabel(batch)).toBe('2 Markdown files');

    const mixed = summarizeMarkdownDropPaths(['/tmp/a.md', '/tmp/not-this.txt']);
    expect(formatMarkdownDropSkippedLabel(mixed)).toBe('not-this.txt skipped');
  });
});
