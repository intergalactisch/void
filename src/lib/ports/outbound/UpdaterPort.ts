/**
 * UpdaterPort - Outbound port for app self-update.
 *
 * Implementations talk to the app-update infrastructure (Void-owned Tauri
 * commands in production, in-memory mock in tests).
 *
 * Part of Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound/UpdaterService';

export interface UpdaterPort {
  /**
   * Return the version currently running.
   */
  currentVersion(): Promise<Result<string, Error>>;

  /**
   * Check whether an update is available. Returns null when up to date.
   */
  check(): Promise<Result<UpdateInfo | null, Error>>;

  /**
   * Download and install the pending update.
   * Must be called only after a `check()` returned an `UpdateInfo` payload.
   */
  downloadAndInstall(onEvent?: (event: UpdateInstallEvent) => void): Promise<Result<void, Error>>;

  /**
   * Restart the app once an installed update is ready to apply.
   */
  restart(): Promise<Result<void, Error>>;
}
