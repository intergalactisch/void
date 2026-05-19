import { defineTool } from '../define';
import { resolveLineageNoteId, toZeroBasedLine } from './helpers';

interface ActionsArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
}

interface LineageActionDescriptor {
  id: string;
  title: string;
  toolId: string;
  accessMode: 'read' | 'write' | 'create';
  requiresConfirmation: boolean;
  available: boolean;
  reason: string;
  args: Record<string, string | number | boolean>;
}

interface ActionsResult {
  noteId: string;
  line?: number;
  unitId?: string;
  currentVersionId?: string;
  previousVersionCount: number;
  warningCount: number;
  actions: LineageActionDescriptor[];
  summary: string;
}

export default defineTool<ActionsArgs, ActionsResult>({
  id: 'lineage:actions',
  name: 'Lineage Actions',
  description: 'List the available read, restore, branch, trace, and repair actions for a lineage-tracked line',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to inspect', minimum: 1 },
    unitId: { type: 'string', description: 'Lineage unit ID to inspect instead of a line number' },
  },
  keywords: ['lineage', 'actions', 'line', 'revert', 'repair', 'branch'],
  examples: ['What can I do with line 12?', 'Show actions for lineage unit lu_123'],
  estimatedDuration: 60,
  accessMode: 'read',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress }) {
    progress(15, 'Resolving lineage target...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const lineIndex = args.line !== undefined ? toZeroBasedLine(args.line) : undefined;

    const snapshot = await services.lineage.getSnapshot(noteId);
    if (!snapshot.ok) throw snapshot.error;

    let unitId = args.unitId;
    let currentVersionId: string | undefined;
    let previousVersionCount = 0;
    let line = args.line;

    if (lineIndex !== undefined) {
      const explanation = await services.lineage.explainLine(noteId, lineIndex);
      if (!explanation.ok) throw explanation.error;
      if (explanation.value) {
        unitId = explanation.value.unitId;
        currentVersionId = explanation.value.currentVersion.id;
        previousVersionCount = explanation.value.previousVersions.length;
      }
    } else if (unitId && snapshot.value) {
      const unit = snapshot.value.units[unitId];
      if (!unit) {
        throw new Error(`Lineage unit not found: ${unitId}`);
      }
      currentVersionId = unit.currentVersionId ?? undefined;
      const orderIndex = snapshot.value.order.indexOf(unitId);
      if (orderIndex >= 0) line = orderIndex + 1;
      const history = await services.lineage.getLineHistory(noteId, unitId);
      if (!history.ok) throw history.error;
      previousVersionCount = Math.max(0, history.value.versions.length - 1);
    }

    const warnings = await services.lineage.getReconciliationWarnings(noteId);
    if (!warnings.ok) throw warnings.error;
    const targetWarnings = warnings.value.filter((warning) =>
      warning.matches.some((match) =>
        (unitId && match.oldUnitId === unitId) ||
        (lineIndex !== undefined && match.newLineIndex === lineIndex)
      )
    );

    progress(100, 'Lineage actions ready');
    const actionInput: {
      noteId: string;
      line?: number;
      unitId?: string;
      currentVersionId?: string;
      previousVersionCount: number;
      warningId?: string;
    } = {
      noteId,
      previousVersionCount,
    };
    if (line !== undefined) actionInput.line = line;
    if (unitId !== undefined) actionInput.unitId = unitId;
    if (currentVersionId !== undefined) actionInput.currentVersionId = currentVersionId;
    if (targetWarnings[0]?.id !== undefined) actionInput.warningId = targetWarnings[0].id;
    const actions = buildActions(actionInput);
    return {
      noteId,
      ...(line !== undefined ? { line } : {}),
      ...(unitId ? { unitId } : {}),
      ...(currentVersionId ? { currentVersionId } : {}),
      previousVersionCount,
      warningCount: targetWarnings.length,
      actions,
      summary: actions
        .map((action) => `${action.available ? 'available' : 'blocked'}: ${action.title} -> ${action.toolId}`)
        .join('\n'),
    };
  },

  summary: (_args, result) =>
    `Listed ${result.actions.filter((action) => action.available).length}/${result.actions.length} lineage action${result.actions.length === 1 ? '' : 's'} for ${result.noteId}`,
});

function buildActions(input: {
  noteId: string;
  line?: number;
  unitId?: string;
  currentVersionId?: string;
  previousVersionCount: number;
  warningId?: string;
}): LineageActionDescriptor[] {
  const targetArgs = {
    noteId: input.noteId,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.unitId ? { unitId: input.unitId } : {}),
  };
  const hasTarget = input.line !== undefined || !!input.unitId;

  return [
    {
      id: 'explain',
      title: 'Explain why this line exists',
      toolId: 'lineage:why',
      accessMode: 'read',
      requiresConfirmation: false,
      available: input.line !== undefined,
      reason: input.line !== undefined ? 'Line number is available.' : 'Requires a current line number.',
      args: { noteId: input.noteId, ...(input.line !== undefined ? { line: input.line } : {}) },
    },
    {
      id: 'history',
      title: 'Show version history',
      toolId: 'lineage:history',
      accessMode: 'read',
      requiresConfirmation: false,
      available: hasTarget,
      reason: hasTarget ? 'Lineage target is available.' : 'Requires a line number or unit ID.',
      args: targetArgs,
    },
    {
      id: 'trace',
      title: 'Trace source ancestry',
      toolId: 'lineage:trace',
      accessMode: 'read',
      requiresConfirmation: false,
      available: hasTarget || !!input.currentVersionId,
      reason: hasTarget || input.currentVersionId ? 'Trace root is available.' : 'Requires a line, unit, or version ID.',
      args: { ...targetArgs, direction: 'both' },
    },
    {
      id: 'revert',
      title: 'Restore previous version',
      toolId: 'lineage:revert',
      accessMode: 'write',
      requiresConfirmation: true,
      available: hasTarget && input.previousVersionCount > 0,
      reason: input.previousVersionCount > 0 ? 'Previous versions exist.' : 'No previous version is available to restore.',
      args: targetArgs,
    },
    {
      id: 'branch',
      title: 'Create alternative branches',
      toolId: 'lineage:branch',
      accessMode: 'create',
      requiresConfirmation: false,
      available: true,
      reason: 'Branches can be created from the current note.',
      args: { noteId: input.noteId, prompt: 'Explore an alternative version of this line in context.', count: 3 },
    },
    {
      id: 'repair',
      title: 'Repair ambiguous line match',
      toolId: 'lineage:repair',
      accessMode: 'write',
      requiresConfirmation: false,
      available: !!input.warningId && input.line !== undefined && !!input.unitId,
      reason: input.warningId
        ? 'A reconciliation warning targets this line.'
        : 'No reconciliation warning targets this line.',
      args: {
        noteId: input.noteId,
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.unitId ? { unitId: input.unitId } : {}),
        ...(input.warningId ? { warningId: input.warningId } : {}),
      },
    },
    {
      id: 'context',
      title: 'Read agent context',
      toolId: 'lineage:context',
      accessMode: 'read',
      requiresConfirmation: false,
      available: true,
      reason: 'Agent context is available for the note.',
      args: { ...targetArgs, clusterLimit: 8 },
    },
  ];
}
