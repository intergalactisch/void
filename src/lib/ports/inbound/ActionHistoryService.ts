/**
 * ActionHistoryService - Inbound port for global action undo.
 *
 * Tracks a bounded stack of recent destructive operations (note delete,
 * bulk move, AI rewrite, bulk tag) so the user can rewind via Mod+Shift+Z.
 *
 * Each action carries its own inverse closure — the service knows nothing
 * about the operation domain. Callers wrap their mutation with
 * `record({ type, summary, undo })` and the service stores the inverse for
 * later replay. Bounded stack size avoids unbounded memory growth.
 */

import type { Result } from '$lib/core';

export interface RecordedAction {
  /** Stable id for the action — used as a stack key. */
  id: string;
  /** Short type label for filtering / display ('note.delete', 'notes.bulkMove'). */
  type: string;
  /** Human-readable summary shown in the undo toast. */
  summary: string;
  /** Wall-clock timestamp (ms since epoch). */
  recordedAt: number;
  /**
   * Inverse closure. Called when the user invokes undo. Should reverse
   * the operation atomically; throws/rejects on failure (the service
   * surfaces the error).
   */
  undo: () => Promise<void> | void;
}

export interface ActionHistoryService {
  /** Push a new action onto the stack. Older actions beyond the cap drop off. */
  record(action: Omit<RecordedAction, 'id' | 'recordedAt'>): RecordedAction;

  /** Pop and replay the most recent action. */
  undoLast(): Promise<Result<RecordedAction | null, Error>>;

  /** Read the current stack (newest first) without mutation. */
  getStack(): RecordedAction[];

  /** Subscribe to stack changes. */
  subscribe(callback: (stack: RecordedAction[]) => void): () => void;
}
