/**
 * Lineage store - note history workspace and line-focused trace state.
 */

import type {
  CommitmentLineageService,
  CommitmentSourceInfo,
  LineageService,
  NoteCollaborationService,
  EditorService,
} from '$lib/ports/inbound';
import type {
  LineExplanation,
  LineHistory,
  LineageDeletedLine,
  LineageDeletedRestorePreview,
  LineageEditCluster,
  LineageTimeline,
  LineageTimelineEntry,
} from '$lib/ports/inbound/LineageService';
import type { Block } from '$lib/domain/entities/Block';
import type { LineVersion, ReconciliationWarning } from '$lib/domain/entities/Lineage';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import { events } from '$lib/events';

export interface LineageTraceEdge {
  fromVersionId: string;
  toVersionId: string;
}

export interface LineageTraceNode {
  version: LineVersion;
  depth: number;
  direction: 'source' | 'downstream' | 'root';
}

export type LineageTimelineFilter = 'all' | 'focused' | 'deleted' | 'warnings';

class LineageStore {
  private lineage: LineageService | null = null;
  private collaboration: NoteCollaborationService | null = null;
  private commitmentLineage: CommitmentLineageService | null = null;
  private editor: EditorService | null = null;
  private markdown: MarkdownSerializerPort | null = null;
  private offInspect: (() => void) | null = null;

  visible = $state(false);
  loading = $state(false);
  restoring = $state(false);
  repairing = $state(false);
  error = $state<Error | null>(null);
  notePath = $state<string | null>(null);
  lineIndex = $state<number | null>(null);
  blockId = $state<string | null>(null);
  position = $state<{ top: number; left: number } | null>(null);
  explanation = $state<LineExplanation | null>(null);
  history = $state<LineHistory | null>(null);
  warnings = $state<ReconciliationWarning[]>([]);
  clusters = $state<LineageEditCluster[]>([]);
  activeCluster = $state<LineageEditCluster | null>(null);
  commitmentSource = $state<CommitmentSourceInfo | null>(null);
  traceNodes = $state<LineageTraceNode[]>([]);
  traceEdges = $state<LineageTraceEdge[]>([]);
  timeline = $state<LineageTimeline | null>(null);
  deletedLines = $state<LineageDeletedLine[]>([]);
  timelineFilter = $state<LineageTimelineFilter>('all');
  selectedEntryId = $state<string | null>(null);
  restorePreview = $state<LineageDeletedRestorePreview | null>(null);

  init(
    lineage: LineageService,
    collaboration: NoteCollaborationService,
    commitmentLineage: CommitmentLineageService,
    editor: EditorService,
    markdown?: MarkdownSerializerPort,
  ): void {
    this.destroy();
    this.lineage = lineage;
    this.collaboration = collaboration;
    this.commitmentLineage = commitmentLineage;
    this.editor = editor;
    this.markdown = markdown ?? null;

    const handler = (payload: {
      blockId: string;
      lineIndex: number;
      position: { top: number; left: number };
    }) => {
      const path = this.editor?.getState().document?.path ?? null;
      if (!path) return;
      void this.openWorkspace(path, payload.lineIndex, payload.blockId, payload.position);
    };
    events.on('editor:lineage-inspect-request', handler);
    this.offInspect = () => events.off('editor:lineage-inspect-request', handler);
  }

  async open(
    notePath: string,
    lineIndex: number,
    blockId?: string,
    position?: { top: number; left: number },
  ): Promise<void> {
    await this.openWorkspace(notePath, lineIndex, blockId, position);
  }

  async openWorkspace(
    notePath?: string | null,
    lineIndex?: number | null,
    blockId?: string,
    position?: { top: number; left: number },
  ): Promise<void> {
    const resolvedPath = notePath ?? this.editor?.getState().document?.path ?? null;
    if (!resolvedPath) return;
    const resolvedLineIndex = this.resolveLineIndexForBlock(blockId, lineIndex ?? null);

    this.visible = true;
    this.notePath = resolvedPath;
    this.lineIndex = resolvedLineIndex;
    this.blockId = blockId ?? null;
    this.position = position ?? null;
    this.timelineFilter = 'all';
    this.restorePreview = null;
    await this.refresh();
  }

  close(): void {
    this.visible = false;
    this.error = null;
    this.selectedEntryId = null;
  }

