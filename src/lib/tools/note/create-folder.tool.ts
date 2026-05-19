import { defineTool } from '../define';
import { normalizeNoteFolder } from './paths';

interface CreateFolderArgs {
  folder: string;
}

export default defineTool<CreateFolderArgs, { success: boolean; folder: string }>({
  id: 'note:create-folder',
  name: 'Create Folder',
  description: 'Create a folder inside the notes directory for organizing notes',
  category: 'note',

  args: {
    folder: { type: 'string', description: 'Relative folder path inside the notes directory', required: true },
  },

  keywords: ['folder', 'directory', 'organize'],
  examples: [
    'Create a research folder',
    'Make folder Research/AI Topics',
  ],
  estimatedDuration: 100,
  resourceId: (args) => args.folder,
  accessMode: 'create',

  summary: (_args, result) => `Created folder ${result.folder}`,

  async execute(args, { services, progress }) {
    progress(20, 'Creating folder...');

    const folder = await normalizeNoteFolder(args.folder, services);
    assertSafeRelativeFolder(folder);
    if (!folder) {
      throw new Error('Folder path cannot be empty');
    }

    const settings = await services.settings.load();
    if (!settings.ok) {
      throw new Error(`Failed to load settings: ${settings.error.message}`);
    }

    const notesPath = settings.value.notesPath.replace(/\/+$/, '');
    const absolutePath = `${notesPath}/${folder}`;
    const result = await services.files.createDirectory(absolutePath);
    if (!result.ok) {
      throw new Error(`Failed to create folder: ${result.error.message}`);
    }

    await services.notes.refresh();
    if (services.navigation) {
      await services.navigation.openFolder(folder);
    }

    progress(100, 'Folder created');
    return { success: true, folder };
  },
});

function assertSafeRelativeFolder(folder: string): void {
  const normalized = folder.replace(/\\/g, '/');
  if (!normalized) return;
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.includes('\0')) {
    throw new Error('Folder path must be relative to the notes directory');
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Folder path cannot contain "." or ".." segments');
  }
}
