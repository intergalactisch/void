import { defineTool } from '../define';
import { resolveLineageNoteId } from './helpers';

interface BranchArgs {
  noteId?: string;
  prompt: string;
  count?: number;
}

interface BranchResult {
  noteId: string;
  branchIds: string[];
  count: number;
}

export default defineTool<BranchArgs, BranchResult>({
  id: 'lineage:branch',
  name: 'Branch Note',
  description: 'Create lineage-aware alternative markdown branches for the active note',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    prompt: { type: 'string', description: 'What the branch should explore', required: true },
    count: { type: 'number', description: 'Number of alternatives to create', minimum: 1, maximum: 5 },
  },
  keywords: ['lineage', 'branch', 'alternative', 'version'],
  examples: ['Create two branches for a more decisive launch plan'],
  estimatedDuration: 500,
  accessMode: 'create',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress, invocation }) {
    progress(10, 'Resolving note...');
    const noteId = await resolveLineageNoteId(args.noteId, services);

    progress(25, 'Creating branches...');
    const result = await services.branches.createBranches(noteId, args.prompt, args.count ?? 3);
    if (!result.ok) throw result.error;

    const snapshot = await services.lineage.getSnapshot(noteId);
    if (snapshot.ok && snapshot.value) {
      await services.lineage.recordMarkdownChange(noteId, await services.lineage.materialize(noteId).then((materialized) => materialized.ok ? materialized.value : ''), {
        actor: { kind: 'ai-agent' },
        intentKind: 'branch',
        summary: `Created ${result.value.length} lineage branch${result.value.length === 1 ? '' : 'es'}`,
        commandId: 'lineage:branch',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        prompt: args.prompt,
        source: { type: 'tool' },
      });
    }

    progress(100, 'Branches ready');
    return {
      noteId,
      branchIds: result.value.map((branch) => branch.id),
      count: result.value.length,
    };
  },

  summary: (_args, result) => `Created ${result.count} branch${result.count === 1 ? '' : 'es'} for ${result.noteId}`,
});
