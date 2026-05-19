/**
 * UpdaterPort - Outbound port for app self-update.
 *
 * Implementations talk to the auto-update infrastructure (Tauri updater
 * plugin in production, in-memory mock in tests).
 *
 * Part of Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { UpdateInfo } from '$lib/ports/inbound/UpdaterService';

export interface UpdaterPort {
  /**
   * Check whether an update is available. Returns null when up to date.
   */
  check(): Promise<Result<UpdateInfo | null, Error>>;

  /**
   * Download and install the pending update.
   * Must be called only after a `check()` returned an `UpdateInfo` payload.
   */
  downloadAndInstall(): Promise<Result<void, Error>>;
}
