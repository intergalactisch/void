import { defineTool } from '../define';
import { aiPrompt } from '../context';

export default defineTool({
  id: 'content:continue',
  name: 'Continue Writing',
  description: 'Continue writing from where the user stopped',
  category: 'content',

  keywords: ['continue', 'keep going', 'more', 'next'],
  examples: ['Continue writing', 'Keep going', 'Write more'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading context...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map((b) => b.content).join('\n') ?? '';

    if (!content) throw new Error('No content to continue from');

    progress(30, 'Continuing...');
    const continuation = await aiPrompt(services, `Continue writing naturally from where this text ends. Match the tone and style:\n\n${content}`);

    progress(100, 'Done');
    return { continuation };
  },
});
