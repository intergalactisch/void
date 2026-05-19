import { defineTool } from '../define';
import { normalizeNoteTags } from '$lib/domain/values';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';
import { normalizeNoteFolder } from './paths';

interface ListArgs {
  folder?: string;
  tags?: string[];
  limit?: number;
}

interface ListResult {
  notes: Array<{ noteId: string; title: string; tags: string[] }>;
}

export default defineTool<ListArgs, ListResult>({
  id: 'note:list',
  name: 'List Notes',
  description: 'List all notes with optional filtering by folder or tags',
  category: 'note',

  args: {
    folder: { type: 'string', description: 'Filter by folder path' },
    tags: { type: 'array', description: 'Filter by tags (notes must have all specified tags)', items: { type: 'string', description: 'Tag name' } },
    limit: { type: 'number', description: 'Maximum number of notes to return', default: 50, minimum: 1, maximum: 200 },
  },

  keywords: ['show', 'all', 'browse', 'find'],
  examples: [
    'List all my notes',
    'Show notes in the Projects folder',
    'Find notes tagged with "work"',
  ],
  estimatedDuration: 100,
  accessMode: 'read',

  summary: (_args, result) => `Found ${result.notes.length} note${result.notes.length !== 1 ? 's' : ''}`,

  async execute(args, { services, progress }) {
    progress(10, 'Listing notes...');

    const state = services.notes.getState();
    const items = state.items;

    // Flatten the tree into a simple list
    const notes: Array<{ noteId: string; title: string; tags: string[] }> = [];
    function flatten(list: NotesListItem[]) {
      for (const item of list) {
        if (!item.isFolder) {
          notes.push({ noteId: item.path, title: item.title, tags: item.tags });
        }
        if (item.children) {
          flatten(item.children);
        }
      }
    }
    flatten(items);

    const folder = args.folder
      ? (await normalizeNoteFolder(args.folder, services)).replace(/^\/+|\/+$/g, '')
      : undefined;
    const tags = normalizeNoteTags(args.tags);
    const filtered = notes.filter((note) => {
      const inFolder = !folder || note.noteId === folder || note.noteId.startsWith(`${folder}/`);
      const hasTags = tags.every((tag) => note.tags.includes(tag));
      return inFolder && hasTags;
    });

    const limit = args.limit ?? 50;

    progress(100, 'Notes listed');
    return { notes: filtered.slice(0, limit) };
  },
});
