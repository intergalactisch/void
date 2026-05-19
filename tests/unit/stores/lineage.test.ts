import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { events } from '$lib/events';
import { lineageStore } from '$lib/stores/lineage.svelte';
import type {
  CommitmentLineageService,
  EditorService,
  LineageService,
  NoteCollaborationService,
} from '$lib/ports/inbound';
import type { Block } from '$lib/domain/entities/Block';

describe('lineageStore', () => {
  afterEach(() => {
    lineageStore.destroy();
  });

  it('opens from editor gutter events and loads line history', async () => {
    const lineage = createLineageService();
    lineageStore.init(
      lineage,
      createCollaboration(),
      createCommitmentLineage(),
      createEditor('launch.md'),
    );

    events.emit('editor:lineage-inspect-request', {
      blockId: 'block-1',
      lineIndex: 0,
      position: { top: 10, left: 20 },
      currentType: 'paragraph',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lineageStore.visible).toBe(true);
    expect(lineageStore.notePath).toBe('launch.md');
    expect(lineageStore.explanation?.unitId).toBe('lu_1');
    expect(lineageStore.explanation?.currentVersion.context?.before[0]?.content).toBe('Before content');
    expect(lineageStore.activeCluster?.summary).toBe('Updated by user touched line 1');
    expect(lineage.getLineHistory).toHaveBeenCalledWith('launch.md', 'lu_1');
  });

  it('translates clicked block ids to serialized markdown line indexes', async () => {
    const lineage = createLineageService();
    const blocks = [
      createParagraph('block-1', 'First paragraph'),
      createParagraph('block-2', 'Second paragraph'),
    ];
    lineageStore.init(
      lineage,
      createCollaboration(),
      createCommitmentLineage(),
      createEditor('launch.md', blocks),
    );

    events.emit('editor:lineage-inspect-request', {
      blockId: 'block-2',
      lineIndex: 1,
      position: { top: 10, left: 20 },
      currentType: 'paragraph',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lineageStore.lineIndex).toBe(2);
    expect(lineage.explainLine).toHaveBeenCalledWith('launch.md', 2);
    expect(lineage.getTimeline).toHaveBeenCalledWith(
      'launch.md',
      expect.objectContaining({ selectedLine: 2 }),
    );
  });

  it('restores a selected historical version through collaboration', async () => {
    const applyNoteContent = vi.fn().mockResolvedValue(ok(undefined));
    lineageStore.init(
      createLineageService(),
      createCollaboration(applyNoteContent),
      createCommitmentLineage(),
      createEditor('launch.md'),
    );

    await lineageStore.open('launch.md', 0);
    const restored = await lineageStore.restoreVersion('lv_old');

    expect(restored).toBe(true);
    expect(applyNoteContent).toHaveBeenCalledWith(
      'launch.md',
      'Old content',
      'Restore line',
      expect.objectContaining({ intentKind: 'restore', commandId: 'lineage-workspace:restore' }),
    );
  });

  it('previews and applies deleted line recovery through collaboration', async () => {
    const applyNoteContent = vi.fn().mockResolvedValue(ok(undefined));
    const lineage = createLineageService();
    lineageStore.init(
      lineage,
      createCollaboration(applyNoteContent),
      createCommitmentLineage(),
      createEditor('launch.md'),
    );

    await lineageStore.openWorkspace('launch.md');
    const previewed = await lineageStore.previewDeletedRestore('lu_deleted', 'lv_deleted');
    const restored = await lineageStore.applyDeletedRestore();

    expect(previewed).toBe(true);
    expect(restored).toBe(true);
    expect(lineage.previewRestoreDeletedLine).toHaveBeenCalledWith('launch.md', 'lu_deleted', 'lv_deleted');
    expect(applyNoteContent).toHaveBeenCalledWith(
      'launch.md',
      'Current content\nDeleted content',
      'Restore deleted line',
      expect.objectContaining({
        intentKind: 'restore',
        commandId: 'lineage-workspace:restore-deleted',
        lineSources: [{ lineIndex: 1, sourceVersionIds: ['lv_deleted'] }],
      }),
    );
  });
});

function createLineageService(): LineageService {
  const currentVersion = {
    id: 'lv_current',
    unitId: 'lu_1',
    notePath: 'launch.md',
    content: 'Current content',
    actor: { kind: 'user' as const },
    operationId: null,
    intentId: 'intent_1',
    sourceVersionIds: ['lv_old'],
    createdAt: new Date().toISOString(),
    supersededAt: null,
    contentHash: 'hash',
    contextHash: 'hash',
    context: {
      lineIndex: 0,
      lineCount: 2,
      documentHash: 'document-hash',
      before: [{ lineIndex: 0, content: 'Before content' }],
      after: [{ lineIndex: 1, content: 'After content' }],
      capturedAt: new Date().toISOString(),
    },
  };
  const oldVersion = { ...currentVersion, id: 'lv_old', content: 'Old content', sourceVersionIds: [] };
  const cluster = {
    id: 'cluster_1',
    notePath: 'launch.md',
    patchId: 'patch_1',
    intentId: 'intent_1',
    intent: { id: 'intent_1', kind: 'update' as const, actor: { kind: 'user' as const }, createdAt: new Date().toISOString(), summary: 'Updated' },
    createdAt: new Date().toISOString(),
    clusterId: 'cluster_1',
    captureReason: 'autosave' as const,
    kind: 'update' as const,
    changeTypes: ['unit.updated' as const],
    changedUnitIds: ['lu_1'],
    lineRange: { start: 1, end: 1 },
    versions: [{
      versionId: 'lv_current',
      unitId: 'lu_1',
      line: 1,
      content: 'Current content',
      actor: { kind: 'user' as const },
      intent: { id: 'intent_1', kind: 'update' as const, actor: { kind: 'user' as const }, createdAt: new Date().toISOString(), summary: 'Updated' },
      sourceVersionIds: ['lv_old'],
      createdAt: currentVersion.createdAt,
    }],
    deletedLines: [],
    warningIds: [],
    diffHunks: [{
      id: 'hunk_1',
      unitId: 'lu_1',
      line: 1,
      changeType: 'unit.updated' as const,
      before: 'Old content',
      after: 'Current content',
      tokens: [
        { type: 'removed' as const, text: 'Old' },
        { type: 'added' as const, text: 'Current' },
        { type: 'same' as const, text: ' content' },
      ],
      fromVersionId: 'lv_old',
      toVersionId: 'lv_current',
    }],
    summary: 'Updated by user touched line 1',
  };

  return {
    enqueueMarkdownChange: vi.fn().mockResolvedValue(ok({ jobId: 'job_1', notePath: 'launch.md', queuedAt: new Date().toISOString() })),
    recordMarkdownChange: vi.fn(),
    flush: vi.fn().mockResolvedValue(ok(undefined)),
    getQueueStatus: vi.fn().mockReturnValue({ pendingJobs: 0, activeJobs: 0, lastError: null }),
    getTimeline: vi.fn().mockResolvedValue(ok({
      notePath: 'launch.md',
      currentMarkdownHash: 'hash',
      queue: { pendingJobs: 0, activeJobs: 0, lastError: null },
      entries: [cluster],
      deletedLines: [],
      warnings: [],
      pendingEntry: null,
      summary: '1 lineage line. 1 durable edit cluster. 0 repair warnings.',
    })),
    explainLine: vi.fn().mockResolvedValue(ok({
      notePath: 'launch.md',
      lineIndex: 0,
      unitId: 'lu_1',
      currentVersion,
      intent: { id: 'intent_1', kind: 'update', actor: { kind: 'user' }, createdAt: new Date().toISOString(), summary: 'Updated' },
      previousVersions: [oldVersion],
    })),
    getLineHistory: vi.fn().mockResolvedValue(ok({ unitId: 'lu_1', versions: [oldVersion, currentVersion] })),
    getJournal: vi.fn().mockResolvedValue(ok([])),
    getReconciliationWarnings: vi.fn().mockResolvedValue(ok([])),
    getEditClusters: vi.fn().mockResolvedValue(ok([cluster])),
    getSnapshot: vi.fn().mockResolvedValue(ok({
      id: 'snapshot_1',
      notePath: 'launch.md',
      order: ['lu_1'],
      units: { lu_1: { id: 'lu_1', notePath: 'launch.md', granularity: 'line', currentVersionId: 'lv_current', parentUnitIds: [], childUnitIds: [], createdAt: new Date().toISOString(), deletedAt: null, status: 'active' } },
      versions: { lv_current: currentVersion, lv_old: oldVersion },
      intents: {},
      patches: {},
      reconciliationWarnings: {},
      currentMarkdownHash: 'hash',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    materialize: vi.fn().mockResolvedValue(ok('Current content')),
    previewRevertLine: vi.fn().mockResolvedValue(ok('Old content')),
    getDeletedLines: vi.fn().mockResolvedValue(ok([])),
    previewRestoreDeletedLine: vi.fn().mockResolvedValue(ok({
      notePath: 'launch.md',
      unitId: 'lu_deleted',
      versionId: 'lv_deleted',
      content: 'Deleted content',
      markdown: 'Current content\nDeleted content',
      insertLine: 2,
      strategy: 'context',
      confidence: 0.9,
      reason: 'Placed after surviving previous context line 1.',
    })),
    repairLineMatch: vi.fn().mockResolvedValue(ok({})),
    getAgentContext: vi.fn(),
  } as unknown as LineageService;
}

function createCollaboration(applyNoteContent = vi.fn().mockResolvedValue(ok(undefined))): NoteCollaborationService {
  return { applyNoteContent } as unknown as NoteCollaborationService;
}

function createCommitmentLineage(): CommitmentLineageService {
  return { getSourceForLine: vi.fn().mockResolvedValue(ok(null)) } as unknown as CommitmentLineageService;
}

function createEditor(path: string, blocks?: Block[]): EditorService {
  return {
    getState: () => ({
      document: { path, blocks, isDirty: false },
    }),
  } as unknown as EditorService;
}

function createParagraph(id: string, content: string): Block {
  return {
    id,
    type: 'paragraph',
    content,
    marks: [],
    children: [],
    attrs: { type: 'paragraph' },
  };
}
