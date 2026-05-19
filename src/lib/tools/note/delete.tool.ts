import { defineTool } from '../define';
import { normalizeNotePath } from './paths';

interface DeleteArgs {
  noteId: string;
}

export default defineTool<DeleteArgs, { success: boolean }>({
  id: 'note:delete',
  name: 'Delete Note',
  description: 'Delete a note permanently. This action requires confirmation.',
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'ID of the note to delete', required: true },
  },

  requiresConfirmation: true,
  keywords: ['remove', 'trash', 'discard', 'destroy'],
  examples: [
    'Delete the old meeting notes',
    'Remove this note',
    'Trash the draft',
  ],
  estimatedDuration: 100,
  resourceId: (args) => args.noteId,
  accessMode: 'write',

  summary: (args) => `Deleted ${args.noteId.split('/').pop()}`,

  async execute(args, { services, progress, isCancelled }) {
    if (isCancelled()) {
      throw new Error('Delete operation cancelled');
    }

    progress(10, 'Deleting note...');
    const noteId = await normalizeNotePath(args.noteId, services);

    const result = await services.notes.deleteNote(noteId);
    if (!result.ok) {
      throw new Error(`Failed to delete note: ${result.error.message}`);
    }

    progress(100, 'Note deleted');
    return { success: true };
  },
});
