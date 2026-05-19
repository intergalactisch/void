import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export default defineTool({
  id: 'intelligence:find-related',
  name: 'Find Related Notes',
  description: 'Find notes related to the current one by meaning',
  category: 'intelligence',

  keywords: ['related', 'similar', 'connected', 'linked'],
  examples: ['Find related notes', 'What notes are similar to this one?', 'Show connected notes'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading current note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map((b) => b.content).join('\n') ?? '';
    const title = state.document?.meta.title ?? '';

    if (!content) throw new Error('No note open to find related content for');

    progress(30, 'Listing all notes...');
    const notesState = services.notes.getState();

    // Flatten the notes tree
    const allNotes: Array<{ path: string; title: string }> = [];
    function flatten(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder) {
          allNotes.push({ path: item.path, title: item.title });
        }
        if (item.children) flatten(item.children);
      }
    }
    flatten(notesState.items);

    if (allNotes.length === 0) {
      return { related: [] };
    }

    progress(50, 'Analyzing relationships...');
    const notesList = allNotes.map((n) => `- ${n.title} (${n.path})`).join('\n');
    const response = await aiPrompt(services,
      `Given the note titled "${title}" with content:\n\n${content.slice(0, 500)}\n\nWhich of these notes are most likely related? Return the top 5 as a JSON array of objects with "path" and "reason" fields. Notes:\n${notesList}`
    );

    let related: Array<{ path: string; reason: string }>;
    try {
      related = JSON.parse(response);
    } catch {
      related = [];
    }

    progress(100, 'Done');
    return { related };
  },
});
