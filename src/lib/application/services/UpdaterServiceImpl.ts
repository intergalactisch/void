/**
 * UpdaterServiceImpl - Application service for app self-update.
 *
 * Thin orchestrator that delegates to an UpdaterPort. The adapter holds
 * any pending-update state needed to chain check → install.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { Result } from '$lib/core';
import type { UpdaterService, UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound';
import type { UpdaterPort } from '$lib/ports/outbound';

export class UpdaterServiceImpl implements UpdaterService {
  constructor(private updater: UpdaterPort) {}

  async getCurrentVersion(): Promise<Result<string, Error>> {
    return this.updater.currentVersion();
  }

  async checkForUpdates(
    _options?: { silent?: boolean }
  ): Promise<Result<UpdateInfo | null, Error>> {
    return this.updater.check();
  }

  async installUpdate(onEvent?: (event: UpdateInstallEvent) => void): Promise<Result<void, Error>> {
    return this.updater.downloadAndInstall(onEvent);
  }

  async restartApp(): Promise<Result<void, Error>> {
    return this.updater.restart();
  }
}
