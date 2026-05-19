import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface SummarizeArgs {
  style?: string;
}

export default defineTool<SummarizeArgs>({
  id: 'content:summarize',
  name: 'Summarize',
  description: 'Summarize the current note or selected text into key points',
  category: 'content',

  args: {
    style: {
      type: 'string',
      description: 'Summary style',
      enum: ['bullets', 'paragraph', 'one-line'],
      default: 'bullets',
    },
  },

  keywords: ['summarize', 'summary', 'key points', 'tldr'],
  examples: ['Summarize this note', 'Give me the key points', 'TLDR'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Reading content...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map((b) => b.content).join('\n') ?? '';

    if (!content) throw new Error('No content to summarize');

    progress(30, 'Summarizing...');
    const style = args.style ?? 'bullets';
    const summary = await aiPrompt(services, `Summarize the following text as ${style}:\n\n${content}`);

    progress(100, 'Done');
    return { summary };
  },
});
