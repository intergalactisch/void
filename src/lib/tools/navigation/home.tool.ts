import { defineTool } from '../define';

export default defineTool({
  id: 'navigation:home',
  name: 'Go Home',
  description: 'Navigate to the home window with no note selected',
  category: 'navigation',

  keywords: ['home', 'start', 'main', 'empty'],
  examples: [
    'Go home',
    'Navigate to the home window',
    'Show the home screen',
  ],
  estimatedDuration: 50,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(50, 'Going home...');

    if (services.navigation) {
      const result = await services.navigation.goHome();
      if (!result.ok) throw result.error;
    } else {
      services.notes.selectNote(null);
    }

    progress(100, 'Home opened');
    return { success: true, view: 'home' };
  },
});
