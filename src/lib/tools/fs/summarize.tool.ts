import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

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
    const blockedReason = getBlockedFilesystemReadReason(args.path, services);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
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
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename.endsWith('.pem') ||
    basename.endsWith('.key') ||
    basename.endsWith('.p12') ||
    basename.endsWith('.pfx') ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519' ||
    basename === '.npmrc' ||
    basename === '.pypirc' ||
    /\/\.(ssh|aws|azure|kube|gnupg)\//.test(normalized)
  );
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
