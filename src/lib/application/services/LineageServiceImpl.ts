/**
 * LineageServiceImpl - line-level markdown intent/version history.
 *
 * Records clean markdown as a projection while storing line identity,
 * versions, intents, and reversible patches in .void/lineage.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  IntentFrame,
  CreateIntentParams,
  CreateLineVersionParams,
  LineActor,
  LineageChange,
  LineageJournalEntry,
  LineageLine,
  LineagePatch,
  LineageSnapshot,
  LineageUnit,
  LineageVersionContext,
  LineVersion,
  ReconciliationMatch,
  ReconciliationWarning,
} from '$lib/domain/entities/Lineage';
import {
  createEmptyLineageSnapshot,
  createIntentFrame,
  createLineageId,
  createLineageUnit,
  createLineVersion,
  getCurrentVersion,
  materializeLineageMarkdown,
  normalizeLineContent,
  splitMarkdownLines,
  stableHash,
} from '$lib/domain/entities/Lineage';
import type {
  LineageRecordOptions,
  LineageRecordResult,
  LineageService,
  LineageAgentContext,
  LineageAgentContextOptions,
  LineageAgentLine,
  LineageClusterQuery,
  LineageEditCluster,
  LineageQueuedChange,
  LineageQueueStatus,
  LineExplanation,
  LineHistory,
  LineageRepairResult,
  LineageTimeline,
  LineageTimelineQuery,
  LineagePendingTimelineEntry,
  LineageDiffHunk,
  LineageDiffToken,
  LineageDeletedLine,
  LineageDeletedRestorePreview,
} from '$lib/ports/inbound/LineageService';
import type { LineageStoragePort } from '$lib/ports/outbound/LineageStoragePort';
import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import type { ProvenanceEventType } from '$lib/domain/values/ProvenanceEvent';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';

interface OldLineCandidate {
  unitId: string;
  version: LineVersion;
  index: number;
}

interface InternalMatch extends ReconciliationMatch {
  oldIndex: number | null;
  oldIndexes?: number[];
}

interface QueuedLineageJob {
  id: string;
  notePath: string;
  markdown: string;
  options: LineageRecordOptions;
  queuedAt: string;
}

const DEFAULT_ACTOR: LineActor = { kind: 'user' };
const EDIT_MATCH_THRESHOLD = 0.58;
const AMBIGUOUS_MATCH_MARGIN = 0.08;
const LOW_CONFIDENCE_WARNING_THRESHOLD = 0.72;
const DEFAULT_CONTEXT_RADIUS = 3;

export class LineageServiceImpl implements LineageService {
  private readonly queues = new Map<string, QueuedLineageJob[]>();
  private readonly activeNotes = new Set<string>();
  private readonly scheduledNotes = new Set<string>();
  private flushWaiters: Array<{
    notePath?: string;
    resolve: (result: Result<void, Error>) => void;
  }> = [];
  private lastQueueError: Error | null = null;

  constructor(
    private readonly storage: LineageStoragePort,
    private readonly provenance: ProvenanceService | null = null,
  ) {}

  async dispose(): Promise<void> {
    await this.flush();
  }

  async enqueueMarkdownChange(
    notePath: string,
    markdown: string,
    options: LineageRecordOptions = {}
  ): Promise<Result<LineageQueuedChange, Error>> {
    try {
      const queuedAt = new Date().toISOString();
      const job: QueuedLineageJob = {
        id: createLineageId('job'),
        notePath,
        markdown,
        options: clonePlain(options),
        queuedAt,
      };

      const queue = this.queues.get(notePath) ?? [];
      const last = queue[queue.length - 1];
      if (last && last.markdown === markdown) {
        last.options = { ...last.options, ...job.options };
        return ok({ jobId: last.id, notePath, queuedAt: last.queuedAt });
      }

      queue.push(job);
      this.queues.set(notePath, queue);
      this.scheduleQueue(notePath);
      return ok({ jobId: job.id, notePath, queuedAt });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async recordMarkdownChange(
    notePath: string,
    markdown: string,
    options: LineageRecordOptions = {}
  ): Promise<Result<LineageRecordResult, Error>> {
    try {
      const existingResult = await this.storage.readSnapshot(notePath);
      if (!existingResult.ok) return err(existingResult.error);

      const existing = existingResult.value;
      const lines = splitMarkdownLines(markdown);
      const actor = options.actor ?? DEFAULT_ACTOR;
      const now = new Date().toISOString();
      const intentParams: CreateIntentParams = {
        kind: options.intentKind ?? inferIntentKind(existing, actor),
        actor,
        now,
      };
      if (options.summary !== undefined) intentParams.summary = options.summary;
      if (options.clusterId !== undefined) intentParams.clusterId = options.clusterId;
      if (options.captureReason !== undefined) intentParams.captureReason = options.captureReason;
      if (options.prompt !== undefined) intentParams.prompt = options.prompt;
      if (options.commandId !== undefined) intentParams.commandId = options.commandId;
      if (options.agentRunId !== undefined) intentParams.agentRunId = options.agentRunId;
      if (options.agentTaskId !== undefined) intentParams.agentTaskId = options.agentTaskId;
      if (options.receiptId !== undefined) intentParams.receiptId = options.receiptId;
      if (options.provenanceEventId !== undefined) intentParams.provenanceEventId = options.provenanceEventId;
      if (options.provenanceType !== undefined) intentParams.provenanceType = options.provenanceType;
      if (options.branchId !== undefined) intentParams.branchId = options.branchId;
      if (options.source !== undefined) intentParams.source = options.source;
      const intent = createIntentFrame(intentParams);

      const result = existing
        ? this.applyReconciliation(existing, lines, intent, options, now)
        : this.createInitialSnapshot(notePath, lines, intent, options, now);

      const writeSnapshot = await this.storage.writeSnapshot(notePath, result.snapshot);
      if (!writeSnapshot.ok) return err(writeSnapshot.error);

      const append = await this.storage.appendEntries(notePath, result.entries);
      if (!append.ok) return err(append.error);

      await this.recordProvenanceBridge(notePath, result, intent, options);

      return ok(result);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async flush(notePath?: string): Promise<Result<void, Error>> {
    if (this.isQueueIdle(notePath)) {
      return ok(undefined);
    }

    return new Promise((resolve) => {
      const waiter: { notePath?: string; resolve: (result: Result<void, Error>) => void } = { resolve };
      if (notePath !== undefined) waiter.notePath = notePath;
      this.flushWaiters.push(waiter);
      if (notePath) this.scheduleQueue(notePath);
      else {
        for (const queuedNotePath of this.queues.keys()) {
          this.scheduleQueue(queuedNotePath);
        }
      }
      this.resolveFlushWaiters();
    });
  }

  getQueueStatus(): LineageQueueStatus {
    let pendingJobs = 0;
    for (const queue of this.queues.values()) pendingJobs += queue.length;
    return {
      pendingJobs,
      activeJobs: this.activeNotes.size,
      lastError: this.lastQueueError?.message ?? null,
    };
  }

  async getSnapshot(notePath: string): Promise<Result<LineageSnapshot | null, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    return this.storage.readSnapshot(notePath);
  }

  async getJournal(notePath: string): Promise<Result<LineageJournalEntry[], Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    return this.storage.readJournal(notePath);
  }

  async getLineHistory(notePath: string, unitId: string): Promise<Result<LineHistory, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot || !snapshot.units[unitId]) {
      return err(new Error(`Lineage unit not found: ${unitId}`));
    }

    const versions = Object.values(snapshot.versions)
      .filter((version) => version.unitId === unitId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return ok({ unitId, versions });
  }

  async explainLine(notePath: string, lineIndex: number): Promise<Result<LineExplanation | null, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return ok(null);

    const unitId = snapshot.order[lineIndex];
    if (!unitId) return ok(null);

    const currentVersion = getCurrentVersion(snapshot, unitId);
    if (!currentVersion) return ok(null);

    const previousVersions = Object.values(snapshot.versions)
      .filter((version) => version.unitId === unitId && version.id !== currentVersion.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return ok({
      notePath,
      lineIndex,
      unitId,
      currentVersion,
      intent: currentVersion.intentId ? snapshot.intents[currentVersion.intentId] ?? null : null,
      previousVersions,
    });
  }

  async materialize(notePath: string): Promise<Result<string, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    if (!snapshotResult.value) return err(new Error(`No lineage snapshot for ${notePath}`));
    return ok(materializeLineageMarkdown(snapshotResult.value));
  }

  async previewRevertLine(notePath: string, unitId: string, versionId: string): Promise<Result<string, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return err(new Error(`No lineage snapshot for ${notePath}`));
    const unit = snapshot.units[unitId];
    const version = snapshot.versions[versionId];
    if (!unit || !version || version.unitId !== unitId) {
      return err(new Error(`Cannot revert ${unitId} to ${versionId}`));
    }

    const preview = cloneSnapshot(snapshot);
    preview.units[unitId] = {
      ...unit,
      currentVersionId: versionId,
      status: 'active',
      deletedAt: null,
    };
    if (!preview.order.includes(unitId)) {
      preview.order.push(unitId);
    }
    return ok(materializeLineageMarkdown(preview));
  }

  async getDeletedLines(notePath: string): Promise<Result<LineageDeletedLine[], Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    return ok(snapshotResult.value ? buildDeletedLines(snapshotResult.value) : []);
  }

  async previewRestoreDeletedLine(
    notePath: string,
    unitId: string,
    versionId?: string
  ): Promise<Result<LineageDeletedRestorePreview, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return err(new Error(`No lineage snapshot for ${notePath}`));

    const unit = snapshot.units[unitId];
    if (!unit) return err(new Error(`Lineage unit not found: ${unitId}`));
    const resolvedVersionId = versionId ?? unit.currentVersionId;
    if (!resolvedVersionId) return err(new Error(`Deleted lineage unit has no version: ${unitId}`));
    const version = snapshot.versions[resolvedVersionId];
    if (!version || version.unitId !== unitId) {
      return err(new Error(`Cannot restore ${unitId} from ${resolvedVersionId}`));
    }

    const currentLines = splitMarkdownLines(materializeLineageMarkdown(snapshot)).map((line) => line.content);
    const placement = findRestorePlacement(currentLines, version);
    const nextLines = currentLines.slice();
    nextLines.splice(placement.index, 0, version.content);

    return ok({
      notePath,
      unitId,
      versionId: version.id,
      content: version.content,
      markdown: nextLines.join('\n'),
      insertLine: placement.index + 1,
      strategy: placement.strategy,
      confidence: placement.confidence,
      reason: placement.reason,
    });
  }

  async getReconciliationWarnings(notePath: string): Promise<Result<ReconciliationWarning[], Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);
    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return ok([]);

    return ok(Object.values(snapshot.reconciliationWarnings ?? {})
      .filter((warning) => (warning.status ?? 'open') === 'open')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async getEditClusters(
    notePath: string,
    query: LineageClusterQuery = {}
  ): Promise<Result<LineageEditCluster[], Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);

    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return ok([]);

    const limit = Math.max(1, Math.min(query.limit ?? 25, 200));
    const clusters = Object.values(snapshot.patches)
      .map((patch, index) => ({ patch, index }))
      .filter(({ patch }) => query.includeEmpty || patch.changes.length > 0)
      .filter(({ patch }) => !query.since || patch.createdAt >= query.since)
      .sort((a, b) => b.patch.createdAt.localeCompare(a.patch.createdAt) || b.index - a.index)
      .slice(0, limit)
      .map(({ patch }) => buildEditCluster(snapshot, patch));

    return ok(clusters);
  }

  async getTimeline(
    notePath: string,
    query: LineageTimelineQuery = {}
  ): Promise<Result<LineageTimeline, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);

    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    const warnings = snapshot
      ? Object.values(snapshot.reconciliationWarnings ?? {})
          .filter((warning) => (warning.status ?? 'open') === 'open')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
    const deletedLines = snapshot ? buildDeletedLines(snapshot) : [];

    const limit = Math.max(1, Math.min(query.limit ?? 80, 300));
    const durableEntries = snapshot
      ? Object.values(snapshot.patches)
          .map((patch, index) => ({ patch, index }))
          .filter(({ patch }) => patch.changes.length > 0)
          .sort((a, b) => b.patch.createdAt.localeCompare(a.patch.createdAt) || b.index - a.index)
          .slice(0, limit)
          .map(({ patch }) => buildEditCluster(snapshot, patch))
      : [];

    const baseMarkdown = snapshot ? materializeLineageMarkdown(snapshot) : '';
    const candidateMarkdown = query.pendingMarkdown ?? query.currentMarkdown;
    const pendingEntry = query.includePending !== false && candidateMarkdown !== undefined
      ? buildPendingTimelineEntry(notePath, snapshot, baseMarkdown, candidateMarkdown)
      : null;

    const entries = pendingEntry ? [pendingEntry, ...durableEntries] : durableEntries;
    const lineCount = snapshot?.order.length ?? splitMarkdownLines(candidateMarkdown ?? '').length;
    const summary = [
      `${lineCount} lineage line${lineCount === 1 ? '' : 's'}.`,
      `${durableEntries.length} durable edit cluster${durableEntries.length === 1 ? '' : 's'}.`,
      deletedLines.length > 0
        ? `${deletedLines.length} deleted line${deletedLines.length === 1 ? '' : 's'} available for recovery.`
        : '',
      pendingEntry ? 'Unsaved editor changes are visible as a pending diff.' : '',
      `${warnings.length} repair warning${warnings.length === 1 ? '' : 's'}.`,
    ].filter(Boolean).join(' ');

    return ok({
      notePath,
      currentMarkdownHash: snapshot?.currentMarkdownHash ?? null,
      queue: this.getQueueStatus(),
      entries,
      deletedLines,
      warnings,
      pendingEntry,
      summary,
    });
  }

  async getAgentContext(
    notePath: string,
    options: LineageAgentContextOptions = {}
  ): Promise<Result<LineageAgentContext, Error>> {
    const flushed = await this.flush(notePath);
    if (!flushed.ok) return err(flushed.error);

    const snapshotResult = await this.storage.readSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) {
      return ok({
        notePath,
        currentMarkdownHash: null,
        lineCount: 0,
        queue: this.getQueueStatus(),
        target: null,
        lines: [],
        clusters: [],
        warnings: [],
        summary: `No lineage snapshot exists for ${notePath}.`,
      });
    }

    const clusters = await this.getEditClusters(notePath, { limit: options.clusterLimit ?? 12 });
    if (!clusters.ok) return err(clusters.error);
    const warnings = await this.getReconciliationWarnings(notePath);
    if (!warnings.ok) return err(warnings.error);

    let target: LineExplanation | null = null;
    if (options.line !== undefined) {
      const explained = await this.explainLine(notePath, options.line);
      if (!explained.ok) return err(explained.error);
      target = explained.value;
    } else if (options.unitId !== undefined) {
      const lineIndex = snapshot.order.indexOf(options.unitId);
      if (lineIndex >= 0) {
        const explained = await this.explainLine(notePath, lineIndex);
        if (!explained.ok) return err(explained.error);
        target = explained.value;
      }
    }

    const lines = snapshot.order
      .map<LineageAgentLine | null>((unitId, index) => {
        const unit = snapshot.units[unitId];
        const version = getCurrentVersion(snapshot, unitId);
        if (!unit || !version) return null;
        const line: LineageAgentLine = {
          line: index + 1,
          unitId,
          versionId: version.id,
          content: version.content,
          actor: version.actor,
          intent: version.intentId ? snapshot.intents[version.intentId] ?? null : null,
          sourceVersionIds: version.sourceVersionIds,
        };
        if (version.context !== undefined) line.context = version.context;
        return line;
      })
      .filter((line): line is LineageAgentLine => line !== null);

    const summary = [
      `${notePath}: ${lines.length} active lineage lines.`,
      `${clusters.value.length} recent edit cluster${clusters.value.length === 1 ? '' : 's'}.`,
      `${warnings.value.length} open reconciliation warning${warnings.value.length === 1 ? '' : 's'}.`,
      target ? `Target line ${target.lineIndex + 1} maps to ${target.unitId}.` : '',
    ].filter(Boolean).join(' ');

    return ok({
      notePath,
      currentMarkdownHash: snapshot.currentMarkdownHash,
      lineCount: snapshot.order.length,
      queue: this.getQueueStatus(),
      target,
      lines,
      clusters: clusters.value,
      warnings: warnings.value,
      summary,
    });
  }

  async repairLineMatch(
    notePath: string,
    lineIndex: number,
    unitId: string,
    options: LineageRecordOptions & { warningId?: string } = {}
  ): Promise<Result<LineageRepairResult, Error>> {
    try {
      const snapshotResult = await this.storage.readSnapshot(notePath);
      if (!snapshotResult.ok) return err(snapshotResult.error);
      const existing = snapshotResult.value;
      if (!existing) return err(new Error(`No lineage snapshot for ${notePath}`));

      const currentUnitId = existing.order[lineIndex];
      if (!currentUnitId) return err(new Error(`No lineage line at index ${lineIndex}`));
      if (!existing.units[unitId]) return err(new Error(`Lineage unit not found: ${unitId}`));

      const currentVersion = getCurrentVersion(existing, currentUnitId);
      if (!currentVersion) return err(new Error(`No current version for line ${lineIndex}`));

      const targetPrevious = getCurrentVersion(existing, unitId);
      const now = new Date().toISOString();
      const actor = options.actor ?? DEFAULT_ACTOR;
      const intentParams: CreateIntentParams = {
        kind: options.intentKind ?? 'external-reconcile',
        actor,
        summary: options.summary ?? `Repair line ${lineIndex + 1} lineage match`,
        now,
      };
      if (options.prompt !== undefined) intentParams.prompt = options.prompt;
      if (options.clusterId !== undefined) intentParams.clusterId = options.clusterId;
      if (options.captureReason !== undefined) intentParams.captureReason = options.captureReason;
      if (options.commandId !== undefined) intentParams.commandId = options.commandId;
      if (options.agentRunId !== undefined) intentParams.agentRunId = options.agentRunId;
      if (options.agentTaskId !== undefined) intentParams.agentTaskId = options.agentTaskId;
      if (options.receiptId !== undefined) intentParams.receiptId = options.receiptId;
      if (options.provenanceEventId !== undefined) intentParams.provenanceEventId = options.provenanceEventId;
      if (options.provenanceType !== undefined) intentParams.provenanceType = options.provenanceType;
      if (options.branchId !== undefined) intentParams.branchId = options.branchId;
      intentParams.source = options.source ?? { type: 'tool' };
      const intent = createIntentFrame(intentParams);

      const snapshot = cloneSnapshot(existing);
      snapshot.id = createLineageId('snapshot');
      snapshot.updatedAt = now;
      snapshot.intents[intent.id] = intent;
      snapshot.reconciliationWarnings ??= {};

      const entries: LineageJournalEntry[] = [{ type: 'intent.created', intent }];
      const changes: LineageChange[] = [];

      if (targetPrevious) {
        const previousInSnapshot = snapshot.versions[targetPrevious.id];
        if (previousInSnapshot) {
          snapshot.versions[targetPrevious.id] = { ...previousInSnapshot, supersededAt: now };
        }
      }

      const repairLines = splitMarkdownLines(materializeLineageMarkdown(existing));
      const repairContext = buildVersionContext(repairLines, lineIndex, now);
      const repairedVersionParams: CreateLineVersionParams = {
        unitId,
        notePath: snapshot.notePath,
        content: currentVersion.content,
        actor: intent.actor,
        intentId: intent.id,
        sourceVersionIds: [
          ...(targetPrevious ? [targetPrevious.id] : []),
          currentVersion.id,
        ],
        now,
        contextHash: repairContext.contextHash,
        context: repairContext.context,
      };
      if (options.operationId !== undefined) repairedVersionParams.operationId = options.operationId;
      if (currentVersion.markdownPrefix !== undefined) repairedVersionParams.markdownPrefix = currentVersion.markdownPrefix;
      if (currentVersion.blockType !== undefined) repairedVersionParams.blockType = currentVersion.blockType;
      const repairedVersion = createLineVersion(repairedVersionParams);

      snapshot.versions[repairedVersion.id] = repairedVersion;
      snapshot.units[unitId] = {
        ...snapshot.units[unitId]!,
        currentVersionId: repairedVersion.id,
        status: 'active',
        deletedAt: null,
      };
      entries.push({ type: 'version.created', version: repairedVersion });

      if (targetPrevious) {
        changes.push({
          type: 'unit.updated',
          unitId,
          fromVersionId: targetPrevious.id,
          toVersionId: repairedVersion.id,
        });
      } else {
        changes.push({
          type: 'unit.created',
          unitId,
          versionId: repairedVersion.id,
          orderAfterUnitId: snapshot.order[lineIndex - 1] ?? null,
        });
      }

      if (currentUnitId !== unitId) {
        const oldUnit = snapshot.units[currentUnitId];
        if (oldUnit) {
          snapshot.units[currentUnitId] = {
            ...oldUnit,
            status: 'deleted',
            deletedAt: now,
          };
          changes.push({
            type: 'unit.deleted',
            unitId: currentUnitId,
            previousVersionId: currentVersion.id,
          });
        }
      }

      snapshot.order = snapshot.order.filter((candidate, index) =>
        candidate !== unitId || index === lineIndex
      );
      snapshot.order[lineIndex] = unitId;

      let warning: ReconciliationWarning | null = null;
      if (options.warningId) {
        const existingWarning = snapshot.reconciliationWarnings[options.warningId];
        if (existingWarning) {
        warning = {
          ...existingWarning,
          status: 'resolved',
          resolvedAt: now,
          resolution: `Line ${lineIndex + 1} assigned to ${unitId}`,
        };
        snapshot.reconciliationWarnings[options.warningId] = warning;
        entries.push({ type: 'reconciliation.warning', warning });
        }
      }

      const patch = createPatch(snapshot.notePath, intent.id, changes, now);
      snapshot.patches[patch.id] = patch;
      snapshot.currentMarkdownHash = stableHash(materializeLineageMarkdown(snapshot));
      entries.push({ type: 'patch.applied', patch });
      entries.push({
        type: 'snapshot.created',
        snapshotId: snapshot.id,
        hash: snapshot.currentMarkdownHash,
        createdAt: now,
      });

      const writeSnapshot = await this.storage.writeSnapshot(notePath, snapshot);
      if (!writeSnapshot.ok) return err(writeSnapshot.error);
      const append = await this.storage.appendEntries(notePath, entries);
      if (!append.ok) return err(append.error);

      return ok({
        snapshot,
        patch,
        warning,
        materializedMarkdown: materializeLineageMarkdown(snapshot),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async recordProvenanceBridge(
    notePath: string,
    result: LineageRecordResult,
    intent: IntentFrame,
    options: LineageRecordOptions,
  ): Promise<void> {
    if (!this.provenance) return;
    if (intent.kind === 'import' || result.patch.changes.length === 0) return;

    try {
      const changeStats = summarizePatchDiff(result.patch);
      const type = resolveProvenanceType(intent, options.provenanceType);
      const eventData: Parameters<ProvenanceService['record']>[1] = {
        type,
        blocks: unique(result.patch.changes.flatMap(extractChangedUnitIds)),
        diff: changeStats,
        accepted: true,
        action: intent.kind,
        result: intent.summary,
        patchId: result.patch.id,
        intentId: intent.id,
      };
      if (intent.prompt !== undefined) eventData.prompt = intent.prompt;
      if (intent.actor.kind === 'ai-agent' && intent.actor.model !== undefined) eventData.model = intent.actor.model;
      if (options.operationId !== undefined && options.operationId !== null) eventData.operationId = options.operationId;
      if (intent.receiptId !== undefined) eventData.receiptId = intent.receiptId;
      if (intent.clusterId !== undefined) eventData.lineageClusterId = intent.clusterId;

      const record = await this.provenance.record(noteNameFromPath(notePath), eventData);
      if (!record.ok) {
        console.warn('[LineageService] Failed to bridge lineage to provenance:', record.error);
      }
    } catch (e) {
      console.warn('[LineageService] Failed to bridge lineage to provenance:', e);
    }
  }

  private scheduleQueue(notePath: string): void {
    if (this.activeNotes.has(notePath) || this.scheduledNotes.has(notePath)) return;
    const queue = this.queues.get(notePath);
    if (!queue || queue.length === 0) return;

    this.scheduledNotes.add(notePath);
    scheduleBackgroundWork(() => {
      this.scheduledNotes.delete(notePath);
      void this.processQueue(notePath);
    });
  }

  private async processQueue(notePath: string): Promise<void> {
    if (this.activeNotes.has(notePath)) return;
    const queue = this.queues.get(notePath);
    if (!queue || queue.length === 0) {
      this.resolveFlushWaiters();
      return;
    }

    this.activeNotes.add(notePath);
    try {
      while (queue.length > 0) {
        const job = queue.shift()!;
        const result = await this.recordMarkdownChange(job.notePath, job.markdown, job.options);
        if (!result.ok) {
          this.lastQueueError = result.error;
          console.warn('[LineageService] Background lineage recording failed:', result.error);
        }
        await yieldToHost();
      }
      this.queues.delete(notePath);
    } finally {
      this.activeNotes.delete(notePath);
      this.resolveFlushWaiters();
      this.scheduleQueue(notePath);
    }
  }

  private isQueueIdle(notePath?: string): boolean {
    if (notePath) {
      return !this.activeNotes.has(notePath) && (this.queues.get(notePath)?.length ?? 0) === 0;
    }

    if (this.activeNotes.size > 0) return false;
    for (const queue of this.queues.values()) {
      if (queue.length > 0) return false;
    }
    return true;
  }

  private resolveFlushWaiters(): void {
    if (this.flushWaiters.length === 0) return;

    const remaining: typeof this.flushWaiters = [];
    for (const waiter of this.flushWaiters) {
      if (!this.isQueueIdle(waiter.notePath)) {
        remaining.push(waiter);
        continue;
      }
      waiter.resolve(ok(undefined));
    }
    this.flushWaiters = remaining;
  }

  private createInitialSnapshot(
    notePath: string,
    lines: LineageLine[],
    intent: IntentFrame,
    options: LineageRecordOptions,
    now: string
  ): LineageRecordResult {
    const snapshot = createEmptyLineageSnapshot(notePath, now);
    const entries: LineageJournalEntry[] = [{ type: 'intent.created', intent }];
    const changes: LineageChange[] = [];

    snapshot.intents[intent.id] = intent;

    const lineSources = buildLineSourceMap(options);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const unit = createLineageUnit({ notePath, now });
      const version = createLineVersion(buildVersionParams({
        unitId: unit.id,
        notePath,
        line,
        lines,
        lineIndex: index,
        actor: intent.actor,
        intentId: intent.id,
        sourceVersionIds: lineSources.get(index),
        operationId: options.operationId,
        now,
      }));
      unit.currentVersionId = version.id;
      snapshot.units[unit.id] = unit;
      snapshot.versions[version.id] = version;
      snapshot.order.push(unit.id);
      entries.push({ type: 'unit.created', unit });
      entries.push({ type: 'version.created', version });
      changes.push({
        type: 'unit.created',
        unitId: unit.id,
        versionId: version.id,
        orderAfterUnitId: snapshot.order[snapshot.order.length - 2] ?? null,
      });
    }

    const patch = createPatch(snapshot.notePath, intent.id, changes, now);
    snapshot.patches[patch.id] = patch;
    snapshot.currentMarkdownHash = stableHash(lines.map((line) => line.content).join('\n'));
    snapshot.updatedAt = now;
    entries.push({ type: 'patch.applied', patch });
    entries.push({
      type: 'snapshot.created',
      snapshotId: snapshot.id,
      hash: snapshot.currentMarkdownHash,
      createdAt: now,
    });

    const matches = lines.map<ReconciliationMatch>((_, index) => ({
      oldUnitId: null,
      newLineIndex: index,
      matchKind: 'new',
      confidence: 1,
      reasons: ['initial import'],
    }));

    return { snapshot, patch, matches, entries };
  }

  private applyReconciliation(
    existing: LineageSnapshot,
    lines: LineageLine[],
    intent: IntentFrame,
    options: LineageRecordOptions,
    now: string
  ): LineageRecordResult {
    const previous = cloneSnapshot(existing);
    const snapshot = cloneSnapshot(existing);
    snapshot.id = createLineageId('snapshot');
    snapshot.intents[intent.id] = intent;
    snapshot.updatedAt = now;

    const lineSources = buildLineSourceMap(options);
    const restoreLineIndexes = findRestoreLineIndexes(lines, lineSources, previous);
    const matches = reconcileLines(previous, lines, restoreLineIndexes);
    const matchByNewIndex = new Map<number, InternalMatch>();
    for (const match of matches) {
      if (match.newLineIndex >= 0) {
        matchByNewIndex.set(match.newLineIndex, match);
      }
    }

    const entries: LineageJournalEntry[] = [{ type: 'intent.created', intent }];
    const changes: LineageChange[] = [];
    const nextOrder: string[] = [];
    const splitTargetsBySource = new Map<string, string[]>();
    const warnings = createWarningsFromMatches(snapshot.notePath, matches, now);
    snapshot.reconciliationWarnings ??= {};
    for (const warning of warnings) {
      snapshot.reconciliationWarnings[warning.id] = warning;
      entries.push({ type: 'reconciliation.warning', warning });
    }

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const match = matchByNewIndex.get(index);

      if (!match || !match.oldUnitId) {
        const restored = resolveRestoredDeletedUnit(index, line, lineSources, snapshot);
        if (restored) {
          const oldVersionInSnapshot = snapshot.versions[restored.version.id];
          if (oldVersionInSnapshot) {
            snapshot.versions[restored.version.id] = {
              ...oldVersionInSnapshot,
              supersededAt: now,
            };
          }

          const version = createLineVersion(buildVersionParams({
            unitId: restored.unit.id,
            notePath: snapshot.notePath,
            line,
            lines,
            lineIndex: index,
            actor: intent.actor,
            intentId: intent.id,
            sourceVersionIds: lineSources.get(index) ?? [restored.version.id],
            operationId: options.operationId,
            now,
          }));

          snapshot.versions[version.id] = version;
          snapshot.units[restored.unit.id] = {
            ...restored.unit,
            currentVersionId: version.id,
            status: 'active',
            deletedAt: null,
          };
          nextOrder.push(restored.unit.id);
          entries.push({ type: 'version.created', version });
          changes.push({
            type: 'unit.updated',
            unitId: restored.unit.id,
            fromVersionId: restored.version.id,
            toVersionId: version.id,
          });
          continue;
        }

        const unit = createLineageUnit({ notePath: snapshot.notePath, now });
        const version = createLineVersion(buildVersionParams({
          unitId: unit.id,
          notePath: snapshot.notePath,
          line,
          lines,
          lineIndex: index,
          actor: intent.actor,
          intentId: intent.id,
          sourceVersionIds: inferNewLineSourceVersions(index, line, lineSources, nextOrder, snapshot, intent),
          operationId: options.operationId,
          now,
        }));
        unit.currentVersionId = version.id;
        snapshot.units[unit.id] = unit;
        snapshot.versions[version.id] = version;
        nextOrder.push(unit.id);
        entries.push({ type: 'unit.created', unit });
        entries.push({ type: 'version.created', version });
        changes.push({
          type: 'unit.created',
          unitId: unit.id,
          versionId: version.id,
          orderAfterUnitId: nextOrder[nextOrder.length - 2] ?? null,
        });
        continue;
      }

      if (match.matchKind === 'merged' && match.oldUnitIds && match.oldUnitIds.length > 1) {
        const primaryUnitId = match.oldUnitIds[0]!;
        const unit = snapshot.units[primaryUnitId];
        const sourceVersions = match.oldUnitIds
          .map((id) => getCurrentVersion(previous, id))
          .filter((version): version is LineVersion => version !== null);
        const oldVersion = sourceVersions[0];
        if (!unit || !oldVersion) continue;

        const previousIndex = previous.order.indexOf(primaryUnitId);
        nextOrder.push(primaryUnitId);

        if (previousIndex !== index) {
          changes.push({
            type: 'unit.moved',
            unitId: primaryUnitId,
            fromIndex: previousIndex,
            toIndex: index,
          });
        }

        const oldVersionInSnapshot = snapshot.versions[oldVersion.id];
        if (oldVersionInSnapshot) {
          snapshot.versions[oldVersion.id] = {
            ...oldVersionInSnapshot,
            supersededAt: now,
          };
        }

        const version = createLineVersion(buildVersionParams({
          unitId: primaryUnitId,
          notePath: snapshot.notePath,
          line,
          lines,
          lineIndex: index,
          actor: intent.actor,
          intentId: intent.id,
          sourceVersionIds: lineSources.get(index) ?? sourceVersions.map((source) => source.id),
          operationId: options.operationId,
          now,
        }));

        snapshot.versions[version.id] = version;
        snapshot.units[primaryUnitId] = {
          ...unit,
          currentVersionId: version.id,
          status: 'active',
          deletedAt: null,
        };
        entries.push({ type: 'version.created', version });
        changes.push({
          type: 'unit.updated',
          unitId: primaryUnitId,
          fromVersionId: oldVersion.id,
          toVersionId: version.id,
        });

        for (const mergedUnitId of match.oldUnitIds.slice(1)) {
          const mergedUnit = snapshot.units[mergedUnitId];
          const mergedVersion = getCurrentVersion(previous, mergedUnitId);
          if (!mergedUnit || !mergedVersion) continue;
          snapshot.units[mergedUnitId] = {
            ...mergedUnit,
            status: 'deleted',
            deletedAt: now,
          };
          changes.push({
            type: 'unit.deleted',
            unitId: mergedUnitId,
            previousVersionId: mergedVersion.id,
          });
        }

        changes.push({
          type: 'unit.merged',
          fromUnitIds: match.oldUnitIds,
          toUnitId: primaryUnitId,
        });
        continue;
      }

      if (match.matchKind === 'split') {
        const sourceUnitId = match.oldUnitId;
        const oldVersion = getCurrentVersion(previous, sourceUnitId);
        if (!oldVersion) continue;

        const existingTargets = splitTargetsBySource.get(sourceUnitId) ?? [];
        if (existingTargets.length === 0) {
          const unit = snapshot.units[sourceUnitId];
          if (!unit) continue;

          const previousIndex = previous.order.indexOf(sourceUnitId);
          nextOrder.push(sourceUnitId);
          existingTargets.push(sourceUnitId);
          splitTargetsBySource.set(sourceUnitId, existingTargets);

          if (previousIndex !== index) {
            changes.push({
              type: 'unit.moved',
              unitId: sourceUnitId,
              fromIndex: previousIndex,
              toIndex: index,
            });
          }

          const oldVersionInSnapshot = snapshot.versions[oldVersion.id];
          if (oldVersionInSnapshot) {
            snapshot.versions[oldVersion.id] = {
              ...oldVersionInSnapshot,
              supersededAt: now,
            };
          }

          const version = createLineVersion(buildVersionParams({
            unitId: sourceUnitId,
            notePath: snapshot.notePath,
            line,
            lines,
            lineIndex: index,
            actor: intent.actor,
            intentId: intent.id,
            sourceVersionIds: lineSources.get(index) ?? [oldVersion.id],
            operationId: options.operationId,
            now,
          }));
          snapshot.versions[version.id] = version;
          snapshot.units[sourceUnitId] = {
            ...unit,
            currentVersionId: version.id,
            status: 'active',
            deletedAt: null,
          };
          entries.push({ type: 'version.created', version });
          changes.push({
            type: 'unit.updated',
            unitId: sourceUnitId,
            fromVersionId: oldVersion.id,
            toVersionId: version.id,
          });
        } else {
          const unit = createLineageUnit({
            notePath: snapshot.notePath,
            parentUnitIds: [sourceUnitId],
            now,
          });
          const version = createLineVersion(buildVersionParams({
            unitId: unit.id,
            notePath: snapshot.notePath,
            line,
            lines,
            lineIndex: index,
            actor: intent.actor,
            intentId: intent.id,
            sourceVersionIds: lineSources.get(index) ?? [oldVersion.id],
            operationId: options.operationId,
            now,
          }));
          unit.currentVersionId = version.id;
          snapshot.units[unit.id] = unit;
          snapshot.versions[version.id] = version;
          const sourceUnit = snapshot.units[sourceUnitId];
          if (sourceUnit && !sourceUnit.childUnitIds.includes(unit.id)) {
            snapshot.units[sourceUnitId] = {
              ...sourceUnit,
              childUnitIds: [...sourceUnit.childUnitIds, unit.id],
            };
          }
          nextOrder.push(unit.id);
          existingTargets.push(unit.id);
          entries.push({ type: 'unit.created', unit });
          entries.push({ type: 'version.created', version });
          changes.push({
            type: 'unit.created',
            unitId: unit.id,
            versionId: version.id,
            orderAfterUnitId: nextOrder[nextOrder.length - 2] ?? null,
          });
        }
        continue;
      }

      const unit = snapshot.units[match.oldUnitId];
      const oldVersion = getCurrentVersion(previous, match.oldUnitId);
      if (!unit || !oldVersion) continue;

      const previousIndex = previous.order.indexOf(match.oldUnitId);
      nextOrder.push(match.oldUnitId);

      if (previousIndex !== index) {
        changes.push({
          type: 'unit.moved',
          unitId: match.oldUnitId,
          fromIndex: previousIndex,
          toIndex: index,
        });
      }

      if (match.matchKind === 'edited') {
        const oldVersionInSnapshot = snapshot.versions[oldVersion.id];
        if (oldVersionInSnapshot) {
          snapshot.versions[oldVersion.id] = {
            ...oldVersionInSnapshot,
            supersededAt: now,
          };
        }

        const version = createLineVersion(buildVersionParams({
          unitId: unit.id,
          notePath: snapshot.notePath,
          line,
          lines,
          lineIndex: index,
          actor: intent.actor,
          intentId: intent.id,
          sourceVersionIds: lineSources.get(index) ?? [oldVersion.id],
          operationId: options.operationId,
          now,
        }));

        snapshot.versions[version.id] = version;
        snapshot.units[unit.id] = {
          ...unit,
          currentVersionId: version.id,
          status: 'active',
          deletedAt: null,
        };
        entries.push({ type: 'version.created', version });
        changes.push({
          type: 'unit.updated',
          unitId: unit.id,
          fromVersionId: oldVersion.id,
          toVersionId: version.id,
        });
      } else {
        snapshot.units[unit.id] = {
          ...unit,
          status: 'active',
          deletedAt: null,
        };
      }
    }

    for (const [fromUnitId, toUnitIds] of splitTargetsBySource) {
      if (toUnitIds.length > 1) {
        changes.push({ type: 'unit.split', fromUnitId, toUnitIds });
      }
    }

    for (const match of matches.filter((item) => item.matchKind === 'deleted')) {
      if (!match.oldUnitId) continue;
      const unit = snapshot.units[match.oldUnitId];
      const version = getCurrentVersion(previous, match.oldUnitId);
      if (!unit || !version) continue;
      snapshot.units[match.oldUnitId] = {
        ...unit,
        status: 'deleted',
        deletedAt: now,
      };
      changes.push({
        type: 'unit.deleted',
        unitId: match.oldUnitId,
        previousVersionId: version.id,
      });
    }

    snapshot.order = nextOrder;
    snapshot.currentMarkdownHash = stableHash(lines.map((line) => line.content).join('\n'));

    const patch = createPatch(snapshot.notePath, intent.id, changes, now);
    snapshot.patches[patch.id] = patch;
    entries.push({ type: 'patch.applied', patch });
    entries.push({
      type: 'snapshot.created',
      snapshotId: snapshot.id,
      hash: snapshot.currentMarkdownHash,
      createdAt: now,
    });

    return {
      snapshot,
      patch,
      matches: matches.map(({ oldIndex: _oldIndex, oldIndexes: _oldIndexes, ...match }) => match),
      warnings,
      entries,
    };
  }
}

function inferIntentKind(existing: LineageSnapshot | null, actor: LineActor): IntentFrame['kind'] {
  if (!existing) return 'import';
  if (actor.kind === 'ai-agent') return 'rewrite';
  if (actor.kind === 'external-editor') return 'external-reconcile';
  if (actor.kind === 'importer') return 'import';
  return 'update';
}

function createPatch(
  notePath: string,
  intentId: string,
  changes: LineageChange[],
  now: string
): LineagePatch {
  return {
    id: createLineageId('patch'),
    notePath,
    intentId,
    createdAt: now,
    changes,
    reversible: true,
  };
}

function buildVersionParams(params: {
  unitId: string;
  notePath: string;
  line: LineageLine;
  lines: LineageLine[];
  lineIndex: number;
  actor: LineActor;
  intentId: string;
  operationId: string | null | undefined;
  sourceVersionIds?: string[] | undefined;
  now: string;
}): CreateLineVersionParams {
  const versionContext = buildVersionContext(params.lines, params.lineIndex, params.now);
  const out: CreateLineVersionParams = {
    unitId: params.unitId,
    notePath: params.notePath,
    content: params.line.content,
    actor: params.actor,
    intentId: params.intentId,
    now: params.now,
    contextHash: versionContext.contextHash,
    context: versionContext.context,
  };
  if (params.operationId !== undefined) out.operationId = params.operationId;
  if (params.sourceVersionIds !== undefined) out.sourceVersionIds = params.sourceVersionIds;
  if (params.line.markdownPrefix !== undefined) out.markdownPrefix = params.line.markdownPrefix;
  if (params.line.blockType !== undefined) out.blockType = params.line.blockType;
  return out;
}

function buildVersionContext(
  lines: LineageLine[],
  lineIndex: number,
  capturedAt: string,
): { contextHash: string; context: LineageVersionContext } {
  const documentText = lines.map((line) => line.content).join('\n');
  const beforeStart = Math.max(0, lineIndex - DEFAULT_CONTEXT_RADIUS);
  const afterEnd = Math.min(lines.length, lineIndex + DEFAULT_CONTEXT_RADIUS + 1);
  const before = lines.slice(beforeStart, lineIndex).map((line, offset) => ({
    lineIndex: beforeStart + offset,
    content: line.content,
  }));
  const after = lines.slice(lineIndex + 1, afterEnd).map((line, offset) => ({
    lineIndex: lineIndex + 1 + offset,
    content: line.content,
  }));
  const context: LineageVersionContext = {
    lineIndex,
    lineCount: lines.length,
    documentHash: stableHash(documentText),
    before,
    after,
    capturedAt,
  };

  return {
    context,
    contextHash: stableHash([
      context.documentHash,
      ...before.map((line) => line.content),
      lines[lineIndex]?.content ?? '',
      ...after.map((line) => line.content),
    ].join('\n')),
  };
}

function buildLineSourceMap(options: LineageRecordOptions): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const source of options.lineSources ?? []) {
    const ids = source.sourceVersionIds.filter(Boolean);
    if (ids.length > 0) out.set(source.lineIndex, ids);
  }
  return out;
}

function inferNewLineSourceVersions(
  index: number,
  line: LineageLine,
  explicitSources: Map<number, string[]>,
  nextOrder: string[],
  snapshot: LineageSnapshot,
  intent: IntentFrame
): string[] | undefined {
  const explicit = explicitSources.get(index);
  if (explicit) return explicit;

  const shouldInheritFromPrevious =
    line.blockType === 'todo' ||
    intent.kind === 'commitment-create' ||
    intent.kind === 'extract';
  if (!shouldInheritFromPrevious) return undefined;

  const previousUnitId = nextOrder[nextOrder.length - 1];
  if (!previousUnitId) return undefined;
  const previousVersion = getCurrentVersion(snapshot, previousUnitId);
  return previousVersion ? [previousVersion.id] : undefined;
}

function resolveRestoredDeletedUnit(
  index: number,
  line: LineageLine,
  explicitSources: Map<number, string[]>,
  snapshot: LineageSnapshot,
): { unit: LineageUnit; version: LineVersion } | null {
  const sourceVersionIds = explicitSources.get(index);
  if (!sourceVersionIds) return null;
  for (const sourceVersionId of sourceVersionIds) {
    const version = snapshot.versions[sourceVersionId];
    if (!version) continue;
    const unit = snapshot.units[version.unitId];
    if (!unit || unit.status !== 'deleted') continue;
    if (normalizeLineContent(version.content) !== normalizeLineContent(line.content)) continue;
    return { unit, version };
  }
  return null;
}

function findRestoreLineIndexes(
  lines: LineageLine[],
  explicitSources: Map<number, string[]>,
  snapshot: LineageSnapshot,
): Set<number> {
  const out = new Set<number>();
  for (const [index] of explicitSources) {
    const line = lines[index];
    if (!line) continue;
    if (resolveRestoredDeletedUnit(index, line, explicitSources, snapshot)) out.add(index);
  }
  return out;
}

function createWarningsFromMatches(
  notePath: string,
  matches: InternalMatch[],
  now: string
): ReconciliationWarning[] {
  return matches
    .filter((match) =>
      match.newLineIndex >= 0 &&
      match.matchKind !== 'new' &&
      (
        match.confidence < LOW_CONFIDENCE_WARNING_THRESHOLD ||
        match.reasons.some((reason) => reason.toLowerCase().includes('ambiguous'))
      )
    )
    .map((match) => ({
      id: createLineageId('rw'),
      notePath,
      message: `Line ${match.newLineIndex + 1} was matched with ${Math.round(match.confidence * 100)}% confidence`,
      matches: [stripInternalMatch(match)],
      createdAt: now,
      status: 'open' as const,
    }));
}

function stripInternalMatch(match: InternalMatch): ReconciliationMatch {
  const { oldIndex: _oldIndex, oldIndexes: _oldIndexes, ...out } = match;
  return out;
}

function reconcileLines(
  snapshot: LineageSnapshot,
  nextLines: LineageLine[],
  restoreLineIndexes: Set<number> = new Set(),
): InternalMatch[] {
  const oldCandidates = snapshot.order
    .map<OldLineCandidate | null>((unitId, index) => {
      const version = getCurrentVersion(snapshot, unitId);
      return version ? { unitId, version, index } : null;
    })
    .filter((candidate): candidate is OldLineCandidate => candidate !== null);

  const matches: InternalMatch[] = [];
  const usedOld = new Set<string>();
  const usedNew = new Set<number>();

  for (let index = 0; index < nextLines.length; index++) {
    if (restoreLineIndexes.has(index)) continue;
    const line = nextLines[index]!;
    const hash = stableHash(normalizeLineContent(line.content));
    const exact = chooseExactCandidate(oldCandidates, usedOld, hash, index, line);
    if (!exact) continue;
    const candidate = exact.candidate;

    usedOld.add(candidate.unitId);
    usedNew.add(index);
    matches.push({
      oldUnitId: candidate.unitId,
      oldIndex: candidate.index,
      newLineIndex: index,
      matchKind: candidate.index === index ? 'same' : 'moved',
      confidence: exact.confidence,
      reasons: exact.reasons,
    });
  }

  detectSplits(oldCandidates, nextLines, usedOld, usedNew, restoreLineIndexes, matches);
  detectMerges(oldCandidates, nextLines, usedOld, usedNew, restoreLineIndexes, matches);

  for (let index = 0; index < nextLines.length; index++) {
    if (usedNew.has(index)) continue;
    if (restoreLineIndexes.has(index)) continue;
    const line = nextLines[index]!;
    const candidate = chooseEditedCandidate(oldCandidates, usedOld, line, index);
    if (!candidate) continue;

    usedOld.add(candidate.unitId);
    usedNew.add(index);
    matches.push({
      oldUnitId: candidate.unitId,
      oldIndex: candidate.index,
      newLineIndex: index,
      matchKind: 'edited',
      confidence: candidate.score,
      reasons: candidate.reasons,
    });
  }

  for (let index = 0; index < nextLines.length; index++) {
    if (usedNew.has(index)) continue;
    matches.push({
      oldUnitId: null,
      oldIndex: null,
      newLineIndex: index,
      matchKind: 'new',
      confidence: 1,
      reasons: ['no previous line matched with sufficient confidence'],
    });
  }

  for (const candidate of oldCandidates) {
    if (usedOld.has(candidate.unitId)) continue;
    matches.push({
      oldUnitId: candidate.unitId,
      oldIndex: candidate.index,
      newLineIndex: -1,
      matchKind: 'deleted',
      confidence: 1,
      reasons: ['previous line was not present in the new markdown'],
    });
  }

  return matches.sort((a, b) => {
    if (a.newLineIndex === -1 && b.newLineIndex === -1) {
      return (a.oldIndex ?? 0) - (b.oldIndex ?? 0);
    }
    if (a.newLineIndex === -1) return 1;
    if (b.newLineIndex === -1) return -1;
    return a.newLineIndex - b.newLineIndex;
  });
}

function chooseExactCandidate(
  candidates: OldLineCandidate[],
  usedOld: Set<string>,
  hash: string,
  newIndex: number,
  line: LineageLine
): { candidate: OldLineCandidate; confidence: number; reasons: string[] } | null {
  const exact = candidates.filter((candidate) => {
    if (usedOld.has(candidate.unitId)) return false;
    if (candidate.version.contentHash !== hash) return false;
    if (line.blockType && candidate.version.blockType && line.blockType !== candidate.version.blockType) {
      return false;
    }
    return true;
  });
  if (exact.length === 0) return null;
  const samePosition = exact.find((candidate) => candidate.index === newIndex);
  if (samePosition) {
    return {
      candidate: samePosition,
      confidence: 1,
      reasons: ['content hash matched'],
    };
  }

  const sorted = exact.sort((a, b) => Math.abs(a.index - newIndex) - Math.abs(b.index - newIndex));
  const candidate = sorted[0];
  if (!candidate) return null;

  return {
    candidate,
    confidence: sorted.length > 1 ? 0.74 : 0.96,
    reasons: [
      'content hash matched at a new position',
      ...(sorted.length > 1 ? ['ambiguous duplicate content match'] : []),
    ],
  };
}

function detectSplits(
  oldCandidates: OldLineCandidate[],
  nextLines: LineageLine[],
  usedOld: Set<string>,
  usedNew: Set<number>,
  reservedNew: Set<number>,
  matches: InternalMatch[]
): void {
  for (const candidate of oldCandidates) {
    if (usedOld.has(candidate.unitId)) continue;

    let best: { start: number; length: number; score: number } | null = null;
    for (let start = 0; start < nextLines.length; start++) {
      if (usedNew.has(start)) continue;
      if (reservedNew.has(start)) continue;
      for (const length of [2, 3]) {
        if (start + length > nextLines.length) continue;
        const segment = nextLines.slice(start, start + length);
        if (segment.some((_, offset) => usedNew.has(start + offset))) continue;
        if (segment.some((_, offset) => reservedNew.has(start + offset))) continue;
        const combined = segment.map((line) => line.content).join(' ');
        const score = similarity(candidate.version.content, combined);
        if (score < 0.72) continue;
        if (!best || score > best.score) best = { start, length, score };
      }
    }

    if (!best) continue;

    usedOld.add(candidate.unitId);
    for (let offset = 0; offset < best.length; offset++) {
      const newLineIndex = best.start + offset;
      usedNew.add(newLineIndex);
      matches.push({
        oldUnitId: candidate.unitId,
        oldIndex: candidate.index,
        newLineIndex,
        matchKind: 'split',
        confidence: best.score,
        reasons: [
          `split from previous line ${candidate.index + 1}`,
          `combined text similarity ${best.score.toFixed(2)}`,
        ],
      });
    }
  }
}

function detectMerges(
  oldCandidates: OldLineCandidate[],
  nextLines: LineageLine[],
  usedOld: Set<string>,
  usedNew: Set<number>,
  reservedNew: Set<number>,
  matches: InternalMatch[]
): void {
  for (let newIndex = 0; newIndex < nextLines.length; newIndex++) {
    if (usedNew.has(newIndex)) continue;
    if (reservedNew.has(newIndex)) continue;

    let best: { candidates: OldLineCandidate[]; score: number } | null = null;
    for (let start = 0; start < oldCandidates.length; start++) {
      for (const length of [2, 3]) {
        const segment = oldCandidates.slice(start, start + length);
        if (segment.length !== length) continue;
        if (segment.some((candidate) => usedOld.has(candidate.unitId))) continue;
        if (!areAdjacent(segment)) continue;
        const combined = segment.map((candidate) => candidate.version.content).join(' ');
        const score = similarity(combined, nextLines[newIndex]!.content);
        if (score < 0.72) continue;
        if (!best || score > best.score) best = { candidates: segment, score };
      }
    }

    if (!best) continue;

    for (const candidate of best.candidates) {
      usedOld.add(candidate.unitId);
    }
    usedNew.add(newIndex);
    matches.push({
      oldUnitId: best.candidates[0]!.unitId,
      oldUnitIds: best.candidates.map((candidate) => candidate.unitId),
      oldIndex: best.candidates[0]!.index,
      oldIndexes: best.candidates.map((candidate) => candidate.index),
      newLineIndex: newIndex,
      matchKind: 'merged',
      confidence: best.score,
      reasons: [
        `merged from previous lines ${best.candidates.map((candidate) => candidate.index + 1).join(', ')}`,
        `combined text similarity ${best.score.toFixed(2)}`,
      ],
    });
  }
}

function areAdjacent(candidates: OldLineCandidate[]): boolean {
  for (let index = 1; index < candidates.length; index++) {
    if (candidates[index]!.index !== candidates[index - 1]!.index + 1) return false;
  }
  return true;
}

function chooseEditedCandidate(
  candidates: OldLineCandidate[],
  usedOld: Set<string>,
  line: LineageLine,
  newIndex: number
): { unitId: string; index: number; score: number; reasons: string[] } | null {
  const scored: Array<{ unitId: string; index: number; score: number; reasons: string[] }> = [];

  for (const candidate of candidates) {
    if (usedOld.has(candidate.unitId)) continue;
    const contentScore = similarity(candidate.version.content, line.content);
    const blockBonus = candidate.version.blockType && line.blockType && candidate.version.blockType === line.blockType
      ? 0.08
      : 0;
    const positionBonus = candidate.index === newIndex ? 0.08 : Math.max(0, 0.04 - Math.abs(candidate.index - newIndex) * 0.01);
    const score = Math.min(1, contentScore + blockBonus + positionBonus);
    if (score < EDIT_MATCH_THRESHOLD) continue;
    scored.push({
      unitId: candidate.unitId,
      index: candidate.index,
      score,
      reasons: [
        `text similarity ${contentScore.toFixed(2)}`,
        ...(blockBonus > 0 ? ['same markdown block type'] : []),
        ...(positionBonus > 0 ? ['near previous position'] : []),
      ],
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] ?? null;
  const runnerUp = scored[1];
  if (best && runnerUp && best.score - runnerUp.score <= AMBIGUOUS_MATCH_MARGIN) {
    best.reasons.push(`ambiguous with ${runnerUp.unitId} at ${runnerUp.score.toFixed(2)}`);
    best.score = Math.min(best.score, 0.7);
  }
  return best;
}

function similarity(a: string, b: string): number {
  const left = bigrams(normalizeLineContent(a).toLowerCase());
  const right = bigrams(normalizeLineContent(b).toLowerCase());
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) overlap++;
  }
  return (2 * overlap) / (left.size + right.size);
}

function bigrams(value: string): Set<string> {
  if (!value) return new Set();
  if (value.length <= 2) return new Set([value]);
  const out = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    out.add(value.slice(i, i + 2));
  }
  return out;
}

function cloneSnapshot(snapshot: LineageSnapshot): LineageSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LineageSnapshot;
}

function buildEditCluster(snapshot: LineageSnapshot, patch: LineagePatch): LineageEditCluster {
  const intent = snapshot.intents[patch.intentId] ?? null;
  const changeTypes = unique(patch.changes.map((change) => change.type));
  const changedUnitIds = unique(patch.changes.flatMap(extractChangedUnitIds));
  const versionIds = unique(patch.changes.flatMap((change) => extractChangedVersionIds(change, snapshot)));
  const diffHunks = buildDiffHunks(snapshot, patch);
  const deletedLines = buildDeletedLinesForPatch(snapshot, patch);
  const versions = versionIds
    .map((versionId) => snapshot.versions[versionId])
    .filter((version): version is LineVersion => version !== undefined)
    .map((version) => {
      const lineIndex = snapshot.order.indexOf(version.unitId);
      const clusterVersion: LineageEditCluster['versions'][number] = {
        versionId: version.id,
        unitId: version.unitId,
        line: lineIndex >= 0 ? lineIndex + 1 : null,
        content: version.content,
        actor: version.actor,
        intent: version.intentId ? snapshot.intents[version.intentId] ?? null : null,
        sourceVersionIds: version.sourceVersionIds,
        createdAt: version.createdAt,
      };
      if (version.context !== undefined) clusterVersion.context = version.context;
      return clusterVersion;
    })
    .sort((a, b) => {
      if (a.line === null && b.line === null) return a.createdAt.localeCompare(b.createdAt);
      if (a.line === null) return 1;
      if (b.line === null) return -1;
      return a.line - b.line;
    });

  const lines = versions
    .map((version) => version.line)
    .concat(deletedLines.map((line) => line.lastKnownLine))
    .filter((line): line is number => line !== null);
  const lineRange = {
    start: lines.length > 0 ? Math.min(...lines) : null,
    end: lines.length > 0 ? Math.max(...lines) : null,
  };
  const warningIds = Object.values(snapshot.reconciliationWarnings ?? {})
    .filter((warning) => warning.matches.some((match) =>
      (match.oldUnitId && changedUnitIds.includes(match.oldUnitId)) ||
      (match.oldUnitIds?.some((unitId) => changedUnitIds.includes(unitId)) ?? false) ||
      (match.newLineIndex >= 0 &&
        lineRange.start !== null &&
        match.newLineIndex + 1 >= lineRange.start &&
        match.newLineIndex + 1 <= (lineRange.end ?? lineRange.start))
    ))
    .map((warning) => warning.id);

  const summary = summarizeCluster({
    intent,
    patch,
    changeTypes,
    lineRange,
    versions,
    deletedLines,
  });

  return {
    id: `cluster_${patch.id}`,
    notePath: snapshot.notePath,
    patchId: patch.id,
    intentId: patch.intentId,
    intent,
    createdAt: patch.createdAt,
    clusterId: intent?.clusterId ?? `cluster_${patch.id}`,
    captureReason: intent?.captureReason ?? null,
    kind: intent?.kind ?? 'mixed',
    changeTypes,
    changedUnitIds,
    lineRange,
    versions,
    deletedLines,
    warningIds,
    diffHunks,
    ...(intent?.receiptId !== undefined ? { receiptId: intent.receiptId } : {}),
    ...(intent?.provenanceEventId !== undefined ? { provenanceEventId: intent.provenanceEventId } : {}),
    summary,
  };
}

function buildDiffHunks(snapshot: LineageSnapshot, patch: LineagePatch): LineageDiffHunk[] {
  return patch.changes
    .flatMap((change): LineageDiffHunk[] => {
      switch (change.type) {
        case 'unit.created': {
          const after = snapshot.versions[change.versionId];
          if (!after) return [];
          return [createDiffHunk({
            id: `${patch.id}:${change.type}:${change.unitId}`,
            unitId: change.unitId,
            line: lineNumberForUnit(snapshot, change.unitId),
            changeType: change.type,
            before: null,
            after: after.content,
            toVersionId: after.id,
          })];
        }
        case 'unit.deleted': {
          const before = snapshot.versions[change.previousVersionId];
          return [createDiffHunk({
            id: `${patch.id}:${change.type}:${change.unitId}`,
            unitId: change.unitId,
            line: before ? lastKnownLineForVersion(before) : lineNumberForUnit(snapshot, change.unitId),
            changeType: change.type,
            before: before?.content ?? '',
            after: null,
            fromVersionId: change.previousVersionId,
          })];
        }
        case 'unit.updated': {
          const before = snapshot.versions[change.fromVersionId];
          const after = snapshot.versions[change.toVersionId];
          return [createDiffHunk({
            id: `${patch.id}:${change.type}:${change.unitId}`,
            unitId: change.unitId,
            line: lineNumberForUnit(snapshot, change.unitId),
            changeType: change.type,
            before: before?.content ?? '',
            after: after?.content ?? '',
            fromVersionId: change.fromVersionId,
            toVersionId: change.toVersionId,
          })];
        }
        case 'unit.moved':
        case 'unit.split':
        case 'unit.merged':
        case 'span.annotated':
          return [];
      }
    })
    .filter((hunk) => hunk.before !== hunk.after);
}

function createDiffHunk(params: {
  id: string;
  unitId: string | null;
  line: number | null;
  changeType: LineageDiffHunk['changeType'];
  before: string | null;
  after: string | null;
  fromVersionId?: string;
  toVersionId?: string;
}): LineageDiffHunk {
  const out: LineageDiffHunk = {
    id: params.id,
    unitId: params.unitId,
    line: params.line,
    changeType: params.changeType,
    before: params.before,
    after: params.after,
    tokens: buildInlineDiff(params.before ?? '', params.after ?? ''),
  };
  if (params.fromVersionId !== undefined) out.fromVersionId = params.fromVersionId;
  if (params.toVersionId !== undefined) out.toVersionId = params.toVersionId;
  return out;
}

function buildPendingTimelineEntry(
  notePath: string,
  snapshot: LineageSnapshot | null,
  baseMarkdown: string,
  pendingMarkdown: string,
): LineagePendingTimelineEntry | null {
  if (baseMarkdown === pendingMarkdown) return null;

  const beforeLines = splitMarkdownLines(baseMarkdown).map((line) => line.content);
  const afterLines = splitMarkdownLines(pendingMarkdown).map((line) => line.content);
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const diffHunks: LineageDiffHunk[] = [];
  const changeTypes = new Set<LineagePendingTimelineEntry['changeTypes'][number]>();
  const changedUnitIds: string[] = [];

  for (let index = 0; index < maxLength; index++) {
    const before = beforeLines[index] ?? null;
    const after = afterLines[index] ?? null;
    if (before === after) continue;

    const unitId = snapshot?.order[index] ?? null;
    if (unitId) changedUnitIds.push(unitId);
    const changeType =
      before === null ? 'pending.create' :
      after === null ? 'pending.delete' :
      'pending.update';
    changeTypes.add(changeType);
    diffHunks.push(createDiffHunk({
      id: `pending:${index}:${changeType}`,
      unitId,
      line: index + 1,
      changeType,
      before,
      after,
    }));
  }

  if (diffHunks.length === 0) return null;
  const lines = diffHunks.map((hunk) => hunk.line).filter((line): line is number => line !== null);
  const lineRange = {
    start: lines.length > 0 ? Math.min(...lines) : null,
    end: lines.length > 0 ? Math.max(...lines) : null,
  };
  const now = new Date().toISOString();

  return {
    id: 'pending-editor-diff',
    notePath,
    createdAt: now,
    clusterId: 'pending-editor-diff',
    captureReason: 'autosave',
    isPending: true,
    kind: 'update',
    summary: `Unsaved editor changes touch ${formatLineRange(lineRange)}`,
    changeTypes: [...changeTypes],
    changedUnitIds: unique(changedUnitIds),
    lineRange,
    versions: [],
    deletedLines: [],
    warningIds: [],
    diffHunks,
  };
}

function buildInlineDiff(before: string, after: string): LineageDiffToken[] {
  if (before === after) return before ? [{ type: 'same', text: before }] : [];

  const left = tokenizeDiffText(before);
  const right = tokenizeDiffText(after);
  const dp: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i]![j] = left[i] === right[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const tokens: LineageDiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pushDiffToken(tokens, 'same', left[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      pushDiffToken(tokens, 'removed', left[i]!);
      i++;
    } else {
      pushDiffToken(tokens, 'added', right[j]!);
      j++;
    }
  }
  while (i < left.length) {
    pushDiffToken(tokens, 'removed', left[i]!);
    i++;
  }
  while (j < right.length) {
    pushDiffToken(tokens, 'added', right[j]!);
    j++;
  }

  return tokens;
}

function tokenizeDiffText(value: string): string[] {
  return value.match(/\s+|[^\s]+/g) ?? [];
}

function pushDiffToken(tokens: LineageDiffToken[], type: LineageDiffToken['type'], text: string): void {
  const last = tokens[tokens.length - 1];
  if (last?.type === type) {
    last.text += text;
    return;
  }
  tokens.push({ type, text });
}

function lineNumberForUnit(snapshot: LineageSnapshot, unitId: string): number | null {
  const index = snapshot.order.indexOf(unitId);
  return index >= 0 ? index + 1 : null;
}

function lastKnownLineForVersion(version: LineVersion): number | null {
  return version.context ? version.context.lineIndex + 1 : null;
}

function buildDeletedLines(snapshot: LineageSnapshot): LineageDeletedLine[] {
  return Object.values(snapshot.units)
    .filter((unit) => unit.status === 'deleted')
    .map((unit) => {
      const versionId = unit.currentVersionId;
      const version = versionId ? snapshot.versions[versionId] : undefined;
      return version ? buildDeletedLine(snapshot, unit.id, version.id) : null;
    })
    .filter((line): line is LineageDeletedLine => line !== null)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || (a.lastKnownLine ?? 0) - (b.lastKnownLine ?? 0));
}

function buildDeletedLinesForPatch(snapshot: LineageSnapshot, patch: LineagePatch): LineageDeletedLine[] {
  return patch.changes
    .filter((change): change is Extract<LineageChange, { type: 'unit.deleted' }> => change.type === 'unit.deleted')
    .map((change) => buildDeletedLine(snapshot, change.unitId, change.previousVersionId, patch.createdAt))
    .filter((line): line is LineageDeletedLine => line !== null)
    .sort((a, b) => (a.lastKnownLine ?? Number.MAX_SAFE_INTEGER) - (b.lastKnownLine ?? Number.MAX_SAFE_INTEGER));
}

function buildDeletedLine(
  snapshot: LineageSnapshot,
  unitId: string,
  versionId: string,
  deletedAtOverride?: string,
): LineageDeletedLine | null {
  const unit = snapshot.units[unitId];
  const version = snapshot.versions[versionId];
  if (!unit || !version || version.unitId !== unitId) return null;

  const line: LineageDeletedLine = {
    unitId,
    versionId: version.id,
    notePath: snapshot.notePath,
    content: version.content,
    actor: version.actor,
    intent: version.intentId ? snapshot.intents[version.intentId] ?? null : null,
    sourceVersionIds: version.sourceVersionIds,
    createdAt: version.createdAt,
    deletedAt: deletedAtOverride ?? unit.deletedAt ?? version.supersededAt ?? version.createdAt,
    lastKnownLine: lastKnownLineForVersion(version),
    restoreEligible: unit.status === 'deleted',
  };
  if (version.context !== undefined) line.context = version.context;
  return line;
}

function findRestorePlacement(
  currentLines: string[],
  version: LineVersion,
): {
  index: number;
  strategy: LineageDeletedRestorePreview['strategy'];
  confidence: number;
  reason: string;
} {
  const context = version.context;
  if (context) {
    for (const before of context.before.slice().reverse()) {
      const index = findMatchingLine(currentLines, before.content);
      if (index >= 0) {
        return {
          index: Math.min(index + 1, currentLines.length),
          strategy: 'context',
          confidence: 0.92,
          reason: `Placed after surviving previous context line ${before.lineIndex + 1}.`,
        };
      }
    }

    for (const after of context.after) {
      const index = findMatchingLine(currentLines, after.content);
      if (index >= 0) {
        return {
          index,
          strategy: 'context',
          confidence: 0.9,
          reason: `Placed before surviving following context line ${after.lineIndex + 1}.`,
        };
      }
    }

    return {
      index: clamp(context.lineIndex, 0, currentLines.length),
      strategy: 'last-known-line',
      confidence: 0.55,
      reason: `Original context moved away; using last known line ${context.lineIndex + 1}.`,
    };
  }

  return {
    index: currentLines.length,
    strategy: 'append',
    confidence: 0.3,
    reason: 'No stored context is available, so the line will be appended.',
  };
}

function findMatchingLine(lines: string[], content: string): number {
  const normalized = normalizeLineContent(content);
  return lines.findIndex((line) => normalizeLineContent(line) === normalized);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function summarizePatchDiff(patch: LineagePatch): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const change of patch.changes) {
    switch (change.type) {
      case 'unit.created':
        added++;
        break;
      case 'unit.deleted':
        removed++;
        break;
      case 'unit.updated':
        added++;
        removed++;
        break;
      case 'unit.merged':
        removed += Math.max(0, change.fromUnitIds.length - 1);
        break;
      case 'unit.split':
        added += Math.max(0, change.toUnitIds.length - 1);
        break;
      case 'unit.moved':
      case 'span.annotated':
        break;
    }
  }
  return { added, removed };
}

function resolveProvenanceType(
  intent: IntentFrame,
  explicitType?: string,
): ProvenanceEventType {
  if (isProvenanceEventType(explicitType)) return explicitType;
  if (intent.actor.kind !== 'ai-agent') return 'user_edit';
  if (intent.kind === 'rewrite') return 'ai_rewrite';
  if (intent.kind === 'continue') return 'ai_continue';
  return 'ai_action';
}

function isProvenanceEventType(value: string | undefined): value is ProvenanceEventType {
  return value === 'ai_rewrite' ||
    value === 'ai_action' ||
    value === 'user_edit' ||
    value === 'ai_generate' ||
    value === 'ai_continue';
}

function formatLineRange(range: { start: number | null; end: number | null }): string {
  if (range.start === null) return 'draft lines';
  if (range.start === range.end) return `line ${range.start}`;
  return `lines ${range.start}-${range.end}`;
}

function extractChangedUnitIds(change: LineageChange): string[] {
  switch (change.type) {
    case 'unit.created':
    case 'unit.deleted':
    case 'unit.updated':
    case 'unit.moved':
    case 'span.annotated':
      return [change.unitId];
    case 'unit.split':
      return [change.fromUnitId, ...change.toUnitIds];
    case 'unit.merged':
      return [...change.fromUnitIds, change.toUnitId];
  }
}

function extractChangedVersionIds(change: LineageChange, snapshot: LineageSnapshot): string[] {
  switch (change.type) {
    case 'unit.created':
      return [change.versionId];
    case 'unit.deleted':
      return [change.previousVersionId];
    case 'unit.updated':
      return [change.toVersionId];
    case 'unit.moved': {
      const versionId = snapshot.units[change.unitId]?.currentVersionId;
      return versionId ? [versionId] : [];
    }
    case 'unit.split':
      return change.toUnitIds
        .map((unitId) => snapshot.units[unitId]?.currentVersionId)
        .filter((versionId): versionId is string => typeof versionId === 'string');
    case 'unit.merged': {
      const versionId = snapshot.units[change.toUnitId]?.currentVersionId;
      return versionId ? [versionId] : [];
    }
    case 'span.annotated': {
      const versionId = snapshot.units[change.unitId]?.currentVersionId;
      return versionId ? [versionId] : [];
    }
  }
}

function summarizeCluster(params: {
  intent: IntentFrame | null;
  patch: LineagePatch;
  changeTypes: string[];
  lineRange: { start: number | null; end: number | null };
  versions: Array<{ content: string; actor: LineActor }>;
  deletedLines: LineageDeletedLine[];
}): string {
  const actor = params.versions[0]?.actor ?? params.deletedLines[0]?.actor ?? params.intent?.actor ?? DEFAULT_ACTOR;
  const actorText = actor.kind === 'ai-agent'
    ? actor.model ?? actor.name ?? 'AI agent'
    : actor.name ?? actor.kind.replace(/-/g, ' ');
  const range = params.lineRange.start === null
    ? 'no active lines'
    : params.lineRange.start === params.lineRange.end
      ? `line ${params.lineRange.start}`
      : `lines ${params.lineRange.start}-${params.lineRange.end}`;
  const action = params.intent?.summary ?? params.intent?.kind.replace(/-/g, ' ') ?? 'Lineage change';
  if (params.deletedLines.length > 0 && params.changeTypes.includes('unit.deleted')) {
    const deletedText = `deleted ${params.deletedLines.length} line${params.deletedLines.length === 1 ? '' : 's'}`;
    const sample = params.deletedLines[0]?.content ? `: ${params.deletedLines[0].content.slice(0, 96)}` : '';
    return `${action} by ${actorText} ${deletedText} at ${range}${sample}`;
  }
  const sample = params.versions[0]?.content ? `: ${params.versions[0].content.slice(0, 96)}` : '';
  return `${action} by ${actorText} touched ${range} (${params.changeTypes.join(', ') || 'no structural changes'})${sample}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clonePlain<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function scheduleBackgroundWork(callback: () => void): void {
  const scheduler = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  };
  if (typeof scheduler.requestIdleCallback === 'function') {
    scheduler.requestIdleCallback(callback, { timeout: 1200 });
    return;
  }
  setTimeout(callback, 0);
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
