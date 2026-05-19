import { defineTool } from '../define';
import { normalizeNotePath } from '../note/paths';

interface ApplyNotePatchArgs {
  noteId?: string;
  content: string;
  label?: string;
}

export default defineTool<ApplyNotePatchArgs, { success: boolean; noteId: string }>({
  id: 'editor:apply-note-patch',
  name: 'Apply Note Patch',
  description: 'Apply full-note markdown through active-editor-aware block collaboration',
  category: 'editor',

  args: {
    noteId: { type: 'string', description: 'Target note path. Defaults to the active editor note.' },
    content: { type: 'string', description: 'Complete markdown content to apply', required: true },
    label: { type: 'string', description: 'Short label for the AI operation' },
  },

  keywords: ['patch', 'apply', 'note', 'collaborative'],
  examples: ['Apply this updated note draft without overwriting user edits'],
  estimatedDuration: 180,
  accessMode: 'write',
  resourceId: (args) => args.noteId ?? null,

  async execute(args, { services, progress, invocation }) {
    const noteId = args.noteId
      ? await normalizeNotePath(args.noteId, services)
      : services.editor.getState().document?.path;
    if (!noteId) {
      throw new Error('No active note to patch');
    }

    progress(15, 'Planning note patch...');
    const result = await services.collaboration.applyNoteContent(
      noteId,
      args.content,
      args.label ?? 'AI note patch',
      {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: args.label ?? 'AI note patch',
        commandId: 'editor:apply-note-patch',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    );
    if (!result.ok) throw result.error;

    progress(100, 'Patch applied');
    return { success: true, noteId };
  },
});
