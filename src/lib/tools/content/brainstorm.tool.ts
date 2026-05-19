import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface BrainstormArgs {
  topic: string;
  count?: number;
}

export default defineTool<BrainstormArgs>({
  id: 'content:brainstorm',
  name: 'Brainstorm',
  description: 'Generate ideas on a topic',
  category: 'content',

  args: {
    topic: { type: 'string', description: 'Topic to brainstorm about', required: true },
    count: { type: 'number', description: 'Number of ideas to generate', minimum: 3, maximum: 20, default: 10 },
  },

  keywords: ['brainstorm', 'ideas', 'ideate', 'generate'],
  examples: ['Brainstorm ideas for the project', 'Give me 10 ideas about...', 'Help me ideate'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Brainstorming...');

    const count = args.count ?? 10;
    const ideas = await aiPrompt(services, `Generate ${count} creative ideas about: "${args.topic}". Format as a numbered list with brief descriptions.`);

    progress(100, 'Done');
    return { ideas };
  },
});
