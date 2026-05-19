/**
 * Keymap store - reactive view over KeymapService for the Settings UI and
 * the ShortcutSheet. Exposes bindings, conflicts, and chord-record state.
 *
 * Primary adapter: stays thin and delegates all logic to the service.
 */

import type { KeymapService, KeyBinding, KeyConflict } from '$lib/ports/inbound/KeymapService';
import type { KeyChord } from '$lib/domain/values/KeyChord';

class KeymapStore {
  private service: KeymapService | null = null;
  private unsubscribe: (() => void) | null = null;

  bindings = $state<KeyBinding[]>([]);
  conflicts = $state<KeyConflict[]>([]);
  ready = $state(false);

  /** Wire to a KeymapService instance. Idempotent. */
  init(service: KeymapService): void {
    if (this.service === service) return;
    this.unsubscribe?.();
    this.service = service;
    this.unsubscribe = service.subscribe((bindings) => {
      this.bindings = bindings;
      this.conflicts = service.findConflicts();
    });
    this.ready = service.isReady();
  }

  /** Mark service as ready (used after KeymapService.load() resolves). */
  markReady(): void {
    this.ready = true;
  }

  /** Apply a user override for the given command. */
  async setOverride(commandId: string, chord: KeyChord) {
    if (!this.service) return;
    await this.service.setOverride(commandId, chord);
  }

  /** Restore the default for the given command. */
  async clearOverride(commandId: string) {
    if (!this.service) return;
    await this.service.clearOverride(commandId);
  }

  /** Tear down subscription. Used in tests / hot reload. */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.service = null;
    this.bindings = [];
    this.conflicts = [];
    this.ready = false;
  }
}

export const keymapStore = new KeymapStore();
