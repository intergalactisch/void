import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface SummarizeFileArgs {
  path: string;
}

export default defineTool<SummarizeFileArgs>({
  id: 'fs:summarize',
  name: 'Summarize File',
  description: 'Summarize any file on the machine',
  category: 'fs',

  args: {
    path: { type: 'string', description: 'File path to summarize', required: true },
  },

  keywords: ['file', 'summarize', 'describe'],
  examples: ['Summarize this file', 'What does this file contain?'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Reading file...');

    const result = await services.files.read(args.path);
    if (!result.ok) {
      throw new Error(`Failed to read file: ${result.error.message}`);
    }

    const content = result.value;
    // Truncate very large files for the AI
    const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n\n[... truncated]' : content;

    progress(30, 'Summarizing...');
    const summary = await aiPrompt(services,
      `Summarize the contents of this file (${args.path}). Describe what it contains, its purpose, and key details:\n\n${truncated}`
    );

    progress(100, 'Done');
    return { path: args.path, summary };
  },
});
