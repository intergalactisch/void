import { defineTool } from '../define';
import { aiPrompt } from '../context';

export default defineTool({
  id: 'intelligence:extract-todos',
  name: 'Extract Todos',
  description: 'Scan the current note for action items and create todos from them',
  category: 'intelligence',

  keywords: ['action items', 'todos', 'tasks', 'extract'],
  examples: ['Extract action items from this meeting note', 'Find all todos in this note'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map((b) => b.content).join('\n') ?? '';

    if (!content) throw new Error('No content to extract from');

    progress(30, 'Finding action items...');
    const response = await aiPrompt(services,
      `Extract action items from this text. Return ONLY a JSON array of objects with "title" and "priority" (one of "none", "low", "medium", "high") fields. No other text:\n\n${content}`
    );

    let items: Array<{ title: string; priority: string }>;
    try {
      items = JSON.parse(response);
    } catch {
      // If AI didn't return valid JSON, extract from text
      items = [{ title: response.trim(), priority: 'none' }];
    }

    progress(60, `Creating ${items.length} todos...`);
    let created = 0;
    for (const item of items) {
      const result = await services.todos.create(item.title);
      if (result.ok) created++;
    }

    progress(100, 'Done');
    return { created, items };
  },
});
