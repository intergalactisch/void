/**
 * SessionServiceImpl - implementation of SessionService.
 *
 * Composes SessionStoragePort, emits session:changed events.
 */

import { ok, err, type Result } from '$lib/core/result';
import type {
  Session,
  SessionRole,
  SessionStatus,
  CreateSessionParams,
} from '$lib/domain/entities/Session';
import {
  createSession,
  setSessionStatus,
} from '$lib/domain/entities/Session';
import type { SessionStoragePort } from '$lib/ports/outbound/SessionStoragePort';
import type {
  SessionService,
  SessionChangeEvent,
} from '$lib/ports/inbound/SessionService';
import { events } from '$lib/events';

export class SessionServiceImpl implements SessionService {
  private readonly subscribers = new Set<(event: SessionChangeEvent) => void>();

  constructor(
    private readonly storage: SessionStoragePort
  ) {}

  async create(params: CreateSessionParams): Promise<Result<Session, Error>> {
    if (params.toolId && params.kind !== 'manual') {
      const existing = await this.findRecentMatch(params);
      if (existing) return ok(existing);
    }

    const session = createSession(params);
    const saved = await this.storage.save(session);
    if (!saved.ok) return err(saved.error);

    this.emit({ sessionId: session.id, action: 'created' });
    return ok(session);
  }

  async get(sessionId: string): Promise<Result<Session | null, Error>> {
    return this.storage.get(sessionId);
  }

  async list(): Promise<Result<Session[], Error>> {
    return this.storage.list();
  }

  async listForNote(notePath: string): Promise<Result<Session[], Error>> {
    return this.storage.listForNote(notePath);
  }

  async addNote(sessionId: string, notePath: string, role: SessionRole): Promise<Result<void, Error>> {
    const result = await this.storage.addMember(sessionId, {
      notePath,
      role,
      addedAt: new Date().toISOString(),
    });
    if (!result.ok) return result;

    this.emit({ sessionId, notePath, action: 'member-added' });
    return ok(undefined);
  }

  async removeNote(sessionId: string, notePath: string): Promise<Result<void, Error>> {
    const result = await this.storage.removeMember(sessionId, notePath);
    if (!result.ok) return result;

    this.emit({ sessionId, notePath, action: 'member-removed' });
    return ok(undefined);
  }

  async markStatus(sessionId: string, status: SessionStatus): Promise<Result<void, Error>> {
    const session = await this.storage.get(sessionId);
    if (!session.ok) return err(session.error);
    if (!session.value) return ok(undefined);

    const updated = setSessionStatus(session.value, status);
    const saved = await this.storage.save(updated);
    if (!saved.ok) return saved;

    this.emit({ sessionId, action: 'updated' });
    return ok(undefined);
  }

  async delete(sessionId: string): Promise<Result<void, Error>> {
    const result = await this.storage.delete(sessionId);
    if (!result.ok) return result;
    this.emit({ sessionId, action: 'deleted' });
    return ok(undefined);
  }

  async renameNote(oldPath: string, newPath: string): Promise<Result<void, Error>> {
    const result = await this.storage.renameNote(oldPath, newPath);
    if (!result.ok) return result;
    this.emit({ sessionId: '', notePath: newPath, action: 'updated' });
    return ok(undefined);
  }

  async removeNoteFromAll(notePath: string): Promise<Result<void, Error>> {
    const result = await this.storage.removeNoteFromAll(notePath);
    if (!result.ok) return err(result.error);
    for (const id of result.value) {
      this.emit({ sessionId: id, notePath, action: 'member-removed' });
    }
    return ok(undefined);
  }

  subscribe(handler: (event: SessionChangeEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  private async findRecentMatch(params: CreateSessionParams): Promise<Session | null> {
    if (!params.toolId) return null;
    const list = await this.storage.list();
    if (!list.ok) return null;
    const cutoff = Date.now() - 5_000;
    return list.value.find((existing) => {
      if (existing.toolId !== params.toolId) return false;
      if (params.agentRunId && existing.agentRunId !== params.agentRunId) return false;
      if (params.conversationId && existing.conversationId !== params.conversationId) return false;
      if (params.topic && existing.topic !== params.topic) return false;
      const ts = Date.parse(existing.createdAt);
      return Number.isFinite(ts) && ts >= cutoff;
    }) ?? null;
  }

  private emit(event: SessionChangeEvent): void {
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch {
        // ignore subscriber errors
      }
    }
    events.emit('session:changed', event);
  }
}
