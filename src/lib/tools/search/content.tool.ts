import { defineTool } from '../define';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';
import { normalizeNotePath } from '../note/paths';

interface SearchContentArgs {
  query: string;
  noteId?: string;
  limit?: number;
}

interface ContentMatch {
  line: number;
  text: string;
  context: string;
}

interface ContentSearchResult {
  noteId: string;
  title: string;
  path: string;
  matches: ContentMatch[];
}

interface ScannedNote {
  result: ContentSearchResult;
  matchCount: number;
}

const SEARCH_CONCURRENCY = 12;
const MAX_MATCHES_PER_NOTE = 20;
const MAX_MATCH_TEXT_CHARS = 500;

export default defineTool<SearchContentArgs, { results: ContentSearchResult[]; totalMatches: number }>({
  id: 'search:content',
  name: 'Search Content',
  description: 'Search within the content of notes for specific text',
  category: 'search',

  args: {
    query: { type: 'string', description: 'Text to search for within note content', required: true, minLength: 1 },
    noteId: { type: 'string', description: 'Optionally limit search to a specific note' },
    limit: { type: 'number', description: 'Maximum number of notes to return', default: 20 },
  },

  keywords: ['find', 'text', 'content', 'grep', 'in'],
  examples: [
    'Search for "action items" in all notes',
    'Find mentions of "deadline" in this note',
    'Look for TODO comments',
  ],
  estimatedDuration: 500,
  accessMode: 'read',

  summary: (args, result) => `"${args.query}" → ${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''}`,

  async execute(args, { services, progress, isCancelled }) {
    progress(10, 'Searching content...');

    if (isCancelled()) {
      throw new Error('Search cancelled');
    }

    const query = args.query.trim();
    if (!query) {
      throw new Error('Search query cannot be empty');
    }

    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    let notes = flattenNotes(services.notes.getState().items).filter((item) => !item.isFolder);

    if (notes.length === 0) {
      const refreshed = await services.notes.refresh();
      if (!refreshed.ok) {
        throw new Error(`Content search failed: ${refreshed.error.message}`);
      }
      notes = flattenNotes(refreshed.value).filter((item) => !item.isFolder);
    }

    if (args.noteId) {
      const noteId = await normalizeNotePath(args.noteId, services);
      notes = notes.filter((note) => note.path === noteId || note.path.endsWith(noteId));
    }

    const lowerQuery = query.toLowerCase();
    const results: ContentSearchResult[] = [];
    let totalMatches = 0;
    const batches = chunk(notes, SEARCH_CONCURRENCY);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (isCancelled()) throw new Error('Search cancelled');

      const batch = batches[batchIndex] ?? [];
      const batchResults = await Promise.all(batch.map(async (note): Promise<ScannedNote | null> => {
        if (isCancelled()) throw new Error('Search cancelled');

        const meta = await services.documents.readMeta(note.path);
        if (meta.ok && meta.value.protection?.level === 'protected') {
          const protection = meta.value.protection;
          const policy = services.protection.currentPolicy();
          if (
            protection.lockState === 'locked' ||
            (policy.requireAIApprovalForProtectedReads &&
              !services.protection.hasAIContextAuthorization(protection.noteId, 'note.read'))
          ) {
            return null;
          }
        }

        const content = await services.documents.readContent(note.path);
        if (!content.ok) return null;

        const lines = content.value.split(/\r?\n/);
        const matches: ContentMatch[] = [];
        let matchCount = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (!line.toLowerCase().includes(lowerQuery)) continue;

          matchCount++;
          if (matches.length >= MAX_MATCHES_PER_NOTE) continue;

          const before = lines[Math.max(0, i - 1)] ?? '';
          const after = lines[Math.min(lines.length - 1, i + 1)] ?? '';
          matches.push({
            line: i + 1,
            text: clipText(line),
            context: [before, line, after].filter(Boolean).map(clipText).join('\n'),
          });
        }

        if (matchCount === 0) return null;
        return {
          result: {
            noteId: note.path,
            title: note.title,
            path: note.path,
            matches,
          },
          matchCount,
        };
      }));

      for (const scanned of batchResults) {
        if (!scanned) continue;
        totalMatches += scanned.matchCount;
        results.push(scanned.result);
        if (results.length >= limit) break;
      }

      progress(
        Math.min(95, 10 + Math.round(((batchIndex + 1) / Math.max(1, batches.length)) * 80)),
        'Searching content...'
      );

      if (results.length >= limit) break;
    }

    progress(100, 'Content search complete');
    return { results, totalMatches };
  },
});

function flattenNotes(items: NotesListItem[]): NotesListItem[] {
  const result: NotesListItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) {
      result.push(...flattenNotes(item.children));
    }
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function clipText(text: string): string {
  if (text.length <= MAX_MATCH_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_MATCH_TEXT_CHARS - 3)}...`;
}
