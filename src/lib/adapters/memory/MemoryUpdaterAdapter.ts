/**
 * MemoryUpdaterAdapter - In-memory implementation of UpdaterPort.
 *
 * Always reports "up to date" so browser dev mode and tests do not call
 * the network or the Tauri plugin. Tests can seed an update via `seed()`.
 *
 * Part of Hexagonal Architecture - Secondary Adapters layer.
 */

import { ok, err, type Result } from '$lib/core';
import type { UpdaterPort } from '$lib/ports/outbound';
import type { UpdateInfo } from '$lib/ports/inbound/UpdaterService';

export class MemoryUpdaterAdapter implements UpdaterPort {
  private next: UpdateInfo | null = null;
  private installCalls = 0;

  async check(): Promise<Result<UpdateInfo | null, Error>> {
    return ok(this.next);
  }

  async downloadAndInstall(): Promise<Result<void, Error>> {
    if (!this.next) {
      return err(new Error('No pending update — call check() first.'));
    }
    this.installCalls += 1;
    return ok(undefined);
  }

  // --- Testing utilities ---

  seed(update: UpdateInfo | null): void {
    this.next = update;
  }

  getInstallCount(): number {
    return this.installCalls;
  }
}
