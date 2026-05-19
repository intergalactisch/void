import { defineTool } from '../define';
import { aiPrompt } from '../context';
import { INTENT_AI_HINTS } from '$lib/domain/values/NoteIntent';
import type { NoteIntent } from '$lib/domain/values/NoteIntent';

function getDistillHint(intent: NoteIntent): string {
  const base = INTENT_AI_HINTS[intent];
  const specific: Partial<Record<NoteIntent, string>> = {
    'meeting-notes': 'Include an Attendees section and Follow-ups section.',
    'research': 'Include a Methodology section and Findings section.',
    'journal': 'Include a Themes section and Reflections section.',
    'project-plan': 'Include a Milestones section and Risks section.',
  };
  return specific[intent]
    ? `${base}\n${specific[intent]}`
    : base;
}

export default defineTool({
  id: 'action:distill',
  name: 'Distill',
  description: 'Extract structure from messy notes — decisions, action items, questions',
  category: 'intelligence',
  keywords: ['distill', 'structure', 'extract', 'organize', 'clean', 'summarize'],
  examples: ['Distill this note', 'Extract the key points', 'Organize my meeting notes'],
  estimatedDuration: 8000,
  accessMode: 'write',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map(b => b.content).join('\n') ?? '';
    const intent = state.document?.meta.intent ?? 'general';

    if (!content.trim()) throw new Error('No note content to distill');

    progress(30, 'Analyzing...');
    const intentHint = getDistillHint(intent);
    const result = await aiPrompt(services,
      `Distill this note into structured sections. Extract the key information and organize it clearly.\n\n## Instructions\n${intentHint}\n\n## Output format\nReturn markdown with these sections (skip any that don't apply):\n- ## Key Decisions\n- ## Action Items (as checkboxes)\n- ## Open Questions\n- ## Summary\n\n## Note content\n${content}`
    );

    progress(80, 'Inserting result...');
    // Insert the distilled content at the top of the document
    const currentContent = await services.documents.readContent(state.document?.path ?? '');
    if (currentContent.ok && state.document) {
      await services.collaboration.applyNoteContent(
        state.document.path,
        result + '\n\n---\n\n' + currentContent.value,
        'AI distill',
      );
    }

    progress(100, 'Done');
    return { distilled: true, intent };
  },

  summary: (_args, result) => {
    const r = result as { intent?: string };
    return `Distilled note (${r.intent ?? 'general'}) into structured sections`;
  },
});
