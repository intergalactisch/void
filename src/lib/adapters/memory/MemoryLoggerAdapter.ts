/**
 * MemoryLoggerAdapter - In-memory logger for testing and browser-only dev.
 *
 * Ring buffer only, no file writes. flush() is a no-op.
 */

import type { LogEntry } from '$lib/domain/values/LogEntry';
import type { LoggerPort } from '$lib/ports/outbound/LoggerPort';

const MAX_ENTRIES = 1000;

export class MemoryLoggerAdapter implements LoggerPort {
  private entries: LogEntry[] = [];
  private subscribers = new Set<(entry: LogEntry) => void>();

  log(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    for (const cb of this.subscribers) {
      cb(entry);
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  async flush(): Promise<void> {
    // No-op for memory adapter
  }

  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}
