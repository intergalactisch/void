/**
 * ResourceLock - Per-resource mutex for preventing concurrent modifications
 *
 * This implements a simple lock manager that ensures only one operation
 * can modify a resource at a time. When a lock is held, subsequent
 * requests for the same resource are queued and processed in order.
 *
 * Usage:
 * ```typescript
 * const locks = new ResourceLock();
 *
 * // Acquire a lock, perform work, then release
 * const release = await locks.acquire('my-resource');
 * try {
 *   await doWork();
 * } finally {
 *   release();
 * }
 *
 * // Or use withLock for automatic release
 * const result = await locks.withLock('my-resource', async () => {
 *   return await doWork();
 * });
 * ```
 */

import { events } from '../bus';

/**
 * A function that releases a held lock.
 */
export type ReleaseLock = () => void;

export interface ResourceLockOwner {
  id: string;
  kind: 'tool' | 'command' | 'service' | 'agent' | 'system';
  label?: string;
  runId?: string;
  toolId?: string;
  messageId?: string | null;
}

export interface ResourceLockSnapshot {
  resourceId: string;
  held: boolean;
  queued: number;
  holder?: ResourceLockOwner;
  waiters?: ResourceLockOwner[];
}

export type ResourceLockChangeReason = 'acquired' | 'queued' | 'released' | 'cleared';

/**
 * Internal queue entry for a pending lock request.
 */
interface QueueEntry {
  resolve: (release: ReleaseLock) => void;
  owner?: ResourceLockOwner;
}

/**
 * ResourceLock manages per-resource locks to prevent concurrent modifications.
 *
 * Key features:
 * - FIFO ordering: locks are granted in the order they were requested
 * - Non-blocking: acquire() returns a Promise that resolves when the lock is granted
 * - Automatic cleanup: empty queues are removed to prevent memory leaks
 */
export class ResourceLock {
  /** Map of resource ID to queue of waiting lock requests */
  private locks = new Map<string, QueueEntry[]>();
  /** Set of currently held locks */
  private held = new Set<string>();
  /** Metadata for currently held locks, when the caller supplied it. */
  private heldOwners = new Map<string, ResourceLockOwner>();

  /**
   * Acquire a lock on a resource.
   *
   * If the resource is not locked, the lock is granted immediately.
   * If the resource is already locked, the request is queued.
   *
   * @param resourceId - Identifier for the resource to lock
   * @returns Promise that resolves with a release function when the lock is acquired
   */
  acquire(resourceId: string, owner?: ResourceLockOwner): Promise<ReleaseLock> {
    // If no lock is held, grant immediately
    if (!this.held.has(resourceId)) {
      this.held.add(resourceId);
      if (owner) {
        this.heldOwners.set(resourceId, owner);
      } else {
        this.heldOwners.delete(resourceId);
      }
      this.emitChanged(resourceId, 'acquired');
      return Promise.resolve(this.createRelease(resourceId));
    }

    // Otherwise, queue the request
    return new Promise((resolve) => {
      const queue = this.locks.get(resourceId) ?? [];
      queue.push({
        resolve,
        ...(owner ? { owner } : {}),
      });
      this.locks.set(resourceId, queue);
      this.emitChanged(resourceId, 'queued');
    });
  }

  /**
   * Execute a function while holding a lock on a resource.
   *
   * The lock is automatically released when the function completes
   * (whether it succeeds or throws).
   *
   * @param resourceId - Identifier for the resource to lock
   * @param fn - Async function to execute while holding the lock
   * @returns Promise that resolves with the function's return value
   */
  async withLock<T>(
    resourceId: string,
    fn: () => Promise<T>,
    owner?: ResourceLockOwner
  ): Promise<T> {
    const release = await this.acquire(resourceId, owner);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if a resource is currently locked.
   *
   * @param resourceId - Identifier for the resource to check
   * @returns True if the resource is locked
   */
  isLocked(resourceId: string): boolean {
    return this.held.has(resourceId);
  }

  /**
   * Get the number of pending lock requests for a resource.
   *
   * @param resourceId - Identifier for the resource to check
   * @returns Number of pending requests (0 if none)
   */
  queueLength(resourceId: string): number {
    return this.locks.get(resourceId)?.length ?? 0;
  }

  /**
   * Get the total number of resources with active or pending locks.
   *
   * @returns Number of resources with locks
   */
  get activeResourceCount(): number {
    return this.held.size;
  }

  /**
   * Snapshot of resources currently held or queued.
   */
  snapshot(): ResourceLockSnapshot[] {
    const resourceIds = new Set<string>([
      ...this.held,
      ...this.locks.keys(),
    ]);

    return [...resourceIds]
      .map((resourceId) => ({
        ...this.snapshotEntry(resourceId),
      }))
      .filter((entry) => entry.held || entry.queued > 0)
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  }

  /**
   * Create a release function for a specific resource.
   */
  private createRelease(resourceId: string): ReleaseLock {
    let released = false;

    return () => {
      // Prevent double-release
      if (released) return;
      released = true;

      const queue = this.locks.get(resourceId);

      if (queue && queue.length > 0) {
        // Grant lock to next waiting request
        const next = queue.shift()!;
        if (next.owner) {
          this.heldOwners.set(resourceId, next.owner);
        } else {
          this.heldOwners.delete(resourceId);
        }
        next.resolve(this.createRelease(resourceId));

        // Clean up empty queue
        if (queue.length === 0) {
          this.locks.delete(resourceId);
        }
        this.emitChanged(resourceId, 'acquired');
      } else {
        // No one waiting, release the lock
        this.held.delete(resourceId);
        this.locks.delete(resourceId);
        this.heldOwners.delete(resourceId);
        this.emitChanged(resourceId, 'released');
      }
    };
  }

  private snapshotEntry(resourceId: string): ResourceLockSnapshot {
    const holder = this.heldOwners.get(resourceId);
    const waiters = (this.locks.get(resourceId) ?? [])
      .map((entry) => entry.owner)
      .filter((owner): owner is ResourceLockOwner => !!owner);

    return {
      resourceId,
      held: this.held.has(resourceId),
      queued: this.locks.get(resourceId)?.length ?? 0,
      ...(holder ? { holder } : {}),
      ...(waiters.length > 0 ? { waiters } : {}),
    };
  }

  /**
   * Clear all locks and pending requests.
   * Use only for testing or cleanup.
   */
  clear(): void {
    this.locks.clear();
    this.held.clear();
    this.heldOwners.clear();
    this.emitChanged(null, 'cleared');
  }

  private emitChanged(resourceId: string | null, reason: ResourceLockChangeReason): void {
    events.emit('resource-lock:changed', {
      resourceId,
      reason,
      resources: this.snapshot(),
    });
  }
}

/**
 * Default singleton instance for application-wide resource locking.
 */
export const resourceLock = new ResourceLock();
