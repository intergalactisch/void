import { defineTool } from '../define';

interface GotoArgs {
  target: string;
  type?: 'note' | 'folder' | 'view';
}

export default defineTool<GotoArgs>({
  id: 'navigation:goto',
  name: 'Go To',
  description: 'Navigate to a specific note or view',
  category: 'navigation',

  args: {
    target: { type: 'string', description: 'ID of the note or name of the view to navigate to', required: true },
    type: { type: 'string', description: 'Type of target (note, folder, or view)', default: 'note', enum: ['note', 'folder', 'view'] },
  },

  keywords: ['open', 'navigate', 'go', 'jump', 'show'],
  examples: [
    'Go to the meeting notes',
    'Open the settings view',
    'Navigate to my todo list',
  ],
  estimatedDuration: 100,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(50, `Navigating to ${args.target}...`);

    const targetType = args.type ?? 'note';
    if (services.navigation) {
      if (targetType === 'note') {
        const result = await services.navigation.openNote(args.target);
        if (!result.ok) throw result.error;
      } else if (targetType === 'folder') {
        const result = await services.navigation.openFolder(args.target);
        if (!result.ok) throw result.error;
      } else {
        const target = args.target.toLowerCase();
        const result =
          target === 'home' ? await services.navigation.goHome() :
          target === 'search' ? await services.navigation.openSearch() :
          target === 'tasks' || target === 'todos' ? await services.navigation.openTasks() :
          target === 'actions' || target === 'work' || target === 'operations' ? await services.navigation.openActions() :
          target === 'settings' ? await services.navigation.openSettings() :
          await services.navigation.openSearch(args.target);
        if (!result.ok) throw result.error;
      }
    } else if (targetType === 'note') {
      services.notes.selectNote(args.target);
    } else if (targetType === 'folder') {
      services.notes.expandFolder(args.target);
      services.notes.selectNote(null);
    }

    progress(100, 'Navigation complete');
    return { success: true, target: args.target };
  },
});
