import { defineTool } from '../define';
import type { CommitmentStaleCheck } from '$lib/ports/inbound/CommitmentLineageService';
import { normalizeNotePath } from '../note/paths';

interface StaleCheckArgs {
  noteId?: string;
  staleOnly?: boolean;
}

interface StaleCheckResult {
  noteId?: string;
  checked: number;
  stale: number;
  orphaned: number;
  unknown: number;
  items: CommitmentStaleCheck[];
}

export default defineTool<StaleCheckArgs, StaleCheckResult>({
  id: 'commitment:stale-check',
  name: 'Check Commitment Sources',
  description: 'Detect todos whose lineage source line changed, disappeared, or lacks a source version link',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Optional note path to check. Defaults to all todos.' },
    staleOnly: { type: 'boolean', description: 'Only return stale/orphaned commitments', default: true },
  },
  keywords: ['commitment', 'todo', 'stale', 'source', 'lineage'],
  examples: ['Check stale commitment sources', 'Which tasks are based on changed lines?'],
  estimatedDuration: 120,
  accessMode: 'read',
  resourceId: (args) => args.noteId ?? 'all-commitments',

  async execute(args, { services, progress }) {
    progress(20, 'Checking commitment sources...');
    const noteId = args.noteId ? await normalizeNotePath(args.noteId, services) : undefined;
    const result = await services.commitmentLineage.checkStaleSources(noteId);
    if (!result.ok) throw result.error;
    const visible = (args.staleOnly ?? true)
      ? result.value.filter((item) => item.status === 'stale' || item.status === 'orphaned')
      : result.value;

    progress(100, 'Commitment source check ready');
    return {
      ...(noteId !== undefined ? { noteId } : {}),
      checked: result.value.length,
      stale: result.value.filter((item) => item.status === 'stale').length,
      orphaned: result.value.filter((item) => item.status === 'orphaned').length,
      unknown: result.value.filter((item) => item.status === 'unknown').length,
      items: visible,
    };
  },

  summary: (_args, result) => `${result.stale + result.orphaned} stale/orphaned commitment source${result.stale + result.orphaned === 1 ? '' : 's'} found`,
});
