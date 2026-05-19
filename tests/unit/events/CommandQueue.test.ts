/**
 * CommandQueue Unit Tests
 *
 * Tests for the sequential command processor with resource locking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandQueue } from '$lib/events/queue/CommandQueue';
import { createCommand, commandSuccess, commandFailure } from '$lib/events/commands';

// Mock the events module
vi.mock('$lib/events/bus', () => ({
  events: {
    emit: vi.fn(),
  },
}));

describe('CommandQueue', () => {
  let queue: CommandQueue;

  beforeEach(() => {
    queue = new CommandQueue({ emitLifecycleEvents: false, devLogging: false });
    vi.clearAllMocks();
  });

  describe('registerHandler', () => {
    it('registers a handler for a command type', () => {
      queue.registerHandler('test:command', async () => commandSuccess('id', undefined));

      expect(queue.hasHandler('test:command')).toBe(true);
      expect(queue.hasHandler('unknown:command')).toBe(false);
    });

    it('allows overwriting handlers with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      queue.registerHandler('test:command', async () => commandSuccess('id', 'first'));
      queue.registerHandler('test:command', async () => commandSuccess('id', 'second'));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[CommandQueue] Overwriting handler for command type: test:command'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('dispatch', () => {
    it('returns error for unregistered command type', async () => {
      const command = createCommand('unknown:command', {});
      const result = await queue.dispatch(command);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('No handler registered');
      }
    });

    it('executes handler and returns result', async () => {
      queue.registerHandler('test:command', async (cmd) => {
        return commandSuccess(cmd.id, 'result');
      });

      const command = createCommand('test:command', { value: 42 });
      const result = await queue.dispatch<string>(command);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('result');
      }
    });

    it('catches handler errors and returns failure', async () => {
      queue.registerHandler('test:command', async () => {
        throw new Error('Handler error');
      });

      const command = createCommand('test:command', {});
      const result = await queue.dispatch(command);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('Handler error');
      }
    });

    it('processes commands without resourceId in global queue', async () => {
      const executionOrder: number[] = [];

      queue.registerHandler('test:command', async (cmd) => {
        const order = (cmd.payload as { order: number }).order;
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push(order);
        return commandSuccess(cmd.id, undefined);
      });

      // Dispatch multiple commands without resourceId
      const p1 = queue.dispatch(createCommand('test:command', { order: 1 }));
      const p2 = queue.dispatch(createCommand('test:command', { order: 2 }));
      const p3 = queue.dispatch(createCommand('test:command', { order: 3 }));

      await Promise.all([p1, p2, p3]);

      // Should be processed in FIFO order
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('processes commands with same resourceId sequentially', async () => {
      const executionOrder: number[] = [];
      let concurrent = 0;
      let maxConcurrent = 0;

      queue.registerHandler('test:command', async (cmd) => {
        const order = (cmd.payload as { order: number }).order;
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push(order);
        concurrent--;
        return commandSuccess(cmd.id, undefined);
      });

      // Same resourceId should be sequential
      const p1 = queue.dispatch(createCommand('test:command', { order: 1 }, 'resource-1'));
      const p2 = queue.dispatch(createCommand('test:command', { order: 2 }, 'resource-1'));
      const p3 = queue.dispatch(createCommand('test:command', { order: 3 }, 'resource-1'));

      await Promise.all([p1, p2, p3]);

      expect(executionOrder).toEqual([1, 2, 3]);
      expect(maxConcurrent).toBe(1); // Never more than 1 concurrent for same resource
    });

    it('allows parallel execution for different resources', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      queue.registerHandler('test:command', async (cmd) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return commandSuccess(cmd.id, undefined);
      });

      // Different resourceIds should process in parallel
      const p1 = queue.dispatch(createCommand('test:command', {}, 'resource-1'));
      const p2 = queue.dispatch(createCommand('test:command', {}, 'resource-2'));
      const p3 = queue.dispatch(createCommand('test:command', {}, 'resource-3'));

      await Promise.all([p1, p2, p3]);

      // Should have run in parallel
      expect(maxConcurrent).toBe(3);
    });
  });

  describe('isResourceLocked', () => {
    it('returns false for unlocked resource', () => {
      expect(queue.isResourceLocked('resource-1')).toBe(false);
    });

    it('returns true while command is processing', async () => {
      let isLockedDuringExecution = false;

      queue.registerHandler('test:command', async () => {
        isLockedDuringExecution = queue.isResourceLocked('resource-1');
        await new Promise((r) => setTimeout(r, 10));
        return commandSuccess('id', undefined);
      });

      await queue.dispatch(createCommand('test:command', {}, 'resource-1'));

      expect(isLockedDuringExecution).toBe(true);
      expect(queue.isResourceLocked('resource-1')).toBe(false);
    });
  });

  describe('pendingCount', () => {
    it('returns 0 when no commands are pending', () => {
      expect(queue.pendingCount).toBe(0);
    });
  });

  describe('resourceQueueLength', () => {
    it('returns queue length for a resource', async () => {
      queue.registerHandler('test:command', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return commandSuccess('id', undefined);
      });

      // Start processing one command
      queue.dispatch(createCommand('test:command', {}, 'resource-1'));

      // Queue more
      queue.dispatch(createCommand('test:command', {}, 'resource-1'));
      queue.dispatch(createCommand('test:command', {}, 'resource-1'));

      // Wait a tick for first to start
      await new Promise((r) => setTimeout(r, 10));

      expect(queue.resourceQueueLength('resource-1')).toBe(2);
    });
  });

  describe('clear', () => {
    it('clears handlers and queues', () => {
      queue.registerHandler('test:command', async () => commandSuccess('id', undefined));

      expect(queue.hasHandler('test:command')).toBe(true);

      queue.clear();

      expect(queue.hasHandler('test:command')).toBe(false);
    });
  });
});
