import { defineTool } from '../define';
import { normalizeNotePath } from '../note/paths';

interface DisableLineArgs {
  noteId?: string;
  line: number;
  reason?: string;
}

export default defineTool<DisableLineArgs, { success: boolean; noteId: string; line: number; disabledText: string }>({
  id: 'editor:disable-line',
  name: 'Disable Line',
  description: 'Disable a markdown line by wrapping it in a reversible HTML comment while preserving the original text',
  category: 'editor',

  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    line: { type: 'number', description: '1-based markdown line number to disable', required: true, minimum: 1 },
    reason: { type: 'string', description: 'Optional reason to include in the disable marker' },
  },

  keywords: ['disable', 'comment', 'line', 'hide'],
  examples: [
    'Disable line 12',
    'Comment out this line',
    'Disable a stale sentence but keep it recoverable',
  ],
  estimatedDuration: 120,
  resourceId: (args) => args.noteId ?? 'active-note',
  accessMode: 'write',

  summary: (args) => `Disabled line ${args.line} in ${args.noteId ?? 'active note'}`,

  async execute(args, { services, progress }) {
    progress(20, 'Reading note...');

    const noteId = args.noteId
      ? await normalizeNotePath(args.noteId, services)
      : services.notes.getSelectedPath();
    if (!noteId) {
      throw new Error('No note selected. Provide noteId or open a note first.');
    }

    const read = await services.documents.readContent(noteId);
    if (!read.ok) {
      throw new Error(`Failed to read note: ${read.error.message}`);
    }

    const lines = read.value.split(/\r?\n/);
    const index = args.line - 1;
    if (index < 0 || index >= lines.length) {
      throw new Error(`Line ${args.line} is outside the note (${lines.length} lines)`);
    }

    const original = lines[index] ?? '';
    if (original.trim().startsWith('<!-- void-disabled:')) {
      return { success: true, noteId, line: args.line, disabledText: original };
    }

    const reason = args.reason ? ` reason="${escapeComment(args.reason)}"` : '';
    const disabled = `<!-- void-disabled:${reason} ${escapeComment(original)} -->`;
    lines[index] = disabled;

    progress(70, 'Writing disabled line...');
    const write = await services.collaboration.applyNoteContent(
      noteId,
      lines.join('\n'),
      'AI disable line'
    );
    if (!write.ok) {
      throw new Error(`Failed to write note: ${write.error.message}`);
    }

    progress(100, 'Line disabled');
    return { success: true, noteId, line: args.line, disabledText: disabled };
  },
});

function escapeComment(value: string): string {
  return value.replace(/-->/g, '-- >').trim();
}
