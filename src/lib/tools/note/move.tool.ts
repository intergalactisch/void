import { defineTool } from '../define';
import { normalizeNoteFolder, normalizeNotePath } from './paths';

interface MoveArgs {
  noteId: string;
  destination: string;
}

export default defineTool<MoveArgs, { success: boolean; newPath: string }>({
  id: 'note:move',
  name: 'Move Note',
  description: 'Move a note to a different folder',
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'Path of the note to move', required: true },
    destination: { type: 'string', description: 'Destination folder path', required: true },
  },

  keywords: ['move', 'relocate', 'organize'],
  examples: ['Move this note to Projects', 'Relocate to the Archive folder', 'Move to Work/Notes'],
  estimatedDuration: 200,
  resourceId: (args) => args.noteId,
  accessMode: 'write',

  summary: (args, result) => `Moved ${args.noteId.split('/').pop()} → ${result.newPath}`,

  async execute(args, { services, progress }) {
    progress(10, 'Moving note...');
    const noteId = await normalizeNotePath(args.noteId, services);
    const destination = await normalizeNoteFolder(args.destination, services);

    // Extract filename from current path
    const filename = noteId.split('/').pop() ?? noteId;
    const newPath = destination ? `${destination}/${filename}` : filename;

    const loadResult = await services.notes.loadDocument(noteId);
    if (!loadResult.ok) {
      throw new Error(`Failed to load note before move: ${loadResult.error.message}`);
    }

    const saveResult = await services.notes.saveDocument({
      ...loadResult.value,
      path: newPath,
      isDirty: true,
    });
    if (!saveResult.ok) {
      throw new Error(`Failed to save moved note: ${saveResult.error.message}`);
    }

    const deleteResult = await services.notes.deleteNote(noteId);
    if (!deleteResult.ok) {
      throw new Error(`Moved note to ${newPath}, but failed to remove original ${noteId}: ${deleteResult.error.message}`);
    }

    services.notes.selectNote(newPath);
    progress(100, 'Note moved');
    return { success: true, newPath };
  },
});
