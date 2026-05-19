/**
 * Relations store - reactive view over RelationsService.
 *
 * Backlinks (incoming) and outgoing links for the active note. Re-fetches
 * whenever the active note changes or the underlying graph notifies of a
 * change (note saved / deleted / renamed).
 */

import type { RelationsService, NoteLink } from '$lib/ports/inbound/RelationsService';

class RelationsStore {
  private service: RelationsService | null = null;
  private serviceUnsubscribe: (() => void) | null = null;

  backlinks = $state<NoteLink[]>([]);
  outgoing = $state<NoteLink[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);
  activePath = $state<string | null>(null);

  init(service: RelationsService): void {
    if (this.service === service) return;
    this.serviceUnsubscribe?.();
    this.service = service;
    this.serviceUnsubscribe = service.subscribe(() => {
      // Graph changed — refetch for the currently focused note.
      if (this.activePath) {
        void this.fetchFor(this.activePath);
      }
    });
  }

  async fetchFor(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.backlinks = [];
      this.outgoing = [];
      this.error = null;
      return;
    }
    this.loading = true;
    this.error = null;
    const [back, out] = await Promise.all([
      this.service.getBacklinks(notePath),
      this.service.getOutgoingLinks(notePath),
    ]);
    if (back.ok) this.backlinks = back.value;
    else this.error = back.error;
    if (out.ok) this.outgoing = out.value;
    else this.error = out.error;
    this.loading = false;
  }

  destroy(): void {
    this.serviceUnsubscribe?.();
    this.serviceUnsubscribe = null;
    this.service = null;
    this.backlinks = [];
    this.outgoing = [];
    this.activePath = null;
  }
}

export const relationsStore = new RelationsStore();
