import { describe, expect, it, vi } from 'vitest';
import createTool from '$lib/tools/note/create.tool';
import listTool from '$lib/tools/note/list.tool';
import tagTool from '$lib/tools/note/tag.tool';
import updateTool from '$lib/tools/note/update.tool';
import type { ToolExecutionContext } from '$lib/ports/outbound';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import { ok } from '$lib/core';

function createContext(services: Partial<ToolServices>): ToolExecutionContext {
  const defaultSettings = {
    load: vi.fn().mockResolvedValue(ok({
      notesPath: '/Users/testuser/notes',
    })),
  } as unknown as ToolServices['settings'];
  const defaultDocuments = {
    readMeta: vi.fn().mockResolvedValue(ok({ title: 'Test note', tags: [], protection: null })),
  } as unknown as ToolServices['documents'];

  return {
    invocation: {} as ToolExecutionContext['invocation'],
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    services: { settings: defaultSettings, documents: defaultDocuments, ...services } as ToolServices,
  };
}

describe('note tag tools', () => {
  it('filters note:list by normalized tags', async () => {
    const context = createContext({
      notes: {
        getState: () => ({
          items: [
            { path: 'a.md', title: 'A', isFolder: false, modifiedAt: new Date(), tags: ['work'] },
            { path: 'b.md', title: 'B', isFolder: false, modifiedAt: new Date(), tags: ['personal'] },
          ],
          tagGroups: [],
          selectedPath: null,
          isLoading: false,
          searchQuery: '',
          expandedFolders: new Set(),
        }),
      } as ToolServices['notes'],
    });

    const result = await listTool.handler({ tags: ['#Work'] }, context);

    expect(result).toEqual({ notes: [{ noteId: 'a.md', title: 'A', tags: ['work'] }] });
  });

  it('normalizes tags when adding and removing with note:tag', async () => {
    const updateNote = vi.fn().mockResolvedValue(ok(undefined));
    const context = createContext({
      documents: {
        readMeta: vi.fn().mockResolvedValue(ok({ tags: ['work'] })),
      } as unknown as ToolServices['documents'],
      collaboration: {
        updateNote,
      } as unknown as ToolServices['collaboration'],
    });

    await tagTool.handler({ noteId: 'a.md', add: ['#New Tag'], remove: ['#Work'] }, context);

    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      noteId: 'a.md',
      tags: ['new-tag'],
      label: 'AI tag update',
      lineage: expect.objectContaining({ commandId: 'note:tag', intentKind: 'rewrite' }),
    }));
  });

  it('normalizes absolute in-vault paths before note:update collaborates', async () => {
    const updateNote = vi.fn().mockResolvedValue(ok(undefined));
    const context = createContext({
      collaboration: {
        isActiveNote: vi.fn().mockReturnValue(false),
        updateNote,
      } as unknown as ToolServices['collaboration'],
    });

    await updateTool.handler(
      {
        noteId: '/Users/testuser/notes/planten.md',
        content: '# Planten\n\n- [ ] Water geven',
        tags: ['#Plant Care'],
      },
      context
    );

    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      noteId: 'planten.md',
      content: '# Planten\n\n- [ ] Water geven',
      tags: ['#Plant Care'],
      label: 'AI note update',
      lineage: expect.objectContaining({ commandId: 'note:update', intentKind: 'rewrite' }),
    }));
  });

  it('normalizes tilde in-vault paths before note:update collaborates', async () => {
    const updateNote = vi.fn().mockResolvedValue(ok(undefined));
    const context = createContext({
      collaboration: {
        isActiveNote: vi.fn().mockReturnValue(false),
        updateNote,
      } as unknown as ToolServices['collaboration'],
    });

    const result = await updateTool.handler(
      {
        noteId: '~/notes/Research/anthropic-best-notes.md',
        content: '# Anthropic notes',
      },
      context
    );

    expect(result.noteId).toBe('Research/anthropic-best-notes.md');
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      noteId: 'Research/anthropic-best-notes.md',
      content: '# Anthropic notes',
      label: 'AI note update',
      lineage: expect.objectContaining({ commandId: 'note:update', intentKind: 'rewrite' }),
    }));
  });

  it('routes note:create tags through collaboration', async () => {
    const createNote = vi.fn().mockResolvedValue(ok({ path: 'new.md', title: 'New' }));
    const context = createContext({
      collaboration: {
        createNote,
      } as unknown as ToolServices['collaboration'],
    });

    await createTool.handler({ title: 'New', tags: ['#Work', 'Project Plan'] }, context);

    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({
      folder: '',
      title: 'New',
      autoFocus: true,
      tags: ['#Work', 'Project Plan'],
      lineage: expect.objectContaining({ commandId: 'note:create', intentKind: 'import' }),
    }));
  });
});
