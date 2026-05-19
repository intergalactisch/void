import { defineTool } from '../define';
import { actorLabel, intentLabel, resolveLineageNoteId, toZeroBasedLine } from './helpers';

interface HistoryArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
  limit?: number;
}

interface HistoryVersion {
  versionId: string;
  unitId: string;
  content: string;
  actor: string;
  intent: string;
  createdAt: string;
  supersededAt: string | null;
  sourceVersionIds: string[];
}

interface HistoryResult {
  noteId: string;
  scope: 'note' | 'line' | 'unit';
  line?: number;
  unitId?: string;
  currentVersionId?: string | null;
  versions?: HistoryVersion[];
  timeline?: Array<{
    type: string;
    createdAt: string;
    summary: string;
  }>;
  summary: string;
}

export default defineTool<HistoryArgs, HistoryResult>({
  id: 'lineage:history',
  name: 'Line History',
  description: 'Show line-level lineage history for a note, line number, or lineage unit',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to inspect', minimum: 1 },
    unitId: { type: 'string', description: 'Stable lineage unit ID to inspect' },
    limit: { type: 'number', description: 'Maximum note-level timeline entries to return', minimum: 1, maximum: 100 },
  },
  keywords: ['lineage', 'history', 'versions', 'source', 'provenance'],
  examples: ['Show history for line 8', 'Show this note lineage', 'Show versions for lineage unit lu_123'],
  estimatedDuration: 80,
  resourceId: (args) => args.noteId ?? 'active-note',
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(15, 'Reading lineage...');
    const noteId = await resolveLineageNoteId(args.noteId, services);

    if (args.line !== undefined) {
      const lineIndex = toZeroBasedLine(args.line);
      const explanation = await services.lineage.explainLine(noteId, lineIndex);
      if (!explanation.ok) throw new Error(`Failed to explain line: ${explanation.error.message}`);
      if (!explanation.value) throw new Error(`No lineage recorded for line ${args.line}`);

      const history = await services.lineage.getLineHistory(noteId, explanation.value.unitId);
      if (!history.ok) throw new Error(`Failed to read line history: ${history.error.message}`);

      const snapshot = await services.lineage.getSnapshot(noteId);
      if (!snapshot.ok) throw new Error(`Failed to read lineage snapshot: ${snapshot.error.message}`);
      const versions = history.value.versions.map((version) => ({
        versionId: version.id,
        unitId: version.unitId,
        content: version.content,
        actor: actorLabel(version.actor),
        intent: intentLabel(version.intentId ? snapshot.value?.intents[version.intentId] : null),
        createdAt: version.createdAt,
        supersededAt: version.supersededAt,
        sourceVersionIds: version.sourceVersionIds,
      }));

      progress(100, 'Line history ready');
      return {
        noteId,
        scope: 'line',
        line: args.line,
        unitId: explanation.value.unitId,
        currentVersionId: explanation.value.currentVersion.id,
        versions,
        summary: versions.map((version) => `${version.createdAt} - ${version.actor} - ${version.intent} - ${version.content}`).join('\n'),
      };
    }

    if (args.unitId !== undefined) {
      const history = await services.lineage.getLineHistory(noteId, args.unitId);
      if (!history.ok) throw new Error(`Failed to read line history: ${history.error.message}`);

      const snapshot = await services.lineage.getSnapshot(noteId);
      if (!snapshot.ok) throw new Error(`Failed to read lineage snapshot: ${snapshot.error.message}`);
      const versions = history.value.versions.map((version) => ({
        versionId: version.id,
        unitId: version.unitId,
        content: version.content,
        actor: actorLabel(version.actor),
        intent: intentLabel(version.intentId ? snapshot.value?.intents[version.intentId] : null),
        createdAt: version.createdAt,
        supersededAt: version.supersededAt,
        sourceVersionIds: version.sourceVersionIds,
      }));

      progress(100, 'Unit history ready');
      return {
        noteId,
        scope: 'unit',
        unitId: args.unitId,
        currentVersionId: snapshot.value?.units[args.unitId]?.currentVersionId ?? null,
        versions,
        summary: versions.map((version) => `${version.createdAt} - ${version.actor} - ${version.intent} - ${version.content}`).join('\n'),
      };
    }

    const journal = await services.lineage.getJournal(noteId);
    if (!journal.ok) throw new Error(`Failed to read lineage journal: ${journal.error.message}`);
    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
    const timeline = journal.value
      .map((entry) => {
        if (entry.type === 'intent.created') {
          return {
            type: entry.type,
            createdAt: entry.intent.createdAt,
            summary: `${entry.intent.kind}: ${entry.intent.summary} by ${actorLabel(entry.intent.actor)}`,
          };
        }
        if (entry.type === 'version.created') {
          return {
            type: entry.type,
            createdAt: entry.version.createdAt,
            summary: `version ${entry.version.id} for ${entry.version.unitId}: ${entry.version.content}`,
          };
        }
        if (entry.type === 'unit.created') {
          return {
            type: entry.type,
            createdAt: entry.unit.createdAt,
            summary: `unit ${entry.unit.id} created`,
          };
        }
        if (entry.type === 'patch.applied') {
          return {
            type: entry.type,
            createdAt: entry.patch.createdAt,
            summary: `patch ${entry.patch.id} with ${entry.patch.changes.length} changes`,
          };
        }
        if (entry.type === 'snapshot.created') {
          return {
            type: entry.type,
            createdAt: entry.createdAt,
            summary: `snapshot ${entry.snapshotId} hash ${entry.hash}`,
          };
        }
        return {
          type: entry.type,
          createdAt: entry.warning.createdAt,
          summary: entry.warning.message,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);

    progress(100, 'Note timeline ready');
    return {
      noteId,
      scope: 'note',
      timeline,
      summary: timeline.map((entry) => `${entry.createdAt} - ${entry.summary}`).join('\n'),
    };
  },

  summary: (args, result) => {
    if (result.scope === 'line') return `Read lineage history for line ${args.line}`;
    if (result.scope === 'unit') return `Read lineage history for ${args.unitId}`;
    return `Read lineage timeline for ${result.noteId}`;
  },
});
