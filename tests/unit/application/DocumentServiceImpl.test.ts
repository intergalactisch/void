/**
 * DocumentServiceImpl Tests
 *
 * Tests for the headless document content API, focusing on:
 * - createWithContent (the race condition location)
 * - readContent
 * - writeContent
 * - readMeta / updateMeta
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentServiceImpl } from '$lib/application/services/DocumentServiceImpl';
import type { DocumentPort, MarkdownSerializerPort } from '$lib/ports/outbound';
import type { LineageService, NotesService, NotesState, NotesListItem, TodoService } from '$lib/ports/inbound';
import type { Document, DocumentMeta } from '$lib/domain';
import { ok, err } from '$lib/core';
import { resourceLock } from '$lib/events/queue/ResourceLock';

vi.mock('$lib/events/bus', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('$lib/logging', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Create a mock DocumentMeta.
 */
function createMeta(title: string): DocumentMeta {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    category: null,
    color: null,
    pinned: false,
    status: 'draft',
    intent: 'general',
    aiTouches: 0,
    custom: {},
  };
}

/**
 * Create a mock DocumentPort for testing.
 */
function createMockDocumentPort(): DocumentPort {
  const documents = new Map<string, Document>();

  return {
    load: vi.fn().mockImplementation(async (path: string) => {
      if (documents.has(path)) {
        return ok(documents.get(path)!);
      }
      return err(new Error(`Document not found: ${path}`));
    }),
    save: vi.fn().mockImplementation(async (doc: Document) => {
      documents.set(doc.path, doc);
      return ok(undefined);
    }),
    delete: vi.fn().mockImplementation(async (path: string) => {
      documents.delete(path);
      return ok(undefined);
    }),
    list: vi.fn().mockResolvedValue(ok([])),
    listFolders: vi.fn().mockResolvedValue(ok([])),
    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(ok(documents.has(path))),
    ),
    create: vi.fn().mockImplementation(async (path: string, title?: string) => {
      const doc: Document = {
        path,
        meta: createMeta(title || 'Untitled'),
        blocks: [],
      };
      documents.set(path, doc);
      return ok(doc);
    }),
    watch: vi.fn().mockReturnValue(() => {}),
  };
}

/**
 * Create a mock NotesService that syncs with a DocumentPort.
 */
