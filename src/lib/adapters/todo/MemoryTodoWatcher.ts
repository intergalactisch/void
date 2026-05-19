/**
 * MemoryTodoWatcher - In-memory file watcher for testing
 *
 * Implements TodoWatcherPort without any actual file system watching.
 * Provides manual trigger methods to simulate file changes in tests.
 *
 * Features:
 * - No external dependencies
 * - Manual simulation of file events
 * - Callback registration/unregistration
 * - Useful for unit testing todo services
 *
 * Part of the Hexagonal Architecture adapter layer (testing).
 */

import type {
  TodoWatcherPort,
  FileChangeCallback,
  Unsubscribe,
} from '$lib/ports/outbound/TodoWatcherPort';

/**
 * MemoryTodoWatcher implementation for testing.
 *
 * Does not actually watch the file system. Instead, provides
 * methods to manually simulate file change events.
 */
export class MemoryTodoWatcher implements TodoWatcherPort {
  /** Currently watching flag */
  private watching = false;

  /** Path being "watched" */
  private watchPath: string | null = null;

  /** Registered callbacks for file changes */
  private changeCallbacks: Set<FileChangeCallback> = new Set();

  /** Registered callbacks for file creation */
  private createCallbacks: Set<FileChangeCallback> = new Set();

  /** Registered callbacks for file deletion */
  private deleteCallbacks: Set<FileChangeCallback> = new Set();

  /**
   * Start "watching" the notes directory (no-op for memory implementation).
   */
  async watch(notesPath: string): Promise<void> {
    this.watching = true;
    this.watchPath = notesPath;
  }

  /**
   * Stop "watching" (no-op for memory implementation).
   */
  stop(): void {
    this.watching = false;
    this.watchPath = null;
  }

  /**
   * Register a callback for file modification events.
   */
  onFileChange(callback: FileChangeCallback): Unsubscribe {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback for file creation events.
   */
  onFileCreate(callback: FileChangeCallback): Unsubscribe {
    this.createCallbacks.add(callback);
    return () => {
      this.createCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback for file deletion events.
   */
  onFileDelete(callback: FileChangeCallback): Unsubscribe {
    this.deleteCallbacks.add(callback);
    return () => {
      this.deleteCallbacks.delete(callback);
    };
  }

  /**
   * Check if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.watching;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test Helpers - Methods to simulate file system events
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Simulate a file change event.
   * Triggers all registered change callbacks.
   *
   * @param filePath - Path to the "changed" file
   */
  simulateChange(filePath: string): void {
    if (!this.watching) return;

    for (const callback of this.changeCallbacks) {
      try {
        callback(filePath);
      } catch (error) {
        console.error('[MemoryTodoWatcher] Change callback error:', error);
      }
    }
  }

  /**
   * Simulate a file creation event.
   * Triggers all registered create callbacks.
   *
   * @param filePath - Path to the "created" file
   */
  simulateCreate(filePath: string): void {
    if (!this.watching) return;

    for (const callback of this.createCallbacks) {
      try {
        callback(filePath);
      } catch (error) {
        console.error('[MemoryTodoWatcher] Create callback error:', error);
      }
    }
  }

  /**
   * Simulate a file deletion event.
   * Triggers all registered delete callbacks.
   *
   * @param filePath - Path to the "deleted" file
   */
  simulateDelete(filePath: string): void {
    if (!this.watching) return;

    for (const callback of this.deleteCallbacks) {
      try {
        callback(filePath);
      } catch (error) {
        console.error('[MemoryTodoWatcher] Delete callback error:', error);
      }
    }
  }

  /**
   * Get the path currently being "watched".
   * Useful for test assertions.
   */
  getWatchPath(): string | null {
    return this.watchPath;
  }

  /**
   * Get the count of registered callbacks.
   * Useful for test assertions.
   */
  getCallbackCounts(): {
    change: number;
    create: number;
    delete: number;
  } {
    return {
      change: this.changeCallbacks.size,
      create: this.createCallbacks.size,
      delete: this.deleteCallbacks.size,
    };
  }

  /**
   * Clear all registered callbacks.
   * Useful for test cleanup.
   */
  clearCallbacks(): void {
    this.changeCallbacks.clear();
    this.createCallbacks.clear();
    this.deleteCallbacks.clear();
  }

  /**
   * Reset the watcher to initial state.
   * Stops watching and clears all callbacks.
   */
  reset(): void {
    this.stop();
    this.clearCallbacks();
  }
}

/**
 * Create a new MemoryTodoWatcher instance.
 */
export function createMemoryTodoWatcher(): MemoryTodoWatcher {
  return new MemoryTodoWatcher();
}
