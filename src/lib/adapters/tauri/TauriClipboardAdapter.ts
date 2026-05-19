/**
 * Tauri clipboard adapter
 *
 * Bridges the Rust-side `void://clipboard-changed` event to the frontend
 * `ClipboardService` and provides a `write` operation backed by the
 * browser's clipboard API (Tauri webview supports `navigator.clipboard`).
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ClipboardWatcher,
  ClipboardWatcherEvent,
  ClipboardWriter,
} from '$lib/application/services/ClipboardServiceImpl';

interface RustPayload {
  text: string;
  hash: string;
  length: number;
}

export class TauriClipboardWatcher implements ClipboardWatcher {
  subscribe(callback: (event: ClipboardWatcherEvent) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    void listen<RustPayload>('void://clipboard-changed', (event) => {
      callback({
        text: event.payload.text,
        hash: event.payload.hash,
        length: event.payload.length,
      });
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }
}

export class TauriClipboardWriter implements ClipboardWriter {
  async write(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }
}

/** Memory adapters used by the browser-only dev/test path. */
export class MemoryClipboardWatcher implements ClipboardWatcher {
  private subscribers = new Set<(event: ClipboardWatcherEvent) => void>();

  subscribe(callback: (event: ClipboardWatcherEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Test helper — push a fake clipboard event. */
  emit(event: ClipboardWatcherEvent): void {
    for (const cb of this.subscribers) cb(event);
  }
}

export class MemoryClipboardWriter implements ClipboardWriter {
  written: string[] = [];
  async write(text: string): Promise<void> {
    this.written.push(text);
  }
}
