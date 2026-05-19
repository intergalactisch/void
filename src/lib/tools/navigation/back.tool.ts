import { defineTool } from '../define';

export default defineTool({
  id: 'navigation:back',
  name: 'Go Back',
  description: 'Navigate back in the history to the previous note or view',
  category: 'navigation',

  keywords: ['previous', 'back', 'history', 'return'],
  examples: [
    'Go back',
    'Return to the previous note',
    'Navigate back',
  ],
  estimatedDuration: 50,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(50, 'Going back...');

    if (services.navigation) {
      const result = await services.navigation.back();
      if (!result.ok) throw result.error;
    }

    progress(100, 'Navigation complete');
    return { success: true, canGoBack: true };
  },
});
