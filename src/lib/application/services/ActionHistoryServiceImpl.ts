/**
 * ActionHistoryServiceImpl - bounded in-memory action history.
 *
 * Pure logic: no DOM, no I/O. Each recorded action carries its own inverse
 * closure; the service simply replays it on undo. The stack is capped at
 * `MAX_STACK` to bound memory; older actions roll off the bottom.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  ActionHistoryService,
  RecordedAction,
} from '$lib/ports/inbound/ActionHistoryService';

const MAX_STACK = 50;

export class ActionHistoryServiceImpl implements ActionHistoryService {
  private stack: RecordedAction[] = [];
  private subscribers = new Set<(stack: RecordedAction[]) => void>();
  private idCounter = 0;

  record(action: Omit<RecordedAction, 'id' | 'recordedAt'>): RecordedAction {
    const recorded: RecordedAction = {
      ...action,
      id: `action-${Date.now()}-${++this.idCounter}`,
      recordedAt: Date.now(),
    };
    this.stack.unshift(recorded);
    if (this.stack.length > MAX_STACK) {
      this.stack = this.stack.slice(0, MAX_STACK);
    }
    this.notify();
    return recorded;
  }

  async undoLast(): Promise<Result<RecordedAction | null, Error>> {
    const action = this.stack.shift();
    if (!action) {
      this.notify();
      return ok(null);
    }

    try {
      await action.undo();
      this.notify();
      return ok(action);
    } catch (e) {
      // On failure, push the action back so the user can retry. We don't
      // want a flaky inverse to silently lose its place in history.
      this.stack.unshift(action);
      this.notify();
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  getStack(): RecordedAction[] {
    return this.stack.slice();
  }

  subscribe(callback: (stack: RecordedAction[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getStack());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.getStack();
    for (const cb of this.subscribers) {
      try {
        cb(snapshot);
      } catch (e) {
        console.error('ActionHistoryService subscriber error:', e);
      }
    }
  }
}
