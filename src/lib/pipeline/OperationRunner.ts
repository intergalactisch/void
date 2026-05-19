/**
 * OperationRunner - Manages tracked multi-step operations
 *
 * Creates OperationContext instances and manages their lifecycle.
 * Provides observable state for UI (operations panel).
 *
 * Usage:
 * ```typescript
 * const runner = new OperationRunner();
 * const result = await runner.run('Create notes', AI_SOURCE, async (ctx) => {
 *   const notes = await ctx.parallel('Reading', tasks);
 *   ctx.progress('Synthesizing...');
 *   return await ctx.buffer(async () => createNotes(notes));
 * });
 * ```
 */

import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';
import type { OperationSource, TrackedOperation, OperationContext } from './types';
import { startBuffering } from '$lib/events/bus';

/** Create a tracked operation object */
function createTrackedOperation(label: string, source: OperationSource): TrackedOperation {
  return {
    id: crypto.randomUUID(),
    label,
    source,
    status: 'pending',
    progress: { completed: 0, total: 0, message: '' },
    children: [],
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

export class OperationRunner {
  private active = new Map<string, { op: TrackedOperation; abort: AbortController }>();
  private listeners = new Set<(ops: TrackedOperation[]) => void>();

  /** Run a function within a tracked operation */
  async run<T>(
    label: string,
    source: OperationSource,
    fn: (ctx: OperationContext) => Promise<T>,
  ): Promise<Result<T, Error>> {
    const op = createTrackedOperation(label, source);
    const abort = new AbortController();

    this.active.set(op.id, { op, abort });
    this.notify();

    // Link to parent signal if provided
    if (source.signal) {
      source.signal.addEventListener('abort', () => abort.abort(), { once: true });
    }

    const ctx = this.createContext(op, abort);

    try {
      op.status = 'running';
      op.startedAt = new Date();
      this.notify();

      const result = await fn(ctx);

      op.status = op.children.some((c) => c.status === 'failed') ? 'partial' : 'completed';
      op.result = result;
      op.completedAt = new Date();
      this.notify();

      return ok(result);
    } catch (error) {
      op.status = abort.signal.aborted ? 'cancelled' : 'failed';
      op.error = error instanceof Error ? error : new Error(String(error));
      op.completedAt = new Date();
      this.notify();
      return err(op.error);
    } finally {
      // Remove from active after a short delay for UI
      setTimeout(() => {
        this.active.delete(op.id);
        this.notify();
      }, 2000);
    }
  }

  /** Cancel a running operation */
  cancel(operationId: string): boolean {
    const entry = this.active.get(operationId);
    if (!entry) return false;
    entry.abort.abort();
    return true;
  }

  /** Get all active operations (for OperationsPanel) */
  getActive(): TrackedOperation[] {
    return [...this.active.values()].map((e) => e.op);
  }

  /** Subscribe to operation changes */
  subscribe(listener: (ops: TrackedOperation[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const ops = this.getActive();
    for (const listener of this.listeners) {
      try {
        listener(ops);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  private createContext(op: TrackedOperation, abort: AbortController): OperationContext {
    return {
      signal: abort.signal,
      get isCancelled() {
        return abort.signal.aborted;
      },

      progress: (message: string) => {
        op.progress.message = message;
        this.notify();
      },

      step: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
        const child = createTrackedOperation(label, op.source);
        op.children.push(child);
        child.status = 'running';
        child.startedAt = new Date();
        this.notify();
        try {
          const result = await fn();
          child.status = 'completed';
          child.result = result;
          child.completedAt = new Date();
          op.progress.completed++;
          this.notify();
          return result;
        } catch (e) {
          child.status = 'failed';
          child.error = e instanceof Error ? e : new Error(String(e));
          child.completedAt = new Date();
          this.notify();
          throw e;
        }
      },

      parallel: async <T>(
        label: string,
        tasks: Array<() => Promise<T>>,
        options?: { maxConcurrency?: number },
      ): Promise<T[]> => {
        op.progress.total = tasks.length;
        op.progress.message = label;
        this.notify();

        const concurrency = options?.maxConcurrency ?? tasks.length;
        const results: T[] = [];
        const errors: unknown[] = [];

        // Process in chunks respecting concurrency limit. Collect every
        // failure rather than short-circuiting so callers see the full
        // picture; an AggregateError surfaces them at the end.
        for (let i = 0; i < tasks.length; i += concurrency) {
          if (abort.signal.aborted) break;
          const chunk = tasks.slice(i, i + concurrency);
          const chunkResults = await Promise.allSettled(chunk.map((t) => t()));
          for (const r of chunkResults) {
            if (r.status === 'fulfilled') {
              results.push(r.value);
              op.progress.completed++;
              this.notify();
            } else {
              errors.push(r.reason);
            }
          }
        }

        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `${errors.length} of ${tasks.length} parallel tasks failed`,
          );
        }
        return results;
      },

      buffer: async <T>(fn: () => Promise<T>): Promise<T> => {
        const buffered = startBuffering();
        try {
          const result = await fn();
          buffered.flush();
          return result;
        } catch (e) {
          buffered.discard();
          throw e;
        }
      },
    };
  }
}