function createMockNotesService(docPort: DocumentPort): NotesService {
  const state: NotesState = {
    items: [],
    tagGroups: [],
    selectedPath: null,
    isLoading: false,
    searchQuery: '',
    expandedFolders: new Set(),
  };

  return {
    getState: vi.fn().mockReturnValue(state),
    loadFolderTree: vi.fn().mockResolvedValue(ok([])),
    refresh: vi.fn().mockResolvedValue(ok([])),
    createNote: vi.fn().mockImplementation(async (_folder: string, title: string) => {
      const path = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md';
      // Create in the document port so writeContent can find it
      const result = await docPort.create(path, title);
      if (!result.ok) return result;
      return ok(result.value);
    }),
    createQuickNote: vi.fn().mockResolvedValue(ok({ path: 'quick.md', meta: createMeta('Quick'), blocks: [] })),
    deleteNote: vi.fn().mockResolvedValue(ok(undefined)),
    renameNote: vi.fn().mockResolvedValue(ok('renamed.md')),
    searchNotes: vi.fn().mockResolvedValue(ok([])),
    selectNote: vi.fn(),
    getSelectedPath: vi.fn().mockReturnValue(null),
    toggleFolder: vi.fn(),
    expandFolder: vi.fn(),
    collapseFolder: vi.fn(),
    isFolderExpanded: vi.fn().mockReturnValue(false),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

/**
 * Stub MarkdownSerializerPort. The DocumentServiceImpl no longer
 * imports the markdown adapter directly — it depends on this port —
 * so tests inject a deterministic stub.
 */
function createMockMarkdownSerializer(): MarkdownSerializerPort {
  return {
    parseToBlocks: vi.fn().mockReturnValue([]),
    serializeBlocks: vi.fn().mockReturnValue('# Test\n\nContent'),
    parseDocument: vi.fn().mockReturnValue({ content: '', meta: {}, blocks: [] }),
  };
}

function createMockTodoService(): TodoService {
  return {
    initialize: vi.fn().mockResolvedValue(ok(undefined)),
    shutdown: vi.fn(),
    getAll: vi.fn().mockResolvedValue(ok([])),
    getById: vi.fn().mockResolvedValue(ok(null)),
    getBySource: vi.fn().mockResolvedValue(ok([])),
    toggle: vi.fn(),
    toggleFromEditor: vi.fn().mockResolvedValue(ok(undefined)),
    create: vi.fn(),
    quickCreate: vi.fn(),
    update: vi.fn(),
    updatePatch: vi.fn(),
    delete: vi.fn(),
    ensureTodoFile: vi.fn().mockResolvedValue(ok('/notes/TODO.md')),
    syncFileSnapshot: vi.fn().mockResolvedValue(ok(undefined)),
    clearFileSnapshot: vi.fn().mockResolvedValue(ok(undefined)),
    syncSavedFile: vi.fn().mockResolvedValue(ok(undefined)),
    getStats: vi.fn().mockResolvedValue({ total: 0, open: 0, completed: 0, overdue: 0, dueToday: 0 }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  } as TodoService;
}

function createMockLineageService(): LineageService {
  return {
    enqueueMarkdownChange: vi.fn().mockResolvedValue(ok({
      jobId: 'job_1',
      notePath: 'test.md',
      queuedAt: new Date().toISOString(),
    })),
    recordMarkdownChange: vi.fn().mockResolvedValue(ok({
      snapshot: null,
      patch: null,
      matches: [],
      entries: [],
    })),
    flush: vi.fn().mockResolvedValue(ok(undefined)),
    getQueueStatus: vi.fn().mockReturnValue({ pendingJobs: 0, activeJobs: 0, lastError: null }),
    getSnapshot: vi.fn().mockResolvedValue(ok(null)),
    getJournal: vi.fn().mockResolvedValue(ok([])),
    getLineHistory: vi.fn(),
    explainLine: vi.fn(),
    materialize: vi.fn(),
    previewRevertLine: vi.fn(),
    getReconciliationWarnings: vi.fn().mockResolvedValue(ok([])),
    getEditClusters: vi.fn().mockResolvedValue(ok([])),
    getAgentContext: vi.fn(),
    repairLineMatch: vi.fn(),
  } as unknown as LineageService;
}

describe('DocumentServiceImpl', () => {
  let documentPort: DocumentPort;
  let notesService: NotesService;
  let markdown: MarkdownSerializerPort;
  let todoService: TodoService;
  let lineageService: LineageService;
  let service: DocumentServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    resourceLock.clear();
    documentPort = createMockDocumentPort();
    notesService = createMockNotesService(documentPort);
    markdown = createMockMarkdownSerializer();
    todoService = createMockTodoService();
    lineageService = createMockLineageService();
    service = new DocumentServiceImpl(documentPort, notesService, markdown, todoService, lineageService);
  });

  afterEach(() => {
    resourceLock.clear();
  });

  describe('readContent', () => {
    it('reads content from an existing document', async () => {
      // Create a document first
      await documentPort.create('test.md', 'Test Note');

      const result = await service.readContent('test.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value).toBe('string');
      }
    });

    it('returns error for non-existent document', async () => {
      const result = await service.readContent('nonexistent.md');

      expect(result.ok).toBe(false);
    });

    it('redacts unlocked protected line plaintext from headless reads', async () => {
      await documentPort.create('test.md', 'Test Note');
      (markdown.serializeBlocks as ReturnType<typeof vi.fn>).mockReturnValue([
        '```void-protected-lines-v1',
        JSON.stringify({
          id: 'pblk_1',
          version: 1,
          algorithm: 'AES-256-GCM',
          keyId: 'pkey_1',
          nonce: 'nonce',
          ciphertext: 'ciphertext',
          wrappedDek: { version: 1, algorithm: 'AES-256-GCM', kdf: 'none', nonce: 'n', ciphertext: 'c' },
          lineCount: 1,
          protectedAt: '2026-05-24T00:00:00.000Z',
          titleVisible: true,
          __void: { lockState: 'unlocked', plaintext: 'API_KEY=secret' },
        }, null, 2),
        '```',
      ].join('\n'));

      const result = await service.readContent('test.md');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toContain('API_KEY=secret');
      expect(result.value).not.toContain('__void');
      expect(result.value).toContain('void-protected-lines-v1');
    });
  });

  describe('writeContent', () => {
    it('writes content to an existing document', async () => {
      // Create a document first
      await documentPort.create('test.md', 'Test Note');

      const result = await service.writeContent('test.md', '# Updated\n\nNew content');

      expect(result.ok).toBe(true);
      expect(documentPort.save).toHaveBeenCalled();
    });

    it('refreshes notes list after writing', async () => {
      await documentPort.create('test.md', 'Test Note');

      await service.writeContent('test.md', '# Updated');

      expect(notesService.refresh).toHaveBeenCalled();
    });

    it('syncs markdown todos after writing generated content', async () => {
      await documentPort.create('test.md', 'Test Note');

      const result = await service.writeContent('test.md', '# Updated\n\n- [ ] Follow up');

      expect(result.ok).toBe(true);
      expect(todoService.syncSavedFile).toHaveBeenCalledWith('test.md');
    });

    it('records line-level lineage after writing generated content', async () => {
      await documentPort.create('test.md', 'Test Note');

      const result = await service.writeContent('test.md', '# Updated', {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'AI rewrite',
      });

      expect(result.ok).toBe(true);
      expect(lineageService.enqueueMarkdownChange).toHaveBeenCalledWith(
        'test.md',
        '# Updated',
        expect.objectContaining({
          actor: { kind: 'ai-agent' },
          intentKind: 'rewrite',
          summary: 'AI rewrite',
        }),
      );
    });

    it('blocks AI writes to notes containing protected line capsules', async () => {
      const created = await documentPort.create('test.md', 'Test Note');
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      created.value.blocks = [{
        id: 'block-protected',
        type: 'protectedBlock',
        content: '',
        marks: [],
        children: [],
        attrs: {
          type: 'protectedBlock',
          protectionId: 'pblk_1',
          keyId: 'pkey_1',
          algorithm: 'AES-256-GCM',
          envelopeVersion: 1,
          protectedAt: '2026-05-24T00:00:00.000Z',
          titleVisible: true,
          lineCount: 1,
          lockState: 'unlocked',
          envelope: '{}',
        },
      }];

      const result = await service.writeContent('test.md', '# Updated', {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'AI rewrite',
      });

      expect(result.ok).toBe(false);
      expect(documentPort.save).not.toHaveBeenCalled();
    });

    it('exposes lineage ownership while a generated write holds the note lane', async () => {
      await documentPort.create('test.md', 'Test Note');
      let releaseSave: (() => void) | null = null;
      const saveStarted = new Promise<void>((resolve) => {
        (documentPort.save as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          resolve();
          await new Promise<void>((release) => {
            releaseSave = release;
          });
          return ok(undefined);
        });
      });

      const write = service.writeContent('test.md', '# Updated', {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'Swarm update from writer',
        commandId: 'agent:swarm',
        agentRunId: 'run-swarm',
        source: { type: 'tool' },
      });
      await saveStarted;

      expect(resourceLock.snapshot()).toEqual([
        {
          resourceId: 'note:test.md',
          held: true,
          queued: 0,
          holder: {
            id: 'run-swarm',
            kind: 'agent',
            label: 'Swarm update from writer',
            runId: 'run-swarm',
            toolId: 'agent:swarm',
          },
        },
      ]);

      releaseSave?.();
      await expect(write).resolves.toMatchObject({ ok: true });
    });

    it('returns error for non-existent document', async () => {
      const result = await service.writeContent('nonexistent.md', 'content');

      expect(result.ok).toBe(false);
    });

    it('serializes concurrent writes to the same note path', async () => {
      await documentPort.create('shared.md', 'Shared');
      const order: string[] = [];
      const saveSpy = documentPort.save as ReturnType<typeof vi.fn>;

      (markdown.parseToBlocks as ReturnType<typeof vi.fn>).mockImplementation((value: string) => [{
        id: value,
        type: 'paragraph',
        content: value,
        marks: [],
        children: [],
        attrs: { type: 'paragraph' },
      }]);
      saveSpy.mockImplementation(async (doc: Document) => {
        const label = doc.blocks[0]?.content ?? 'unknown';
        order.push(`start:${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${label}`);
        return ok(undefined);
      });

      const results = await Promise.all([
        service.writeContent('shared.md', 'first write'),
        service.writeContent('shared.md', 'second write'),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order).toEqual([
        'start:first write',
        'end:first write',
        'start:second write',
        'end:second write',
      ]);
    });

    it('allows concurrent writes to different note paths', async () => {
      await documentPort.create('first.md', 'First');
      await documentPort.create('second.md', 'Second');
      const order: string[] = [];
      const saveSpy = documentPort.save as ReturnType<typeof vi.fn>;

      (markdown.parseToBlocks as ReturnType<typeof vi.fn>).mockImplementation((value: string) => [{
        id: value,
        type: 'paragraph',
        content: value,
        marks: [],
        children: [],
        attrs: { type: 'paragraph' },
      }]);
      saveSpy.mockImplementation(async (doc: Document) => {
        const label = doc.blocks[0]?.content ?? 'unknown';
        order.push(`start:${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${label}`);
        return ok(undefined);
      });

      const results = await Promise.all([
        service.writeContent('first.md', 'first note'),
        service.writeContent('second.md', 'second note'),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(order.slice(0, 2)).toEqual(['start:first note', 'start:second note']);
    });
  });

  describe('transformContent', () => {
    beforeEach(() => {
      (markdown.parseToBlocks as ReturnType<typeof vi.fn>).mockImplementation((value: string) => [{
        id: value,
        type: 'paragraph',
        content: value,
        marks: [],
        children: [],
        attrs: { type: 'paragraph' },
      }]);
      (markdown.serializeBlocks as ReturnType<typeof vi.fn>).mockImplementation((blocks: Document['blocks']) =>
        blocks.map((block) => block.content).join('\n')
      );
    });

    it('atomically transforms and saves markdown content', async () => {
      await documentPort.create('test.md', 'Test Note');
      await service.writeContent('test.md', 'Base');

      const result = await service.transformContent(
        'test.md',
        (current) => `${current}\nAppendix`,
        {
          actor: { kind: 'ai-agent' },
          intentKind: 'rewrite',
          summary: 'Append from swarm',
        },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Base\nAppendix');
      }
      const read = await service.readContent('test.md');
      expect(read.ok && read.value).toBe('Base\nAppendix');
      expect(lineageService.enqueueMarkdownChange).toHaveBeenLastCalledWith(
        'test.md',
        'Base\nAppendix',
        expect.objectContaining({ summary: 'Append from swarm' }),
      );
    });

    it('serializes concurrent transforms to the same note path', async () => {
      await documentPort.create('shared.md', 'Shared');
      await service.writeContent('shared.md', 'Base');

      const results = await Promise.all([
        service.transformContent('shared.md', async (current) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return `${current}\nFirst append`;
        }),
        service.transformContent('shared.md', (current) => `${current}\nSecond append`),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      const read = await service.readContent('shared.md');
      expect(read.ok && read.value).toBe('Base\nFirst append\nSecond append');
    });
  });

  describe('readMeta', () => {
    it('reads metadata from a document', async () => {
      await documentPort.create('test.md', 'My Note');

      const result = await service.readMeta('test.md');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('My Note');
      }
    });
  });

  describe('updateMeta', () => {
    it('updates metadata partially', async () => {
      await documentPort.create('test.md', 'Original');

      const result = await service.updateMeta('test.md', { title: 'Updated Title' });

      expect(result.ok).toBe(true);
      expect(documentPort.save).toHaveBeenCalled();
    });

    it('preserves unspecified metadata fields', async () => {
      await documentPort.create('test.md', 'Original');

      await service.updateMeta('test.md', { tags: ['#New Tag', 'new-tag'] });

      const saved = (documentPort.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Document;
      expect(saved.meta.title).toBe('Original');
      expect(saved.meta.tags).toEqual(['new-tag']);
    });
  });

  describe('createWithContent', () => {
    it('creates a note without content', async () => {
      const result = await service.createWithContent('', 'Empty Note');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Empty Note');
        expect(result.value.path).toBe('empty-note.md');
      }
      expect(notesService.createNote).toHaveBeenCalledWith(
        '', 'Empty Note', expect.objectContaining({ autoFocus: false }),
      );
    });

    it('creates a note with markdown content', async () => {
      const result = await service.createWithContent('', 'Content Note', '# Hello\n\nWorld');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Content Note');
      }
      // createNote is called first, then writeContent saves
      expect(notesService.createNote).toHaveBeenCalled();
    });

    it('creates a note in a folder', async () => {
      const result = await service.createWithContent('my-folder', 'Folder Note');

      expect(result.ok).toBe(true);
      expect(notesService.createNote).toHaveBeenCalledWith(
        'my-folder', 'Folder Note', expect.objectContaining({ autoFocus: false }),
      );
    });

    it('propagates createNote errors', async () => {
      (notesService.createNote as ReturnType<typeof vi.fn>).mockResolvedValue(
        err(new Error('Failed to create')),
      );

      const result = await service.createWithContent('', 'Failing Note');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to create');
      }
    });

    it('propagates writeContent errors', async () => {
      // createNote succeeds but the document can't be loaded for writing
      (notesService.createNote as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ path: 'orphan.md', meta: createMeta('Orphan'), blocks: [] }),
      );

      const result = await service.createWithContent('', 'Orphan Note', '# Content');

      // writeContent will fail because documentPort.load('orphan.md') returns error
      expect(result.ok).toBe(false);
    });

    it('calls createNote before writeContent (order matters for race condition)', async () => {
      const callOrder: string[] = [];

      (notesService.createNote as ReturnType<typeof vi.fn>).mockImplementation(
        async (_folder: string, title: string) => {
          callOrder.push('createNote');
          const path = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md';
          // Create in documentPort so writeContent can find it
          await documentPort.create(path, title);
          return ok({ path, meta: createMeta(title), blocks: [] } as Document);
        },
      );

      // Wrap save to track calls without recursion
      const saveSpy = documentPort.save as ReturnType<typeof vi.fn>;
      const origImpl = saveSpy.getMockImplementation();
      saveSpy.mockImplementation(async (doc: Document) => {
        callOrder.push('writeContent');
        // Call the original implementation directly
        const documents = new Map<string, Document>();
        documents.set(doc.path, doc);
        return ok(undefined);
      });

      await service.createWithContent('', 'Order Test', '# Content');

      expect(callOrder[0]).toBe('createNote');
      // writeContent should come after createNote
      expect(callOrder.indexOf('writeContent')).toBeGreaterThan(callOrder.indexOf('createNote'));
    });
  });
});
