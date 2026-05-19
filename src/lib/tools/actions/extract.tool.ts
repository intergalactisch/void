import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

const EXTRACT_TYPES: Record<string, string> = {
  todos: 'Extract all action items, tasks, and to-dos. Format as markdown checkboxes.',
  decisions: 'Extract all decisions made. Include context for each decision.',
  questions: 'Extract all open questions, unknowns, and things to investigate.',
  names: 'Extract all people and organization names mentioned. List with context.',
  dates: 'Extract all dates and deadlines mentioned. Format as a timeline.',
};

export default defineTool({
  id: 'action:extract',
  name: 'Extract',
  description: 'Extract structured data from notes — todos, decisions, questions, names, dates',
  category: 'intelligence',
  args: {
    type: {
      type: 'string',
      description: `Extraction type: ${Object.keys(EXTRACT_TYPES).join(', ')}`,
      required: true,
    },
  },
  keywords: ['extract', 'todos', 'decisions', 'questions', 'names', 'dates', 'pull out'],
  examples: ['Extract todos', 'Pull out all decisions', 'Find all questions across notes'],
  estimatedDuration: 12000,
  accessMode: 'create',

  async execute(args, { services, progress }) {
    const type = (args as { type?: string }).type ?? 'todos';
    const extractPrompt = EXTRACT_TYPES[type];

    if (!extractPrompt) {
      throw new Error(`Unknown extraction type: ${type}. Supported: ${Object.keys(EXTRACT_TYPES).join(', ')}`);
    }

    progress(10, 'Gathering notes...');
    const notesState = services.notes.getState();

    const allNotes: Array<{ path: string; title: string }> = [];
    function flatten(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder) allNotes.push({ path: item.path, title: item.title });
        if (item.children) flatten(item.children);
      }
    }
    flatten(notesState.items);

    if (allNotes.length === 0) throw new Error('No notes found');

    progress(30, `Reading ${allNotes.length} notes...`);
    const contents: string[] = [];
    const sourcePaths: string[] = [];
    for (const note of allNotes.slice(0, 20)) {
      const content = await services.documents.readContent(note.path);
      if (content.ok && content.value.trim()) {
        contents.push(`## ${note.title}\n${content.value.slice(0, 500)}`);
        sourcePaths.push(note.path);
      }
    }

    progress(60, `Extracting ${type}...`);
    const result = await aiPrompt(services,
      `${extractPrompt}\n\nGroup results by source note. Include the note title for each item.\n\nNotes:\n\n${contents.join('\n\n---\n\n')}`
    );

    progress(80, 'Creating extraction note...');
    const title = `Extracted ${type} — ${new Date().toLocaleDateString()}`;
    const created = await services.collaboration.createNote({ title, content: result, autoFocus: true });

    if (services.sessions && created.ok) {
      await services.sessions.create({
        type: 'ai-batch',
        kind: 'extract',
        title,
        topic: type,
        toolId: 'action:extract',
        createdBy: 'ai-agent',
        members: [
          ...sourcePaths.map((path) => ({ notePath: path, role: 'source' as const })),
          { notePath: created.value.path, role: 'derived' as const },
        ],
      });
    }

    progress(100, 'Done');
    return { extracted: true, type, notesScanned: contents.length };
  },

  summary: (_args, result) => {
    const r = result as { type?: string; notesScanned?: number };
    return `Extracted ${r.type} from ${r.notesScanned} notes`;
  },
});
