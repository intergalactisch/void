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
import type { UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound/UpdaterService';

export class MemoryUpdaterAdapter implements UpdaterPort {
  private next: UpdateInfo | null = null;
  private current = '0.1.1';
  private installCalls = 0;
  private restartCalls = 0;
  private installFailure: Error | null = null;

  async currentVersion(): Promise<Result<string, Error>> {
    return ok(this.current);
  }

  async check(): Promise<Result<UpdateInfo | null, Error>> {
    return ok(this.next);
  }

  async downloadAndInstall(onEvent?: (event: UpdateInstallEvent) => void): Promise<Result<void, Error>> {
    if (!this.next) {
      return err(new Error('No pending update — call check() first.'));
    }
    if (this.installFailure) {
      return err(this.installFailure);
    }
    onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
    onEvent?.({ event: 'Finished' });
    this.installCalls += 1;
    this.next = null;
    return ok(undefined);
  }

  async restart(): Promise<Result<void, Error>> {
    this.restartCalls += 1;
    return ok(undefined);
  }

  // --- Testing utilities ---

  seed(update: UpdateInfo | null): void {
    this.next = update;
  }

  setCurrentVersion(version: string): void {
    this.current = version;
  }

  failInstall(error: Error | null): void {
    this.installFailure = error;
  }

  getInstallCount(): number {
    return this.installCalls;
  }

  getRestartCount(): number {
    return this.restartCalls;
  }
}