  async refresh(): Promise<void> {
    if (!this.lineage || this.notePath === null) return;
    this.loading = true;
    this.error = null;

    try {
      const pendingMarkdown = this.getPendingMarkdownForActiveNote();
      const timelineQuery: Parameters<LineageService['getTimeline']>[1] = { limit: 80 };
      if (pendingMarkdown !== null) timelineQuery.pendingMarkdown = pendingMarkdown;
      if (this.lineIndex !== null) timelineQuery.selectedLine = this.lineIndex;
      const timeline = await this.lineage.getTimeline(this.notePath, timelineQuery);
      if (!timeline.ok) {
        this.error = timeline.error;
        return;
      }

      this.timeline = timeline.value;
      this.deletedLines = timeline.value.deletedLines;
      this.clusters = timeline.value.entries.filter((entry): entry is LineageEditCluster =>
        !('isPending' in entry && entry.isPending)
      );
      this.warnings = timeline.value.warnings;
      this.selectedEntryId = this.resolveSelectedEntryId(this.filterTimelineEntries(timeline.value.entries));

      const explanation = this.lineIndex !== null
        ? await this.lineage.explainLine(this.notePath, this.lineIndex)
        : null;
      if (explanation && !explanation.ok) {
        this.error = explanation.error;
        return;
      }

      this.explanation = explanation?.value ?? null;
      this.history = null;
      this.traceNodes = [];
      this.traceEdges = [];
      this.commitmentSource = null;
      this.activeCluster = null;

      if (this.explanation) {
        const history = await this.lineage.getLineHistory(this.notePath, this.explanation.unitId);
        if (history.ok) this.history = history.value;
        await this.refreshTrace(this.explanation.currentVersion.id);
        this.activeCluster = this.findClusterForVersion(this.explanation.currentVersion.id);
      }

      if (this.commitmentLineage && this.lineIndex !== null) {
        const source = await this.commitmentLineage.getSourceForLine(this.notePath, this.lineIndex);
        if (source.ok) this.commitmentSource = source.value;
      }
    } finally {
      this.loading = false;
    }
  }

  selectEntry(entryId: string): void {
    this.selectedEntryId = entryId;
    this.restorePreview = null;
  }

  setTimelineFilter(filter: LineageTimelineFilter): void {
    this.timelineFilter = filter;
    if (!this.timeline) return;
    const entries = this.filterTimelineEntries(this.timeline.entries);
    if (!entries.some((entry) => entry.id === this.selectedEntryId)) {
      this.selectedEntryId = this.resolveSelectedEntryId(entries);
    }
    this.restorePreview = null;
  }

  get selectedEntry(): LineageTimelineEntry | null {
    if (!this.timeline || !this.selectedEntryId) return null;
    return this.timeline.entries.find((entry) => entry.id === this.selectedEntryId) ?? null;
  }

  get visibleTimelineEntries(): LineageTimelineEntry[] {
    return this.timeline ? this.filterTimelineEntries(this.timeline.entries) : [];
  }

  async restoreVersion(versionId: string): Promise<boolean> {
    if (!this.lineage || !this.collaboration || !this.explanation || !this.notePath) return false;
    this.restoring = true;
    this.error = null;
    try {
      const preview = await this.lineage.previewRevertLine(
        this.notePath,
        this.explanation.unitId,
        versionId,
      );
      if (!preview.ok) {
        this.error = preview.error;
        return false;
      }

      const write = await this.collaboration.applyNoteContent(
        this.notePath,
        preview.value,
        'Restore line',
        {
          actor: { kind: 'user' },
          intentKind: 'restore',
          summary: `Restore line ${this.lineIndex !== null ? this.lineIndex + 1 : ''} to ${versionId}`,
          commandId: 'lineage-workspace:restore',
          captureReason: 'restore',
          source: { type: 'tool' },
        },
      );
      if (!write.ok) {
        this.error = write.error;
        return false;
      }
      await this.refresh();
      return true;
    } finally {
      this.restoring = false;
    }
  }

  async previewDeletedRestore(unitId: string, versionId?: string): Promise<boolean> {
    if (!this.lineage || !this.notePath) return false;
    this.restoring = true;
    this.error = null;
    try {
      const preview = await this.lineage.previewRestoreDeletedLine(this.notePath, unitId, versionId);
      if (!preview.ok) {
        this.error = preview.error;
        return false;
      }
      this.restorePreview = preview.value;
      return true;
    } finally {
      this.restoring = false;
    }
  }

