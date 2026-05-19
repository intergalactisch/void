import { defineTool } from '../define';
import { resolveLineageNoteId, toZeroBasedLine } from './helpers';

interface RevertArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
  versionId?: string;
}

interface RevertResult {
  success: boolean;
  noteId: string;
  line?: number;
  unitId: string;
  fromVersionId: string;
  toVersionId: string;
  restoredContent: string;
}

export default defineTool<RevertArgs, RevertResult>({
  id: 'lineage:revert',
  name: 'Revert Line',
  description: 'Restore one lineage-tracked markdown line to a previous version and record the restore intent',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to revert', minimum: 1 },
    unitId: { type: 'string', description: 'Lineage unit ID to revert instead of a line number' },
    versionId: { type: 'string', description: 'Target historical version ID. Defaults to the previous version.' },
  },
  keywords: ['revert', 'restore', 'undo', 'lineage', 'history'],
  examples: ['Revert line 9', 'Restore this line to version lv_123'],
  requiresConfirmation: true,
  estimatedDuration: 120,
  resourceId: (args) => args.noteId ?? 'active-note',
  accessMode: 'write',

  async execute(args, { services, progress, invocation }) {
    progress(15, 'Resolving target line...');
    const noteId = await resolveLineageNoteId(args.noteId, services);

    let unitId = args.unitId;
    let currentVersionId: string | null = null;
    if (!unitId) {
      if (args.line === undefined) {
        throw new Error('Provide either line or unitId to revert.');
      }
      const explanation = await services.lineage.explainLine(noteId, toZeroBasedLine(args.line));
      if (!explanation.ok) throw new Error(`Failed to read line: ${explanation.error.message}`);
      if (!explanation.value) throw new Error(`No lineage recorded for line ${args.line}`);
      unitId = explanation.value.unitId;
      currentVersionId = explanation.value.currentVersion.id;
    }

    const history = await services.lineage.getLineHistory(noteId, unitId);
    if (!history.ok) throw new Error(`Failed to read line history: ${history.error.message}`);
    const versions = history.value.versions;
    if (versions.length === 0) throw new Error(`No versions recorded for ${unitId}`);
    currentVersionId ??= versions[versions.length - 1]?.id ?? null;

    const target = args.versionId
      ? versions.find((version) => version.id === args.versionId)
      : versions.slice(0, -1).at(-1);
    if (!target) {
      throw new Error(args.versionId
        ? `Version ${args.versionId} is not part of ${unitId}`
        : `Line ${args.line ?? unitId} has no previous version to restore`);
    }

    progress(45, 'Previewing restore...');
    const preview = await services.lineage.previewRevertLine(noteId, unitId, target.id);
    if (!preview.ok) throw new Error(`Failed to preview revert: ${preview.error.message}`);

    progress(75, 'Writing restored note...');
    const write = await services.collaboration.applyNoteContent(
      noteId,
      preview.value,
      'AI lineage restore',
      {
        actor: { kind: 'ai-agent' },
        intentKind: 'restore',
        summary: `Restore ${unitId} to ${target.id}`,
        commandId: 'lineage:revert',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    );
    if (!write.ok) throw new Error(`Failed to write restored note: ${write.error.message}`);

    progress(100, 'Line restored');
    return {
      success: true,
      noteId,
      ...(args.line !== undefined ? { line: args.line } : {}),
      unitId,
      fromVersionId: currentVersionId ?? '',
      toVersionId: target.id,
      restoredContent: target.content,
    };
  },

  summary: (_args, result) => `Restored ${result.unitId} in ${result.noteId}`,
});
