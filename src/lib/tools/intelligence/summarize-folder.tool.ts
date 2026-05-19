import { defineTool } from '../define';

interface SummarizeFolderArgs {
  folder: string;
}

export default defineTool<SummarizeFolderArgs, { operationId: string; status: string }>({
  id: 'intelligence:summarize-folder',
  name: 'Summarize Folder',
  description: 'Summarize all notes in a folder into a single comprehensive overview.',
  category: 'intelligence',

  args: {
    folder: { type: 'string', description: 'Folder path to summarize', required: true },
  },
  keywords: ['summarize', 'folder', 'overview', 'digest'],
  examples: ['Summarize the projects folder', 'Create an overview of my research notes'],
  estimatedDuration: 20000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    if (!services.operations) {
      throw new Error('Operation service not available');
    }

    progress(10, 'Queuing folder summarization...');

    const result = await services.operations.queueFromTemplate('summarize-folder', {
      folder: args.folder,
    });

    if (!result.ok) {
      throw new Error(`Failed to queue summarization: ${result.error.message}`);
    }

    progress(100, 'Summarization queued');
    return { operationId: result.value.id, status: 'queued' };
  },

  summary: (args, result) => `Queued summarization of "${args.folder}" (${result.operationId})`,
});
