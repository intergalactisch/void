/**
 * Updater Service - Inbound Port
 *
 * Exposes auto-update checks and installation to the UI layer.
 * Wraps the Tauri updater plugin behind a Result-returning interface.
 *
 * Part of Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';

/**
 * Metadata for an available update.
 */
export interface UpdateInfo {
  /** Semantic version of the available release (e.g. "0.2.0"). */
  version: string;
  /** Release notes (may be empty). */
  notes: string;
  /** ISO 8601 publish date string. */
  pubDate: string;
}

export interface UpdaterService {
  /**
   * Query the configured endpoint for an available update.
   *
   * @param options.silent - When true, suppress diagnostic noise. Used by
   *   the background check on startup. Defaults to false.
   * @returns The available update info, or null if the app is up to date.
   */
  checkForUpdates(options?: { silent?: boolean }): Promise<Result<UpdateInfo | null, Error>>;

  /**
   * Download and install the pending update. The app restarts on success.
   * Must be called after a successful `checkForUpdates` that returned an
   * `UpdateInfo` payload.
   */
  installUpdate(): Promise<Result<void, Error>>;
}
