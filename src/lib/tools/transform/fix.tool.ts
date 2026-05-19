import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface FixArgs {
  text: string;
}

export default defineTool<FixArgs>({
  id: 'transform:fix',
  name: 'Fix Writing',
  description: 'Fix grammar, spelling, and punctuation',
  category: 'transform',

  args: {
    text: { type: 'string', description: 'Text to fix', required: true },
  },

  keywords: ['fix', 'grammar', 'spelling', 'proofread', 'correct'],
  examples: ['Fix the grammar', 'Proofread this', 'Correct spelling errors'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Fixing...');

    const fixed = await aiPrompt(services, `Fix all grammar, spelling, and punctuation errors in the following text. Only output the corrected text, no explanations:\n\n${args.text}`);

    progress(100, 'Done');
    return { fixed };
  },
});
