/**
 * TauriTodoWatcher - File watcher using Tauri's event system
 *
 * Implements TodoWatcherPort to watch for changes in markdown files.
 * Uses Tauri's event listener API to receive file change notifications
 * from the Rust backend.
 *
 * Note: This implementation requires a corresponding Rust command or
 * file watcher in the Tauri backend that emits events when files change.
 * Until the fs-watch plugin is added, this uses a polling fallback.
 *
 * Features:
 * - Watch notes directory for markdown changes
 * - Filter for .md files only
 * - Debounce rapid changes (100ms)
 * - Typed event callbacks
 *
 * Part of the Hexagonal Architecture adapter layer.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { events } from '$lib/events';
import type {
  TodoWatcherPort,
  FileChangeCallback,
  Unsubscribe,
} from '$lib/ports/outbound/TodoWatcherPort';

/**
 * Debounce delay in milliseconds for file change events.
 * Prevents rapid-fire updates when files are being edited.
 */
const DEBOUNCE_DELAY_MS = 100;

/**
 * Event payload from the Rust file watcher.
 * Emitted on the `void://file-changed` channel.
 */
interface FileChangedPayload {
  watcherId: string;
  path: string;
  kind: 'create' | 'modify' | 'remove' | 'rename' | 'other';
}

const RUST_FILE_CHANGED_EVENT = 'void://file-changed';
const NOTES_WATCHER_ID = 'void-notes-dir';

/**
 * TauriTodoWatcher implementation of TodoWatcherPort.
 *
 * Listens for file change events from the Tauri backend.
 */
export class TauriTodoWatcher implements TodoWatcherPort {
  /** Tauri event unlisten function */
  private unlistenFn: UnlistenFn | null = null;

  /** Currently watching flag */
  private watching = false;

  /** Path being watched */
  private watchPath: string | null = null;

  /** Registered callbacks for file changes */
  private changeCallbacks: Set<FileChangeCallback> = new Set();

  /** Registered callbacks for file creation */
  private createCallbacks: Set<FileChangeCallback> = new Set();

  /** Registered callbacks for file deletion */
  private deleteCallbacks: Set<FileChangeCallback> = new Set();

  /** Debounce timers keyed by file path */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Start watching the notes directory for markdown file changes.
   *
   * This sets up a listener for 'fs:watch' events from the Tauri backend.
   * The backend is responsible for setting up the actual file system watcher
   * and emitting events through Tauri's event system.
   */
  async watch(notesPath: string): Promise<void> {
    if (this.watching) {
      // Already watching, stop first
      await this.stopAsync();
    }

    this.watchPath = notesPath;

    try {
      // Subscribe to the Rust watcher's debounced events first so we
      // don't miss anything fired between starting the watcher and
      // hooking up the listener.
      this.unlistenFn = await listen<FileChangedPayload>(
        RUST_FILE_CHANGED_EVENT,
        (event) => {
          // eslint-disable-next-line no-console
          console.info('[TauriTodoWatcher] received file event', event.payload);
          this.handleWatchEvent(event.payload);
          // Re-emit on the typed event bus so non-todo subscribers
          // (EditorService, future indexers) can react too.
          events.emit('file:changed', {
            path: event.payload.path,
            kind: event.payload.kind,
          });
        },
      );

      // Now ask the Rust backend to start watching.
      await invoke('watch_directory', {
        path: notesPath,
        watcherId: NOTES_WATCHER_ID,
      });

      // eslint-disable-next-line no-console
      console.info('[TauriTodoWatcher] watching', notesPath);

      this.watching = true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[TauriTodoWatcher] Failed to start watching:', error);
      // Clean up partial state if we got the listener but not the
      // watcher (or vice versa).
      if (this.unlistenFn) {
        this.unlistenFn();
        this.unlistenFn = null;
      }
      throw error;
    }
  }

  /** Internal stop helper that also unwinds the Rust watcher. */
  private async stopAsync(): Promise<void> {
    this.stop();
    try {
      await invoke('unwatch_directory', { watcherId: NOTES_WATCHER_ID });
    } catch {
      // Best-effort — registry might already be empty.
    }
  }

  /**
   * Stop watching all paths.
   */
  stop(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watching) {
      // Best-effort unwatch — fire and forget, registry will GC if any error.
      invoke('unwatch_directory', { watcherId: NOTES_WATCHER_ID }).catch(() => undefined);
    }

    this.watching = false;
    this.watchPath = null;
  }

  /** Container `Disposable` hook — same as stop(). */
  dispose(): void {
    this.stop();
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

  /**
   * Handle a debounced file change from the Rust watcher.
   */
  private handleWatchEvent(event: FileChangedPayload): void {
    const filePath = event.path;
    if (!filePath) return;

    // Todo callbacks only care about markdown files.
    if (!this.isMarkdownFile(filePath)) return;

    // Restrict to the watched directory; the Rust watcher is recursive
    // but we don't want extraneous events sneaking in.
    if (this.watchPath && !this.isInWatchedDirectory(filePath)) return;

    // Already debounced upstream by notify-debouncer-full; the second
    // debounce here is the legacy in-process one and remains as a
    // safety net for tests that synthesize events directly.
    this.debouncedEmit(filePath, event.kind);
  }

  /**
   * Check if a file path is a markdown file.
   */
  private isMarkdownFile(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase();
    return normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown');
  }

  /**
   * Check if a file path is within the watched directory.
   */
  private isInWatchedDirectory(filePath: string): boolean {
    if (!this.watchPath) return true;

    // Normalize paths for comparison
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedWatch = this.watchPath.replace(/\\/g, '/');

    return normalizedFile.startsWith(normalizedWatch);
  }

  /**
   * Emit event with debouncing to prevent rapid-fire updates.
   */
  private debouncedEmit(filePath: string, eventType: string): void {
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.emitEvent(filePath, eventType);
    }, DEBOUNCE_DELAY_MS);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Emit the appropriate event to registered callbacks.
   */
  private emitEvent(filePath: string, eventType: string): void {
    // Normalize event type
    const normalizedType = this.normalizeEventType(eventType);

    switch (normalizedType) {
      case 'change':
        for (const callback of this.changeCallbacks) {
          try {
            callback(filePath);
          } catch (error) {
            console.error('[TauriTodoWatcher] Change callback error:', error);
          }
        }
        break;

      case 'create':
        for (const callback of this.createCallbacks) {
          try {
            callback(filePath);
          } catch (error) {
            console.error('[TauriTodoWatcher] Create callback error:', error);
          }
        }
        break;

      case 'delete':
        for (const callback of this.deleteCallbacks) {
          try {
            callback(filePath);
          } catch (error) {
            console.error('[TauriTodoWatcher] Delete callback error:', error);
          }
        }
        break;
    }
  }

  /**
   * Normalize event type strings.
   */
  private normalizeEventType(eventType: string): 'change' | 'create' | 'delete' | 'unknown' {
    const lower = eventType.toLowerCase();

    if (
      lower.includes('modify') ||
      lower.includes('change') ||
      lower.includes('write') ||
      lower === 'update'
    ) {
      return 'change';
    }

    if (
      lower.includes('create') ||
      lower.includes('add') ||
      lower === 'new'
    ) {
      return 'create';
    }

    if (
      lower.includes('delete') ||
      lower.includes('remove') ||
      lower === 'unlink'
    ) {
      return 'delete';
    }

    // Default to change for unknown events
    return 'change';
  }
}

/**
 * Create a new TauriTodoWatcher instance.
 */
export function createTauriTodoWatcher(): TodoWatcherPort {
  return new TauriTodoWatcher();
}
