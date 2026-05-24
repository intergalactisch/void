import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { NoteCollaborationServiceImpl } from '$lib/application/services/NoteCollaborationServiceImpl';
import type { Block } from '$lib/domain';
import type {
  DocumentService,
  EditorService,
  NotesService,
} from '$lib/ports/inbound';
import type { LineageRecordOptions } from '$lib/ports/inbound/LineageService';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import { resourceLock } from '$lib/events/queue/ResourceLock';

describe('NoteCollaborationServiceImpl lineage metadata', () => {
  beforeEach(() => {
    resourceLock.clear();
  });

  afterEach(() => {
    resourceLock.clear();
  });

  it('passes explicit lineage metadata to inactive note writes', async () => {
    const writeContent = vi.fn().mockResolvedValue(ok(undefined));
    const service = createService({
      documents: { writeContent } as unknown as DocumentService,
      editor: createEditor({ activePath: 'other.md' }),
    });
    const lineage = createRestoreLineage();

    const result = await service.applyNoteContent('note.md', 'Restored', 'Restore line', lineage);

    expect(result.ok).toBe(true);
    expect(writeContent).toHaveBeenCalledWith('note.md', 'Restored', lineage);
  });

  it('passes explicit lineage metadata to active editor saves', async () => {
    const saveDocument = vi.fn().mockResolvedValue(ok(undefined));
    const service = createService({
      editor: createEditor({ activePath: 'note.md', saveDocument }),
      markdown: createMarkdown(),
    });
    const lineage = createRestoreLineage();

    const result = await service.applyNoteContent('note.md', 'Restored', 'Restore line', lineage);

    expect(result.ok).toBe(true);
    expect(saveDocument).toHaveBeenCalledWith(lineage);
  });

  it('appends inactive note content with an atomic document transform', async () => {
    const lineage = createRestoreLineage();
    const transformContent = vi.fn(
      async (_path: string, transform: (current: string) => string | Promise<string>) =>
        ok(await transform('# Saved\n\nExisting'))
    );
    const service = createService({
      documents: {
        writeContent: vi.fn().mockResolvedValue(ok(undefined)),
        transformContent,
      } as unknown as DocumentService,
      editor: createEditor({ activePath: 'other.md' }),
    });

    const result = await service.appendNoteContent('note.md', '## Update\n\nAdded', 'Swarm update', lineage);

    expect(result.ok).toBe(true);
    expect(transformContent).toHaveBeenCalledWith('note.md', expect.any(Function), lineage);
    const transform = transformContent.mock.calls[0]![1];
    await expect(Promise.resolve(transform('# Saved\n\nExisting'))).resolves.toBe(
      '# Saved\n\nExisting\n\n## Update\n\nAdded'
    );
  });

  it('appends active note content from current editor blocks before saving', async () => {
    const lineage = createRestoreLineage();
    const saveDocument = vi.fn().mockResolvedValue(ok(undefined));
    const serializeBlocks = vi.fn((blocks: Block[]) => blocks.map((block) => block.content).join('\n'));
    const parseToBlocks = vi.fn((markdown: string) => [createBlock(markdown)]);
    const editor = createEditor({
      activePath: 'note.md',
      saveDocument,
      blocks: [createBlock('Unsaved editor text')],
    });
    const service = createService({
      editor,
      markdown: { serializeBlocks, parseToBlocks } as unknown as MarkdownSerializerPort,
    });

    const result = await service.appendNoteContent('note.md', '## Update\n\nAdded', 'Swarm update', lineage);

    expect(result.ok).toBe(true);
    expect(parseToBlocks).toHaveBeenCalledWith('Unsaved editor text\n\n## Update\n\nAdded');
    expect(editor.startAIBlockOperation).toHaveBeenCalledWith(
      'block-1',
      'Swarm update',
      'Unsaved editor text\n\n## Update\n\nAdded'
    );
    expect(editor.finishAIBlockOperation).toHaveBeenCalledWith(
      'block-1',
      'Unsaved editor text\n\n## Update\n\nAdded'
    );
    expect(saveDocument).toHaveBeenCalledWith(lineage);
  });

  it('exposes lineage ownership while appending to an active note', async () => {
    let releaseSave: (() => void) | null = null;
    let markSaveStarted: (() => void) | null = null;
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    const saveDocument = vi.fn().mockImplementation(async () => {
      markSaveStarted?.();
      await new Promise<void>((release) => {
        releaseSave = release;
      });
      return ok(undefined);
    });
    const lineage: LineageRecordOptions = {
      actor: { kind: 'ai-agent' },
      intentKind: 'rewrite',
      summary: 'Swarm append from worker',
      commandId: 'agent:swarm',
      agentRunId: 'run-swarm',
      source: { type: 'tool' },
    };
    const service = createService({
      editor: createEditor({
        activePath: 'note.md',
        saveDocument,
        blocks: [createBlock('Unsaved editor text')],
      }),
    });

    const append = service.appendNoteContent('note.md', '## Update', 'Swarm append', lineage);
    await saveStarted;

    expect(resourceLock.snapshot()).toEqual([
      expect.objectContaining({
        resourceId: 'note:note.md',
        held: true,
        queued: 0,
        holder: expect.objectContaining({
          id: 'run-swarm',
          kind: 'agent',
          label: 'Swarm append from worker',
          runId: 'run-swarm',
          toolId: 'agent:swarm',
        }),
      }),
      expect.objectContaining({
        resourceId: 'note:save:note.md',
        held: true,
        queued: 0,
        holder: expect.objectContaining({
          id: 'run-swarm',
          kind: 'agent',
          label: 'Swarm append from worker',
          runId: 'run-swarm',
          toolId: 'agent:swarm',
        }),
      }),
    ]);

    releaseSave?.();
    await expect(append).resolves.toMatchObject({ ok: true });
  });

  it('serializes concurrent active editor writes to the same block', async () => {
    const order: string[] = [];
    let currentMarkdown = '';
    const saveDocument = vi.fn().mockImplementation(async () => {
      const markdown = currentMarkdown;
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${markdown}`);
      return ok(undefined);
    });
    const editor = createEditor({ activePath: 'note.md', saveDocument });
    (editor.startAIBlockOperation as ReturnType<typeof vi.fn>).mockImplementation(
      (_blockId: string, _label: string, markdown: string) => {
        currentMarkdown = markdown;
        order.push(`start:${markdown}`);
      },
    );
    const service = createService({ editor });

    const results = await Promise.all([
      service.replaceBlock({ blockId: 'block-1', markdown: 'First replacement' }),
      service.replaceBlock({ blockId: 'block-1', markdown: 'Second replacement' }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(order).toEqual([
      'start:First replacement',
      'end:First replacement',
      'start:Second replacement',
      'end:Second replacement',
    ]);
  });

  it('lets different active-editor block lanes stage while saves stay ordered', async () => {
    const order: string[] = [];
    let saveCount = 0;
    const saveDocument = vi.fn().mockImplementation(async () => {
      saveCount += 1;
      const index = saveCount;
      order.push(`save-start:${index}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`save-end:${index}`);
      return ok(undefined);
    });
    const editor = createEditor({ activePath: 'note.md', saveDocument });
    (editor.startAIBlockOperation as ReturnType<typeof vi.fn>).mockImplementation(
      (blockId: string, _label: string, markdown: string) => {
        order.push(`start:${blockId}:${markdown}`);
      },
    );
    const service = createService({ editor });

    const results = await Promise.all([
      service.replaceBlock({ blockId: 'block-1', markdown: 'First replacement' }),
      service.replaceBlock({ blockId: 'block-2', markdown: 'Second replacement' }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(order).toEqual([
      'start:block-1:First replacement',
      'start:block-2:Second replacement',
      'save-start:1',
      'save-end:1',
      'save-start:2',
      'save-end:2',
    ]);
  });

  it('records lineage metadata when replacing a block', async () => {
    const saveDocument = vi.fn().mockResolvedValue(ok(undefined));
    const lineage = createRestoreLineage();
    const service = createService({
      editor: createEditor({ activePath: 'note.md', saveDocument }),
    });

    const result = await service.replaceBlock({
      blockId: 'block-1',
      markdown: 'Replacement',
      lineage,
    });

    expect(result.ok).toBe(true);
    expect(saveDocument).toHaveBeenCalledWith(lineage);
  });
});

function createRestoreLineage(): LineageRecordOptions {
  return {
    actor: { kind: 'ai-agent' },
    intentKind: 'restore',
    summary: 'Restore line',
    commandId: 'lineage:revert',
    source: { type: 'tool' },
  };
}

function createService(overrides: {
  editor?: EditorService;
  documents?: DocumentService;
  notes?: NotesService;
  markdown?: MarkdownSerializerPort;
} = {}): NoteCollaborationServiceImpl {
  return new NoteCollaborationServiceImpl(
    overrides.editor ?? createEditor(),
    overrides.documents ?? ({
      writeContent: vi.fn().mockResolvedValue(ok(undefined)),
      transformContent: vi.fn(async (_path: string, transform: (current: string) => string | Promise<string>) =>
        ok(await transform(''))
      ),
    } as unknown as DocumentService),
    overrides.notes ?? ({} as NotesService),
    overrides.markdown ?? createMarkdown(),
  );
}

function createEditor(options: {
  activePath?: string;
  saveDocument?: ReturnType<typeof vi.fn>;
  blocks?: Block[];
} = {}): EditorService {
  const blocks = options.blocks ?? [createBlock(options.activePath ? 'Existing' : '')];
  return {
    getState: () => ({
      document: options.activePath
        ? {
            path: options.activePath,
            blocks,
            meta: { title: 'Note' },
            isDirty: false,
          }
        : null,
      selection: {},
    }),
    saveDocument: options.saveDocument ?? vi.fn().mockResolvedValue(ok(undefined)),
    startAIBlockOperation: vi.fn(),
    scrollBlockIntoView: vi.fn(),
    streamAIBlock: vi.fn(),
    finishAIBlockOperation: vi.fn(),
    unlockBlockFromAI: vi.fn(),
    insertContentAfterBlock: vi.fn(),
    insertContent: vi.fn(),
    deleteBlock: vi.fn(),
  } as unknown as EditorService;
}

function createMarkdown(): MarkdownSerializerPort {
  return {
    parseToBlocks: (markdown: string) => [createBlock(markdown)],
    serializeBlocks: (blocks: Block[]) => blocks.map((block) => block.content).join('\n'),
    parseDocument: (markdown: string) => ({
      content: markdown,
      meta: {},
      blocks: [createBlock(markdown)],
    }),
  } as MarkdownSerializerPort;
}

function createBlock(content: string): Block {
  return {
    id: 'block-1',
    type: 'paragraph',
    content,
    attrs: {},
    children: [],
  } as Block;
}
