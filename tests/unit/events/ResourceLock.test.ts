/**
 * ResourceLock Unit Tests
 *
 * Tests for the per-resource mutex that prevents concurrent modifications.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceLock } from '$lib/events/queue/ResourceLock';
import { events } from '$lib/events';
import type { EventMap } from '$lib/events';

describe('ResourceLock', () => {
  let lock: ResourceLock;

  beforeEach(() => {
    lock = new ResourceLock();
  });

  describe('acquire', () => {
    it('grants lock immediately when resource is not locked', async () => {
      const release = await lock.acquire('resource-1');

      expect(lock.isLocked('resource-1')).toBe(true);
      expect(typeof release).toBe('function');

      release();
      expect(lock.isLocked('resource-1')).toBe(false);
    });

    it('queues request when resource is already locked', async () => {
      const release1 = await lock.acquire('resource-1');
      expect(lock.isLocked('resource-1')).toBe(true);

      // Second acquire should wait
      let secondAcquired = false;
      const acquirePromise = lock.acquire('resource-1').then((r) => {
        secondAcquired = true;
        return r;
      });

      // Should still be waiting
      await new Promise((r) => setTimeout(r, 10));
      expect(secondAcquired).toBe(false);
      expect(lock.queueLength('resource-1')).toBe(1);

      // Release first lock
      release1();

      // Second should now acquire
      const release2 = await acquirePromise;
      expect(secondAcquired).toBe(true);
      expect(lock.isLocked('resource-1')).toBe(true);

      release2();
      expect(lock.isLocked('resource-1')).toBe(false);
    });

    it('processes queue in FIFO order', async () => {
      const order: number[] = [];

      const release1 = await lock.acquire('resource-1');

      // Queue multiple requests
      const promise2 = lock.acquire('resource-1').then((r) => {
        order.push(2);
        return r;
      });
      const promise3 = lock.acquire('resource-1').then((r) => {
        order.push(3);
        return r;
      });
      const promise4 = lock.acquire('resource-1').then((r) => {
        order.push(4);
        return r;
      });

      expect(lock.queueLength('resource-1')).toBe(3);

      // Release first and let queue process
      release1();
      order.push(1);

      const release2 = await promise2;
      release2();

      const release3 = await promise3;
      release3();

      const release4 = await promise4;
      release4();

      // Should be in order (1 is when we released, then 2, 3, 4 in FIFO)
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('handles different resources independently', async () => {
      const release1 = await lock.acquire('resource-1');
      const release2 = await lock.acquire('resource-2');

      expect(lock.isLocked('resource-1')).toBe(true);
      expect(lock.isLocked('resource-2')).toBe(true);

      release1();
      expect(lock.isLocked('resource-1')).toBe(false);
      expect(lock.isLocked('resource-2')).toBe(true);

      release2();
      expect(lock.isLocked('resource-2')).toBe(false);
    });
  });

  describe('withLock', () => {
    it('executes function while holding lock', async () => {
      let wasLocked = false;

      await lock.withLock('resource-1', async () => {
        wasLocked = lock.isLocked('resource-1');
      });

      expect(wasLocked).toBe(true);
      expect(lock.isLocked('resource-1')).toBe(false);
    });

    it('returns function result', async () => {
      const result = await lock.withLock('resource-1', async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('releases lock even if function throws', async () => {
      await expect(
        lock.withLock('resource-1', async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      expect(lock.isLocked('resource-1')).toBe(false);
    });

    it('awaits queued functions in order', async () => {
      const results: number[] = [];

      // Start first operation
      const p1 = lock.withLock('resource-1', async () => {
        await new Promise((r) => setTimeout(r, 50));
        results.push(1);
      });

      // Queue second and third
      const p2 = lock.withLock('resource-1', async () => {
        results.push(2);
      });
      const p3 = lock.withLock('resource-1', async () => {
        results.push(3);
      });

      await Promise.all([p1, p2, p3]);

      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe('isLocked', () => {
    it('returns false for unlocked resource', () => {
      expect(lock.isLocked('unknown')).toBe(false);
    });

    it('returns true for locked resource', async () => {
      const release = await lock.acquire('resource-1');
      expect(lock.isLocked('resource-1')).toBe(true);
      release();
    });
  });

  describe('queueLength', () => {
    it('returns 0 for resource with no queue', () => {
      expect(lock.queueLength('unknown')).toBe(0);
    });

    it('returns correct queue length', async () => {
      const release = await lock.acquire('resource-1');

      // Queue some requests
      lock.acquire('resource-1');
      lock.acquire('resource-1');

      expect(lock.queueLength('resource-1')).toBe(2);

      release();
    });
  });

  describe('activeResourceCount', () => {
    it('returns 0 when no locks are held', () => {
      expect(lock.activeResourceCount).toBe(0);
    });

    it('returns correct count', async () => {
      const release1 = await lock.acquire('resource-1');
      expect(lock.activeResourceCount).toBe(1);

      const release2 = await lock.acquire('resource-2');
      expect(lock.activeResourceCount).toBe(2);

      release1();
      expect(lock.activeResourceCount).toBe(1);

      release2();
      expect(lock.activeResourceCount).toBe(0);
    });
  });

  describe('snapshot', () => {
    it('reports held and queued resources', async () => {
      const release1 = await lock.acquire('resource-1');
      const release2 = await lock.acquire('resource-2');
      const queued = lock.acquire('resource-1');

      expect(lock.snapshot()).toEqual([
        { resourceId: 'resource-1', held: true, queued: 1 },
        { resourceId: 'resource-2', held: true, queued: 0 },
      ]);

      release1();
      const releaseQueued = await queued;
      releaseQueued();
      release2();
    });

    it('reports holder and waiter metadata when supplied', async () => {
      const release1 = await lock.acquire('resource-1', {
        id: 'inv-1',
        kind: 'tool',
        label: 'note:update',
        toolId: 'note:update',
      });
      const queued = lock.acquire('resource-1', {
        id: 'inv-2',
        kind: 'tool',
        label: 'todo:update',
        toolId: 'todo:update',
      });

      expect(lock.snapshot()).toEqual([
        {
          resourceId: 'resource-1',
          held: true,
          queued: 1,
          holder: {
            id: 'inv-1',
            kind: 'tool',
            label: 'note:update',
            toolId: 'note:update',
          },
          waiters: [{
            id: 'inv-2',
            kind: 'tool',
            label: 'todo:update',
            toolId: 'todo:update',
          }],
        },
      ]);

      release1();
      const release2 = await queued;

      expect(lock.snapshot()).toEqual([
        {
          resourceId: 'resource-1',
          held: true,
          queued: 0,
          holder: {
            id: 'inv-2',
            kind: 'tool',
            label: 'todo:update',
            toolId: 'todo:update',
          },
        },
      ]);

      release2();
    });
  });

  describe('events', () => {
    it('emits change snapshots when locks move', async () => {
      const changes: EventMap['resource-lock:changed'][] = [];
      const handler = (payload: EventMap['resource-lock:changed']) => changes.push(payload);
      events.on('resource-lock:changed', handler);

      const release1 = await lock.acquire('resource-1');
      const queued = lock.acquire('resource-1');
      release1();
      const release2 = await queued;
      release2();

      events.off('resource-lock:changed', handler);

      expect(changes.map((change) => change.reason)).toEqual([
        'acquired',
        'queued',
        'acquired',
        'released',
      ]);
      expect(changes.at(-1)?.resources).toEqual([]);
    });
  });

  describe('double release prevention', () => {
    it('prevents double release from causing issues', async () => {
      const release = await lock.acquire('resource-1');

      // Release twice - should not cause errors
      release();
      release(); // Second release should be no-op

      expect(lock.isLocked('resource-1')).toBe(false);
    });
  });

  describe('clear', () => {
    it('clears all locks and queues', async () => {
      await lock.acquire('resource-1');
      await lock.acquire('resource-2');

      expect(lock.activeResourceCount).toBe(2);

      lock.clear();

      expect(lock.activeResourceCount).toBe(0);
      expect(lock.isLocked('resource-1')).toBe(false);
      expect(lock.isLocked('resource-2')).toBe(false);
    });
  });
});
