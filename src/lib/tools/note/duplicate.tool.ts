import { defineTool } from '../define';
import { normalizeNotePath } from './paths';

interface DuplicateArgs {
  noteId: string;
  newTitle?: string;
}

export default defineTool<DuplicateArgs, { success: boolean; newPath: string; title: string }>({
  id: 'note:duplicate',
  name: 'Duplicate Note',
  description: 'Create a copy of a note',
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'Path of the note to duplicate', required: true },
    newTitle: { type: 'string', description: 'Title for the copy (defaults to "Copy of ...")' },
  },

  keywords: ['copy', 'duplicate', 'clone'],
  examples: ['Duplicate this note', 'Make a copy of the meeting notes', 'Clone this document'],
  estimatedDuration: 200,
  resourceId: (args) => args.noteId,
  accessMode: 'read',

  summary: (_args, result) => `Duplicated as "${result.title}" → ${result.newPath}`,

  async execute(args, { services, progress }) {
    progress(10, 'Reading original...');
    const noteId = await normalizeNotePath(args.noteId, services);

    // Read original content and metadata
    const metaResult = await services.documents.readMeta(noteId);
    if (!metaResult.ok) {
      throw new Error(`Failed to read note: ${metaResult.error.message}`);
    }

    const contentResult = await services.documents.readContent(noteId);
    if (!contentResult.ok) {
      throw new Error(`Failed to read note content: ${contentResult.error.message}`);
    }

    const title = args.newTitle ?? `Copy of ${metaResult.value.title}`;

    progress(50, 'Creating copy...');

    // Extract folder from the original path
    const parts = noteId.split('/');
    parts.pop();
    const folder = parts.join('/');

    const createResult = await services.collaboration.createNote({
      folder,
      title,
      content: contentResult.value,
      autoFocus: true,
    });
    if (!createResult.ok) {
      throw new Error(`Failed to create copy: ${createResult.error.message}`);
    }

    progress(100, 'Note duplicated');
    return { success: true, newPath: createResult.value.path, title };
  },
});
