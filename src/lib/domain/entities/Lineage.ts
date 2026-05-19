/**
 * Lineage - line-level intent and version history for markdown artifacts.
 *
 * The markdown file remains the portable projection. These entities describe
 * the sidecar history stored under .void/lineage/.
 *
 * Pure domain code: no framework, adapter, or Tauri dependencies.
 */

export type LineageGranularity =
  | 'line'
  | 'block'
  | 'sentence'
  | 'span'
  | 'todo'
  | 'heading'
  | 'table-cell'
  | 'code-line';

export type LineageUnitStatus = 'active' | 'deleted' | 'superseded' | 'branched';

export type IntentActorKind = 'user' | 'ai-agent' | 'external-editor' | 'importer' | 'system';

export type LineageCaptureReason =
  | 'autosave'
  | 'manual-save'
  | 'external-reconcile'
  | 'tool'
  | 'import'
  | 'branch'
  | 'restore';

export type IntentKind =
  | 'type'
  | 'paste'
  | 'delete'
  | 'move'
  | 'split'
  | 'merge'
  | 'rewrite'
  | 'summarize'
  | 'extract'
  | 'continue'
  | 'research'
  | 'plan'
  | 'commitment-create'
  | 'commitment-update'
  | 'restore'
  | 'branch'
  | 'accept-branch'
  | 'external-reconcile'
  | 'import'
  | 'update';

export type LineageMatchKind =
  | 'same'
  | 'moved'
  | 'edited'
  | 'split'
  | 'merged'
  | 'new'
  | 'deleted';

export interface LineActor {
  kind: IntentActorKind;
  name?: string;
  model?: string;
  provider?: string;
}

export interface LineageUnit {
  id: string;
  notePath: string;
  granularity: LineageGranularity;
  currentVersionId: string | null;
  parentUnitIds: string[];
  childUnitIds: string[];
  createdAt: string;
  deletedAt: string | null;
  status: LineageUnitStatus;
}

export interface LineageContextLine {
  lineIndex: number;
  content: string;
}

export interface LineageVersionContext {
  lineIndex: number;
  lineCount: number;
  documentHash: string;
  before: LineageContextLine[];
  after: LineageContextLine[];
  capturedAt: string;
}

export interface LineVersion {
  id: string;
  unitId: string;
  notePath: string;
  content: string;
  actor: LineActor;
  operationId: string | null;
  intentId: string | null;
  sourceVersionIds: string[];
  createdAt: string;
  supersededAt: string | null;
  contentHash: string;
  contextHash: string;
  markdownPrefix?: string;
  blockType?: string;
  context?: LineageVersionContext;
}

export interface IntentFrame {
  id: string;
  kind: IntentKind;
  actor: LineActor;
  createdAt: string;
  summary: string;
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
  source?: {
    type: 'keyboard' | 'pasteboard' | 'quick-capture' | 'meeting' | 'web' | 'file-import' | 'tool';
    ref?: string;
  };
}

export type LineageChange =
  | { type: 'unit.created'; unitId: string; versionId: string; orderAfterUnitId: string | null }
  | { type: 'unit.deleted'; unitId: string; previousVersionId: string }
  | { type: 'unit.updated'; unitId: string; fromVersionId: string; toVersionId: string }
  | { type: 'unit.moved'; unitId: string; fromIndex: number; toIndex: number }
  | { type: 'unit.split'; fromUnitId: string; toUnitIds: string[] }
  | { type: 'unit.merged'; fromUnitIds: string[]; toUnitId: string }
  | { type: 'span.annotated'; unitId: string; spanId: string; annotationId: string };

export interface LineagePatch {
  id: string;
  notePath: string;
  intentId: string;
  createdAt: string;
  changes: LineageChange[];
  reversible: boolean;
}

export interface ReconciliationMatch {
  oldUnitId: string | null;
  oldUnitIds?: string[];
  newLineIndex: number;
  matchKind: LineageMatchKind;
  confidence: number;
  reasons: string[];
}

export interface ReconciliationWarning {
  id: string;
  notePath: string;
  message: string;
  matches: ReconciliationMatch[];
  createdAt: string;
  status?: 'open' | 'resolved' | 'dismissed';
  resolvedAt?: string;
  resolution?: string;
}

export type LineageJournalEntry =
  | { type: 'intent.created'; intent: IntentFrame }
  | { type: 'unit.created'; unit: LineageUnit }
  | { type: 'version.created'; version: LineVersion }
  | { type: 'patch.applied'; patch: LineagePatch }
  | { type: 'snapshot.created'; snapshotId: string; hash: string; createdAt: string }
  | { type: 'reconciliation.warning'; warning: ReconciliationWarning };

