/**
 * MemoryContentSearchAdapter - in-memory content search for tests.
 *
 * Initialised with a map of `path → content`. Useful for unit-testing
 * SearchServiceImpl without filesystem coupling.
 */

import type {
  ContentSearchPort,
  ContentSearchOptions,
  RawHit,
} from '$lib/ports/outbound/ContentSearchPort';

export class MemoryContentSearchAdapter implements ContentSearchPort {
  private files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map(Object.entries(files));
  }

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  removeFile(path: string): void {
    this.files.delete(path);
  }

  async *search(options: ContentSearchOptions): AsyncIterable<RawHit> {
    if (!options.query) return;

    const maxResults = options.maxResults ?? 200;
    const maxPerFile = options.maxResultsPerFile ?? 20;
    const candidates = options.scopePaths && options.scopePaths.length > 0
      ? options.scopePaths.filter((p) => this.files.has(p))
      : Array.from(this.files.keys());

    let total = 0;
    for (const path of candidates) {
      if (total >= maxResults) return;
      const content = this.files.get(path);
      if (content === undefined) continue;

      let inFile = 0;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (inFile >= maxPerFile) break;
        if (total >= maxResults) return;
        const lineText = lines[i] ?? '';
        const matches = findMatches(lineText, options);
        for (const m of matches) {
          if (inFile >= maxPerFile) break;
          if (total >= maxResults) return;
          yield {
            path,
            line: i + 1,
            column: m.start,
            lineText,
            matchStart: m.start,
            matchEnd: m.end,
          };
          inFile += 1;
          total += 1;
        }
      }
    }
  }
}

function findMatches(line: string, opts: ContentSearchOptions): Array<{ start: number; end: number }> {
  if (opts.regex) {
    try {
      const re = new RegExp(opts.query, opts.caseSensitive ? 'g' : 'gi');
      const out: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        out.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex += 1;
      }
      return out;
    } catch {
      return [];
    }
  }
  const needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
  const haystack = opts.caseSensitive ? line : line.toLowerCase();
  if (!needle) return [];
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length });
    from = idx + needle.length || from + 1;
  }
  return out;
}
