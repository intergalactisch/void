import { defineTool } from '../define';
import { actorLabel, intentLabel, resolveLineageNoteId, toZeroBasedLine } from './helpers';

interface WhyArgs {
  noteId?: string;
  line: number;
}

interface WhyResult {
  noteId: string;
  line: number;
  unitId: string;
  versionId: string;
  content: string;
  actor: string;
  intent: string;
  intentId: string | null;
  createdAt: string;
  previousVersionCount: number;
  sourceVersionIds: string[];
  explanation: string;
}

export default defineTool<WhyArgs, WhyResult>({
  id: 'lineage:why',
  name: 'Why This Line',
  description: 'Explain why a markdown line exists by returning its current version, actor, intent, and sources',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to explain', required: true, minimum: 1 },
  },
  keywords: ['why', 'source', 'origin', 'explain', 'lineage', 'receipt'],
  examples: ['Why does line 12 exist?', 'Explain the source of line 4'],
  estimatedDuration: 60,
  resourceId: (args) => args.noteId ?? 'active-note',
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(20, 'Reading line explanation...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const lineIndex = toZeroBasedLine(args.line);
    const result = await services.lineage.explainLine(noteId, lineIndex);
    if (!result.ok) throw new Error(`Failed to explain line: ${result.error.message}`);
    if (!result.value) throw new Error(`No lineage recorded for line ${args.line}`);

    const version = result.value.currentVersion;
    const intent = result.value.intent;
    const actor = actorLabel(version.actor);
    const intentSummary = intentLabel(intent);
    const explanation = `${actor} created the current version on ${version.createdAt} via ${intentSummary}.`;

    progress(100, 'Line explanation ready');
    return {
      noteId,
      line: args.line,
      unitId: result.value.unitId,
      versionId: version.id,
      content: version.content,
      actor,
      intent: intentSummary,
      intentId: intent?.id ?? null,
      createdAt: version.createdAt,
      previousVersionCount: result.value.previousVersions.length,
      sourceVersionIds: version.sourceVersionIds,
      explanation,
    };
  },

  summary: (args, result) => `Explained line ${args.line} in ${result.noteId}`,
});
