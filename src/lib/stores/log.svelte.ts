/**
 * Log Store - Primary Adapter for structured logging UI.
 *
 * Svelte 5 store that connects the LogPanel UI to the LoggerPort.
 * Maintains reactive state for filtered/searched entries.
 */

import type { LoggerPort } from '$lib/ports/outbound/LoggerPort';
import type { LogEntry, LogLevel } from '$lib/domain/values/LogEntry';

class LogStore {
  #logger: LoggerPort | null = null;
  #unsubscribe: (() => void) | null = null;

  entries = $state<LogEntry[]>([]);
  isOpen = $state(false);
  filter = $state<LogLevel | 'all'>('all');
  search = $state('');

  /**
   * Initialize the store with a LoggerPort instance.
   */
  init(logger: LoggerPort) {
    // Clean up previous subscription
    if (this.#unsubscribe) {
      this.#unsubscribe();
    }

    this.#logger = logger;

    // Load existing entries
    this.entries = logger.getEntries();

    // Subscribe to new entries
    this.#unsubscribe = logger.subscribe((entry) => {
      this.entries = [...this.entries, entry];
    });
  }

  toggle() {
    this.isOpen = !this.isOpen;
  }

  setFilter(level: LogLevel | 'all') {
    this.filter = level;
  }

  setSearch(query: string) {
    this.search = query;
  }

  clear() {
    this.#logger?.clear();
    this.entries = [];
  }

  get filteredEntries(): LogEntry[] {
    let result = this.entries;

    if (this.filter !== 'all') {
      const level = this.filter;
      result = result.filter((e) => e.level === level);
    }

    if (this.search) {
      const q = this.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q) ||
          (e.metadata && JSON.stringify(e.metadata).toLowerCase().includes(q))
      );
    }

    return result;
  }

  get errorCount(): number {
    return this.entries.filter((e) => e.level === 'error').length;
  }

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#logger !== null;
  }
}

export const logStore = new LogStore();
