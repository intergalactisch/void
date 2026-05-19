import { defineTool } from '../define';
import { normalizeNotePath } from './paths';

interface MergeArgs {
  noteIds: string[];
  title?: string;
}

export default defineTool<MergeArgs, { success: boolean; newPath: string; mergedCount: number }>({
  id: 'note:merge',
  name: 'Merge Notes',
  description: 'Combine multiple notes into one',
  category: 'note',

  args: {
    noteIds: { type: 'array', description: 'Paths of notes to merge', required: true, items: { type: 'string', description: 'Note path' }, minLength: 2 },
    title: { type: 'string', description: 'Title for the merged note' },
  },

  requiresConfirmation: true,
  keywords: ['merge', 'combine', 'join', 'consolidate'],
  examples: ['Merge these two notes', 'Combine all meeting notes', 'Consolidate into one document'],
  estimatedDuration: 500,
  accessMode: 'write',

  summary: (_args, result) => `Merged ${result.mergedCount} notes → ${result.newPath}`,

  async execute(args, { services, progress, isCancelled }) {
    if (isCancelled()) throw new Error('Merge cancelled');

    progress(10, 'Reading notes...');

    // Read content from all notes
    const contents: string[] = [];
    const noteIds = await Promise.all(args.noteIds.map((noteId) => normalizeNotePath(noteId, services)));
    for (const noteId of noteIds) {
      const metaResult = await services.documents.readMeta(noteId);
      const contentResult = await services.documents.readContent(noteId);

      if (metaResult.ok && contentResult.ok) {
        contents.push(`## ${metaResult.value.title}\n\n${contentResult.value}`);
      }
    }

    if (contents.length === 0) {
      throw new Error('No notes could be read for merging');
    }

    progress(50, 'Creating merged note...');

    const title = args.title ?? 'Merged Notes';
    const mergedMarkdown = contents.join('\n\n---\n\n');

    const createResult = await services.collaboration.createNote({
      title,
      content: mergedMarkdown,
      autoFocus: true,
    });
    if (!createResult.ok) {
      throw new Error(`Failed to create merged note: ${createResult.error.message}`);
    }

    progress(100, 'Notes merged');
    return { success: true, newPath: createResult.value.path, mergedCount: contents.length };
  },
});
