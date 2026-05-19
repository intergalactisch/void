/**
 * Clipboard store - reactive view over ClipboardService.
 */

import type {
  ClipboardService,
  ClipboardEntry,
} from '$lib/ports/inbound/ClipboardService';

class ClipboardStore {
  private service: ClipboardService | null = null;
  private unsubscribe: (() => void) | null = null;

  history = $state<ClipboardEntry[]>([]);

  init(service: ClipboardService): void {
    if (this.service === service) return;
    this.unsubscribe?.();
    this.service = service;
    this.unsubscribe = service.subscribe((entries) => {
      this.history = entries;
    });
  }

  async copyToSystem(entry: ClipboardEntry): Promise<void> {
    await this.service?.copyToSystem(entry);
  }

  remove(id: string): void {
    this.service?.remove(id);
  }

  clear(): void {
    this.service?.clear();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.service = null;
    this.history = [];
  }
}

export const clipboardStore = new ClipboardStore();
