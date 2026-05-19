/**
 * LoggerPort - Outbound port for structured logging.
 *
 * Handles both in-memory ring buffer (for UI) and optional file persistence.
 * Part of the Hexagonal Architecture - adapters implement this interface.
 *
 * Implementations:
 * - MemoryLoggerAdapter: Ring buffer only, no file writes (for testing/browser)
 * - TauriLoggerAdapter: Ring buffer + JSONL file persistence
 */

import type { LogEntry } from '$lib/domain/values/LogEntry';

export interface LoggerPort {
  /** Add a log entry */
  log(entry: LogEntry): void;
  /** Get all entries in the ring buffer */
  getEntries(): LogEntry[];
  /** Clear all entries */
  clear(): void;
  /** Flush pending entries to disk (no-op for memory adapter) */
  flush(): Promise<void>;
  /** Subscribe to new entries. Returns unsubscribe function. */
  subscribe(callback: (entry: LogEntry) => void): () => void;
}