export interface LineageSnapshot {
  id: string;
  notePath: string;
  order: string[];
  units: Record<string, LineageUnit>;
  versions: Record<string, LineVersion>;
  intents: Record<string, IntentFrame>;
  patches: Record<string, LineagePatch>;
  reconciliationWarnings?: Record<string, ReconciliationWarning>;
  currentMarkdownHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface LineageLineSource {
  lineIndex: number;
  sourceVersionIds: string[];
}

export interface CreateIntentParams {
  kind: IntentKind;
  actor: LineActor;
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
  source?: IntentFrame['source'];
  now?: string;
}

export interface CreateLineVersionParams {
  unitId: string;
  notePath: string;
  content: string;
  actor: LineActor;
  operationId?: string | null;
  intentId?: string | null;
  sourceVersionIds?: string[];
  markdownPrefix?: string;
  blockType?: string;
  now?: string;
  contextHash?: string;
  context?: LineageVersionContext;
}

export interface LineageLine {
  content: string;
  markdownPrefix?: string;
  blockType?: string;
}

export function createLineageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function stableHash(input: string): string {
  // FNV-1a 32-bit hash. Deterministic, fast, and good enough for local IDs.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function splitMarkdownLines(markdown: string): LineageLine[] {
  const raw = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map(parseLineageLine);
}

export function parseLineageLine(content: string): LineageLine {
  const markdownPrefix = inferMarkdownPrefix(content);
  const blockType = inferBlockType(content);
  const line: LineageLine = { content };
  if (markdownPrefix !== undefined) line.markdownPrefix = markdownPrefix;
  if (blockType !== undefined) line.blockType = blockType;
  return line;
}

export function createIntentFrame(params: CreateIntentParams): IntentFrame {
  const now = params.now ?? new Date().toISOString();
  const frame: IntentFrame = {
    id: createLineageId('intent'),
    kind: params.kind,
    actor: params.actor,
    createdAt: now,
    summary: params.summary ?? summarizeIntent(params.kind, params.actor),
  };
  if (params.prompt !== undefined) frame.prompt = params.prompt;
  if (params.clusterId !== undefined) frame.clusterId = params.clusterId;
  if (params.captureReason !== undefined) frame.captureReason = params.captureReason;
  if (params.commandId !== undefined) frame.commandId = params.commandId;
  if (params.agentRunId !== undefined) frame.agentRunId = params.agentRunId;
  if (params.agentTaskId !== undefined) frame.agentTaskId = params.agentTaskId;
  if (params.receiptId !== undefined) frame.receiptId = params.receiptId;
  if (params.provenanceEventId !== undefined) frame.provenanceEventId = params.provenanceEventId;
  if (params.provenanceType !== undefined) frame.provenanceType = params.provenanceType;
  if (params.branchId !== undefined) frame.branchId = params.branchId;
  if (params.source !== undefined) frame.source = params.source;
  return frame;
}

export function createLineageUnit(params: {
  notePath: string;
  currentVersionId?: string | null;
  parentUnitIds?: string[];
  childUnitIds?: string[];
  granularity?: LineageGranularity;
  now?: string;
}): LineageUnit {
  const now = params.now ?? new Date().toISOString();
  return {
    id: createLineageId('lu'),
    notePath: params.notePath,
    granularity: params.granularity ?? 'line',
    currentVersionId: params.currentVersionId ?? null,
    parentUnitIds: params.parentUnitIds ?? [],
    childUnitIds: params.childUnitIds ?? [],
    createdAt: now,
    deletedAt: null,
    status: 'active',
  };
}

export function createLineVersion(params: CreateLineVersionParams): LineVersion {
  const now = params.now ?? new Date().toISOString();
  const contentHash = stableHash(normalizeLineContent(params.content));
  const version: LineVersion = {
    id: createLineageId('lv'),
    unitId: params.unitId,
    notePath: params.notePath,
    content: params.content,
    actor: params.actor,
    operationId: params.operationId ?? null,
    intentId: params.intentId ?? null,
    sourceVersionIds: params.sourceVersionIds ?? [],
    createdAt: now,
    supersededAt: null,
    contentHash,
    contextHash: params.contextHash ?? contentHash,
  };
  if (params.markdownPrefix !== undefined) version.markdownPrefix = params.markdownPrefix;
  if (params.blockType !== undefined) version.blockType = params.blockType;
  if (params.context !== undefined) version.context = params.context;
  return version;
}

export function createEmptyLineageSnapshot(notePath: string, now = new Date().toISOString()): LineageSnapshot {
  return {
    id: createLineageId('snapshot'),
    notePath,
    order: [],
    units: {},
    versions: {},
    intents: {},
    patches: {},
    reconciliationWarnings: {},
    currentMarkdownHash: stableHash(''),
    createdAt: now,
    updatedAt: now,
  };
}

export function materializeLineageMarkdown(snapshot: LineageSnapshot): string {
  return snapshot.order
    .map((unitId) => {
      const unit = snapshot.units[unitId];
      if (!unit || unit.status !== 'active' || !unit.currentVersionId) return null;
      return snapshot.versions[unit.currentVersionId]?.content ?? null;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function getCurrentVersion(snapshot: LineageSnapshot, unitId: string): LineVersion | null {
  const unit = snapshot.units[unitId];
  if (!unit?.currentVersionId) return null;
  return snapshot.versions[unit.currentVersionId] ?? null;
}

export function normalizeLineContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ');
}

export function inferBlockType(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed === '') return 'blank';
  if (/^#{1,6}\s/.test(trimmed)) return 'heading';
  if (/^[-*+]\s+\[[ xX]\]\s/.test(trimmed)) return 'todo';
  if (/^[-*+]\s+/.test(trimmed)) return 'bullet';
  if (/^\d+\.\s+/.test(trimmed)) return 'ordered';
  if (/^>\s?/.test(trimmed)) return 'blockquote';
  if (/^```/.test(trimmed)) return 'code-fence';
  if (/^---+$/.test(trimmed)) return 'divider';
  return 'paragraph';
}

function inferMarkdownPrefix(line: string): string | undefined {
  const match = line.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?|```\w*|---+))/);
  return match?.[1];
}

function summarizeIntent(kind: IntentKind, actor: LineActor): string {
  const actorLabel = actor.kind === 'ai-agent' ? 'AI agent' : actor.kind;
  return `${actorLabel} ${kind.replace(/-/g, ' ')}`;
}
