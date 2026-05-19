/**
 * Sessions store - reactive view over SessionService.
 *
 * Tracks which sessions the active note belongs to (thread, synthesize,
 * deep-research, swarm, manual grouping). Re-fetches when the service emits
 * a session:changed event for the active path.
 */

import type { Session } from '$lib/domain/entities/Session';
import type { SessionService } from '$lib/ports/inbound/SessionService';

class SessionsStore {
  private service: SessionService | null = null;
  private serviceUnsubscribe: (() => void) | null = null;

  sessions = $state<Session[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);
  activePath = $state<string | null>(null);
  expandedSessionId = $state<string | null>(null);

  init(service: SessionService): void {
    if (this.service === service) return;
    this.serviceUnsubscribe?.();
    this.service = service;
    this.serviceUnsubscribe = service.subscribe((event) => {
      const path = this.activePath;
      if (!path) return;
      if (event.notePath && event.notePath !== path && event.action !== 'updated' && event.action !== 'deleted') {
        return;
      }
      void this.fetchFor(path);
    });
  }

  async fetchFor(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.sessions = [];
      this.error = null;
      return;
    }
    this.loading = true;
    this.error = null;
    const result = await this.service.listForNote(notePath);
    if (result.ok) {
      this.sessions = result.value;
    } else {
      this.error = result.error;
    }
    this.loading = false;
  }

  toggleExpanded(sessionId: string | null): void {
    if (sessionId === null) {
      this.expandedSessionId = null;
      return;
    }
    this.expandedSessionId = this.expandedSessionId === sessionId ? null : sessionId;
  }

  async removeNoteFromSession(sessionId: string, notePath: string): Promise<void> {
    if (!this.service) return;
    const result = await this.service.removeNote(sessionId, notePath);
    if (!result.ok) {
      this.error = result.error;
    }
  }

  destroy(): void {
    this.serviceUnsubscribe?.();
    this.serviceUnsubscribe = null;
    this.service = null;
    this.sessions = [];
    this.activePath = null;
    this.expandedSessionId = null;
  }
}

export const sessionsStore = new SessionsStore();
