/**
 * TauriLoggerAdapter - File-backed logger with ring buffer for UI.
 *
 * - Ring buffer (cap 1000 entries) for real-time UI display
 * - JSONL file persistence, flushed every 2s or at 50 pending entries
 * - Writes to {logDir}/void-{date}.jsonl
 * - Uses FileSystemPort for I/O
 */

import type { LogEntry } from '$lib/domain/values/LogEntry';
import type { LoggerPort } from '$lib/ports/outbound/LoggerPort';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';

const MAX_ENTRIES = 1000;
const FLUSH_INTERVAL = 2000;
const FLUSH_THRESHOLD = 50;

export class TauriLoggerAdapter implements LoggerPort {
  private entries: LogEntry[] = [];
  private pendingWrites: LogEntry[] = [];
  private subscribers = new Set<(entry: LogEntry) => void>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fs: FileSystemPort;
  private readonly logDir: string;
  private dirCreated = false;

  constructor(fs: FileSystemPort, logDir: string) {
    this.fs = fs;
    this.logDir = logDir;
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
  }

  log(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    this.pendingWrites.push(entry);

    for (const cb of this.subscribers) {
      cb(entry);
    }

    if (this.pendingWrites.length >= FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.pendingWrites = [];
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) return;

    const toWrite = this.pendingWrites.splice(0);
    const lines = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';

    try {
      if (!this.dirCreated) {
        await this.fs.createDirectory(this.logDir);
        this.dirCreated = true;
      }

      const date = new Date().toISOString().slice(0, 10);
      const filePath = `${this.logDir}/void-${date}.jsonl`;

      // Read existing content and append
      const existing = await this.fs.readFile(filePath);
      const content = existing.ok ? existing.value + lines : lines;
      await this.fs.writeFile(filePath, content);
    } catch {
      // Logging should never crash the app - silently drop on failure
    }
  }

  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Stop the flush timer (for cleanup) */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** Container `Disposable` hook — same as destroy(), awaits final flush. */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
