/**
 * ClipboardService - Inbound port for the in-app clipboard history.
 *
 * The Rust-side `clipboard_watcher` polls the system pasteboard and emits
 * `void://clipboard-changed` events. This service collects those events
 * into a bounded history with newest-first ordering and exposes search +
 * paste APIs to the UI.
 *
 * In-memory only by design — clipboards routinely contain sensitive data
 * (passwords, tokens) and we don't want that on disk without explicit
 * opt-in. A future preference can promote items to persistent pinned
 * entries without changing this contract.
 */

export interface ClipboardEntry {
  /** Stable id for keyed renders. */
  id: string;
  /** The captured text. */
  text: string;
  /** Hash from the Rust watcher — used to dedupe against the most recent. */
  hash: string;
  /** Wall-clock capture time (ms since epoch). */
  capturedAt: number;
  /** Character length (clamped on the Rust side). */
  length: number;
}

export interface ClipboardService {
  /** Subscribe to history changes. Returns unsubscribe. */
  subscribe(callback: (entries: ClipboardEntry[]) => void): () => void;

  /** Read the current history newest-first. */
  getHistory(): ClipboardEntry[];

  /** Clear the entire history. */
  clear(): void;

  /** Remove a single entry by id. */
  remove(id: string): void;

  /**
   * Place an entry back on the system clipboard. Useful when the user
   * wants to restore an older entry to the OS clipboard for pasting in
   * another application.
   */
  copyToSystem(entry: ClipboardEntry): Promise<void>;
}
