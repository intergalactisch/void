import { defineTool } from '../define';

interface ReadFileArgs {
  path: string;
}

export default defineTool<ReadFileArgs>({
  id: 'fs:read',
  name: 'Read File',
  description: 'Read a file from disk',
  category: 'fs',

  args: {
    path: { type: 'string', description: 'File path to read', required: true },
  },

  keywords: ['file', 'read', 'open', 'cat'],
  examples: ['Read the file at /path/to/file', 'Show me the contents of config.json'],
  estimatedDuration: 100,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Reading file...');

    const result = await services.files.read(args.path);
    if (!result.ok) {
      throw new Error(`Failed to read file: ${result.error.message}`);
    }

    progress(100, 'File read');
    return { path: args.path, content: result.value };
  },
});
