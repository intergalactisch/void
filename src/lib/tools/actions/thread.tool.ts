import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export default defineTool({
  id: 'action:thread',
  name: 'Thread',
  description: 'Trace a topic across all your notes — creates a chronological narrative',
  category: 'intelligence',
  args: {
    topic: {
      type: 'string',
      description: 'The topic to trace across notes',
      required: true,
    },
  },
  keywords: ['thread', 'trace', 'topic', 'across', 'timeline', 'narrative'],
  examples: ['Thread database migration', 'Trace the auth discussion', 'Timeline of project decisions'],
  estimatedDuration: 15000,
  accessMode: 'create',

  async execute(args, { services, progress }) {
    const topic = (args as { topic?: string }).topic;
    if (!topic) throw new Error('Please specify a topic to thread');

    progress(10, 'Searching notes...');
    const notesState = services.notes.getState();
    const allNotes: Array<{ path: string; title: string }> = [];
    function flatten(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder) allNotes.push({ path: item.path, title: item.title });
        if (item.children) flatten(item.children);
      }
    }
    flatten(notesState.items);

    // Read notes and filter by topic mention
    progress(30, 'Reading notes...');
    const excerpts: string[] = [];
    const sourcePaths: string[] = [];
    const lowerTopic = topic.toLowerCase();
    for (const note of allNotes.slice(0, 20)) {
      const content = await services.documents.readContent(note.path);
      if (content.ok && content.value.toLowerCase().includes(lowerTopic)) {
        excerpts.push(`### ${note.title} (${note.path})\n${content.value.slice(0, 500)}`);
        sourcePaths.push(note.path);
      }
    }

    if (excerpts.length === 0) {
      throw new Error(`No notes found mentioning "${topic}"`);
    }

    progress(60, 'Generating narrative...');
    const result = await aiPrompt(services,
      `Create a chronological narrative thread about "${topic}" based on these note excerpts. Connect the mentions, show how thinking evolved, and highlight key moments.\n\n${excerpts.join('\n\n---\n\n')}`
    );

    progress(80, 'Creating thread note...');
    const created = await services.collaboration.createNote({
      title: `Thread — ${topic}`,
      content: result,
      autoFocus: true,
    });

    if (services.sessions && created.ok) {
      await services.sessions.create({
        type: 'ai-batch',
        kind: 'thread',
        title: `Thread — ${topic}`,
        topic,
        toolId: 'action:thread',
        createdBy: 'ai-agent',
        members: [
          ...sourcePaths.map((path) => ({ notePath: path, role: 'source' as const })),
          { notePath: created.value.path, role: 'derived' as const },
        ],
      });
    }

    progress(100, 'Done');
    return { threaded: true, topic, notesFound: excerpts.length };
  },

  summary: (_args, result) => {
    const r = result as { topic?: string; notesFound?: number };
    return `Created thread for "${r.topic}" across ${r.notesFound} notes`;
  },
});
