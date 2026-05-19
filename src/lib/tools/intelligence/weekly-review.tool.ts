import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export default defineTool({
  id: 'intelligence:weekly-review',
  name: 'Weekly Review',
  description: "Create a weekly review from past week's notes",
  category: 'intelligence',

  keywords: ['weekly', 'review', 'week', 'retrospective'],
  examples: ['Create a weekly review', 'What happened this week?', 'Weekly summary'],
  estimatedDuration: 15000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Finding this week\'s notes...');

    const notesState = services.notes.getState();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    // Find notes modified in the past week
    const weekNotes: string[] = [];
    function findRecent(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder && item.modifiedAt >= weekAgo) {
          weekNotes.push(item.title);
        }
        if (item.children) findRecent(item.children);
      }
    }
    findRecent(notesState.items);

    if (weekNotes.length === 0) {
      return { review: 'No notes were modified in the past week.' };
    }

    progress(30, 'Generating weekly review...');
    const notesList = weekNotes.join(', ');
    const review = await aiPrompt(services,
      `Create a weekly review based on these notes modified in the past 7 days: ${notesList}. Structure as:\n- Key accomplishments\n- Main themes\n- Areas to follow up on`
    );

    progress(100, 'Done');
    return { review, noteCount: weekNotes.length };
  },
});
