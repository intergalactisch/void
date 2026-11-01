/**
 * JsContentSearchAdapter - filesystem-backed content search done in JS.
 *
 * Reads each note via `FileSystemPort.readFile` and scans for matches in
 * the renderer process. Adequate for moderate vaults; large vaults should
 * use a Rust-side grep adapter (a future optimisation, not part of Wave 1).
 *
 * The list of files to scan comes from `NotesService` (in-memory note tree).
 * If `scopePaths` is provided, the adapter searches only those paths.
 */

import type {
  ContentSearchPort,
  ContentSearchOptions,
  RawHit,
} from '$lib/ports/outbound/ContentSearchPort';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';
import type { NotesService, NotesListItem } from '$lib/ports/inbound/NotesService';

const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_PER_FILE = 20;

export class JsContentSearchAdapter implements ContentSearchPort {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly notes: NotesService,
    private readonly basePath: string,
  ) {}

  async *search(options: ContentSearchOptions): AsyncIterable<RawHit> {
    const query = options.query;
    if (!query) return;

    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const maxPerFile = options.maxResultsPerFile ?? DEFAULT_MAX_PER_FILE;
    const matcher = compileMatcher(options);
    if (!matcher) return;

    // Build the eligibility index once, instead of walking the entire tree
    // for each scoped path. Always read the canonical path from the note tree.
    const paths = this.allNotePaths();
    const byPath = new Map(paths.map((path) => [normalizePath(path), path]));
    const candidates = options.scopePaths && options.scopePaths.length > 0
      ? [...new Set(options.scopePaths.flatMap((path) => {
          const canonical = byPath.get(normalizePath(path));
          return canonical === undefined ? [] : [canonical];
        }))]
      : paths;

    let totalHits = 0;
    for (const path of candidates) {
      if (totalHits >= maxResults) return;
      // NotesService exposes document-relative paths, while FileSystemPort
      // expects a path rooted in the active workspace.
      const relative = path.replace(/\\/g, '/');
      if (/^(?:\/|[A-Za-z]:)/.test(relative) || relative.split('/').some(part => part === '..' || part === '.')) continue;
      const result = await this.fs.readFile(`${this.basePath.replace(/\/$/, '')}/${relative}`);
      if (!result.ok) continue;

      let hitsInFile = 0;
      const content = result.value;
      const lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (hitsInFile >= maxPerFile) break;
        if (totalHits >= maxResults) return;
        const lineText = lines[lineIndex] ?? '';
        const matches = matcher(lineText);
        for (const match of matches) {
          if (hitsInFile >= maxPerFile) break;
          if (totalHits >= maxResults) return;
          yield {
            path,
            line: lineIndex + 1,
            column: match.start,
            lineText,
            matchStart: match.start,
            matchEnd: match.end,
          };
          hitsInFile += 1;
          totalHits += 1;
        }
      }
    }
  }

  private allNotePaths(): string[] {
    const out: string[] = [];
    const walk = (items: NotesListItem[]) => {
      for (const item of items) {
        if (!item.isFolder && !item.protection) {
          out.push(item.path);
        }
        if (item.children && item.children.length > 0) {
          walk(item.children);
        }
      }
    };
    walk(this.notes.getState().items);
    return out;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

interface Match {
  start: number;
  end: number;
}

type Matcher = (line: string) => Iterable<Match>;

function compileMatcher(options: ContentSearchOptions): Matcher | null {
  if (options.regex) {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      const re = new RegExp(options.query, flags);
      return function* (line: string) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          yield { start: m.index, end: m.index + m[0].length };
          if (m[0].length === 0) re.lastIndex += 1; // avoid infinite loop on empty match
        }
      };
    } catch {
      return null; // invalid regex
    }
  }

  const needle = options.query;
  const wholeWord = options.wholeWord ?? false;
  const caseSensitive = options.caseSensitive ?? false;
  const ws = /\w/;

  const target = caseSensitive ? needle : needle.toLowerCase();
  return function* (line: string) {
    const haystack = caseSensitive ? line : line.toLowerCase();
    if (target.length === 0) return;

    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(target, from);
      if (idx === -1) break;
      const end = idx + target.length;
      const before = idx > 0 ? line[idx - 1] : '';
      const after = end < line.length ? line[end] : '';
      const isWord = !wholeWord || ((!before || !ws.test(before)) && (!after || !ws.test(after)));
      if (isWord) {
        yield { start: idx, end };
      }
      from = end > from ? end : from + 1;
    }
  };
}
