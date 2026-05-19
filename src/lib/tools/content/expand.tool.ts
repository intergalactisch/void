import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface ExpandArgs {
  text: string;
  style?: string;
}

export default defineTool<ExpandArgs>({
  id: 'content:expand',
  name: 'Expand',
  description: 'Take a brief point and expand into detailed text',
  category: 'content',

  args: {
    text: { type: 'string', description: 'Brief text to expand on', required: true },
    style: { type: 'string', description: 'Writing style', enum: ['detailed', 'conversational', 'formal'] },
  },

  keywords: ['expand', 'elaborate', 'detail', 'flesh out'],
  examples: ['Expand on this point', 'Elaborate on the idea', 'Flesh out this paragraph'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Expanding...');

    const style = args.style ?? 'detailed';
    const expanded = await aiPrompt(services, `Expand the following point into a ${style} paragraph:\n\n${args.text}`);

    progress(100, 'Done');
    return { expanded };
  },
});
