import { describe, expect, it, vi } from 'vitest';
import {
  formatMarkdownImportTargetFolder,
  openImportedMarkdownSummary,
  resolveMarkdownImportTargetFolder,
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

  it('formats import destination labels', () => {
    expect(formatMarkdownImportTargetFolder('')).toBe('Workspace root');
    expect(formatMarkdownImportTargetFolder('projects/alpha')).toBe('projects / alpha');
  });
});
