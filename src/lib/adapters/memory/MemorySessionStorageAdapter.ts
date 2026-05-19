/**
 * MemorySessionStorageAdapter - in-memory implementation of SessionStoragePort
 * for tests and browser-only mock mode.
 */

import { ok, type Result } from '$lib/core/result';
import type { Session, SessionMember } from '$lib/domain/entities/Session';
import type { SessionStoragePort } from '$lib/ports/outbound/SessionStoragePort';

export class MemorySessionStorageAdapter implements SessionStoragePort {
  private readonly sessions = new Map<string, Session>();

  async save(session: Session): Promise<Result<void, Error>> {
    this.sessions.set(session.id, structuredClone(session));
    return ok(undefined);
  }

  async get(sessionId: string): Promise<Result<Session | null, Error>> {
    const session = this.sessions.get(sessionId);
    return ok(session ? structuredClone(session) : null);
  }

  async list(): Promise<Result<Session[], Error>> {
    const all = [...this.sessions.values()]
      .map((s) => structuredClone(s))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok(all);
  }

  async listForNote(notePath: string): Promise<Result<Session[], Error>> {
    const matches = [...this.sessions.values()]
      .filter((s) => s.members.some((m) => m.notePath === notePath))
      .map((s) => structuredClone(s))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok(matches);
  }

  async addMember(sessionId: string, member: SessionMember): Promise<Result<void, Error>> {
    const session = this.sessions.get(sessionId);
    if (!session) return ok(undefined);
    if (session.members.some((m) => m.notePath === member.notePath)) return ok(undefined);
    const updated: Session = {
      ...session,
      members: [...session.members, { ...member }],
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, updated);
    return ok(undefined);
  }

  async removeMember(sessionId: string, notePath: string): Promise<Result<void, Error>> {
    const session = this.sessions.get(sessionId);
    if (!session) return ok(undefined);
    const updated: Session = {
      ...session,
      members: session.members.filter((m) => m.notePath !== notePath),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, updated);
    return ok(undefined);
  }

  async delete(sessionId: string): Promise<Result<void, Error>> {
    this.sessions.delete(sessionId);
    return ok(undefined);
  }

  async renameNote(oldPath: string, newPath: string): Promise<Result<void, Error>> {
    for (const [id, session] of this.sessions) {
      if (!session.members.some((m) => m.notePath === oldPath)) continue;
      this.sessions.set(id, {
        ...session,
        members: session.members.map((m) =>
          m.notePath === oldPath ? { ...m, notePath: newPath } : m
        ),
        updatedAt: new Date().toISOString(),
      });
    }
    return ok(undefined);
  }

  async removeNoteFromAll(notePath: string): Promise<Result<string[], Error>> {
    const affected: string[] = [];
    for (const [id, session] of this.sessions) {
      if (!session.members.some((m) => m.notePath === notePath)) continue;
      affected.push(id);
      this.sessions.set(id, {
        ...session,
        members: session.members.filter((m) => m.notePath !== notePath),
        updatedAt: new Date().toISOString(),
      });
    }
    return ok(affected);
  }
}
