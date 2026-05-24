import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import { MarkdownAdapter } from '$lib/adapters/markdown/MarkdownAdapter';
import { EditorServiceImpl } from '$lib/application/services/EditorServiceImpl';
import { EMPTY_SELECTION } from '$lib/domain/values';
import type { Document } from '$lib/domain';
import type {
  CommandRegistryPort,
  EditorEvents,
  EditorPort,
  EditorPortFactory,
  RegisteredCommand,
} from '$lib/ports/outbound';
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

function createEditorPortStub() {
  let currentDocument: Document | null = null;
  let element: HTMLElement | null = null;
  const handlers = new Map<keyof EditorEvents, Array<(payload: unknown) => void>>();
  const destroyed = vi.fn();

  const emit = <K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]) => {
    for (const handler of handlers.get(event) ?? []) {
      handler(payload);
    }
  };

  const port = {
    mount: vi.fn(async (host: HTMLElement, document: Document) => {
      element = host;
      currentDocument = document;
      emit('editor:ready', undefined as EditorEvents['editor:ready']);
      return ok(undefined);
    }),
    update: vi.fn((document: Document) => {
      currentDocument = document;
    }),
    updateMetadata: vi.fn((meta: Document['meta']) => {
      if (!currentDocument) return;
      currentDocument = {
        ...currentDocument,
        meta,
      };
    }),
    destroy: destroyed,
    execute: vi.fn((command: string) => {
      if (command === 'focus') emit('editor:focus', undefined as EditorEvents['editor:focus']);
    }),
    on: vi.fn((event: keyof EditorEvents, handler: (payload: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {
        handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler));
      };
    }),
    getDocument: () => currentDocument,
    getTextContent: () => currentDocument?.blocks.map((block) => block.content).join('\n') ?? '',
    getTextBetween: () => '',
    resolveInlineAIRangeAnchor: () => null,
    getMarkdown: () => currentDocument?.blocks.map((block) => block.content).join('\n') ?? '',
    getSelection: () => EMPTY_SELECTION,
    canUndo: () => false,
    canRedo: () => false,
    toggleTodoChecked: () => false,
    selectSlashMenuCommand: () => null,
    closeSlashMenu: vi.fn(),
    executeSlashMenuCommand: vi.fn(),
    posFromDOM: () => 0,
    resolveSelectionFromDOM: () => null,
    getAILockedBlocks: () => [],
    getBlockInfo: () => null,
    __getElement: () => element,
    __destroyed: destroyed,
  } as unknown as EditorPort & {
    __getElement: () => HTMLElement | null;
    __destroyed: ReturnType<typeof vi.fn>;
  };

  return port;
}

function createEditorPortFactory() {
  const ports: Array<ReturnType<typeof createEditorPortStub>> = [];
  const factory: EditorPortFactory = {
    create: vi.fn(() => {
      const port = createEditorPortStub();
      ports.push(port);
      return port;
    }),
  };
  return { factory, ports };
}

describe('EditorServiceImpl - multi-pane mounted editors', () => {
  let editor: EditorServiceImpl;
  let factory: ReturnType<typeof createEditorPortFactory>;
  let fs: MemoryFileSystemAdapter;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    fs.seed({
      '/notes/a.md': frontmatterDoc('A'),
      '/notes/b.md': frontmatterDoc('B'),
    });

    factory = createEditorPortFactory();
    editor = new EditorServiceImpl(
      new MarkdownAdapter(fs, { basePath: '/notes' }),
      createCommandRegistryStub(),
      factory.factory,
      undefined,
      undefined,
      undefined,
      undefined,
      '/notes',
    );
  });

  afterEach(() => {
    editor.destroy();
  });

  it('mounts two independent pane editors for two note paths', async () => {
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    document.body.append(hostA, hostB);

    expect((await editor.mountPane('pane-a', hostA, 'a.md')).ok).toBe(true);
    expect((await editor.mountPane('pane-b', hostB, 'b.md')).ok).toBe(true);

    const state = editor.getState();
    expect(Object.keys(state.panes).sort()).toEqual(['pane-a', 'pane-b']);
    expect(state.panes['pane-a']?.document?.path).toBe('a.md');
    expect(state.panes['pane-b']?.document?.path).toBe('b.md');
    expect(factory.ports).toHaveLength(2);
  });

  it('focusPane switches the active command target without unmounting siblings', async () => {
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    document.body.append(hostA, hostB);
    await editor.mountPane('pane-a', hostA, 'a.md');
    await editor.mountPane('pane-b', hostB, 'b.md');

    editor.focusPane('pane-a');

    expect(editor.getState().activePaneId).toBe('pane-a');
    expect(editor.getState().activePath).toBe('a.md');
    expect(Object.keys(editor.getState().panes).sort()).toEqual(['pane-a', 'pane-b']);
    expect(factory.ports[0]?.__destroyed).not.toHaveBeenCalled();
    expect(factory.ports[1]?.__destroyed).not.toHaveBeenCalled();
  });

  it('persists active pane title metadata without changing the note path', async () => {
    const hostA = document.createElement('div');
    document.body.append(hostA);
    await editor.mountPane('pane-a', hostA, 'a.md');

    const result = editor.updateDocumentMeta({ title: 'A Live Title' });

    expect(result.ok).toBe(true);
    expect(editor.getState().activePath).toBe('a.md');
    expect(editor.getState().tabs.map((tab) => tab.path)).toEqual(['a.md']);
    expect(editor.getState().panes['pane-a']?.document?.meta.title).toBe('A Live Title');
    expect(factory.ports[0]?.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A Live Title' }),
    );

    await editor.savePane('pane-a');
    const saved = await fs.readFile('/notes/a.md');
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value).toContain('title: A Live Title');
    }
  });

  it('openDocument focuses an already mounted note pane', async () => {
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    document.body.append(hostA, hostB);
    await editor.mountPane('pane-a', hostA, 'a.md');
    await editor.mountPane('pane-b', hostB, 'b.md');

    const result = await editor.openDocument('a.md');

    expect(result.ok).toBe(true);
    expect(editor.getState().activePaneId).toBe('pane-a');
    expect(editor.getState().activePath).toBe('a.md');
    expect(editor.getState().tabs.map((tab) => tab.path)).toEqual(['a.md', 'b.md']);
  });

  it('owner-scoped unmount cannot remove a newer editor mounted in the same pane id', async () => {
    const oldHost = document.createElement('div');
    const newHost = document.createElement('div');
    document.body.append(oldHost, newHost);
    await editor.mountPane('pane-a', oldHost, 'a.md');
    await editor.mountPane('pane-a', newHost, 'a.md');

    editor.unmountPane('pane-a', oldHost);

    expect(editor.getState().panes['pane-a']?.path).toBe('a.md');
    expect(factory.ports[1]?.__getElement()).toBe(newHost);
    expect(factory.ports[1]?.__destroyed).not.toHaveBeenCalled();
  });
});
