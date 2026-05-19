import { defineTool } from '../define';
import { normalizeNotePath } from './paths';

interface ReadArgs {
  noteId: string;
}

interface ReadResult {
  noteId: string;
  title: string;
  content: string;
}

export default defineTool<ReadArgs, ReadResult>({
  id: 'note:read',
  name: 'Read Note',
  description: 'Read the content of an existing note by its ID',
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'ID of the note to read', required: true },
  },

  keywords: ['get', 'open', 'view', 'show', 'display'],
  examples: [
    'Read the meeting notes',
    'Open my todo list',
    'Show the project documentation',
  ],
  estimatedDuration: 50,
  resourceId: (args) => args.noteId,
  accessMode: 'read',

  summary: (_args, result) => `Opened "${result.title}"`,

  async execute(args, { services, progress }) {
    progress(10, 'Reading note...');
    const noteId = await normalizeNotePath(args.noteId, services);

    const metaResult = await services.documents.readMeta(noteId);
    if (!metaResult.ok) {
      throw new Error(`Failed to read note: ${metaResult.error.message}`);
    }

    const contentResult = await services.documents.readContent(noteId);
    if (!contentResult.ok) {
      throw new Error(`Failed to read note content: ${contentResult.error.message}`);
    }

    progress(100, 'Note read');

    return {
      noteId,
      title: metaResult.value.title,
      content: contentResult.value,
    };
  },
});
