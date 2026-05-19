import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface OutlineArgs {
  topic: string;
  depth?: number;
}

export default defineTool<OutlineArgs>({
  id: 'content:outline',
  name: 'Generate Outline',
  description: 'Generate a structured outline from a topic',
  category: 'content',

  args: {
    topic: { type: 'string', description: 'Topic to outline', required: true },
    depth: { type: 'number', description: 'Outline depth (1-3 levels)', minimum: 1, maximum: 3, default: 2 },
  },

  keywords: ['outline', 'structure', 'plan', 'skeleton'],
  examples: ['Create an outline for my blog post', 'Structure this topic', 'Plan the article'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Generating outline...');

    const depth = args.depth ?? 2;
    const outline = await aiPrompt(services, `Create a ${depth}-level structured outline for the topic: "${args.topic}". Use markdown headings and bullet points.`);

    progress(100, 'Done');
    return { outline };
  },
});
