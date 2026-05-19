/**
 * Provenance store - reactive view over ProvenanceService for the active note.
 *
 * Reads the JSONL history file via ProvenanceService and exposes events in
 * reverse-chronological order (newest first) for the panel UI. Refreshes
 * whenever the active note changes or a `provenance:recorded` event fires.
 */

import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import { events } from '$lib/events';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';

class ProvenanceStore {
  private service: ProvenanceService | null = null;
  private offProvenance: (() => void) | null = null;

  events = $state<ProvenanceEvent[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);
  activePath = $state<string | null>(null);

  init(service: ProvenanceService): void {
    if (this.service === service) return;
    this.offProvenance?.();
    this.service = service;
    const handler = (payload: { noteName: string }) => {
      const path = this.activePath;
      if (path && noteNameFromPath(path) === payload.noteName) {
        void this.fetchFor(path);
      }
    };
    events.on('provenance:recorded', handler);
    this.offProvenance = () => events.off('provenance:recorded', handler);
  }

  async fetchFor(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.events = [];
      this.error = null;
      return;
    }
    this.loading = true;
    this.error = null;
    const noteName = noteNameFromPath(notePath);
    const result = await this.service.getHistory(noteName);
    if (result.ok) {
      // Newest first for panel display.
      this.events = [...result.value].reverse();
    } else {
      this.events = [];
      this.error = result.error;
    }
    this.loading = false;
  }

  destroy(): void {
    this.offProvenance?.();
    this.offProvenance = null;
    this.service = null;
    this.events = [];
    this.activePath = null;
  }
}

export const provenanceStore = new ProvenanceStore();
