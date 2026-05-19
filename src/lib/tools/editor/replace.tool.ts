import { defineTool } from '../define';

interface ReplaceArgs {
  text: string;
}

export default defineTool<ReplaceArgs>({
  id: 'editor:replace',
  name: 'Replace Selection',
  description: 'Replace the currently selected text with new text',
  category: 'editor',

  args: {
    text: { type: 'string', description: 'Text to replace the selection with', required: true },
  },

  keywords: ['change', 'swap', 'substitute', 'update'],
  examples: [
    'Replace selection with "updated text"',
    'Change this to something else',
    'Substitute the selected content',
  ],
  estimatedDuration: 50,
  accessMode: 'write',

  async execute(args, { services, progress }) {
    progress(50, 'Replacing selection...');

    const selection = services.editor.getState().selection;
    const blockId = selection.anchorBlockId ?? selection.headBlockId;
    const result = blockId
      ? await services.collaboration.replaceBlock({
          blockId,
          markdown: args.text,
          label: 'AI replace',
        })
      : await services.collaboration.insertAtCursor(args.text, 'AI replace');
    if (!result.ok) {
      throw new Error(`Failed to replace selection: ${result.error.message}`);
    }

    progress(100, 'Selection replaced');
    return { success: true };
  },
});