  async applyDeletedRestore(): Promise<boolean> {
    if (!this.collaboration || !this.notePath || !this.restorePreview) return false;
    this.restoring = true;
    this.error = null;
    try {
      const preview = this.restorePreview;
      const write = await this.collaboration.applyNoteContent(
        this.notePath,
        preview.markdown,
        'Restore deleted line',
        {
          actor: { kind: 'user' },
          intentKind: 'restore',
          summary: `Restore deleted line at line ${preview.insertLine}`,
          commandId: 'lineage-workspace:restore-deleted',
          captureReason: 'restore',
          source: { type: 'tool' },
          lineSources: [{
            lineIndex: preview.insertLine - 1,
            sourceVersionIds: [preview.versionId],
          }],
        },
      );
      if (!write.ok) {
        this.error = write.error;
        return false;
      }
      this.restorePreview = null;
      await this.refresh();
      return true;
    } finally {
      this.restoring = false;
    }
  }

  async repairTo(unitId: string, warningId?: string): Promise<boolean> {
    if (!this.lineage || !this.notePath || this.lineIndex === null) return false;
    this.repairing = true;
    this.error = null;
    try {
      const options = {
        actor: { kind: 'user' as const },
        intentKind: 'external-reconcile' as const,
        summary: `Repair line ${this.lineIndex + 1} lineage match`,
        commandId: 'lineage-workspace:repair',
        captureReason: 'external-reconcile' as const,
        source: { type: 'tool' as const },
      };
      const result = await this.lineage.repairLineMatch(
        this.notePath,
        this.lineIndex,
        unitId,
        warningId ? { ...options, warningId } : options,
      );
      if (!result.ok) {
        this.error = result.error;
        return false;
      }
      await this.refresh();
      return true;
    } finally {
      this.repairing = false;
    }
  }

  destroy(): void {
    this.offInspect?.();
    this.offInspect = null;
    this.lineage = null;
    this.collaboration = null;
    this.commitmentLineage = null;
    this.editor = null;
    this.markdown = null;
    this.visible = false;
    this.explanation = null;
    this.history = null;
    this.warnings = [];
    this.clusters = [];
    this.activeCluster = null;
    this.commitmentSource = null;
    this.traceNodes = [];
    this.traceEdges = [];
    this.timeline = null;
    this.deletedLines = [];
    this.timelineFilter = 'all';
    this.selectedEntryId = null;
    this.restorePreview = null;
  }

  private async refreshTrace(rootVersionId: string): Promise<void> {
    if (!this.lineage || !this.notePath) return;
    const snapshotResult = await this.lineage.getSnapshot(this.notePath);
    if (!snapshotResult.ok || !snapshotResult.value) return;
    const snapshot = snapshotResult.value;
    const root = snapshot.versions[rootVersionId];
    if (!root) return;

    const nodes = new Map<string, LineageTraceNode>();
    const edges: LineageTraceEdge[] = [];
    nodes.set(root.id, { version: root, depth: 0, direction: 'root' });

    for (const sourceId of root.sourceVersionIds) {
      const source = snapshot.versions[sourceId];
      if (!source) continue;
      nodes.set(source.id, { version: source, depth: 1, direction: 'source' });
      edges.push({ fromVersionId: source.id, toVersionId: root.id });
    }

    for (const version of Object.values(snapshot.versions)) {
      if (!version.sourceVersionIds.includes(root.id)) continue;
      nodes.set(version.id, { version, depth: 1, direction: 'downstream' });
      edges.push({ fromVersionId: root.id, toVersionId: version.id });
    }

    this.traceNodes = [...nodes.values()].sort((a, b) => a.depth - b.depth || a.version.createdAt.localeCompare(b.version.createdAt));
    this.traceEdges = edges;
  }

  private findClusterForVersion(versionId: string): LineageEditCluster | null {
    return this.clusters.find((cluster) =>
      cluster.versions.some((version) => version.versionId === versionId)
    ) ?? null;
  }

  private resolveSelectedEntryId(entries: LineageTimelineEntry[]): string | null {
    if (entries.length === 0) return null;
    if (this.selectedEntryId && entries.some((entry) => entry.id === this.selectedEntryId)) {
      return this.selectedEntryId;
    }
    if (this.lineIndex !== null) {
      const selectedLine = this.lineIndex + 1;
      const entry = entries.find((candidate) =>
        candidate.lineRange.start !== null &&
        selectedLine >= candidate.lineRange.start &&
        selectedLine <= (candidate.lineRange.end ?? candidate.lineRange.start)
      );
      if (entry) return entry.id;
    }
    return entries[0]!.id;
  }

