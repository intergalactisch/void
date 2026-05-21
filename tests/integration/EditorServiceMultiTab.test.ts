/**
 * Integration tests for the multi-tab editor lifecycle.
 *
 * Exercises the real EditorServiceImpl + MarkdownAdapter + memory
 * filesystem stack. The editor is intentionally NOT mounted (no
 * editorElement / editorPort) — these tests focus on session
 * bookkeeping: open/switch/close, dirty tracking, flush-on-close,
 * tab strip data exposure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok } from '$lib/core';
import { MemoryFileSystemAdapter, MemoryLineageStorageAdapter } from '$lib/adapters/memory';
import { MarkdownAdapter } from '$lib/adapters/markdown/MarkdownAdapter';
import { MarkdownSerializerAdapter } from '$lib/adapters/markdown/MarkdownSerializerAdapter';
import { EditorServiceImpl } from '$lib/application/services/EditorServiceImpl';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { events } from '$lib/events';
import type { Document } from '$lib/domain';
import type { NotesListItem, NotesService, NotesState } from '$lib/ports/inbound/NotesService';
import type { CommandRegistryPort, EditorEvents, EditorPort, RegisteredCommand } from '$lib/ports/outbound';
import type { CommandId } from '$lib/domain/values/Command';

function frontmatterDoc(title: string): string {
  return `---
title: ${title}
id: doc-${title}
createdAt: 2026-05-07T00:00:00.000Z
updatedAt: 2026-05-07T00:00:00.000Z
tags: []
pinned: false
---
# ${title}

Body of ${title}.
`;
}

function frontmatterBodyDoc(title: string, body: string): string {
  return `---
title: ${title}
id: doc-${title}
createdAt: 2026-05-07T00:00:00.000Z
updatedAt: 2026-05-07T00:00:00.000Z
tags: []
pinned: false
---
${body}
`;
}

function createCommandRegistryStub(): CommandRegistryPort {
  return {
    register: () => () => undefined,
    unregister: () => undefined,
    getAll: () => [] as RegisteredCommand[],
    get: () => null,
    getByCategory: () => [],
    search: () => [],
    has: (_id: CommandId) => false,
    subscribe: () => () => undefined,
    clear: () => undefined,
  } as unknown as CommandRegistryPort;
}

function noteItem(path: string, title: string, children?: NotesListItem[]): NotesListItem {
  return {
    path,
    title,
    isFolder: !!children,
    ...(children ? { children } : {}),
    modifiedAt: new Date('2026-05-13T00:00:00.000Z'),
    tags: [],
  };
}

function createNotesServiceStub(items: NotesListItem[]): {
  service: NotesService;
  selectNote: ReturnType<typeof vi.fn>;
} {
  const state: NotesState = {
    items,
    tagGroups: [],
    selectedPath: null,
    isLoading: false,
    searchQuery: '',
    expandedFolders: new Set(),
  };
  const selectNote = vi.fn((path: string | null) => {
    state.selectedPath = path;
  });

  return {
    service: {
      getState: () => state,
      selectNote,
      getSelectedPath: () => state.selectedPath,
    } as unknown as NotesService,
    selectNote,
  };
}

function createEditorPortStub(document: Document): EditorPort & { emitPageLink(path: string): void } {
  const handlers = new Map<keyof EditorEvents, Array<(payload: unknown) => void>>();
  return {
    on: (event: keyof EditorEvents, handler: (payload: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {
        handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler));
      };
    },
    emitPageLink: (path: string) => {
      for (const handler of handlers.get('editor:page-link-clicked') ?? []) {
        handler({ path });
      }
    },
    destroy: vi.fn(),
    getDocument: () => document,
    getMarkdown: () => '',
  } as unknown as EditorPort & { emitPageLink(path: string): void };
}

describe('EditorServiceImpl — multi-tab sessions', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let editor: EditorServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({
      '/notes/a.md': frontmatterDoc('A'),
      '/notes/b.md': frontmatterDoc('B'),
      '/notes/c.md': frontmatterDoc('C'),
    });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined, // editorPortFactory
      undefined, // externalNavigation
      undefined, // aiAssistant
      undefined, // todoService
      undefined, // notesService
      '/notes',  // notesPath — required for file:changed path matching
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('openDocument adds a new tab and activates it', async () => {
    const result = await editor.openDocument('a.md');
    expect(result.ok).toBe(true);

    const state = editor.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.path).toBe('a.md');
    expect(state.activePath).toBe('a.md');
    expect(state.document?.path).toBe('a.md');
  });

  it('opening multiple distinct paths accumulates tabs', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.openDocument('c.md');

    const state = editor.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(state.activePath).toBe('c.md');
    expect(state.document?.path).toBe('c.md');
  });

  it('reopening an already-open path activates without reload', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    const aDocFirst = editor.getState().tabs[0];

    await editor.openDocument('a.md');
    const stateAfter = editor.getState();
    expect(stateAfter.activePath).toBe('a.md');
    expect(stateAfter.tabs).toHaveLength(2);
    // Tab order preserved — A was inserted first.
    expect(stateAfter.tabs[0]?.path).toBe(aDocFirst?.path);
  });

  it('switchTab activates an existing tab', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');

    const result = await editor.switchTab('a.md');
    expect(result.ok).toBe(true);
    expect(editor.getState().activePath).toBe('a.md');
    expect(editor.getState().document?.path).toBe('a.md');
  });

  it('switchTab on a non-open path returns Result.err', async () => {
    await editor.openDocument('a.md');

    const result = await editor.switchTab('b.md');
    expect(result.ok).toBe(false);
  });

  it('closeTab removes a non-active tab without changing active', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.openDocument('c.md');

    await editor.closeTab('a.md');
    const state = editor.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(['b.md', 'c.md']);
    expect(state.activePath).toBe('c.md');
  });

  it('closing the first active tab activates the tab to its right', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.openDocument('c.md');
    await editor.switchTab('a.md');

    await editor.closeTab('a.md');
    const state = editor.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(['b.md', 'c.md']);
    expect(state.activePath).toBe('b.md');
  });

  it('closing a middle active tab activates the tab to its right', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.openDocument('c.md');
    await editor.switchTab('b.md');

    await editor.closeTab('b.md');
    const state = editor.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(['a.md', 'c.md']);
    expect(state.activePath).toBe('c.md');
  });

  it('closing the last active tab activates the tab to its left', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.openDocument('c.md');

    await editor.closeTab('c.md');
    const state = editor.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(['a.md', 'b.md']);
    expect(state.activePath).toBe('b.md');
  });

  it('closing the last tab tears the editor down to initial state', async () => {
    await editor.openDocument('a.md');
    await editor.closeTab('a.md');

    const state = editor.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activePath).toBeNull();
    expect(state.document).toBeNull();
  });

  it('subscribes notify with the latest tabs list', async () => {
    const updates: number[] = [];
    const unsub = editor.subscribe((s) => updates.push(s.tabs.length));

    await editor.openDocument('a.md');
    await editor.openDocument('b.md');
    await editor.closeTab('a.md');

    unsub();
    // Subscribers should have observed the tabs growing 0 → 1 → 2 → 1.
    expect(Math.max(...updates)).toBe(2);
    expect(updates[updates.length - 1]).toBe(1);
  });

  it('migrates the active editor tab when a note is renamed', async () => {
    fs.seed({ '/notes/Test/old.md': frontmatterDoc('Old') });
    await editor.openDocument('Test/old.md');

    events.emit('note:renamed', {
      oldPath: 'Test/old.md',
      newPath: 'Test/new.md',
      newTitle: 'New',
      source: 'user',
    });

    const state = editor.getState();
    expect(state.activePath).toBe('Test/new.md');
    expect(state.document?.path).toBe('Test/new.md');
    expect(state.document?.meta.title).toBe('New');
    expect(state.tabs.map((tab) => tab.path)).toEqual(['Test/new.md']);
    expect(state.tabs[0]?.title).toBe('New');
  });

  it('migrates a non-active editor tab without activating it', async () => {
    await editor.openDocument('a.md');
    await editor.openDocument('b.md');

    events.emit('note:renamed', {
      oldPath: 'a.md',
      newPath: 'renamed-a.md',
      newTitle: 'Renamed A',
      source: 'user',
    });

    const state = editor.getState();
    expect(state.activePath).toBe('b.md');
    expect(state.tabs.map((tab) => tab.path)).toEqual(['renamed-a.md', 'b.md']);
    expect(state.tabs[0]?.title).toBe('Renamed A');
  });

  it('saves a migrated dirty session to the new path without recreating the old file', async () => {
    await editor.openDocument('a.md');
    const current = editor.getState().document;
    expect(current).not.toBeNull();
    if (!current) return;

    editor['updateState']({
      document: {
        ...current,
        blocks: [{
          id: 'dirty-paragraph',
          type: 'paragraph',
          content: 'Unsaved body after rename',
          marks: [],
          children: [],
          attrs: { type: 'paragraph' },
        }],
        isDirty: true,
      },
      isDirty: true,
    });

    const loadResult = await documentAdapter.load('a.md');
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;
    await documentAdapter.save({
      ...loadResult.value,
      path: 'renamed-a.md',
      meta: { ...loadResult.value.meta, title: 'Renamed A' },
    });
    await documentAdapter.delete('a.md');

    events.emit('note:renamed', {
      oldPath: 'a.md',
      newPath: 'renamed-a.md',
      newTitle: 'Renamed A',
      source: 'user',
    });

    const saveResult = await editor.saveDocument();
    expect(saveResult.ok).toBe(true);
    expect((await fs.exists('/notes/a.md')).value).toBe(false);
    expect((await fs.exists('/notes/renamed-a.md')).value).toBe(true);
    const renamedContent = await fs.readFile('/notes/renamed-a.md');
    expect(renamedContent.ok && renamedContent.value).toContain('Unsaved body after rename');
  });

  it('keeps newer local edits dirty when they land during an in-flight save', async () => {
    await editor.openDocument('a.md');
    const current = editor.getState().document;
    expect(current).not.toBeNull();
    if (!current) return;

    const firstEdit = {
      ...current,
      blocks: [{ ...current.blocks[0]!, content: 'First AI edit' }],
      isDirty: true,
    };
    editor['updateState']({ document: firstEdit, isDirty: true });

    vi.spyOn(documentAdapter, 'save').mockImplementation(async () => {
      const live = editor.getState().document;
      if (live) {
        editor['updateState']({
          document: {
            ...live,
            blocks: [{ ...live.blocks[0]!, content: 'Second AI edit while save is running' }],
            isDirty: true,
          },
          isDirty: true,
        });
        // No editor port is mounted in this suite, so the editor:change
        // subscriber that normally bumps editCounter never runs. Simulate
        // that signal so the in-flight-edit detector sees the landing edit.
        const activePath = editor.getState().activePath;
        const session = activePath ? editor['sessions'].get(activePath) : null;
        if (session) session.editCounter += 1;
      }
      return ok(undefined);
    });

    const saveResult = await editor.saveDocument();

    expect(saveResult.ok).toBe(true);
    expect(editor.getState().document?.blocks[0]?.content).toBe('Second AI edit while save is running');
    expect(editor.getState().isDirty).toBe(true);
    expect(editor.getState().tabs[0]?.isDirty).toBe(true);
  });
});

describe('EditorServiceImpl — page-link navigation', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let editor: EditorServiceImpl;
  let selectNote: ReturnType<typeof vi.fn>;

  const folder = 'Research/bonsai-bomen 2026-05-13';
  const followUpPath = `${folder}/bonsai-bomen-follow-ups.md`;
  const overviewPath = `${folder}/bonsai-bomen-research-overview.md`;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({
      [`/notes/${followUpPath}`]: frontmatterDoc('Bonsai Bomen Follow-ups'),
      [`/notes/${overviewPath}`]: frontmatterDoc('Bonsai Bomen Research Overview'),
    });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    const notes = createNotesServiceStub([
      noteItem('Research', 'Research', [
        noteItem('Research/bonsai-bomen 2026-05-13', 'bonsai-bomen 2026-05-13', [
          noteItem(followUpPath, 'Bonsai Bomen Follow-ups'),
          noteItem(overviewPath, 'Bonsai Bomen Research Overview'),
        ]),
      ]),
    ]);
    selectNote = notes.selectNote;
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined,
      undefined,
      undefined,
      undefined,
      notes.service,
      '/notes',
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('resolves title-only wikilink clicks to the existing slugged note path', async () => {
    const opened = await editor.openDocument(followUpPath);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const emitted: Array<{ path: string }> = [];
    const handler = (payload: { path: string }) => emitted.push(payload);
    events.on('editor:page-link-clicked', handler);

    const port = createEditorPortStub(opened.value);
    editor.setEditorPort(port);
    port.emitPageLink('Bonsai Bomen Research Overview');

    events.off('editor:page-link-clicked', handler);

    expect(selectNote).toHaveBeenCalledWith(overviewPath);
    expect(emitted).toEqual([{ path: overviewPath }]);
  });
});

describe('EditorServiceImpl — lineage baseline', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let serializer: MarkdownSerializerAdapter;
  let lineage: LineageServiceImpl;
  let editor: EditorServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({
      '/notes/may-9.md': frontmatterBodyDoc('May 9, 2026 21:00', 'Hoe gaat het daar?'),
    });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    serializer = new MarkdownSerializerAdapter();
    lineage = new LineageServiceImpl(new MemoryLineageStorageAdapter());
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '/notes',
      serializer,
      lineage,
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('seeds an existing note on open so the first edit/save has a previous version', async () => {
    const opened = await editor.openDocument('may-9.md');
    expect(opened.ok).toBe(true);

    const baseline = await lineage.materialize('may-9.md');
    expect(baseline).toEqual(expect.objectContaining({
      ok: true,
      value: 'Hoe gaat het daar?',
    }));

    const document = editor.getState().document;
    expect(document).not.toBeNull();
    document!.blocks = document!.blocks.map((block, index) => {
      if (index !== 0) return block;
      const { spans: _spans, ...rest } = block;
      return { ...rest, content: 'Hoe gaat het daar? Goed.' };
    });

    const saved = await editor.saveDocument();
    expect(saved.ok).toBe(true);

    const reread = await documentAdapter.load('may-9.md');
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.blocks[0]?.content).toBe('Hoe gaat het daar? Goed.');
    }

    const explanation = await lineage.explainLine('may-9.md', 0);
    expect(explanation.ok).toBe(true);
    if (!explanation.ok || !explanation.value) return;
    expect(explanation.value.currentVersion.content).toBe('Hoe gaat het daar? Goed.');
    expect(explanation.value.previousVersions.map((version) => version.content)).toContain('Hoe gaat het daar?');
  });
});

describe('EditorServiceImpl — file:changed reload', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let editor: EditorServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({ '/notes/a.md': frontmatterDoc('A') });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined, undefined, undefined, undefined, undefined,
      '/notes',
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('marks a dirty session as conflicted when its file changes externally', async () => {
    await editor.openDocument('a.md');
    // Simulate the user editing — bump the session dirty state.
    editor['updateState']({ isDirty: true });

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    // Wait past the self-write grace window so the event isn't filtered.
    await new Promise((r) => setTimeout(r, 10));

    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });

    // Allow the async handler to run.
    await new Promise((r) => setTimeout(r, 10));
    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([{ path: 'a.md', kind: 'modified' }]);
  });

  it('silently reloads a clean session when its file changes externally', async () => {
    await editor.openDocument('a.md');
    expect(editor.getState().document?.meta.title).toBe('A');

    // Rewrite the file on disk with new content.
    await fs.writeFile('/notes/a.md', frontmatterDoc('A-updated'));

    await new Promise((r) => setTimeout(r, 10));
    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 20));

    expect(editor.getState().document?.meta.title).toBe('A-updated');
  });

  it('marks a deleted file as conflict-deleted', async () => {
    await editor.openDocument('a.md');
    await new Promise((r) => setTimeout(r, 10));

    const conflicts: Array<{ kind: string }> = [];
    const handler = (p: { kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('file:changed', { path: '/notes/a.md', kind: 'remove' });
    await new Promise((r) => setTimeout(r, 10));
    events.off('editor:conflict', handler);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe('deleted');
  });
});

describe('EditorServiceImpl — editor:self-write coordination', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let editor: EditorServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({ '/notes/a.md': frontmatterDoc('A') });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined, undefined, undefined, undefined, undefined,
      '/notes',
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('suppresses external-modified conflict for a self-written, dirty session', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });

    // Wait past any prior grace window, then signal a self-write
    // immediately before the simulated watcher event.
    await new Promise((r) => setTimeout(r, 10));

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('editor:self-write', { path: '/notes/a.md' });
    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));

    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([]);
    expect(editor.getState().conflictState).toBe('clean');
  });

  it('suppresses delayed watcher events for a note created before its editor session exists', async () => {
    const createResult = await documentAdapter.create('Test/test.md', 'Test');
    expect(createResult.ok).toBe(true);

    const openResult = await editor.openDocument('Test/test.md');
    expect(openResult.ok).toBe(true);
    editor['updateState']({ isDirty: true });

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('file:changed', { path: '/notes/Test/test.md', kind: 'create' });
    events.emit('file:changed', { path: '/notes/Test/test.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));

    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([]);
    expect(editor.getState().conflictState).toBe('clean');
    expect((await editor.saveDocument()).ok).toBe(true);
  });

  it('suppresses delayed watcher events for in-app rename save/delete pairs', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });

    const loadResult = await documentAdapter.load('a.md');
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    expect((await documentAdapter.save({ ...loadResult.value, path: 'b.md' })).ok).toBe(true);
    expect((await documentAdapter.delete('a.md')).ok).toBe(true);

    const openResult = await editor.openDocument('b.md');
    expect(openResult.ok).toBe(true);
    editor['updateState']({ isDirty: true });

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('file:changed', { path: '/notes/b.md', kind: 'modify' });
    events.emit('file:changed', { path: '/notes/a.md', kind: 'remove' });
    await new Promise((r) => setTimeout(r, 10));

    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([]);
    expect(editor.getState().conflictState).toBe('clean');
    expect((await editor.saveDocument()).ok).toBe(true);
  });

  it('does not suppress a different file when the self-write path matches no open session', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));

    // Emitting for an unrelated path must NOT stamp a.md's grace window —
    // a real external-modified event for a.md must still surface.
    events.emit('editor:self-write', { path: '/notes/zz-not-open.md' });

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));

    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([{ path: 'a.md', kind: 'modified' }]);
  });

  it('grace window expires so true external edits are still detected', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));

    events.emit('editor:self-write', { path: '/notes/a.md' });

    // Wait past the in-app mutation grace window before the external event arrives.
    await new Promise((r) => setTimeout(r, 2100));

    const conflicts: Array<{ path: string; kind: string }> = [];
    const handler = (p: { path: string; kind: string }) => conflicts.push(p);
    events.on('editor:conflict', handler);

    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));

    events.off('editor:conflict', handler);

    expect(conflicts).toEqual([{ path: 'a.md', kind: 'modified' }]);
  });

  it('destroy() unsubscribes both file:changed and editor:self-write listeners', async () => {
    await editor.openDocument('a.md');
    editor.destroy();

    // After destroy(), neither event should mutate any state nor throw.
    expect(() => {
      events.emit('editor:self-write', { path: '/notes/a.md' });
      events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    }).not.toThrow();
  });

  it('MarkdownAdapter.save emits editor:self-write before the disk write', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));

    // saveDocument routes through MarkdownAdapter.save, which emits
    // editor:self-write before writeFile. The synchronous emit must
    // arrive before any awaited side effect.
    const writes: string[] = [];
    const handler = (p: { path: string }) => writes.push(p.path);
    events.on('editor:self-write', handler);

    const result = await editor.saveDocument();
    events.off('editor:self-write', handler);

    expect(result.ok).toBe(true);
    expect(writes).toContain('/notes/a.md');
  });

  it('MarkdownAdapter.delete emits editor:self-write before the disk delete', async () => {
    const writes: string[] = [];
    const handler = (p: { path: string }) => writes.push(p.path);
    events.on('editor:self-write', handler);

    const result = await documentAdapter.delete('a.md');
    events.off('editor:self-write', handler);

    expect(result.ok).toBe(true);
    expect(writes).toContain('/notes/a.md');
  });
});

describe('EditorServiceImpl — conflict resolution', () => {
  let fs: MemoryFileSystemAdapter;
  let documentAdapter: MarkdownAdapter;
  let editor: EditorServiceImpl;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({ '/notes/a.md': frontmatterDoc('A') });
    documentAdapter = new MarkdownAdapter(fs, { basePath: '/notes' });
    editor = new EditorServiceImpl(
      documentAdapter,
      createCommandRegistryStub(),
      undefined, undefined, undefined, undefined, undefined,
      '/notes',
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('saveDocument refuses to write when the active session is in conflict', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));
    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));

    expect(editor.getState().conflictState).toBe('external-modified');

    const result = await editor.saveDocument();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('ConflictError');
    }
  });

  it('resolveConflict take-remote reloads from disk and clears the conflict', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));

    // Rewrite the file on disk and trigger a conflict.
    await fs.writeFile('/notes/a.md', frontmatterDoc('A-remote'));
    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));
    expect(editor.getState().conflictState).toBe('external-modified');

    const result = await editor.resolveConflict('a.md', 'take-remote');
    expect(result.ok).toBe(true);
    expect(editor.getState().conflictState).toBe('clean');
    expect(editor.getState().document?.meta.title).toBe('A-remote');
    expect(editor.getState().isDirty).toBe(false);
  });

  it('resolveConflict keep-local force-saves and clears the conflict', async () => {
    await editor.openDocument('a.md');
    editor['updateState']({ isDirty: true });
    await new Promise((r) => setTimeout(r, 10));

    await fs.writeFile('/notes/a.md', frontmatterDoc('A-remote'));
    events.emit('file:changed', { path: '/notes/a.md', kind: 'modify' });
    await new Promise((r) => setTimeout(r, 10));
    expect(editor.getState().conflictState).toBe('external-modified');

    const result = await editor.resolveConflict('a.md', 'keep-local');
    expect(result.ok).toBe(true);
    expect(editor.getState().conflictState).toBe('clean');

    // Re-read the file: our (local 'A') version should have overwritten 'A-remote'.
    const reread = await documentAdapter.load('a.md');
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.meta.title).toBe('A');
    }
  });
});
