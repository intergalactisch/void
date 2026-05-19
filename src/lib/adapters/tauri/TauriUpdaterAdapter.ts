/**
 * TauriUpdaterAdapter - Secondary adapter for the Tauri updater plugin.
 *
 * Implements UpdaterPort by delegating to `@tauri-apps/plugin-updater`.
 * Caches the last `check()` result so a subsequent `downloadAndInstall()`
 * does not need to re-query the endpoint.
 *
 * Part of Hexagonal Architecture - bridges UpdaterPort to Tauri infrastructure.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { UpdaterPort } from '$lib/ports/outbound';
import type { UpdateInfo } from '$lib/ports/inbound/UpdaterService';
import type { Update } from '@tauri-apps/plugin-updater';

export class TauriUpdaterAdapter implements UpdaterPort {
  private pending: Update | null = null;

  async check(): Promise<Result<UpdateInfo | null, Error>> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) {
        this.pending = null;
        return ok(null);
      }
      this.pending = update;
      return ok({
        version: update.version,
        notes: update.body ?? '',
        pubDate: update.date ?? '',
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  async downloadAndInstall(): Promise<Result<void, Error>> {
    const update = this.pending;
    if (!update) {
      return err(new Error('No pending update — call check() first.'));
    }
    try {
      await update.downloadAndInstall();
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }
}
