/**
 * VoidSessionStorageAdapter - persists Session entities in .void/sessions/.
 *
 * Storage layout:
 *   .void/sessions/{id}.json                — canonical Session entity
 *   .void/sessions/by-note/{noteSlug}.json  — string[] sessionIds for that note
 */

import { ok, err, type Result } from '$lib/core/result';
import type { Session, SessionMember } from '$lib/domain/entities/Session';
import type { SessionStoragePort } from '$lib/ports/outbound/SessionStoragePort';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

function slugForNotePath(notePath: string): string {
  return notePath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fileForSession(id: string): string {
  return `sessions/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}

function fileForByNote(notePath: string): string {
  return `sessions/by-note/${slugForNotePath(notePath)}.json`;
}

export class VoidSessionStorageAdapter implements SessionStoragePort {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly notesPath: string
  ) {}

  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  async save(session: Session): Promise<Result<void, Error>> {
    return this.queue(async () => {
      const prev = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(session.id));
      if (!prev.ok) return prev;

      const saved = await this.voidStorage.writeJson(this.notesPath, fileForSession(session.id), session);
      if (!saved.ok) return saved;

      const previousPaths = new Set(prev.value?.members.map((m) => m.notePath) ?? []);
      const currentPaths = new Set(session.members.map((m) => m.notePath));

      for (const path of currentPaths) {
        if (!previousPaths.has(path)) {
          const added = await this.addToReverseIndex(path, session.id);
          if (!added.ok) return added;
        }
      }
      for (const path of previousPaths) {
        if (!currentPaths.has(path)) {
          const removed = await this.removeFromReverseIndex(path, session.id);
          if (!removed.ok) return removed;
        }
      }
      return ok(undefined);
    });
  }

  async get(sessionId: string): Promise<Result<Session | null, Error>> {
    return this.voidStorage.readJson<Session>(this.notesPath, fileForSession(sessionId));
  }

  async list(): Promise<Result<Session[], Error>> {
    const entries = await this.voidStorage.listDir(this.notesPath, 'sessions');
    if (!entries.ok) return entries;

    const sessions: Session[] = [];
    for (const entry of entries.value) {
      if (!entry.endsWith('.json')) continue;
      const read = await this.voidStorage.readJson<Session>(this.notesPath, `sessions/${entry}`);
      if (!read.ok) return err(read.error);
      if (read.value) sessions.push(read.value);
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok(sessions);
  }

  async listForNote(notePath: string): Promise<Result<Session[], Error>> {
    const indexRead = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(notePath));
    if (!indexRead.ok) return err(indexRead.error);

    const ids = Array.isArray(indexRead.value) ? indexRead.value : [];
    if (ids.length === 0) return ok([]);

    const sessions: Session[] = [];
    const validIds: string[] = [];
    for (const id of ids) {
      const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(id));
      if (!read.ok) return err(read.error);
      if (read.value && read.value.members.some((m) => m.notePath === notePath)) {
        sessions.push(read.value);
        validIds.push(id);
      }
    }

    if (validIds.length !== ids.length) {
      await this.voidStorage.writeJson(this.notesPath, fileForByNote(notePath), validIds);
    }

    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok(sessions);
  }

  async addMember(sessionId: string, member: SessionMember): Promise<Result<void, Error>> {
    return this.queue(async () => {
      const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(sessionId));
      if (!read.ok) return read;
      const session = read.value;
      if (!session) return ok(undefined);
      if (session.members.some((m) => m.notePath === member.notePath)) return ok(undefined);

      const updated: Session = {
        ...session,
        members: [...session.members, { ...member }],
        updatedAt: new Date().toISOString(),
      };
      const written = await this.voidStorage.writeJson(this.notesPath, fileForSession(sessionId), updated);
      if (!written.ok) return written;
      return this.addToReverseIndex(member.notePath, sessionId);
    });
  }

  async removeMember(sessionId: string, notePath: string): Promise<Result<void, Error>> {
    return this.queue(async () => {
      const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(sessionId));
      if (!read.ok) return read;
      const session = read.value;
      if (!session) return ok(undefined);
      if (!session.members.some((m) => m.notePath === notePath)) return ok(undefined);

      const updated: Session = {
        ...session,
        members: session.members.filter((m) => m.notePath !== notePath),
        updatedAt: new Date().toISOString(),
      };
      const written = await this.voidStorage.writeJson(this.notesPath, fileForSession(sessionId), updated);
      if (!written.ok) return written;
      return this.removeFromReverseIndex(notePath, sessionId);
    });
  }

  async delete(sessionId: string): Promise<Result<void, Error>> {
    return this.queue(async () => {
      const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(sessionId));
      if (!read.ok) return read;
      const session = read.value;
      if (!session) return ok(undefined);

      for (const member of session.members) {
        const removed = await this.removeFromReverseIndex(member.notePath, sessionId);
        if (!removed.ok) return removed;
      }
      return this.voidStorage.writeJson(this.notesPath, fileForSession(sessionId), null);
    });
  }

  async renameNote(oldPath: string, newPath: string): Promise<Result<void, Error>> {
    return this.queue(async () => {
      const indexRead = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(oldPath));
      if (!indexRead.ok) return err(indexRead.error);
      const ids = Array.isArray(indexRead.value) ? indexRead.value : [];

      for (const id of ids) {
        const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(id));
        if (!read.ok) return err(read.error);
        if (!read.value) continue;
        const session = read.value;
        if (!session.members.some((m) => m.notePath === oldPath)) continue;
        const updated: Session = {
          ...session,
          members: session.members.map((m) =>
            m.notePath === oldPath ? { ...m, notePath: newPath } : m
          ),
          updatedAt: new Date().toISOString(),
        };
        const written = await this.voidStorage.writeJson(this.notesPath, fileForSession(id), updated);
        if (!written.ok) return written;
      }

      const newIndexRead = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(newPath));
      if (!newIndexRead.ok) return err(newIndexRead.error);
      const existing = Array.isArray(newIndexRead.value) ? newIndexRead.value : [];
      const merged = Array.from(new Set([...existing, ...ids]));
      const writeMerged = await this.voidStorage.writeJson(this.notesPath, fileForByNote(newPath), merged);
      if (!writeMerged.ok) return writeMerged;
      return this.voidStorage.writeJson(this.notesPath, fileForByNote(oldPath), []);
    });
  }

  async removeNoteFromAll(notePath: string): Promise<Result<string[], Error>> {
    return this.queue(async () => {
      const indexRead = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(notePath));
      if (!indexRead.ok) return err(indexRead.error);
      const ids = Array.isArray(indexRead.value) ? indexRead.value : [];

      const affected: string[] = [];
      for (const id of ids) {
        const read = await this.voidStorage.readJson<Session>(this.notesPath, fileForSession(id));
        if (!read.ok) return err(read.error);
        if (!read.value) continue;
        const session = read.value;
        if (!session.members.some((m) => m.notePath === notePath)) continue;
        affected.push(id);
        const updated: Session = {
          ...session,
          members: session.members.filter((m) => m.notePath !== notePath),
          updatedAt: new Date().toISOString(),
        };
        const written = await this.voidStorage.writeJson(this.notesPath, fileForSession(id), updated);
        if (!written.ok) return err(written.error);
      }
      const cleared = await this.voidStorage.writeJson(this.notesPath, fileForByNote(notePath), []);
      if (!cleared.ok) return err(cleared.error);
      return ok(affected);
    });
  }

  private async addToReverseIndex(notePath: string, sessionId: string): Promise<Result<void, Error>> {
    const read = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(notePath));
    if (!read.ok) return err(read.error);
    const existing = Array.isArray(read.value) ? read.value : [];
    if (existing.includes(sessionId)) return ok(undefined);
    return this.voidStorage.writeJson(this.notesPath, fileForByNote(notePath), [...existing, sessionId]);
  }

  private async removeFromReverseIndex(notePath: string, sessionId: string): Promise<Result<void, Error>> {
    const read = await this.voidStorage.readJson<string[]>(this.notesPath, fileForByNote(notePath));
    if (!read.ok) return err(read.error);
    const existing = Array.isArray(read.value) ? read.value : [];
    if (!existing.includes(sessionId)) return ok(undefined);
    return this.voidStorage.writeJson(this.notesPath, fileForByNote(notePath), existing.filter((id) => id !== sessionId));
  }
}
