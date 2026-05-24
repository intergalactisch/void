import { defineTool } from '../define';
import { aiPrompt } from '../context';
import { assertProtectedAIReadAllowed, assertProtectedAIWriteAllowed } from '../protectionGuard';

export default defineTool({
  id: 'action:challenge',
  name: 'Challenge',
  description: "Devil's advocate — identify assumptions, weak arguments, and missing perspectives",
  category: 'intelligence',
  keywords: ['challenge', 'critique', 'devil', 'advocate', 'assumptions', 'counter'],
  examples: ['Challenge this note', 'Play devil\'s advocate', 'What am I missing?'],
  estimatedDuration: 10000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const path = state.document?.path ?? '';
    await assertProtectedAIReadAllowed(services, path, 'note.read');
    await assertProtectedAIWriteAllowed(services, path);
    const content = state.document?.blocks.map(b => b.content).join('\n') ?? '';

    if (!content.trim()) throw new Error('No note content to challenge');

    progress(30, 'Analyzing critically...');
    const result = await aiPrompt(services,
      `Read this document critically. Identify unstated assumptions, weak arguments, missing perspectives, and logical gaps. Be specific — cite the exact claims you're challenging. Be constructive but honest.\n\n## Output format\nReturn markdown with these sections:\n- ## Assumptions Found (list each assumption with why it may not hold)\n- ## Strongest Counter-Argument (the single best argument against the main thesis)\n- ## Missing Perspectives (viewpoints not considered)\n- ## Questions to Sit With (thought-provoking questions, not rhetorical)\n\n## Document content\n${content}`
    );

    progress(80, 'Inserting result...');
    const currentContent = await services.documents.readContent(path);
    if (currentContent.ok && state.document) {
      await services.collaboration.applyNoteContent(
        state.document.path,
        currentContent.value + '\n\n---\n\n## Challenge Notes\n\n' + result,
        'AI challenge',
      );
    }

    progress(100, 'Done');
    return { challenged: true };
  },

  summary: () => 'Added challenge notes with counter-arguments and assumptions',
});
