/**
 * Pipeline Types - Core abstractions for multi-step operations
 *
 * Defines how operations are composed, tracked, and controlled.
 * The OperationContext is the API that tool authors interact with.
 */

/** Who initiated this and what behavior is expected */
export interface OperationSource {
  type: 'user' | 'ai' | 'system';
  /** Auto-focus/select the result in editor */
  autoFocus?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Parent operation ID for grouping */
  operationId?: string;
}

export const USER_SOURCE: OperationSource = { type: 'user', autoFocus: true };
export const AI_SOURCE: OperationSource = { type: 'ai', autoFocus: false };
export const SYSTEM_SOURCE: OperationSource = { type: 'system', autoFocus: false };

/** Observable operation state */
export interface TrackedOperation {
  readonly id: string;
  readonly label: string;
  readonly source: OperationSource;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial';
  progress: { completed: number; total: number; message: string };
  children: TrackedOperation[];
  result: unknown | null;
  error: Error | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** The API tool authors interact with */
export interface OperationContext {
  /** The abort signal — check ctx.signal.aborted in loops */
  readonly signal: AbortSignal;

  /** Run tasks in parallel with tracking and concurrency control */
  parallel<T>(
    label: string,
    tasks: Array<() => Promise<T>>,
    options?: { maxConcurrency?: number },
  ): Promise<T[]>;

  /** Create a tracked sub-step visible in the operations panel */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;

  /** Update progress message */
  progress(message: string): void;

  /** Buffer side effects — sidebar refresh, events — flush once at the end */
  buffer<T>(fn: () => Promise<T>): Promise<T>;

  /** Convenience: is this operation cancelled? */
  readonly isCancelled: boolean;
}
