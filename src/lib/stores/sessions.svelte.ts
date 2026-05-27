/**
 * Sessions store - reactive view over SessionService.
 *
 * Tracks which sessions notes belong to (thread, synthesize, deep-research,
 * swarm, manual grouping). Split panes can render several notes at once, so
 * session data is cached per note path instead of as a single active-note list.
 */

import type { Session } from '$lib/domain/entities/Session';
import type { SessionChangeEvent, SessionService } from '$lib/ports/inbound/SessionService';

export class SessionsStore {
  private service: SessionService | null = null;
  private serviceUnsubscribe: (() => void) | null = null;
  private requestSeq = 0;
  private readonly latestRequestByPath = new Map<string, number>();

  sessionsByPath = $state<Record<string, Session[]>>({});
  loadingByPath = $state<Record<string, boolean>>({});
  errorByPath = $state<Record<string, Error | null>>({});

  /** Compatibility view for call sites that still expect the last fetched note. */
  sessions = $state<Session[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);
  activePath = $state<string | null>(null);

  init(service: SessionService): void {
    if (this.service === service) return;
    this.serviceUnsubscribe?.();
    this.service = service;
    this.serviceUnsubscribe = service.subscribe((event) => {
      this.refreshForChange(event);
    });
  }

  async fetchFor(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.sessions = [];
      this.loading = false;
      this.error = null;
      return;
    }
    await this.loadFor(notePath);
  }

  sessionsFor(notePath: string | null): Session[] {
    return notePath ? (this.sessionsByPath[notePath] ?? []) : [];
  }

  loadingFor(notePath: string | null): boolean {
    return notePath ? (this.loadingByPath[notePath] ?? false) : false;
  }

  errorFor(notePath: string | null): Error | null {
    return notePath ? (this.errorByPath[notePath] ?? null) : null;
  }

  async removeNoteFromSession(sessionId: string, notePath: string): Promise<void> {
    if (!this.service) return;
    const result = await this.service.removeNote(sessionId, notePath);
    if (!result.ok) {
      this.setError(notePath, result.error);
      if (this.activePath === notePath) this.error = result.error;
    }
  }

  destroy(): void {
    this.serviceUnsubscribe?.();
    this.serviceUnsubscribe = null;
    this.service = null;
    this.latestRequestByPath.clear();
    this.sessionsByPath = {};
    this.loadingByPath = {};
    this.errorByPath = {};
    this.sessions = [];
    this.loading = false;
    this.error = null;
    this.activePath = null;
  }

  private async loadFor(notePath: string): Promise<void> {
    if (!this.service) return;
    const requestId = ++this.requestSeq;
    this.latestRequestByPath.set(notePath, requestId);
    this.setLoading(notePath, true);
    this.setError(notePath, null);
    if (this.activePath === notePath) {
      this.loading = true;
      this.error = null;
    }

    const result = await this.service.listForNote(notePath);
    if (this.latestRequestByPath.get(notePath) !== requestId) return;

    if (result.ok) {
      this.sessionsByPath = { ...this.sessionsByPath, [notePath]: result.value };
      if (this.activePath === notePath) {
        this.sessions = result.value;
      }
    } else {
      this.setError(notePath, result.error);
      if (this.activePath === notePath) {
        this.error = result.error;
      }
    }
    this.setLoading(notePath, false);
    if (this.activePath === notePath) {
      this.loading = false;
    }
  }

  private refreshForChange(event: SessionChangeEvent): void {
    if (!this.service) return;
    const paths = new Set<string>();

    if (event.notePath && this.shouldRefreshPath(event.notePath)) {
      paths.add(event.notePath);
    }

    if (!event.notePath || event.action === 'created' || event.action === 'updated' || event.action === 'deleted') {
      for (const path of this.cachedPaths()) {
        paths.add(path);
      }
    }

    for (const path of paths) {
      void this.loadFor(path);
    }
  }

  private shouldRefreshPath(notePath: string): boolean {
    return notePath === this.activePath || Object.hasOwn(this.sessionsByPath, notePath);
  }

  private cachedPaths(): string[] {
    const paths = new Set(Object.keys(this.sessionsByPath));
    if (this.activePath) paths.add(this.activePath);
    return [...paths];
  }

  private setLoading(notePath: string, loading: boolean): void {
    this.loadingByPath = { ...this.loadingByPath, [notePath]: loading };
  }

  private setError(notePath: string, error: Error | null): void {
    this.errorByPath = { ...this.errorByPath, [notePath]: error };
  }
}

export const sessionsStore = new SessionsStore();
