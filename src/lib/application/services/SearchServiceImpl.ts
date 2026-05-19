/**
 * SearchServiceImpl - orchestrates content search.
 *
 * Wraps a ContentSearchPort and enriches raw hits with display metadata
 * (note titles) pulled from NotesService. Pure application logic — no
 * filesystem access here.
 */

import type { SearchService, SearchHit } from '$lib/ports/inbound/SearchService';
import type {
  ContentSearchPort,
  ContentSearchOptions,
} from '$lib/ports/outbound/ContentSearchPort';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export class SearchServiceImpl implements SearchService {
  constructor(
    private readonly contentSearch: ContentSearchPort,
    private readonly notes: NotesService
  ) {}

  async *searchContent(options: ContentSearchOptions): AsyncIterable<SearchHit> {
    if (!options.query.trim()) return;
    const titleByPath = this.buildTitleIndex();
    for await (const hit of this.contentSearch.search(options)) {
      yield {
        path: hit.path,
        title: titleByPath.get(hit.path) ?? this.fallbackTitle(hit.path),
        line: hit.line,
        column: hit.column,
        lineText: hit.lineText,
        matchStart: hit.matchStart,
        matchEnd: hit.matchEnd,
      };
    }
  }

  async searchAll(options: ContentSearchOptions): Promise<SearchHit[]> {
    const out: SearchHit[] = [];
    for await (const hit of this.searchContent(options)) {
      out.push(hit);
    }
    return out;
  }

  private buildTitleIndex(): Map<string, string> {
    const map = new Map<string, string>();
    const flatten = (items: NotesListItem[]): void => {
      for (const item of items) {
        if (!item.isFolder) {
          map.set(item.path, item.title);
        }
        if (item.children && item.children.length > 0) {
          flatten(item.children);
        }
      }
    };
    flatten(this.notes.getState().items);
    return map;
  }

  private fallbackTitle(path: string): string {
    const name = path.split('/').pop() ?? path;
    return name.replace(/\.md$/i, '');
  }
}
