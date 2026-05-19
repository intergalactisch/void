/**
 * SessionId - UUID-based identifier for persistent CLI sessions
 *
 * Matches Claude Code's session format. Sessions persist context
 * across invocations and can be resumed days later.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Session ID branded type (UUID format).
 */
export type SessionId = string & { readonly __brand: 'SessionId' };

/**
 * Create a new unique SessionId.
 */
export function createSessionId(): SessionId {
  return crypto.randomUUID() as SessionId;
}

/**
 * Check if a string is a valid SessionId (UUID format).
 */
export function isValidSessionId(id: string): id is SessionId {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
