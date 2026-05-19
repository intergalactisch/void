/**
 * SearchService - Inbound port for cross-note full-text search.
 *
 * The application surface above ContentSearchPort: ranks results, resolves
 * note titles for display, and applies result-cap policies. UI and AI tools
 * consume this; nothing else.
 */

import type { ContentSearchOptions } from '$lib/ports/outbound/ContentSearchPort';

export interface SearchHit {
  /** Path of the matching note. */
  path: string;
  /** Display title for the note (from frontmatter, falling back to filename). */
  title: string;
  /** Line number, 1-indexed. */
  line: number;
  /** Column, 0-indexed within the line. */
  column: number;
  /** The full text of the matching line. */
  lineText: string;
  /** Highlight bounds within `lineText`. */
  matchStart: number;
  /** Highlight bounds within `lineText` (exclusive). */
  matchEnd: number;
}

export interface SearchService {
  /**
   * Stream search hits as they're found. The order is implementation-defined
   * — most adapters yield in file order. Cancel by breaking out of the
   * for-await loop.
   */
  searchContent(options: ContentSearchOptions): AsyncIterable<SearchHit>;

  /**
   * Run a search to completion, returning all hits in an array. Convenient
   * for non-streaming consumers like the AI agent.
   */
  searchAll(options: ContentSearchOptions): Promise<SearchHit[]>;
}
