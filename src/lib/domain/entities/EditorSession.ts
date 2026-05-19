/**
 * EditorSession entity - one open document tab in the editor.
 *
 * The editor can hold multiple sessions simultaneously (one per open tab).
 * Each session owns its own document, dirty/saving state, and timing
 * metadata. The active session is the one currently visible to the user.
 *
 * Pure domain type with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

import type { Document } from './Document';

/** Conflict state when external changes are detected for an open document. */
export type EditorSessionConflictState =
  | 'clean'                 // file on disk matches what the editor loaded
  | 'external-modified'     // file changed externally; user must resolve
  | 'external-deleted';     // file removed externally while session is open

export interface EditorSession {
  /** Document path (relative to notes directory). Acts as session id. */
  readonly path: string;
  /** The current document state (in-memory, may differ from disk if dirty). */
  document: Document;
  /** Whether this session has unsaved changes. */
  isDirty: boolean;
  /** Whether this session is currently being persisted to disk. */
  isSaving: boolean;
  /** Last successful save timestamp; null until first save completes. */
  lastSavedAt: Date | null;
  /** Conflict state with the on-disk version (set by the file-watcher path). */
  conflictState: EditorSessionConflictState;
  /** Timestamp of the file on disk at last load/save (used for conflict detection). */
  externalMtime: number | null;
  /** Hash of the file body at last load/save (used for conflict detection). */
  externalHash: string | null;
}

/** Build a fresh session for a newly-opened document. */
export function createEditorSession(document: Document): EditorSession {
  return {
    path: document.path,
    document,
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    conflictState: 'clean',
    externalMtime: null,
    externalHash: null,
  };
}
