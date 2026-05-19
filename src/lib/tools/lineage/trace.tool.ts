import { defineTool } from '../define';
import { actorLabel, intentLabel, resolveLineageNoteId, toZeroBasedLine } from './helpers';

interface TraceArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
  versionId?: string;
  direction?: 'ancestors' | 'descendants' | 'both';
  depth?: number;
}

interface TraceNode {
  versionId: string;
  unitId: string;
  content: string;
  actor: string;
  intent: string;
  createdAt: string;
}

interface TraceEdge {
  fromVersionId: string;
  toVersionId: string;
  relation: 'source';
}

interface TraceResult {
  noteId: string;
  rootVersionId: string;
  rootUnitId: string;
  direction: 'ancestors' | 'descendants' | 'both';
  nodes: TraceNode[];
  edges: TraceEdge[];
  summary: string;
}

export default defineTool<TraceArgs, TraceResult>({
  id: 'lineage:trace',
  name: 'Trace Lineage',
  description: 'Trace source and downstream version ancestry for a lineage-tracked markdown line',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to trace', minimum: 1 },
    unitId: { type: 'string', description: 'Lineage unit ID to trace instead of a line number' },
    versionId: { type: 'string', description: 'Specific version ID to use as the trace root' },
    direction: {
      type: 'string',
      description: 'Trace source ancestors, downstream descendants, or both',
      enum: ['ancestors', 'descendants', 'both'],
      default: 'ancestors',
    },
    depth: { type: 'number', description: 'Maximum traversal depth', minimum: 1, maximum: 25 },
  },
  keywords: ['trace', 'lineage', 'ancestry', 'source', 'downstream'],
  examples: ['Trace line 12', 'Show downstream lineage for this version', 'Trace source versions for lu_123'],
  estimatedDuration: 80,
  resourceId: (args) => args.noteId ?? 'active-note',
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(15, 'Reading lineage snapshot...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const snapshotResult = await services.lineage.getSnapshot(noteId);
    if (!snapshotResult.ok) throw new Error(`Failed to read lineage snapshot: ${snapshotResult.error.message}`);
    const snapshot = snapshotResult.value;
    if (!snapshot) throw new Error(`No lineage snapshot for ${noteId}`);

    let rootVersionId = args.versionId;
    let rootUnitId = args.unitId;
    if (!rootVersionId) {
      if (args.line !== undefined) {
        const explanation = await services.lineage.explainLine(noteId, toZeroBasedLine(args.line));
        if (!explanation.ok) throw new Error(`Failed to explain line: ${explanation.error.message}`);
        if (!explanation.value) throw new Error(`No lineage recorded for line ${args.line}`);
        rootVersionId = explanation.value.currentVersion.id;
        rootUnitId = explanation.value.unitId;
      } else if (rootUnitId) {
        rootVersionId = snapshot.units[rootUnitId]?.currentVersionId ?? undefined;
      }
    }

    if (!rootVersionId) throw new Error('Provide line, unitId, or versionId to trace.');
    const root = snapshot.versions[rootVersionId];
    if (!root) throw new Error(`Lineage version not found: ${rootVersionId}`);
    rootUnitId = root.unitId;

    const direction = args.direction ?? 'ancestors';
    const maxDepth = Math.max(1, Math.min(args.depth ?? 8, 25));
    const nodeIds = new Set<string>([root.id]);
    const edges: TraceEdge[] = [];

    const descendantsBySource = new Map<string, string[]>();
    for (const version of Object.values(snapshot.versions)) {
      for (const sourceId of version.sourceVersionIds) {
        const list = descendantsBySource.get(sourceId) ?? [];
        list.push(version.id);
        descendantsBySource.set(sourceId, list);
      }
    }

    if (direction === 'ancestors' || direction === 'both') {
      walkAncestors(root.id, 0);
    }
    if (direction === 'descendants' || direction === 'both') {
      walkDescendants(root.id, 0);
    }

    const nodes = [...nodeIds]
      .map((id) => snapshot.versions[id])
      .filter((version): version is NonNullable<typeof version> => version !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map<TraceNode>((version) => ({
        versionId: version.id,
        unitId: version.unitId,
        content: version.content,
        actor: actorLabel(version.actor),
        intent: intentLabel(version.intentId ? snapshot.intents[version.intentId] : null),
        createdAt: version.createdAt,
      }));

    progress(100, 'Lineage trace ready');
    return {
      noteId,
      rootVersionId: root.id,
      rootUnitId,
      direction,
      nodes,
      edges,
      summary: `${nodes.length} version${nodes.length === 1 ? '' : 's'}, ${edges.length} source edge${edges.length === 1 ? '' : 's'}`,
    };

    function walkAncestors(versionId: string, depth: number): void {
      if (depth >= maxDepth) return;
      const version = snapshot?.versions[versionId];
      if (!version) return;
      for (const sourceId of version.sourceVersionIds) {
        if (!snapshot?.versions[sourceId]) continue;
        nodeIds.add(sourceId);
        edges.push({ fromVersionId: sourceId, toVersionId: versionId, relation: 'source' });
        walkAncestors(sourceId, depth + 1);
      }
    }

    function walkDescendants(versionId: string, depth: number): void {
      if (depth >= maxDepth) return;
      for (const targetId of descendantsBySource.get(versionId) ?? []) {
        nodeIds.add(targetId);
        edges.push({ fromVersionId: versionId, toVersionId: targetId, relation: 'source' });
        walkDescendants(targetId, depth + 1);
      }
    }
  },

  summary: (_args, result) => `Traced ${result.summary} in ${result.noteId}`,
});
