/**
 * UndoFrame - Pre-operation snapshot for batch undo
 *
 * Created BEFORE an operation executes. Stores the content
 * of all notes that will be modified, enabling batch undo
 * across all affected notes.
 *
 * Stored at .void/undo/{operationId}.json.
 * Retained for last 20 operations.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export interface UndoFrameEntry {
  /** Note path relative to notes directory */
  notePath: string;
  /** Full markdown content before modification */
  contentBefore: string;
}

export interface UndoFrame {
  /** Operation ID this frame belongs to */
  operationId: string;
  /** ISO timestamp when frame was created */
  ts: string;
  /** Snapshots of notes before modification */
  entries: UndoFrameEntry[];
}

/**
 * Create a new undo frame.
 */
export function createUndoFrame(
  operationId: string,
  entries: UndoFrameEntry[]
): UndoFrame {
  return {
    operationId,
    ts: new Date().toISOString(),
    entries,
  };
}
