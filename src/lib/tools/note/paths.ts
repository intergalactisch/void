import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import { parseRefId } from '$lib/domain/values/RefId';

type SettingsService = Pick<ToolServices, 'settings'>;

function trimTrailingSlashes(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function stripFileProtocol(path: string): string {
  if (!path.startsWith('file://')) return path;

  try {
    return decodeURIComponent(new URL(path).pathname);
  } catch {
    return path.slice('file://'.length);
  }
}

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

async function getNotesPath(services: SettingsService): Promise<string | null> {
  const settingsResult = await services.settings.load();
  if (!settingsResult.ok) return null;
  return trimTrailingSlashes(normalizeSeparators(settingsResult.value.notesPath));
}

function notesRootVariants(notesPath: string): string[] {
  const roots = new Set<string>();
  roots.add(notesPath);

  const userHomeMatch = notesPath.match(/^\/Users\/[^/]+\/(.+)$/);
  if (userHomeMatch?.[1]) {
    roots.add(`~/${userHomeMatch[1]}`);
  }

  return [...roots].sort((a, b) => b.length - a.length);
}

function stripNotesRoot(path: string, notesPath: string): string | null {
  for (const root of notesRootVariants(notesPath)) {
    if (path === root) return '';
    if (path.startsWith(`${root}/`)) {
      return path.slice(root.length + 1);
    }
  }

  const tildeRoot = notesRootVariants(notesPath).find((root) => root.startsWith('~/'));
  if (!tildeRoot) return null;

  const suffix = tildeRoot.slice(2);
  const marker = `/${suffix}/`;
  const markerIndex = path.indexOf(marker);
  if (markerIndex < 0) return null;
  return path.slice(markerIndex + marker.length);
}

/**
 * Convert an absolute path inside the configured notes folder to the relative
 * note path expected by DocumentPort and NotesService. Paths outside the notes
 * folder are left alone so the lower storage layer can reject them.
 */
export async function normalizeNotePath(
  path: string,
  services: SettingsService
): Promise<string> {
  const trimmed = path.trim();
  const ref = parseRefId(trimmed);
  if (ref?.kind === 'note' || ref?.kind === 'block') {
    return ref.notePath;
  }
  if (ref?.kind === 'folder') {
    return ref.folderPath;
  }

  const cleaned = normalizeSeparators(stripFileProtocol(trimmed));
  const notesPath = await getNotesPath(services);

  if (!notesPath) return cleaned;
  const relative = stripNotesRoot(cleaned, notesPath);
  if (relative === null) return cleaned;

  return relative;
}

/**
 * Normalize a folder argument. Unlike note paths, folder paths should not end
 * in a slash after normalization because tools compose children with `/`.
 */
export async function normalizeNoteFolder(
  folder: string,
  services: SettingsService
): Promise<string> {
  return trimTrailingSlashes(await normalizeNotePath(folder, services));
}
