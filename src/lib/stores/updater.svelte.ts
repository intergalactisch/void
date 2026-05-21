/**
 * Updater Store - Primary Adapter
 *
 * Holds app-update UI state while delegating all update operations to the
 * UpdaterService inbound port.
 */

import type { Result } from '$lib/core';
import type { UpdateInfo, UpdateInstallEvent, UpdaterService } from '$lib/ports/inbound';

class UpdaterStore {
  #service: UpdaterService | null = null;

  currentVersion = $state<string | null>(null);
  availableUpdate = $state<UpdateInfo | null>(null);
  lastCheckedAt = $state<string | null>(null);
  checking = $state(false);
  installing = $state(false);
  restarting = $state(false);
  restartRequired = $state(false);
  error = $state<Error | null>(null);
  downloadedBytes = $state(0);
  contentLength = $state<number | null>(null);

  init(service: UpdaterService) {
    this.#service = service;
  }

  get isInitialized(): boolean {
    return this.#service !== null;
  }

  get installProgress(): number | null {
    if (!this.contentLength || this.contentLength <= 0) return null;
    return Math.min(100, Math.round((this.downloadedBytes / this.contentLength) * 100));
  }

  async loadCurrentVersion(): Promise<Result<string, Error>> {
    if (!this.#service) throw new Error('UpdaterStore not initialized');
    const result = await this.#service.getCurrentVersion();
    if (result.ok) {
      this.currentVersion = result.value;
    } else {
      this.error = result.error;
    }
    return result;
  }

  async checkForUpdates(options: { silent?: boolean } = {}): Promise<Result<UpdateInfo | null, Error>> {
    if (!this.#service) throw new Error('UpdaterStore not initialized');
    this.checking = true;
    if (!options.silent) {
      this.error = null;
    }

    const result = await this.#service.checkForUpdates(options);
    if (result.ok) {
      this.availableUpdate = result.value;
      this.lastCheckedAt = new Date().toISOString();
      if (result.value?.currentVersion) {
        this.currentVersion = result.value.currentVersion;
      }
      if (!result.value) {
        this.restartRequired = false;
      }
    } else if (!options.silent) {
      this.error = result.error;
    }

    this.checking = false;
    return result;
  }

  async installUpdate(): Promise<Result<void, Error>> {
    if (!this.#service) throw new Error('UpdaterStore not initialized');
    this.installing = true;
    this.error = null;
    this.downloadedBytes = 0;
    this.contentLength = null;

    const result = await this.#service.installUpdate((event) => this.handleInstallEvent(event));
    if (result.ok) {
      if (this.contentLength !== null) {
        this.downloadedBytes = this.contentLength;
      }
      this.restartRequired = true;
    } else {
      this.error = result.error;
    }

    this.installing = false;
    return result;
  }

  async restartApp(): Promise<Result<void, Error>> {
    if (!this.#service) throw new Error('UpdaterStore not initialized');
    this.restarting = true;
    this.error = null;

    const result = await this.#service.restartApp();
    if (!result.ok) {
      this.error = result.error;
      this.restarting = false;
    }
    return result;
  }

  dismissRestartPrompt(): void {
    this.restartRequired = false;
  }

  resetState(): void {
    this.currentVersion = null;
    this.availableUpdate = null;
    this.lastCheckedAt = null;
    this.checking = false;
    this.installing = false;
    this.restarting = false;
    this.restartRequired = false;
    this.error = null;
    this.downloadedBytes = 0;
    this.contentLength = null;
  }

  private handleInstallEvent(event: UpdateInstallEvent): void {
    switch (event.event) {
      case 'Started':
        this.contentLength = event.data.contentLength;
        this.downloadedBytes = 0;
        break;
      case 'Progress':
        this.downloadedBytes += event.data.chunkLength;
        break;
      case 'Finished':
        if (this.contentLength !== null) {
          this.downloadedBytes = this.contentLength;
        }
        break;
    }
  }
}

export const updaterStore = new UpdaterStore();
