import { defineTool } from '../define';

export default defineTool({
  id: 'navigation:forward',
  name: 'Go Forward',
  description: 'Navigate forward in the history to the next note or view',
  category: 'navigation',

  keywords: ['next', 'forward', 'ahead'],
  examples: [
    'Go forward',
    'Navigate forward',
    'Go to the next view',
  ],
  estimatedDuration: 50,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(50, 'Going forward...');

    if (services.navigation) {
      const result = await services.navigation.forward();
      if (!result.ok) throw result.error;
    }

    progress(100, 'Navigation complete');
    return { success: true, canGoForward: true };
  },
});
