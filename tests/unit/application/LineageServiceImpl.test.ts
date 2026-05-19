import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { MemoryLineageStorageAdapter } from '$lib/adapters/memory';
import type { LineageService } from '$lib/ports/inbound/LineageService';
import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import { ok } from '$lib/core';

describe('LineageServiceImpl', () => {
  let service: LineageService;

  beforeEach(() => {
    const lineageStorage = new MemoryLineageStorageAdapter();
    service = new LineageServiceImpl(lineageStorage);
  });

  it('creates initial units and versions for every markdown line', async () => {
    const result = await service.recordMarkdownChange(
      'launch.md',
      '# Launch\n\nShip receipts first.',
      {
        actor: { kind: 'user', name: 'Test User' },
        intentKind: 'type',
        summary: 'Initial note',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.snapshot.order).toHaveLength(3);
    expect(Object.values(result.value.snapshot.units)).toHaveLength(3);
    expect(Object.values(result.value.snapshot.versions)).toHaveLength(3);
    expect(result.value.matches.map((m) => m.matchKind)).toEqual(['new', 'new', 'new']);

    const explanation = await service.explainLine('launch.md', 2);
    expect(explanation.ok).toBe(true);
    if (explanation.ok && explanation.value) {
      expect(explanation.value.currentVersion.content).toBe('Ship receipts first.');
      expect(explanation.value.intent?.summary).toBe('Initial note');
    }
  });

  it('records surrounding context with each line version', async () => {
    const result = await service.recordMarkdownChange(
      'launch.md',
      'One\nTwo\nThree\nFour\nFive',
      {
        actor: { kind: 'user' },
        intentKind: 'type',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unitId = result.value.snapshot.order[2]!;
    const versionId = result.value.snapshot.units[unitId]!.currentVersionId!;
    const version = result.value.snapshot.versions[versionId]!;

    expect(version.context).toMatchObject({
      lineIndex: 2,
      lineCount: 5,
      before: [
        { lineIndex: 0, content: 'One' },
        { lineIndex: 1, content: 'Two' },
      ],
      after: [
        { lineIndex: 3, content: 'Four' },
        { lineIndex: 4, content: 'Five' },
      ],
    });
    expect(version.contextHash).not.toBe(version.contentHash);
  });

  it('keeps unit identity when a line is edited', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Ship receipts first.');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const unitId = initial.value.snapshot.order[0]!;
    const firstVersionId = initial.value.snapshot.units[unitId]!.currentVersionId;

    const updated = await service.recordMarkdownChange('launch.md', 'Ship reversible receipts first.', {
      actor: { kind: 'ai-agent', model: 'codex' },
      intentKind: 'rewrite',
      summary: 'Clarify strategy',
      prompt: 'Make this sharper',
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.snapshot.order[0]).toBe(unitId);
    const nextVersionId = updated.value.snapshot.units[unitId]!.currentVersionId;
    expect(nextVersionId).not.toBe(firstVersionId);
    expect(updated.value.patch.changes.some((change) => change.type === 'unit.updated')).toBe(true);

    const history = await service.getLineHistory('launch.md', unitId);
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.value.versions.map((version) => version.content)).toEqual([
        'Ship receipts first.',
        'Ship reversible receipts first.',
      ]);
    }
  });

  it('queues lineage recording without blocking callers and flushes in order', async () => {
    const queued = await service.enqueueMarkdownChange('launch.md', 'Alpha', {
      actor: { kind: 'user' },
      intentKind: 'type',
    });

    expect(queued.ok).toBe(true);
    expect(service.getQueueStatus().pendingJobs).toBe(1);

    const flushed = await service.flush('launch.md');
    expect(flushed.ok).toBe(true);

    const snapshot = await service.getSnapshot('launch.md');
    expect(snapshot.ok).toBe(true);
    expect(snapshot.ok ? snapshot.value?.order.length : 0).toBe(1);
    expect(service.getQueueStatus().pendingJobs).toBe(0);
  });

  it('flushes queued lineage before disposal completes', async () => {
    const queued = await service.enqueueMarkdownChange('launch.md', 'Alpha', {
      actor: { kind: 'user' },
      intentKind: 'type',
      summary: 'Queued before shutdown',
    });

    expect(queued.ok).toBe(true);
    expect(service.getQueueStatus().pendingJobs).toBe(1);

    await (service as LineageServiceImpl).dispose();

    expect(service.getQueueStatus()).toMatchObject({
      pendingJobs: 0,
      activeJobs: 0,
      lastError: null,
    });
    const explanation = await service.explainLine('launch.md', 0);
    expect(explanation.ok).toBe(true);
    if (explanation.ok) {
      expect(explanation.value?.currentVersion.content).toBe('Alpha');
      expect(explanation.value?.intent?.summary).toBe('Queued before shutdown');
    }
  });

  it('records line moves without creating a new version', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Alpha\nBeta\nGamma');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const betaUnit = initial.value.snapshot.order[1]!;
    const betaVersion = initial.value.snapshot.units[betaUnit]!.currentVersionId;

    const moved = await service.recordMarkdownChange('launch.md', 'Beta\nAlpha\nGamma');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    expect(moved.value.snapshot.order[0]).toBe(betaUnit);
    expect(moved.value.snapshot.units[betaUnit]!.currentVersionId).toBe(betaVersion);
    expect(moved.value.patch.changes.some((change) => change.type === 'unit.moved')).toBe(true);
  });

  it('marks deleted lines and can preview reverting a line to a previous version', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Alpha\nBeta');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const alphaUnit = initial.value.snapshot.order[0]!;
    const alphaVersion = initial.value.snapshot.units[alphaUnit]!.currentVersionId!;
    const betaUnit = initial.value.snapshot.order[1]!;

    const updated = await service.recordMarkdownChange('launch.md', 'Alpha updated');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.snapshot.units[betaUnit]!.status).toBe('deleted');

    const preview = await service.previewRevertLine('launch.md', alphaUnit, alphaVersion);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value).toBe('Alpha');
    }
  });

  it('shows deleted lines as first-class note timeline entries with previous context', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta\nGamma\nDelta');
    const deleted = await service.recordMarkdownChange('launch.md', 'Alpha\nDelta', {
      actor: { kind: 'user' },
      intentKind: 'delete',
      summary: 'Remove middle lines',
      clusterId: 'cluster_delete_middle',
      captureReason: 'manual-save',
    });

    expect(deleted.ok).toBe(true);
    const timeline = await service.getTimeline('launch.md');
    expect(timeline.ok).toBe(true);
    if (!timeline.ok) return;

    const entry = timeline.value.entries.find((candidate) => candidate.clusterId === 'cluster_delete_middle');
    expect(entry).toBeTruthy();
    expect(entry?.changeTypes).toContain('unit.deleted');
    expect(entry && 'deletedLines' in entry ? entry.deletedLines.map((line) => line.content) : []).toEqual(['Beta', 'Gamma']);
    expect(entry && 'deletedLines' in entry ? entry.deletedLines[0]?.lastKnownLine : null).toBe(2);
    const deletedContext = entry && 'deletedLines' in entry ? entry.deletedLines[0]?.context : undefined;
    expect(deletedContext?.before[deletedContext.before.length - 1]?.content).toBe('Alpha');
    expect(entry?.lineRange).toEqual({ start: 2, end: 3 });
    expect(entry?.summary).toContain('deleted 2 lines');
    expect(entry?.diffHunks.filter((hunk) => hunk.changeType === 'unit.deleted')).toHaveLength(2);
    expect(timeline.value.deletedLines.map((line) => line.content)).toEqual(['Beta', 'Gamma']);
  });

  it('returns deleted archive newest first', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta\nGamma');
    const betaDeleted = await service.recordMarkdownChange('launch.md', 'Alpha\nGamma', {
      intentKind: 'delete',
      summary: 'Delete beta',
    });
    expect(betaDeleted.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const alphaDeleted = await service.recordMarkdownChange('launch.md', 'Gamma', {
      intentKind: 'delete',
      summary: 'Delete alpha',
    });
    expect(alphaDeleted.ok).toBe(true);

    const archive = await service.getDeletedLines('launch.md');
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    expect(archive.value.map((line) => line.content)).toEqual(['Alpha', 'Beta']);
  });

  it('previews deleted-line restore by context and applies through a lineage restore event', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta\nGamma');
    await service.recordMarkdownChange('launch.md', 'Alpha\nGamma', {
      intentKind: 'delete',
      summary: 'Delete beta',
    });

    const archive = await service.getDeletedLines('launch.md');
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const beta = archive.value.find((line) => line.content === 'Beta');
    expect(beta).toBeTruthy();
    if (!beta) return;

    const preview = await service.previewRestoreDeletedLine('launch.md', beta.unitId, beta.versionId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value).toMatchObject({
      content: 'Beta',
      markdown: 'Alpha\nBeta\nGamma',
      insertLine: 2,
      strategy: 'context',
    });

    const restored = await service.recordMarkdownChange('launch.md', preview.value.markdown, {
      actor: { kind: 'user' },
      intentKind: 'restore',
      summary: 'Restore beta',
      lineSources: [{ lineIndex: preview.value.insertLine - 1, sourceVersionIds: [preview.value.versionId] }],
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.snapshot.units[beta.unitId]?.status).toBe('active');
    expect(restored.value.patch.changes.some((change) =>
      change.type === 'unit.updated' &&
      change.unitId === beta.unitId &&
      change.fromVersionId === beta.versionId
    )).toBe(true);
  });

  it('falls back to last known position when deleted-line context no longer matches', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta\nGamma');
    await service.recordMarkdownChange('launch.md', 'Completely different', {
      intentKind: 'rewrite',
      summary: 'Rewrite away context',
    });

    const archive = await service.getDeletedLines('launch.md');
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const beta = archive.value.find((line) => line.content === 'Beta');
    expect(beta).toBeTruthy();
    if (!beta) return;

    const preview = await service.previewRestoreDeletedLine('launch.md', beta.unitId, beta.versionId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.strategy).toBe('last-known-line');
    expect(preview.value.markdown).toBe('Completely different\nBeta');
  });

  it('materializes the current markdown projection', async () => {
    await service.recordMarkdownChange('launch.md', '# Launch\n\n- [ ] Ask Maya');
    const materialized = await service.materialize('launch.md');

    expect(materialized.ok).toBe(true);
    if (materialized.ok) {
      expect(materialized.value).toBe('# Launch\n\n- [ ] Ask Maya');
    }
  });

  it('detects split and merge reconciliation while preserving source versions', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Alpha beta gamma\nMerge this\nwith this');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const splitUnit = initial.value.snapshot.order[0]!;

    const split = await service.recordMarkdownChange('launch.md', 'Alpha beta\nGamma\nMerge this\nwith this');
    expect(split.ok).toBe(true);
    if (!split.ok) return;

    expect(split.value.matches.filter((match) => match.matchKind === 'split')).toHaveLength(2);
    expect(split.value.patch.changes.some((change) => change.type === 'unit.split' && change.fromUnitId === splitUnit)).toBe(true);

    const merge = await service.recordMarkdownChange('launch.md', 'Alpha beta\nGamma\nMerge this with this');
    expect(merge.ok).toBe(true);
    if (!merge.ok) return;

    expect(merge.value.matches.some((match) => match.matchKind === 'merged')).toBe(true);
    expect(merge.value.patch.changes.some((change) => change.type === 'unit.merged')).toBe(true);
  });

  it('exposes edit clusters and agent context for AI queries', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta', {
      actor: { kind: 'user' },
      intentKind: 'type',
      summary: 'Initial draft',
    });
    await service.recordMarkdownChange('launch.md', 'Alpha updated\nBeta', {
      actor: { kind: 'ai-agent', model: 'codex' },
      intentKind: 'rewrite',
      summary: 'Sharpen alpha',
    });

    const clusters = await service.getEditClusters('launch.md');
    expect(clusters.ok).toBe(true);
    if (!clusters.ok) return;
    expect(clusters.value[0]?.summary).toContain('Sharpen alpha');
    expect(clusters.value[0]?.versions[0]?.content).toBe('Alpha updated');

    const context = await service.getAgentContext('launch.md', { line: 0 });
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value.summary).toContain('launch.md');
    expect(context.value.target?.currentVersion.content).toBe('Alpha updated');
    expect(context.value.clusters.length).toBeGreaterThan(0);
    expect(context.value.lines.map((line) => line.content)).toEqual(['Alpha updated', 'Beta']);
  });

  it('builds a unified timeline with saved clusters and pending dirty diffs', async () => {
    await service.recordMarkdownChange('launch.md', 'Alpha\nBeta');
    await service.recordMarkdownChange('launch.md', 'Alpha sharpened\nBeta', {
      actor: { kind: 'user' },
      intentKind: 'update',
      summary: 'Sharpen alpha',
      clusterId: 'cluster_save_1',
      captureReason: 'autosave',
    });

    const timeline = await service.getTimeline('launch.md', {
      pendingMarkdown: 'Alpha sharpened again\nBeta',
    });

    expect(timeline.ok).toBe(true);
    if (!timeline.ok) return;
    expect(timeline.value.pendingEntry?.diffHunks[0]).toMatchObject({
      line: 1,
      before: 'Alpha sharpened',
      after: 'Alpha sharpened again',
    });
    expect(timeline.value.entries[0]).toMatchObject({
      id: 'pending-editor-diff',
      isPending: true,
    });
    const savedEntry = timeline.value.entries.find((entry) => entry.clusterId === 'cluster_save_1');
    expect(savedEntry).toMatchObject({
      clusterId: 'cluster_save_1',
      captureReason: 'autosave',
      summary: expect.stringContaining('Sharpen alpha'),
    });
    expect(savedEntry?.diffHunks[0]).toMatchObject({
      before: 'Alpha',
      after: 'Alpha sharpened',
      changeType: 'unit.updated',
    });
  });

  it('bridges durable lineage patches into concise provenance receipts', async () => {
    const provenance: ProvenanceService = {
      record: vi.fn().mockResolvedValue(ok(undefined)),
      getHistory: vi.fn(),
      getAITouchCount: vi.fn(),
      getRecentByType: vi.fn(),
    } as unknown as ProvenanceService;
    const bridged = new LineageServiceImpl(new MemoryLineageStorageAdapter(), provenance);

    await bridged.recordMarkdownChange('launch.md', 'Alpha');
    const updated = await bridged.recordMarkdownChange('launch.md', 'Alpha refined', {
      actor: { kind: 'user' },
      intentKind: 'update',
      clusterId: 'cluster_save_2',
      captureReason: 'manual-save',
      receiptId: 'receipt_1',
      operationId: 'op_1',
      summary: 'Refine alpha',
    });

    expect(updated.ok).toBe(true);
    expect(provenance.record).toHaveBeenCalledTimes(1);
    expect(provenance.record).toHaveBeenCalledWith(
      'launch',
      expect.objectContaining({
        type: 'user_edit',
        patchId: updated.ok ? updated.value.patch.id : expect.any(String),
        intentId: updated.ok ? updated.value.patch.intentId : expect.any(String),
        lineageClusterId: 'cluster_save_2',
        receiptId: 'receipt_1',
        operationId: 'op_1',
      }),
    );
  });

  it('creates ambiguous reconciliation warnings and repairs a line match', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Rollout risk is high\nRollout risk is low');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const preferredUnit = initial.value.snapshot.order[1]!;

    const updated = await service.recordMarkdownChange('launch.md', 'Rollout risk changed');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const warnings = await service.getReconciliationWarnings('launch.md');
    expect(warnings.ok).toBe(true);
    expect(warnings.ok ? warnings.value.length : 0).toBeGreaterThan(0);

    const repairOptions = {
      actor: { kind: 'user' as const },
      summary: 'Pick lower-risk source',
    } satisfies Parameters<LineageService['repairLineMatch']>[3];
    const warningId = warnings.ok ? warnings.value[0]?.id : undefined;
    const repaired = await service.repairLineMatch(
      'launch.md',
      0,
      preferredUnit,
      warningId ? { ...repairOptions, warningId } : repairOptions,
    );

    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.value.snapshot.order[0]).toBe(preferredUnit);
    expect(repaired.value.warning?.status).toBe('resolved');
  });

  it('links explicit and inferred todo source versions', async () => {
    const initial = await service.recordMarkdownChange('launch.md', 'Maya promised rollout numbers');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const sourceUnit = initial.value.snapshot.order[0]!;
    const sourceVersion = initial.value.snapshot.units[sourceUnit]!.currentVersionId!;

    const extracted = await service.recordMarkdownChange(
      'launch.md',
      'Maya promised rollout numbers\n- [ ] Ask Maya for rollout numbers',
      {
        intentKind: 'commitment-create',
        actor: { kind: 'ai-agent' },
      },
    );
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const todoUnit = extracted.value.snapshot.order[1]!;
    const todoVersionId = extracted.value.snapshot.units[todoUnit]!.currentVersionId!;
    expect(extracted.value.snapshot.versions[todoVersionId]!.sourceVersionIds).toEqual([sourceVersion]);

    const explicit = await service.recordMarkdownChange(
      'other.md',
      '- [ ] Explicit source',
      {
        lineSources: [{ lineIndex: 0, sourceVersionIds: [sourceVersion] }],
      },
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      const unit = explicit.value.snapshot.order[0]!;
      const version = explicit.value.snapshot.versions[explicit.value.snapshot.units[unit]!.currentVersionId!]!;
      expect(version.sourceVersionIds).toEqual([sourceVersion]);
    }
  });
});
