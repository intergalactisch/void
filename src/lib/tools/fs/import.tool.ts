import { defineTool } from '../define';
import { normalizeNoteFolder } from '../note/paths';

interface ImportArgs {
  path: string;
  title?: string;
  folder?: string;
}

export default defineTool<ImportArgs>({
  id: 'fs:import',
  name: 'Import File',
  description: 'Import and restructure content from external files into a note',
  category: 'fs',

  args: {
    path: { type: 'string', description: 'File path to import from', required: true },
    title: { type: 'string', description: 'Title for the new note' },
    folder: { type: 'string', description: 'Folder to import into' },
  },

  requiresConfirmation: true,
  keywords: ['import', 'bring in', 'load'],
  examples: ['Import this markdown file', 'Bring in content from a text file'],
  estimatedDuration: 500,
  accessMode: 'create',

  async execute(args, { services, progress, isCancelled, invocation }) {
    if (isCancelled()) throw new Error('Import cancelled');

    progress(10, 'Reading source file...');

    const readResult = await services.files.read(args.path);
    if (!readResult.ok) {
      throw new Error(`Failed to read file: ${readResult.error.message}`);
    }

    // Extract title from filename if not provided
    const filename = args.path.split('/').pop() ?? 'Imported';
    const title = args.title ?? filename.replace(/\.[^.]+$/, '');
    const folder = await normalizeNoteFolder(args.folder ?? '', services);

    progress(50, 'Creating note...');

    const createResult = await services.collaboration.createNote({
      folder,
      title,
      content: readResult.value,
      autoFocus: true,
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'import',
        summary: 'AI file import',
        commandId: 'fs:import',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!createResult.ok) {
      throw new Error(`Failed to create note: ${createResult.error.message}`);
    }

    progress(100, 'File imported');
    return { success: true, newPath: createResult.value.path, title };
  },
});
