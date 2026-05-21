import { defineTool } from '../define';

interface InsertArgs {
  text: string;
  position?: number;
}

export default defineTool<InsertArgs>({
  id: 'editor:insert',
  name: 'Insert Text',
  description: 'Insert text at the current cursor position or a specified position',
  category: 'editor',

  args: {
    text: { type: 'string', description: 'Text to insert', required: true },
    position: { type: 'number', description: 'Character position to insert at (defaults to cursor position)', minimum: 0 },
  },

  keywords: ['add', 'write', 'type', 'put'],
  examples: [
    'Insert "Hello World" at the cursor',
    'Add a new paragraph here',
    'Type out the following text',
  ],
  estimatedDuration: 50,
  accessMode: 'write',
  resourceId: () => '@ambient:editor',

  async execute(args, { services, progress }) {
    progress(50, 'Inserting text...');

    const result = await services.collaboration.insertAtCursor(args.text, 'AI insert');
    if (!result.ok) {
      throw new Error(`Failed to insert text: ${result.error.message}`);
    }

    progress(100, 'Text inserted');
    return { success: true, position: args.position ?? 0 };
  },
});
