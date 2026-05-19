/**
 * SessionStoragePort - outbound port for persisting Session entities.
 *
 * Sessions live in .void/sessions/{id}.json with a reverse index at
 * .void/sessions/by-note/{noteSlug}.json so per-note membership lookups are cheap.
 */

import type { Result } from '$lib/core/result';
import type { Session, SessionMember } from '$lib/domain/entities/Session';

export interface SessionStoragePort {
  save(session: Session): Promise<Result<void, Error>>;
  get(sessionId: string): Promise<Result<Session | null, Error>>;
  list(): Promise<Result<Session[], Error>>;
  listForNote(notePath: string): Promise<Result<Session[], Error>>;
  addMember(sessionId: string, member: SessionMember): Promise<Result<void, Error>>;
  removeMember(sessionId: string, notePath: string): Promise<Result<void, Error>>;
  delete(sessionId: string): Promise<Result<void, Error>>;
  renameNote(oldPath: string, newPath: string): Promise<Result<void, Error>>;
  removeNoteFromAll(notePath: string): Promise<Result<string[], Error>>;
}
