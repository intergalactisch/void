/**
 * LineageService - inbound port for line-level intent/version history.
 */

import type { Result } from '$lib/core';
import type {
  IntentFrame,
  IntentKind,
  LineActor,
  LineageChange,
  LineageJournalEntry,
  LineagePatch,
  LineageSnapshot,
  LineVersion,
  ReconciliationMatch,
  ReconciliationWarning,
  LineageLineSource,
  LineageCaptureReason,
} from '$lib/domain/entities/Lineage';

export interface LineageRecordOptions {
  actor?: LineActor;
  intentKind?: IntentKind;
  summary?: string;
  clusterId?: string;
  captureReason?: LineageCaptureReason;
  prompt?: string;
  commandId?: string;
  agentRunId?: string;
  agentTaskId?: string;
  receiptId?: string;
  provenanceEventId?: string;
  provenanceType?: string;
  branchId?: string;
  operationId?: string | null;
  source?: IntentFrame['source'];
  lineSources?: LineageLineSource[];
}

export interface LineHistory {
  unitId: string;
  versions: LineVersion[];
}

export interface LineExplanation {
  notePath: string;
  lineIndex: number;
  unitId: string;
  currentVersion: LineVersion;
  intent: IntentFrame | null;
  previousVersions: LineVersion[];
}

export interface LineageRecordResult {
  snapshot: LineageSnapshot;
  patch: LineagePatch;
  matches: ReconciliationMatch[];
  warnings?: ReconciliationWarning[];
  entries: LineageJournalEntry[];
}

export interface LineageRepairResult {
  snapshot: LineageSnapshot;
  patch: LineagePatch;
  warning: ReconciliationWarning | null;
  materializedMarkdown: string;
}

export interface LineageQueuedChange {
  jobId: string;
  notePath: string;
  queuedAt: string;
}

export interface LineageQueueStatus {
  pendingJobs: number;
  activeJobs: number;
  lastError: string | null;
}

export interface LineageClusterVersion {
  versionId: string;
  unitId: string;
  line: number | null;
  content: string;
  actor: LineActor;
  intent: IntentFrame | null;
  sourceVersionIds: string[];
  createdAt: string;
  context?: LineVersion['context'];
}

export interface LineageDeletedLine {
  unitId: string;
  versionId: string;
  notePath: string;
  content: string;
  actor: LineActor;
  intent: IntentFrame | null;
  sourceVersionIds: string[];
  createdAt: string;
  deletedAt: string;
  lastKnownLine: number | null;
  context?: LineVersion['context'];
  restoreEligible: boolean;
}

export interface LineageDeletedRestorePreview {
  notePath: string;
  unitId: string;
  versionId: string;
  content: string;
  markdown: string;
  insertLine: number;
  strategy: 'context' | 'last-known-line' | 'append';
  confidence: number;
  reason: string;
}

export interface LineageEditCluster {
  id: string;
  notePath: string;
  patchId: string;
  intentId: string;
  intent: IntentFrame | null;
  createdAt: string;
  clusterId: string;
  captureReason: LineageCaptureReason | null;
  kind: IntentKind | 'mixed';
  changeTypes: LineageChange['type'][];
  changedUnitIds: string[];
  lineRange: { start: number | null; end: number | null };
  versions: LineageClusterVersion[];
  deletedLines: LineageDeletedLine[];
  warningIds: string[];
  diffHunks: LineageDiffHunk[];
  receiptId?: string;
  provenanceEventId?: string;
  summary: string;
}

export interface LineageClusterQuery {
  limit?: number;
  since?: string;
  includeEmpty?: boolean;
}

export interface LineageAgentContextOptions {
  line?: number;
  unitId?: string;
  clusterLimit?: number;
}

export interface LineageAgentLine {
  line: number;
  unitId: string;
  versionId: string;
  content: string;
  actor: LineActor;
  intent: IntentFrame | null;
  sourceVersionIds: string[];
  context?: LineVersion['context'];
}

export interface LineageAgentContext {
  notePath: string;
  currentMarkdownHash: string | null;
  lineCount: number;
  queue: LineageQueueStatus;
  target: LineExplanation | null;
  lines: LineageAgentLine[];
  clusters: LineageEditCluster[];
  warnings: ReconciliationWarning[];
  summary: string;
}

