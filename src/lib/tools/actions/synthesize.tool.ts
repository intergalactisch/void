import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export default defineTool({
  id: 'action:synthesize',
  name: 'Synthesize',
  description: 'Combine multiple notes into a unified document — finds themes, contradictions, evolution',
  category: 'intelligence',
  args: {
    notes: {
      type: 'string',
      description: 'Comma-separated note paths or titles to synthesize (optional — uses recent notes if omitted)',
    },
  },
  keywords: ['synthesize', 'combine', 'merge', 'unify', 'themes'],
  examples: ['Synthesize my recent notes', 'Combine these meeting notes', 'Unify project discussions'],
  estimatedDuration: 15000,
  accessMode: 'create',

  async execute(args, { services, progress }) {
    progress(10, 'Gathering notes...');

    let notePaths: string[] = [];
    const notesArg = (args as { notes?: string }).notes;

    if (notesArg) {
      notePaths = notesArg.split(',').map(s => s.trim());
    } else {
      // Use recent notes (up to 5)
      const notesState = services.notes.getState();
      const allNotes: Array<{ path: string; title: string }> = [];
      function flatten(items: NotesListItem[]) {
        for (const item of items) {
          if (!item.isFolder) allNotes.push({ path: item.path, title: item.title });
          if (item.children) flatten(item.children);
        }
      }
      flatten(notesState.items);
      notePaths = allNotes.slice(0, 5).map(n => n.path);
    }

    if (notePaths.length < 2) {
      throw new Error('Need at least 2 notes to synthesize');
    }

    progress(30, `Reading ${notePaths.length} notes...`);
    const noteContents: string[] = [];
    const sourcePaths: string[] = [];
    for (const path of notePaths.slice(0, 5)) {
      const content = await services.documents.readContent(path);
      if (content.ok && content.value.trim()) {
        noteContents.push(`## Source: ${path}\n${content.value}`);
        sourcePaths.push(path);
      }
    }

    if (noteContents.length < 2) {
      throw new Error('Could not read enough notes to synthesize');
    }

    progress(60, 'Synthesizing...');
    const result = await aiPrompt(services,
      `Synthesize these ${noteContents.length} notes into a unified document.\n\nIdentify:\n- Common themes across notes\n- Contradictions or tensions between notes\n- How thinking evolved across notes\n- Key insights that emerge from combining them\n\nCite source notes using [[Note Name]] format. Preserve each note's unique contributions.\n\n${noteContents.join('\n\n---\n\n')}`
    );

    progress(80, 'Creating synthesis note...');
    const title = `Synthesis — ${new Date().toLocaleDateString()}`;
    const created = await services.collaboration.createNote({ title, content: result, autoFocus: true });

    if (services.sessions && created.ok) {
      await services.sessions.create({
        type: 'ai-batch',
        kind: 'synthesize',
        title,
        toolId: 'action:synthesize',
        createdBy: 'ai-agent',
        members: [
          ...sourcePaths.map((path) => ({ notePath: path, role: 'source' as const })),
          { notePath: created.value.path, role: 'derived' as const },
        ],
      });
    }

    progress(100, 'Done');
    return { synthesized: true, noteCount: noteContents.length };
  },

  summary: (_args, result) => {
    const r = result as { noteCount?: number };
    return `Synthesized ${r.noteCount} notes into unified document`;
  },
});
