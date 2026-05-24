import { defineTool } from '../define';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

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
    const blockedReason = getBlockedFilesystemReadReason(args.path, services);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
    progress(10, 'Reading file...');

    const result = await services.files.read(args.path);
    if (!result.ok) {
      throw new Error(`Failed to read file: ${result.error.message}`);
    }

    progress(100, 'File read');
    return { path: args.path, content: result.value };
  },
});

function getBlockedFilesystemReadReason(path: string, services: ToolServices): string | null {
  if (isLikelySecretPath(path)) {
    return 'Raw filesystem reads of likely secret files are blocked. Import or protect the note explicitly if you want to work with it.';
  }
  if (isVoidSidecarPath(path)) {
    return 'Raw filesystem reads of .void sidecars are blocked. Use note, lineage, or conversation tools instead.';
  }
  if (isProtectedNotePath(path, services.notes.getState().items)) {
    return 'Raw filesystem reads cannot bypass protected notes. Ask for note access and approve the protected read first.';
  }
  return null;
}

function isLikelySecretPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const basename = normalized.split('/').pop() ?? normalized;
  if (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename.endsWith('.pem') ||
    basename.endsWith('.key') ||
    basename.endsWith('.p12') ||
    basename.endsWith('.pfx') ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519' ||
    basename === '.npmrc' ||
    basename === '.pypirc'
  ) {
    return true;
  }
  return /\/\.(ssh|aws|azure|kube|gnupg)\//.test(normalized);
}

function isVoidSidecarPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === '.void' || normalized.startsWith('.void/') || normalized.includes('/.void/');
}

function isProtectedNotePath(path: string, items: NotesListItem[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  for (const item of items) {
    if (!item.isFolder) {
      const itemPath = item.path.replace(/\\/g, '/').toLowerCase();
      if (
        item.protection?.level === 'protected' &&
        (normalized === itemPath || normalized.endsWith(`/${itemPath}`))
      ) {
        return true;
      }
    }
    if (item.children && isProtectedNotePath(path, item.children)) return true;
  }
  return false;
}
