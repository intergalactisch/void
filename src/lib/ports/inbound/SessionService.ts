/**
 * SessionService - inbound port for session membership.
 *
 * Sessions group notes that participated in an AI batch operation
 * (thread, synthesize, deep-research, swarm, etc.) or a manual user grouping.
 */

import type { Result } from '$lib/core/result';
import type {
  Session,
  SessionRole,
  CreateSessionParams,
  SessionStatus,
} from '$lib/domain/entities/Session';

export type SessionChangeAction =
  | 'created'
  | 'updated'
  | 'member-added'
  | 'member-removed'
  | 'deleted';

export interface SessionChangeEvent {
  sessionId: string;
  notePath?: string;
  action: SessionChangeAction;
}

export interface SessionService {
  create(params: CreateSessionParams): Promise<Result<Session, Error>>;
  get(sessionId: string): Promise<Result<Session | null, Error>>;
  list(): Promise<Result<Session[], Error>>;
  listForNote(notePath: string): Promise<Result<Session[], Error>>;
  addNote(sessionId: string, notePath: string, role: SessionRole): Promise<Result<void, Error>>;
  removeNote(sessionId: string, notePath: string): Promise<Result<void, Error>>;
  markStatus(sessionId: string, status: SessionStatus): Promise<Result<void, Error>>;
  delete(sessionId: string): Promise<Result<void, Error>>;
  renameNote(oldPath: string, newPath: string): Promise<Result<void, Error>>;
  removeNoteFromAll(notePath: string): Promise<Result<void, Error>>;
  subscribe(handler: (event: SessionChangeEvent) => void): () => void;
}
