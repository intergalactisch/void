import { defineTool } from '../define';

interface SearchNotesArgs {
  query: string;
  limit?: number;
}

export default defineTool<SearchNotesArgs, { results: unknown[]; totalCount: number }>({
  id: 'search:notes',
  name: 'Search Notes',
  description: 'Search for notes by title, tags, or other metadata',
  category: 'search',

  args: {
    query: { type: 'string', description: 'Search query string', required: true, minLength: 1 },
    limit: { type: 'number', description: 'Maximum number of results to return', default: 20, minimum: 1, maximum: 100 },
  },

  keywords: ['find', 'lookup', 'locate', 'query'],
  examples: [
    'Search for notes about meetings',
    'Find all project-related notes',
    'Look up notes from last week',
  ],
  estimatedDuration: 200,
  accessMode: 'read',

  summary: (args, result) => `"${args.query}" → ${result.totalCount} result${result.totalCount !== 1 ? 's' : ''}`,

  async execute(args, { services, progress, isCancelled }) {
    progress(10, 'Searching notes...');

    if (isCancelled()) {
      throw new Error('Search cancelled');
    }

    const result = await services.notes.searchNotes(args.query);
    if (!result.ok) {
      throw new Error(`Search failed: ${result.error.message}`);
    }

    const limit = args.limit ?? 20;
    const notes = result.value.slice(0, limit).map((item) => ({
      noteId: item.path,
      title: item.title,
      relevance: 1,
    }));

    progress(100, 'Search complete');
    return { results: notes, totalCount: notes.length };
  },
});