  private filterTimelineEntries(entries: LineageTimelineEntry[]): LineageTimelineEntry[] {
    switch (this.timelineFilter) {
      case 'focused': {
        if (this.lineIndex === null) return entries;
        const selectedLine = this.lineIndex + 1;
        return entries.filter((entry) =>
          entry.lineRange.start !== null &&
          selectedLine >= entry.lineRange.start &&
          selectedLine <= (entry.lineRange.end ?? entry.lineRange.start)
        );
      }
      case 'deleted':
        return entries.filter((entry) =>
          (entry.changeTypes as string[]).includes('unit.deleted') ||
          (entry.changeTypes as string[]).includes('pending.delete') ||
          entry.diffHunks.some((hunk) => hunk.changeType === 'unit.deleted' || hunk.changeType === 'pending.delete')
        );
      case 'warnings':
        return entries.filter((entry) => entry.warningIds.length > 0);
      case 'all':
      default:
        return entries;
    }
  }

  private getPendingMarkdownForActiveNote(): string | null {
    const state = this.editor?.getState();
    if (!state?.document || state.document.path !== this.notePath || !state.isDirty) return null;
    if (this.markdown) {
      return this.markdown.serializeBlocks(state.document.blocks);
    }
    const result = this.editor?.getMarkdown();
    return result?.ok ? result.value : null;
  }

  private resolveLineIndexForBlock(blockId: string | undefined, fallback: number | null): number | null {
    if (!blockId) return fallback;
    const blocks = this.editor?.getState().document?.blocks;
    if (!blocks) return fallback;
    return buildBlockLineIndexMap(blocks).get(blockId) ?? fallback;
  }
}

export const lineageStore = new LineageStore();

function buildBlockLineIndexMap(blocks: Block[]): Map<string, number> {
  const map = new Map<string, number>();
  let line = 0;
  let previousTopLevelType: Block['type'] | null = null;

  for (const block of blocks) {
    if (previousTopLevelType === 'todoItem' && block.type !== 'todoItem') {
      line += 1;
    }
    line = addBlockToLineMap(block, line, map, { topLevel: true });
    previousTopLevelType = block.type;
  }

  return map;
}

function addBlockToLineMap(
  block: Block,
  line: number,
  map: Map<string, number>,
  context: { topLevel: boolean; inList?: boolean } = { topLevel: false },
): number {
  map.set(block.id, line);

  if (block.type === 'bulletList' || block.type === 'numberedList') {
    let nextLine = line;
    for (const child of block.children) {
      nextLine = addListItemToLineMap(child, nextLine, map);
    }
    return context.topLevel ? nextLine + 1 : nextLine;
  }

  if (block.type === 'todoItem') {
    return line + 1;
  }

  if (block.type === 'codeBlock') {
    return line + countTextLines(block.content) + 3;
  }

  if (block.type === 'blockquote') {
    let nextLine = line;
    if (block.children.length === 0) return line + 2;
    for (const child of block.children) {
      map.set(child.id, nextLine);
      nextLine += Math.max(1, countTextLines(child.content));
    }
    return nextLine + 1;
  }

  if (block.type === 'callout') {
    let nextLine = line + 1;
    for (const child of block.children) {
      map.set(child.id, nextLine);
      nextLine += Math.max(1, countTextLines(child.content));
    }
    return nextLine + 1;
  }

  if (block.type === 'table') {
    const rows = 'rows' in block.attrs ? block.attrs.rows : [];
    return line + Math.max(2, rows.length + 1) + 1;
  }

  if (block.type === 'toggle') {
    let nextLine = line + 3;
    for (const child of block.children.slice(1)) {
      nextLine = addBlockToLineMap(child, nextLine, map, { topLevel: false });
    }
    return nextLine + 1;
  }

  const lineSpan = context.inList ? 1 : 2;
  return line + lineSpan;
}

function addListItemToLineMap(block: Block, line: number, map: Map<string, number>): number {
  map.set(block.id, line);
  let nextLine = line + Math.max(1, countTextLines(block.content));
  for (const child of block.children) {
    nextLine = addBlockToLineMap(child, nextLine, map, { topLevel: false, inList: true });
  }
  return nextLine;
}

function countTextLines(value: string): number {
  if (!value) return 1;
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').length;
}
