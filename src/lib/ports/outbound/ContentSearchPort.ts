/**
 * ContentSearchPort - Outbound port for searching note content.
 *
 * Adapters implement filesystem grep, in-memory search, or remote search.
 * The application layer depends only on this interface.
 */

export interface ContentSearchOptions {
  /** The query string. Treated as a literal substring unless `regex` is true. */
  query: string;
  /** Treat `query` as a regular expression. */
  regex?: boolean;
  /** Match case. Default: false (case-insensitive). */
  caseSensitive?: boolean;
  /** Match only whole words. */
  wholeWord?: boolean;
  /** Maximum results (across all notes). Default: 200. */
  maxResults?: number;
  /** Maximum results per file. Default: 20. */
  maxResultsPerFile?: number;
  /** Optional list of note paths to scope the search to. */
  scopePaths?: string[];
}

export interface RawHit {
  /** Path of the matching file. */
  path: string;
  /** Line number, 1-indexed. */
  line: number;
  /** Column where the match starts, 0-indexed (within the line). */
  column: number;
  /** The full text of the matching line. */
  lineText: string;
  /** Start offset of the match within `lineText`. */
  matchStart: number;
  /** End offset of the match within `lineText` (exclusive). */
  matchEnd: number;
}

export interface ContentSearchPort {
  /**
   * Stream raw match hits across the indexed content. Implementations are
   * encouraged to yield hits as they're discovered for responsive UIs.
   */
  search(options: ContentSearchOptions): AsyncIterable<RawHit>;
}
