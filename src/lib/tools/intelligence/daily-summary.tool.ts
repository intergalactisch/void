import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export default defineTool({
  id: 'intelligence:daily-summary',
  name: 'Daily Summary',
  description: "Generate daily summary from today's notes",
  category: 'intelligence',

  keywords: ['daily', 'summary', 'today', 'recap'],
  examples: ['Give me a daily summary', "What did I work on today?", "Summarize today's notes"],
  estimatedDuration: 10000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Finding today\'s notes...');

    const notesState = services.notes.getState();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find notes modified today
    const todayNotes: string[] = [];
    function findRecent(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder && item.modifiedAt >= today) {
          todayNotes.push(item.title);
        }
        if (item.children) findRecent(item.children);
      }
    }
    findRecent(notesState.items);

    if (todayNotes.length === 0) {
      return { summary: 'No notes were modified today.' };
    }

    progress(30, 'Generating summary...');
    const notesList = todayNotes.join(', ');
    const summary = await aiPrompt(services,
      `Create a brief daily summary based on these notes that were modified today: ${notesList}. Write it as a short paragraph highlighting key activities and themes.`
    );

    progress(100, 'Done');
    return { summary, noteCount: todayNotes.length };
  },
});
