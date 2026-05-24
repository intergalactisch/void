import { defineTool } from '../define';
import { normalizeNotePath } from './paths';
import { assertProtectedAIReadAllowed, assertProtectedAIWriteAllowed } from '../protectionGuard';

interface UpdateArgs {
  noteId: string;
  title?: string;
  content?: string;
  tags?: string[];
}

export default defineTool<UpdateArgs, { success: boolean; noteId: string }>({
  id: 'note:update',
  name: 'Update Note',
  description: "Update an existing note's title, content, or tags",
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'ID of the note to update', required: true },
    title: { type: 'string', description: 'New title for the note' },
    content: { type: 'string', description: 'New content for the note (replaces existing)' },
    tags: { type: 'array', description: 'New tags for the note (replaces existing)', items: { type: 'string', description: 'Tag name' } },
  },

  keywords: ['edit', 'change', 'modify', 'save'],
  examples: [
    'Update the title to "Q4 Goals"',
    'Change the content of my notes',
    'Add tags to the document',
  ],
  estimatedDuration: 100,
  resourceId: (args) => args.noteId,
  accessMode: 'write',

  summary: (args) => {
    const parts: string[] = [];
    if (args.title) parts.push(`title → "${args.title}"`);
    if (args.content) parts.push('content');
    if (args.tags) parts.push(`tags`);
    return `Updated ${parts.join(', ')} on ${args.noteId.split('/').pop()}`;
  },

  async execute(args, { services, progress, invocation }) {
    progress(10, 'Updating note...');
    const noteId = await normalizeNotePath(args.noteId, services);
    await assertProtectedAIReadAllowed(services, noteId, 'note.read');
    await assertProtectedAIWriteAllowed(services, noteId);

    progress(45, services.collaboration.isActiveNote(noteId) ? 'Updating active editor...' : 'Updating content...');
    const result = await services.collaboration.updateNote({
      noteId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.content !== undefined ? { content: args.content } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
      label: 'AI note update',
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'AI note update',
        commandId: 'note:update',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });

    if (!result.ok) {
      throw new Error(`Failed to update note: ${result.error.message}`);
    }

    progress(100, 'Note updated');
    return { success: true, noteId };
  },
});
