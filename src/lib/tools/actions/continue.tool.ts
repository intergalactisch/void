import { defineTool } from '../define';
import { aiPrompt } from '../context';
import { INTENT_AI_HINTS } from '$lib/domain/values/NoteIntent';

export default defineTool({
  id: 'action:continue',
  name: 'Continue Writing',
  description: 'Pick up writing where the note left off — matches your tone and style',
  category: 'intelligence',
  keywords: ['continue', 'write', 'extend', 'more', 'keep going', 'finish'],
  examples: ['Continue writing', 'Keep going', 'Write more', 'Finish this section'],
  estimatedDuration: 6000,
  accessMode: 'write',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map(b => b.content).join('\n') ?? '';
    const intent = state.document?.meta.intent ?? 'general';

    if (!content.trim()) throw new Error('No note content to continue from');

    progress(30, 'Continuing...');
    const intentHint = INTENT_AI_HINTS[intent];
    const result = await aiPrompt(services,
      `Continue writing this document from where it stops. Match the author's tone, vocabulary, and level of detail. If the document has a structure (headings, lists), continue in that structure. Write 2-3 paragraphs or until a natural stopping point. Do not summarize what came before — just continue forward.\n\nDocument intent: ${intent}\nHint: ${intentHint}\n\nDocument so far:\n${content}`
    );

    progress(80, 'Appending...');
    const currentContent = await services.documents.readContent(state.document?.path ?? '');
    if (currentContent.ok && state.document) {
      await services.collaboration.applyNoteContent(
        state.document.path,
        currentContent.value + '\n\n' + result,
        'AI continue',
      );
    }

    progress(100, 'Done');
    return { continued: true };
  },

  summary: () => 'Continued writing from where the note left off',
});
