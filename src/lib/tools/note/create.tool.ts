import { defineTool } from '../define';
import { normalizeNoteFolder } from './paths';

interface CreateArgs {
  title?: string;
  content?: string;
  tags?: string[];
  folder?: string;
  autoFocus?: boolean;
}

interface CreateResult {
  noteId: string;
  title: string;
}

export default defineTool<CreateArgs, CreateResult>({
  id: 'note:create',
  name: 'Create Note',
  description: 'Create a new note with optional title, content, tags, and folder location',
  category: 'note',

  args: {
    title: { type: 'string', description: 'Title of the new note' },
    content: { type: 'string', description: 'Initial content for the note (markdown)' },
    tags: { type: 'array', description: 'Tags to assign to the note', items: { type: 'string', description: 'Tag name' } },
    folder: { type: 'string', description: 'Relative subfolder path (e.g. "projects"). Leave empty for root. Do NOT use absolute paths.' },
    autoFocus: { type: 'boolean', description: 'Whether to open this note after creation. Use false for batch creation and true for the final overview note.', default: true },
  },

  keywords: ['new', 'add', 'make', 'write'],
  examples: [
    'Create a new note',
    'Make a note called "Meeting Notes"',
    'Create a note in the Projects folder',
  ],
  estimatedDuration: 100,
  resourceId: (args) => `note:create:${args.folder ?? ''}/${args.title ?? 'Untitled'}`,
  accessMode: 'create',

  summary: (args, result) => `Created "${result.title}" → ${result.noteId}`,

  async execute(args, { services, progress, invocation }) {
    progress(10, 'Creating note...');

    const title = args.title ?? 'Untitled';
    const folder = await normalizeNoteFolder(args.folder ?? '', services);

    // Single note: focus it after creation. Route through collaboration so
    // AI-created notes share the same mutation policy as note updates.
    const createArgs = {
      folder,
      title,
      ...(args.content !== undefined ? { content: args.content } : {}),
      autoFocus: args.autoFocus ?? true,
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
      lineage: {
        actor: { kind: 'ai-agent' as const },
        intentKind: 'import' as const,
        summary: 'AI-created markdown content',
        commandId: 'note:create',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' as const },
      },
    };
    const result = await services.collaboration.createNote(createArgs);
    if (!result.ok) {
      throw new Error(`Failed to create note: ${result.error.message}`);
    }

    progress(100, 'Note created');
    return { noteId: result.value.path, title };
  },
});
