/**
 * TauriUpdaterAdapter - Secondary adapter for Void updater commands.
 *
 * Implements UpdaterPort by delegating to narrow Void-owned Tauri commands.
 * The Rust side owns the pending update and the updater configuration.
 *
 * Part of Hexagonal Architecture - bridges UpdaterPort to Tauri infrastructure.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { UpdaterPort } from '$lib/ports/outbound';
import type { UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound/UpdaterService';
import { updaterCommands } from './commands';

export class TauriUpdaterAdapter implements UpdaterPort {
  async currentVersion(): Promise<Result<string, Error>> {
    try {
      return ok(await updaterCommands.currentVersion());
    } catch (e) {
      return err(toError(e));
    }
  }

  async check(): Promise<Result<UpdateInfo | null, Error>> {
    try {
      return ok(await updaterCommands.check());
    } catch (e) {
      return err(toError(e));
    }
  }

  async downloadAndInstall(onEvent?: (event: UpdateInstallEvent) => void): Promise<Result<void, Error>> {
    try {
      await updaterCommands.install(onEvent);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async restart(): Promise<Result<void, Error>> {
    try {
      await updaterCommands.restart();
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }
}