export interface LineageDiffToken {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export interface LineageDiffHunk {
  id: string;
  unitId: string | null;
  line: number | null;
  changeType: LineageChange['type'] | 'pending.update' | 'pending.create' | 'pending.delete';
  before: string | null;
  after: string | null;
  tokens: LineageDiffToken[];
  fromVersionId?: string;
  toVersionId?: string;
}

export type LineageTimelineEntry =
  | (LineageEditCluster & {
      isPending?: false;
      commitmentStatus?: 'current' | 'stale' | 'unknown';
      sourceLinks?: Array<{ label: string; value: string }>;
      branchLinks?: Array<{ branchId: string; label: string }>;
    })
  | LineagePendingTimelineEntry;

export interface LineagePendingTimelineEntry {
  id: string;
  notePath: string;
  createdAt: string;
  clusterId: string;
  captureReason: 'autosave';
  isPending: true;
  kind: 'update';
  summary: string;
  changeTypes: Array<'pending.update' | 'pending.create' | 'pending.delete'>;
  changedUnitIds: string[];
  lineRange: { start: number | null; end: number | null };
  versions: [];
  deletedLines: [];
  warningIds: [];
  diffHunks: LineageDiffHunk[];
}

export interface LineageTimelineQuery {
  limit?: number;
  includePending?: boolean;
  pendingMarkdown?: string;
  currentMarkdown?: string;
  selectedLine?: number;
}

export interface LineageTimeline {
  notePath: string;
  currentMarkdownHash: string | null;
  queue: LineageQueueStatus;
  entries: LineageTimelineEntry[];
  deletedLines: LineageDeletedLine[];
  warnings: ReconciliationWarning[];
  pendingEntry: LineagePendingTimelineEntry | null;
  summary: string;
}

export interface LineageService {
  /**
   * Queue a markdown snapshot for lineage recording. The call returns quickly;
   * reconciliation and sidecar writes run later on the service's serialized
   * background queue so editor saves do not wait on lineage work.
   */
  enqueueMarkdownChange(
    notePath: string,
    markdown: string,
    options?: LineageRecordOptions
  ): Promise<Result<LineageQueuedChange, Error>>;

  recordMarkdownChange(
    notePath: string,
    markdown: string,
    options?: LineageRecordOptions
  ): Promise<Result<LineageRecordResult, Error>>;

  flush(notePath?: string): Promise<Result<void, Error>>;

  getQueueStatus(): LineageQueueStatus;

  getSnapshot(notePath: string): Promise<Result<LineageSnapshot | null, Error>>;

  getJournal(notePath: string): Promise<Result<LineageJournalEntry[], Error>>;

  getLineHistory(notePath: string, unitId: string): Promise<Result<LineHistory, Error>>;

  explainLine(notePath: string, lineIndex: number): Promise<Result<LineExplanation | null, Error>>;

  materialize(notePath: string): Promise<Result<string, Error>>;

  previewRevertLine(notePath: string, unitId: string, versionId: string): Promise<Result<string, Error>>;

  getDeletedLines(notePath: string): Promise<Result<LineageDeletedLine[], Error>>;

  previewRestoreDeletedLine(
    notePath: string,
    unitId: string,
    versionId?: string
  ): Promise<Result<LineageDeletedRestorePreview, Error>>;

  getReconciliationWarnings(notePath: string): Promise<Result<ReconciliationWarning[], Error>>;

  getEditClusters(
    notePath: string,
    query?: LineageClusterQuery
  ): Promise<Result<LineageEditCluster[], Error>>;

  getTimeline(
    notePath: string,
    query?: LineageTimelineQuery
  ): Promise<Result<LineageTimeline, Error>>;

  getAgentContext(
    notePath: string,
    options?: LineageAgentContextOptions
  ): Promise<Result<LineageAgentContext, Error>>;

  repairLineMatch(
    notePath: string,
    lineIndex: number,
    unitId: string,
    options?: LineageRecordOptions & { warningId?: string }
  ): Promise<Result<LineageRepairResult, Error>>;
}
