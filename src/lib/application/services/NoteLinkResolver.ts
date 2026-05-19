import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export function resolveNoteLinkTarget(
  rawTarget: string,
  sourcePath: string | null | undefined,
  items: NotesListItem[],
): string | null {
  const target = cleanNoteLinkTarget(rawTarget);
  if (!target || isExternalLinkTarget(target)) return null;

  const notes = flattenNoteItems(items).filter((item) => !item.isFolder);
  const exactPaths = new Map<string, string>();
  const lowercasePaths = new Map<string, string>();
  for (const note of notes) {
    const normalized = normalizePathForMatch(note.path);
    exactPaths.set(normalized, note.path);
    lowercasePaths.set(normalized.toLowerCase(), note.path);
  }

  for (const candidate of candidateNotePaths(target, sourcePath)) {
    const normalized = normalizePathForMatch(candidate);
    const exact = exactPaths.get(normalized);
    if (exact) return exact;
    const lower = lowercasePaths.get(normalized.toLowerCase());
    if (lower) return lower;
  }

  const targetKey = noteLookupKey(target);
  if (!targetKey) return null;

  const sourceFolder = folderOf(sourcePath ?? '');
  const titleMatches = notes.filter((note) =>
    noteLookupKey(note.title) === targetKey ||
    noteLookupKey(filenameStem(note.path)) === targetKey
  );

  return titleMatches.find((note) => folderOf(note.path) === sourceFolder)?.path
    ?? titleMatches[0]?.path
    ?? null;
}

export function wikiLinkForNoteTitle(title: string): string {
  return `[[${titleToNoteFilename(title)}|${title}]]`;
}

export function titleToNoteFilename(title: string): string {
  return `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.md`;
}

function candidateNotePaths(target: string, sourcePath: string | null | undefined): string[] {
  const candidates: string[] = [];
  const sourceFolder = folderOf(sourcePath ?? '');
  const cleaned = target.replace(/^\.\//, '');
  const add = (candidate: string): void => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  add(cleaned);
  if (!cleaned.endsWith('.md')) add(`${cleaned}.md`);

  if (sourceFolder && !startsWithRoot(cleaned)) {
    const joined = `${sourceFolder}/${cleaned}`;
    add(joined);
    if (!joined.endsWith('.md')) add(`${joined}.md`);
  }

  const targetFolder = folderOf(cleaned);
  const slugFilename = titleToNoteFilename(filenameStem(cleaned));
  if (targetFolder) {
    add(`${targetFolder}/${slugFilename}`);
  } else {
    add(slugFilename);
    if (sourceFolder) add(`${sourceFolder}/${slugFilename}`);
  }

  return candidates;
}

function flattenNoteItems(items: NotesListItem[]): NotesListItem[] {
  const result: NotesListItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children && item.children.length > 0) {
      result.push(...flattenNoteItems(item.children));
    }
  }
  return result;
}

function cleanNoteLinkTarget(rawTarget: string): string {
  const decoded = safeDecode(rawTarget.trim()).replace(/\\/g, '/');
  const hashIndex = decoded.indexOf('#');
  return hashIndex > 0 ? decoded.slice(0, hashIndex).trim() : decoded;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isExternalLinkTarget(target: string): boolean {
  return target.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ||
    /^(mailto|tel):/i.test(target);
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function startsWithRoot(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~');
}

function folderOf(path: string): string {
  const normalized = normalizePathForMatch(path);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function filenameStem(path: string): string {
  const normalized = normalizePathForMatch(path);
  const filename = normalized.split('/').pop() ?? normalized;
  return filename.replace(/\.md$/i, '');
}

function noteLookupKey(value: string): string {
  return filenameStem(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
