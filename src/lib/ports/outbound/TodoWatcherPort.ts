/**
 * TodoWatcherPort - Outbound port for file system watching
 *
 * This port defines the interface for watching markdown files for changes.
 * Used to keep the TODO cache synchronized when files are modified externally
 * (e.g., by a text editor or sync service).
 *
 * The watcher monitors:
 * - File modifications (content changes)
 * - File creation (new markdown files)
 * - File deletion (removed files)
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

/**
 * Callback function for file change events.
 */
export type FileChangeCallback = (filePath: string) => void;

/**
 * Unsubscribe function returned by event listeners.
 */
export type Unsubscribe = () => void;

/**
 * Outbound port for file system watching operations.
 *
 * Implemented by adapters that provide file watching (Tauri FS events, etc.).
 */
export interface TodoWatcherPort {
  /**
   * Start watching the notes directory for changes.
   * @param notesPath - Root path to watch for markdown files
   */
  watch(notesPath: string): Promise<void>;

  /**
   * Stop watching all paths.
   * Cleans up file watchers and releases resources.
   */
  stop(): void;

  /**
   * Register a callback for file modification events.
   * Called when an existing markdown file's content changes.
   * @param callback - Function to call with the modified file path
   * @returns Unsubscribe function to remove the listener
   */
  onFileChange(callback: FileChangeCallback): Unsubscribe;

  /**
   * Register a callback for file creation events.
   * Called when a new markdown file is created.
   * @param callback - Function to call with the created file path
   * @returns Unsubscribe function to remove the listener
   */
  onFileCreate(callback: FileChangeCallback): Unsubscribe;

  /**
   * Register a callback for file deletion events.
   * Called when a markdown file is deleted.
   * @param callback - Function to call with the deleted file path
   * @returns Unsubscribe function to remove the listener
   */
  onFileDelete(callback: FileChangeCallback): Unsubscribe;

  /**
   * Check if the watcher is currently active.
   * @returns True if watching, false otherwise
   */
  isWatching(): boolean;
}
