import { defineTool } from '../define';

interface ResearchArgs {
  topic: string;
}

export default defineTool<ResearchArgs, { operationId: string; status: string }>({
  id: 'intelligence:research',
  name: 'Research Topic',
  description: 'Start an AI research operation on a topic, using notes as context. Uses a resumable session when the selected CLI supports it.',
  category: 'intelligence',

  args: {
    topic: { type: 'string', description: 'The topic to research', required: true },
  },
  keywords: ['research', 'investigate', 'study', 'deep dive', 'explore'],
  examples: ['Research quantum computing', 'Deep dive into functional programming'],
  estimatedDuration: 30000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    if (!services.operations) {
      throw new Error('Operation service not available');
    }

    progress(10, 'Starting research...');

    const result = await services.operations.startSession(
      `Research: ${args.topic}`,
      `Research "${args.topic}" using my existing notes as context. Create a comprehensive note with references to relevant existing notes. Include key findings, insights, and action items.`,
      [
        { type: 'search', query: args.topic, limit: 10 },
        { type: 'recentNotes', limit: 5 },
      ],
      { webAccess: 'native' }
    );

    if (!result.ok) {
      throw new Error(`Failed to start research: ${result.error.message}`);
    }

    progress(100, 'Research queued');
    return { operationId: result.value.id, status: 'queued' };
  },

  summary: (args, result) => `Queued research on "${args.topic}" (${result.operationId})`,
});
