/**
 * ClipboardServiceImpl - bounded in-memory clipboard history.
 *
 * Listens for `void://clipboard-changed` events from the Rust watcher,
 * deduplicates by hash, caps the ring at MAX_ENTRIES. The system-clipboard
 * write path is delegated to a callback so this service stays free of
 * direct Tauri imports — bootstrap wires the actual Tauri write impl.
 */

import type {
  ClipboardService,
  ClipboardEntry,
} from '$lib/ports/inbound/ClipboardService';

const MAX_ENTRIES = 50;

export interface ClipboardWatcherEvent {
  text: string;
  hash: string;
  length: number;
}

export interface ClipboardWriter {
  write(text: string): Promise<void>;
}

export interface ClipboardWatcher {
  subscribe(callback: (event: ClipboardWatcherEvent) => void): () => void;
}

export class ClipboardServiceImpl implements ClipboardService {
  private entries: ClipboardEntry[] = [];
  private subscribers = new Set<(entries: ClipboardEntry[]) => void>();
  private idCounter = 0;
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly watcher: ClipboardWatcher,
    private readonly writer: ClipboardWriter
  ) {
    this.unwatch = this.watcher.subscribe((event) => this.handleEvent(event));
  }

  getHistory(): ClipboardEntry[] {
    return this.entries.slice();
  }

  subscribe(callback: (entries: ClipboardEntry[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getHistory());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }

  remove(id: string): void {
    const next = this.entries.filter((entry) => entry.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.notify();
  }

  async copyToSystem(entry: ClipboardEntry): Promise<void> {
    await this.writer.write(entry.text);
    // Re-emit so the entry is at the top of the history (and the watcher
    // dedupe doesn't drop it because we just wrote what's already there).
    this.handleEvent({
      text: entry.text,
      hash: entry.hash,
      length: entry.length,
    });
  }

  /** Tear down event subscription — used in tests. */
  destroy(): void {
    this.unwatch?.();
    this.unwatch = null;
    this.entries = [];
    this.subscribers.clear();
  }

  private handleEvent(event: ClipboardWatcherEvent): void {
    if (!event.text || !event.text.trim()) return;

    // Dedupe: if the most recent entry has the same hash, just refresh
    // its timestamp so the history reflects "this was the most recent
    // copy" without creating a duplicate row.
    const head = this.entries[0];
    if (head && head.hash === event.hash) {
      head.capturedAt = Date.now();
      this.notify();
      return;
    }

    // Same hash further down → drop the older entry to avoid duplicates.
    const dedup = this.entries.filter((entry) => entry.hash !== event.hash);

    const next: ClipboardEntry = {
      id: `clip-${Date.now()}-${++this.idCounter}`,
      text: event.text,
      hash: event.hash,
      capturedAt: Date.now(),
      length: event.length,
    };
    this.entries = [next, ...dedup].slice(0, MAX_ENTRIES);
    this.notify();
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.getHistory();
    for (const cb of this.subscribers) {
      try {
        cb(snapshot);
      } catch (e) {
        console.error('ClipboardService subscriber error:', e);
      }
    }
  }
}
