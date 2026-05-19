import { defineTool } from '../define';
import { resolveLineageNoteId } from './helpers';
import type { BranchComparison } from '$lib/ports/inbound/BranchService';

interface CompareArgs {
  noteId?: string;
  branchId: string;
}

export default defineTool<CompareArgs, BranchComparison>({
  id: 'lineage:compare',
  name: 'Compare Branch',
  description: 'Compare a lineage branch against the current note markdown, including todo impact',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    branchId: { type: 'string', description: 'Branch ID to compare', required: true },
  },
  keywords: ['lineage', 'compare', 'branch', 'diff', 'commitment'],
  examples: ['Compare branch_123 with this note'],
  estimatedDuration: 80,
  accessMode: 'read',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress }) {
    progress(15, 'Resolving note...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const result = await services.branches.compareBranch(noteId, args.branchId);
    if (!result.ok) throw result.error;
    progress(100, 'Branch comparison ready');
    return result.value;
  },

  summary: (_args, result) => `Compared ${result.branchId}: ${result.summary}`,
});
