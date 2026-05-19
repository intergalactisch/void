import { defineTool } from '../define';

interface FormatArgs {
  format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code';
}

export default defineTool<FormatArgs>({
  id: 'editor:format',
  name: 'Format Selection',
  description: 'Apply formatting to the selected text',
  category: 'editor',

  args: {
    format: {
      type: 'string',
      description: 'Formatting to apply',
      required: true,
      enum: ['bold', 'italic', 'underline', 'strikethrough', 'code'],
    },
  },

  keywords: ['style', 'bold', 'italic', 'underline', 'code'],
  examples: [
    'Make this text bold',
    'Italicize the selection',
    'Format as code',
  ],
  estimatedDuration: 50,
  accessMode: 'write',

  async execute(args, { services, progress }) {
    progress(50, `Applying ${args.format} formatting...`);

    services.editor.toggleMark(args.format);

    progress(100, 'Formatting applied');
    return { success: true, format: args.format };
  },
});
