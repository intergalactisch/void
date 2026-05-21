/**
 * Updater Service - Inbound Port
 *
 * Exposes update checks, installation, and restart control to the UI layer.
 * Wraps the app-owned updater backend behind a Result-returning interface.
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
  /** Semantic version currently running. */
  currentVersion: string;
  /** Release notes (may be empty). */
  notes: string;
  /** ISO 8601 publish date string. */
  pubDate: string;
}

export type UpdateInstallEvent =
  | { event: 'Started'; data: { contentLength: number | null } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished'; data?: never };

export interface UpdaterService {
  /**
   * Return the version currently running.
   */
  getCurrentVersion(): Promise<Result<string, Error>>;

  /**
   * Query the configured endpoint for an available update.
   *
   * @param options.silent - When true, suppress diagnostic noise. Used by
   *   the background check on startup. Defaults to false.
   * @returns The available update info, or null if the app is up to date.
   */
  checkForUpdates(options?: { silent?: boolean }): Promise<Result<UpdateInfo | null, Error>>;

  /**
   * Download and install the pending update. The caller decides when to restart.
   * Must be called after a successful `checkForUpdates` that returned an
   * `UpdateInfo` payload.
   */
  installUpdate(onEvent?: (event: UpdateInstallEvent) => void): Promise<Result<void, Error>>;

  /**
   * Restart the app after an installed update.
   */
  restartApp(): Promise<Result<void, Error>>;
}
