import { defineTool } from '../define';
import { resolveLineageNoteId, toZeroBasedLine } from './helpers';
import type { ReconciliationWarning } from '$lib/domain/entities/Lineage';

interface RepairArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
  warningId?: string;
  listOnly?: boolean;
}

interface RepairResult {
  noteId: string;
  repaired: boolean;
  warningCount: number;
  warnings: Array<{
    id: string;
    message: string;
    line: number | null;
    reasons: string[];
  }>;
  unitId?: string;
  line?: number;
}

export default defineTool<RepairArgs, RepairResult>({
  id: 'lineage:repair',
  name: 'Repair Lineage',
  description: 'List or resolve ambiguous markdown reconciliation matches',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to repair', minimum: 1 },
    unitId: { type: 'string', description: 'Lineage unit ID the line should be assigned to' },
    warningId: { type: 'string', description: 'Optional warning ID being resolved' },
    listOnly: { type: 'boolean', description: 'Only list open warnings', default: false },
  },
  keywords: ['lineage', 'repair', 'reconcile', 'warning', 'ambiguous'],
  examples: ['Show lineage repair warnings', 'Assign line 4 to lu_123'],
  estimatedDuration: 80,
  accessMode: 'write',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress, invocation }) {
    progress(15, 'Reading repair warnings...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const warningsResult = await services.lineage.getReconciliationWarnings(noteId);
    if (!warningsResult.ok) throw warningsResult.error;

    if (args.listOnly || !args.unitId || args.line === undefined) {
      progress(100, 'Repair warnings ready');
      return {
        noteId,
        repaired: false,
        warningCount: warningsResult.value.length,
        warnings: warningsResult.value.map(formatWarning),
      };
    }

    progress(55, 'Repairing line match...');
    const repairOptions = {
      actor: { kind: 'user' as const },
      intentKind: 'external-reconcile' as const,
      summary: `Repair lineage match for line ${args.line}`,
      commandId: 'lineage:repair',
      source: { type: 'tool' as const },
    };
    const repairOptionsWithReceipt = invocation.id
      ? { ...repairOptions, receiptId: invocation.id }
      : repairOptions;
    const repair = await services.lineage.repairLineMatch(
      noteId,
      toZeroBasedLine(args.line),
      args.unitId,
      args.warningId ? { ...repairOptionsWithReceipt, warningId: args.warningId } : repairOptionsWithReceipt,
    );
    if (!repair.ok) throw repair.error;

    progress(100, 'Lineage repaired');
    return {
      noteId,
      repaired: true,
      warningCount: warningsResult.value.length,
      warnings: warningsResult.value.map(formatWarning),
      unitId: args.unitId,
      line: args.line,
    };
  },

  summary: (_args, result) => result.repaired
    ? `Repaired lineage for line ${result.line} in ${result.noteId}`
    : `Found ${result.warningCount} lineage repair warning${result.warningCount === 1 ? '' : 's'}`,
});

function formatWarning(warning: ReconciliationWarning) {
  const match = warning.matches[0];
  return {
    id: warning.id,
    message: warning.message,
    line: match && match.newLineIndex >= 0 ? match.newLineIndex + 1 : null,
    reasons: match?.reasons ?? [],
  };
}
