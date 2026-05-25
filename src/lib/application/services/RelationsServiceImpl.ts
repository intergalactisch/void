/**
 * RelationsServiceImpl - cross-note link graph from markdown content.
 *
 * Builds a directed graph of `from → to` links by scanning every note's
 * markdown for `[[wikilinks]]` and `[text](path)` references that resolve
 * to known notes. Caches the graph in memory; rebuilds incrementally when
 * a note saves and lazily on first request.
 *
 * Pure application logic: no DOM, no Tauri. Reads content via DocumentService.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  RelationsService,
  NoteLink,
} from '$lib/ports/inbound/RelationsService';
import type { NotesService, NotesListItem } from '$lib/ports/inbound/NotesService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import { events } from '$lib/events';
import { resolveNoteLinkTarget } from './NoteLinkResolver';

interface RawLink {
  /** Resolved target path (relative or absolute matching note index). */
  targetPath: string;
  linkText: string;
  context: string;
  line: number;
}

interface CachedNote {
  /** Outgoing links from this note. */
  outgoing: RawLink[];
}

const WIKILINK_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]/g;
// Captures markdown links: [text](href). Excludes images ![alt](src) by
// requiring the [ to NOT be preceded by !.
const MD_LINK_RE = /(?<!!)\[([^\[\]\n]*?)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;

export class RelationsServiceImpl implements RelationsService {
  private cache: Map<string, CachedNote> = new Map();
  /** Reverse index: targetPath → set of source paths that link to it. */
  private backlinks: Map<string, Set<string>> = new Map();
  private subscribers = new Set<() => void>();
  private initialized = false;
  private refreshing: Promise<Result<void, Error>> | null = null;

  constructor(
    private readonly notes: NotesService,
    private readonly documents: DocumentService
  ) {
    events.on('note:saved', ({ path }) => {
      void this.indexNote(path);
    });
    events.on('document:saved', ({ path }) => {
      void this.indexNote(path);
    });
    events.on('note:deleted', ({ path }) => {
      this.removeNote(path);
    });
    events.on('note:restored', ({ path }) => {
      void this.indexNote(path);
    });
    events.on('note:renamed', ({ oldPath, newPath }) => {
      this.removeNote(oldPath);
      void this.indexNote(newPath);
    });
  }

  async getBacklinks(notePath: string): Promise<Result<NoteLink[], Error>> {
    const ensured = await this.ensureInitialized();
    if (!ensured.ok) return ensured;

    const sources = this.backlinks.get(notePath);
    if (!sources || sources.size === 0) return ok([]);

    const out: NoteLink[] = [];
    for (const sourcePath of sources) {
      const cached = this.cache.get(sourcePath);
      if (!cached) continue;
      const sourceTitle = this.titleFor(sourcePath);
      for (const link of cached.outgoing) {
        if (link.targetPath !== notePath) continue;
        out.push({
          path: sourcePath,
          title: sourceTitle,
          linkText: link.linkText,
          context: link.context,
          line: link.line,
        });
      }
    }
    return ok(out);
  }

  async getOutgoingLinks(notePath: string): Promise<Result<NoteLink[], Error>> {
    const ensured = await this.ensureInitialized();
    if (!ensured.ok) return ensured;

    const cached = this.cache.get(notePath);
    if (!cached) return ok([]);

    const out: NoteLink[] = [];
    for (const link of cached.outgoing) {
      out.push({
        path: link.targetPath,
        title: this.titleFor(link.targetPath),
        linkText: link.linkText,
        context: link.context,
        line: link.line,
      });
    }
    return ok(out);
  }

  async refresh(): Promise<Result<void, Error>> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.runFullRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ─── private ───

  private async ensureInitialized(): Promise<Result<void, Error>> {
    if (this.initialized) return ok(undefined);
    return this.refresh();
  }

  private async runFullRefresh(): Promise<Result<void, Error>> {
    const items = this.notes.getState().items;
    const all = this.flatten(items);
    this.cache.clear();
    this.backlinks.clear();

    for (const item of all) {
      if (item.isFolder) continue;
      if (item.protection?.level === 'protected') continue;
      const result = await this.documents.readContent(item.path);
      if (!result.ok) continue;
      const links = this.parseLinks(result.value, item.path);
      this.cache.set(item.path, { outgoing: links });
      for (const link of links) {
        const set = this.backlinks.get(link.targetPath) ?? new Set();
        set.add(item.path);
        this.backlinks.set(link.targetPath, set);
      }
    }

    this.initialized = true;
    this.notify();
    return ok(undefined);
  }

  private async indexNote(notePath: string): Promise<void> {
    if (!this.initialized) return; // wait for first full refresh
    const note = this.findNote(notePath);
    if (note?.protection?.level === 'protected') {
      this.removeNote(notePath);
      return;
    }
    const previous = this.cache.get(notePath);
    if (previous) {
      for (const link of previous.outgoing) {
        this.backlinks.get(link.targetPath)?.delete(notePath);
      }
    }
    const result = await this.documents.readContent(notePath);
    if (!result.ok) {
      this.cache.delete(notePath);
      this.notify();
      return;
    }
    const links = this.parseLinks(result.value, notePath);
    this.cache.set(notePath, { outgoing: links });
    for (const link of links) {
      const set = this.backlinks.get(link.targetPath) ?? new Set();
      set.add(notePath);
      this.backlinks.set(link.targetPath, set);
    }
    this.notify();
  }

  private removeNote(notePath: string): void {
    const previous = this.cache.get(notePath);
    if (previous) {
      for (const link of previous.outgoing) {
        this.backlinks.get(link.targetPath)?.delete(notePath);
      }
    }
    this.cache.delete(notePath);
    this.backlinks.delete(notePath);
    this.notify();
  }

  private findNote(path: string): NotesListItem | null {
    return this.flatten(this.notes.getState().items)
      .find((item) => !item.isFolder && item.path === path) ?? null;
  }

  private parseLinks(content: string, sourcePath: string): RawLink[] {
    const lines = content.split(/\r?\n/);
    const out: RawLink[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Wiki-style [[note-name]] or [[note-name|display]]
      WIKILINK_RE.lastIndex = 0;
      let wm: RegExpExecArray | null;
      while ((wm = WIKILINK_RE.exec(line)) !== null) {
        const target = (wm[1] ?? '').trim();
        const display = (wm[2] ?? '').trim();
        const resolved = resolveNoteLinkTarget(target, sourcePath, this.notes.getState().items);
        if (resolved) {
          out.push({
            targetPath: resolved,
            linkText: display || target,
            context: line.trim(),
            line: i + 1,
          });
        }
      }

      // Markdown [text](path.md) links
      MD_LINK_RE.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = MD_LINK_RE.exec(line)) !== null) {
        const text = (mm[1] ?? '').trim();
        const href = (mm[2] ?? '').trim();
        if (!href || /^[a-z]+:\/\//i.test(href) || href.startsWith('#')) continue;
        const resolved = resolveNoteLinkTarget(href, sourcePath, this.notes.getState().items);
        if (resolved) {
          out.push({
            targetPath: resolved,
            linkText: text,
            context: line.trim(),
            line: i + 1,
          });
        }
      }
    }

    return out;
  }

  private titleFor(path: string): string {
    const items = this.flatten(this.notes.getState().items);
    const match = items.find((i) => !i.isFolder && i.path === path);
    if (match) return match.title;
    const filename = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
    return filename || path;
  }

  private flatten(items: NotesListItem[]): NotesListItem[] {
    const out: NotesListItem[] = [];
    const walk = (xs: NotesListItem[]) => {
      for (const x of xs) {
        out.push(x);
        if (x.children && x.children.length > 0) walk(x.children);
      }
    };
    walk(items);
    return out;
  }

  private notify(): void {
    for (const cb of this.subscribers) {
      try {
        cb();
      } catch (e) {
        console.error('RelationsService subscriber error:', e);
      }
    }
  }
}
