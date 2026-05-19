import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface RewriteArgs {
  text: string;
  tone?: string;
}

export default defineTool<RewriteArgs>({
  id: 'transform:rewrite',
  name: 'Rewrite',
  description: 'Rewrite text with a different tone or style',
  category: 'transform',

  args: {
    text: { type: 'string', description: 'Text to rewrite', required: true },
    tone: { type: 'string', description: 'Target tone', enum: ['professional', 'casual', 'academic', 'friendly', 'concise'] },
  },

  keywords: ['rewrite', 'rephrase', 'tone', 'style'],
  examples: ['Rewrite this professionally', 'Make this more casual', 'Rephrase in academic tone'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Rewriting...');

    const tone = args.tone ?? 'professional';
    const rewritten = await aiPrompt(services, `Rewrite the following text in a ${tone} tone. Keep the same meaning:\n\n${args.text}`);

    progress(100, 'Done');
    return { rewritten };
  },
});
