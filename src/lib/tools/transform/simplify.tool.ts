import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface SimplifyArgs {
  text: string;
}

export default defineTool<SimplifyArgs>({
  id: 'transform:simplify',
  name: 'Simplify',
  description: 'Make complex text simpler and clearer',
  category: 'transform',

  args: {
    text: { type: 'string', description: 'Text to simplify', required: true },
  },

  keywords: ['simplify', 'simpler', 'clearer', 'plain'],
  examples: ['Simplify this text', 'Make this clearer', 'Write in plain language'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Simplifying...');

    const simplified = await aiPrompt(services, `Simplify the following text. Use shorter sentences, simpler words, and clearer structure:\n\n${args.text}`);

    progress(100, 'Done');
    return { simplified };
  },
});
