import { defineTool } from '../define';
import { resolveLineageNoteId, toZeroBasedLine } from './helpers';
import type { LineageAgentContext } from '$lib/ports/inbound/LineageService';

interface ContextArgs {
  noteId?: string;
  line?: number;
  unitId?: string;
  clusterLimit?: number;
}

export default defineTool<ContextArgs, LineageAgentContext>({
  id: 'lineage:context',
  name: 'Lineage Context',
  description: 'Return AI-readable line mappings, edit clusters, warnings, and optional target-line context for a note',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to focus', minimum: 1 },
    unitId: { type: 'string', description: 'Stable lineage unit ID to focus' },
    clusterLimit: { type: 'number', description: 'Maximum recent edit clusters to return', minimum: 1, maximum: 50 },
  },
  keywords: ['lineage', 'context', 'clusters', 'edits', 'agent'],
  examples: ['Show lineage context for this note', 'Find recent edit clusters', 'Give me lineage context for line 12'],
  estimatedDuration: 80,
  accessMode: 'read',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress }) {
    progress(15, 'Reading lineage context...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const context = await services.lineage.getAgentContext(noteId, {
      ...(args.line !== undefined ? { line: toZeroBasedLine(args.line) } : {}),
      ...(args.unitId !== undefined ? { unitId: args.unitId } : {}),
      ...(args.clusterLimit !== undefined ? { clusterLimit: args.clusterLimit } : {}),
    });
    if (!context.ok) throw context.error;
    progress(100, 'Lineage context ready');
    return context.value;
  },

  summary: (_args, result) =>
    `Read lineage context for ${result.notePath}: ${result.clusters.length} cluster${result.clusters.length === 1 ? '' : 's'}`,
});
