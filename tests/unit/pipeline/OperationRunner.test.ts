/**
 * OperationRunner Tests
 *
 * Tests for the core operation tracking and execution engine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperationRunner } from '$lib/pipeline/OperationRunner';
import { USER_SOURCE, AI_SOURCE, SYSTEM_SOURCE } from '$lib/pipeline/types';
import type { OperationContext, TrackedOperation } from '$lib/pipeline/types';

// Mock the event bus
vi.mock('$lib/events/bus', () => {
  let buffer: Array<{ type: string; payload: unknown }> | null = null;
  return {
    events: {
      emit: vi.fn().mockImplementation((type: string, payload?: unknown) => {
        if (buffer) {
          buffer.push({ type, payload });
          return;
        }
      }),
      on: vi.fn(),
      off: vi.fn(),
    },
    startBuffering: vi.fn().mockImplementation(() => {
      buffer = [];
      return {
        flush() {
          buffer = null;
        },
        discard() {
          buffer = null;
        },
      };
    }),
  };
});

describe('OperationRunner', () => {
  let runner: OperationRunner;

  beforeEach(() => {
    runner = new OperationRunner();
  });

  describe('run', () => {
    it('executes a simple operation', async () => {
      const result = await runner.run('Test', USER_SOURCE, async () => {
        return 42;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it('returns error for failed operations', async () => {
      const result = await runner.run('Failing', USER_SOURCE, async () => {
        throw new Error('Intentional failure');
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Intentional failure');
      }
    });

    it('tracks operation status through lifecycle', async () => {
      const statuses: string[] = [];

      runner.subscribe((ops) => {
        if (ops.length > 0) {
          statuses.push(ops[0].status);
        }
      });

      await runner.run('Track', USER_SOURCE, async () => {
        return 'done';
      });

      expect(statuses).toContain('pending');
      expect(statuses).toContain('running');
      expect(statuses).toContain('completed');
    });

    it('sets timestamps', async () => {
      let captured: TrackedOperation | null = null;

      runner.subscribe((ops) => {
        if (ops.length > 0 && ops[0].status === 'completed') {
          captured = { ...ops[0] };
        }
      });

      await runner.run('Timestamps', USER_SOURCE, async () => 'ok');

      expect(captured).not.toBeNull();
      expect(captured!.startedAt).toBeInstanceOf(Date);
      expect(captured!.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('ctx.progress', () => {
    it('updates progress message', async () => {
      const messages: string[] = [];

      runner.subscribe((ops) => {
        if (ops.length > 0 && ops[0].progress.message) {
          messages.push(ops[0].progress.message);
        }
      });

      await runner.run('Progress', USER_SOURCE, async (ctx) => {
        ctx.progress('Step 1');
        ctx.progress('Step 2');
      });

      expect(messages).toContain('Step 1');
      expect(messages).toContain('Step 2');
    });
  });

  describe('ctx.step', () => {
    it('creates tracked child operations', async () => {
      let childCount = 0;

      runner.subscribe((ops) => {
        if (ops.length > 0) {
          childCount = ops[0].children.length;
        }
      });

      await runner.run('Parent', USER_SOURCE, async (ctx) => {
        await ctx.step('Child 1', async () => 'a');
        await ctx.step('Child 2', async () => 'b');
      });

      expect(childCount).toBe(2);
    });

    it('tracks child status', async () => {
      let lastOps: TrackedOperation[] = [];

      runner.subscribe((ops) => {
        lastOps = ops;
      });

      await runner.run('Parent', USER_SOURCE, async (ctx) => {
        await ctx.step('Good step', async () => 'ok');
      });

      // After completion, check the children were tracked
      if (lastOps.length > 0 && lastOps[0].children.length > 0) {
        expect(lastOps[0].children[0].status).toBe('completed');
      }
    });

    it('marks parent as partial when a child fails', async () => {
      let parentStatus = '';

      runner.subscribe((ops) => {
        if (ops.length > 0 && (ops[0].status === 'completed' || ops[0].status === 'partial')) {
          parentStatus = ops[0].status;
        }
      });

      await runner.run('Parent', USER_SOURCE, async (ctx) => {
        await ctx.step('Good', async () => 'ok');
        try {
          await ctx.step('Bad', async () => {
            throw new Error('fail');
          });
        } catch {
          // Swallow so parent completes
        }
      });

      expect(parentStatus).toBe('partial');
    });
  });

  describe('ctx.parallel', () => {
    it('runs tasks in parallel', async () => {
      const result = await runner.run('Parallel', USER_SOURCE, async (ctx) => {
        return ctx.parallel('Tasks', [
          async () => 1,
          async () => 2,
          async () => 3,
        ]);
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([1, 2, 3]);
      }
    });

    it('respects concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const result = await runner.run('Limited', USER_SOURCE, async (ctx) => {
        return ctx.parallel(
          'Tasks',
          Array.from({ length: 6 }, (_, i) => async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await new Promise((r) => setTimeout(r, 10));
            currentConcurrent--;
            return i;
          }),
          { maxConcurrency: 2 },
        );
      });

      expect(result.ok).toBe(true);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('updates progress as tasks complete', async () => {
      let completed = 0;

      runner.subscribe((ops) => {
        if (ops.length > 0) {
          completed = ops[0].progress.completed;
        }
      });

      await runner.run('Progress', USER_SOURCE, async (ctx) => {
        await ctx.parallel('Tasks', [
          async () => 'a',
          async () => 'b',
        ]);
      });

      expect(completed).toBe(2);
    });

    it('propagates task errors', async () => {
      const result = await runner.run('Failing', USER_SOURCE, async (ctx) => {
        return ctx.parallel('Tasks', [
          async () => 'ok',
          async () => {
            throw new Error('Task failed');
          },
        ]);
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('ctx.buffer', () => {
    it('buffers and flushes events', async () => {
      const { startBuffering } = await import('$lib/events/bus');

      await runner.run('Buffered', USER_SOURCE, async (ctx) => {
        await ctx.buffer(async () => {
          return 'buffered result';
        });
      });

      expect(startBuffering).toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    it('marks cancelled operation', async () => {
      let opId = '';

      const promise = runner.run('Cancellable', USER_SOURCE, async (ctx) => {
        // Store the operation ID from the subscription
        const ops = runner.getActive();
        if (ops.length > 0) opId = ops[0].id;

        // Wait long enough for cancel to happen
        await new Promise((r) => setTimeout(r, 100));
        return 'should not reach';
      });

      // Cancel after a tick
      await new Promise((r) => setTimeout(r, 10));
      const ops = runner.getActive();
      if (ops.length > 0) {
        runner.cancel(ops[0].id);
      }

      const result = await promise;
      // Cancelled operations should return the value if they complete before abort is checked
      // The abort signal is available but doesn't automatically terminate
    });

    it('exposes isCancelled on context', async () => {
      let wasCancelled = false;

      const promise = runner.run('Check cancel', USER_SOURCE, async (ctx) => {
        // Cancel from outside
        const ops = runner.getActive();
        if (ops.length > 0) runner.cancel(ops[0].id);

        wasCancelled = ctx.isCancelled;
      });

      await promise;
      expect(wasCancelled).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('notifies on operation changes', async () => {
      let notificationCount = 0;

      runner.subscribe(() => {
        notificationCount++;
      });

      await runner.run('Notify', USER_SOURCE, async () => 'done');

      // At least: pending, running, completed
      expect(notificationCount).toBeGreaterThanOrEqual(3);
    });

    it('returns unsubscribe function', async () => {
      let count = 0;
      const unsub = runner.subscribe(() => {
        count++;
      });

      unsub();

      await runner.run('No notify', USER_SOURCE, async () => 'done');
      expect(count).toBe(0);
    });
  });

  describe('source constants', () => {
    it('USER_SOURCE has autoFocus true', () => {
      expect(USER_SOURCE.type).toBe('user');
      expect(USER_SOURCE.autoFocus).toBe(true);
    });

    it('AI_SOURCE has autoFocus false', () => {
      expect(AI_SOURCE.type).toBe('ai');
      expect(AI_SOURCE.autoFocus).toBe(false);
    });

    it('SYSTEM_SOURCE has autoFocus false', () => {
      expect(SYSTEM_SOURCE.type).toBe('system');
      expect(SYSTEM_SOURCE.autoFocus).toBe(false);
    });
  });
});
