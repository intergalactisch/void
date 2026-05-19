/**
 * Unit tests for ToolExecutorAdapter
 *
 * Tests tool handler registration, execution, cancellation, and batch operations.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolExecutorAdapter } from '$lib/adapters/tools';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolId } from '$lib/domain/values/ToolId';
import { createToolId } from '$lib/domain/values/ToolId';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import { resourceLock } from '$lib/events/queue/ResourceLock';

// Mock the events module
vi.mock('$lib/events', () => ({
  events: { emit: vi.fn() },
}));

// Import the mocked events for assertions
import { events } from '$lib/events';

/**
 * Create a test invocation with default values.
 */
function createTestInvocation(toolId: ToolId = createToolId('note', 'create')) {
  return createInvocation({
    toolId,
    args: { test: 'value' },
    messageId: 'msg-123',
    confirmed: true,
  });
}

describe('ToolExecutorAdapter', () => {
  let adapter: ToolExecutorAdapter;

  beforeEach(() => {
    adapter = new ToolExecutorAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    adapter.clearHandlers();
    resourceLock.clear();
  });

  // =========================================================================
  // Handler Registration
  // =========================================================================

  describe('registerHandler()', () => {
    it('registers a handler for a tool', () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn();

      adapter.registerHandler(toolId, handler);

      expect(adapter.hasHandler(toolId)).toBe(true);
      expect(adapter.getHandlerCount()).toBe(1);
    });

    it('overwrites existing handler for same toolId', () => {
      const toolId = createToolId('note', 'create');
      const handler1 = vi.fn().mockResolvedValue('first');
      const handler2 = vi.fn().mockResolvedValue('second');

      adapter.registerHandler(toolId, handler1);
      adapter.registerHandler(toolId, handler2);

      expect(adapter.getHandlerCount()).toBe(1);
    });

    it('allows registering multiple handlers for different tools', () => {
      const toolId1 = createToolId('note', 'create');
      const toolId2 = createToolId('note', 'read');

      adapter.registerHandler(toolId1, vi.fn());
      adapter.registerHandler(toolId2, vi.fn());

      expect(adapter.getHandlerCount()).toBe(2);
      expect(adapter.hasHandler(toolId1)).toBe(true);
      expect(adapter.hasHandler(toolId2)).toBe(true);
    });
  });

  describe('unregisterHandler()', () => {
    it('removes an existing handler', () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn());

      const result = adapter.unregisterHandler(toolId);

      expect(result).toBe(true);
      expect(adapter.hasHandler(toolId)).toBe(false);
      expect(adapter.getHandlerCount()).toBe(0);
    });

    it('returns false when handler does not exist', () => {
      const toolId = createToolId('note', 'create');

      const result = adapter.unregisterHandler(toolId);

      expect(result).toBe(false);
    });
  });

  describe('hasHandler()', () => {
    it('returns true when handler exists', () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn());

      expect(adapter.hasHandler(toolId)).toBe(true);
    });

    it('returns false when handler does not exist', () => {
      const toolId = createToolId('note', 'create');

      expect(adapter.hasHandler(toolId)).toBe(false);
    });
  });

  // =========================================================================
  // Single Execution
  // =========================================================================

  describe('execute()', () => {
    it('returns success result on successful execution', async () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn().mockResolvedValue({ noteId: 'new-note' });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('success');
      expect(result.toolId).toBe(toolId);
      if (result.status === 'success') {
        expect(result.data).toEqual({ noteId: 'new-note' });
      }
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes args and context to handler', async () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn().mockResolvedValue('result');
      adapter.registerHandler(toolId, handler);

      const invocation = createInvocation({
        toolId,
        args: { title: 'Test Note', content: 'Hello' },
        confirmed: true,
      });

      await adapter.execute(invocation);

      expect(handler).toHaveBeenCalledWith(
        { title: 'Test Note', content: 'Hello' },
        expect.objectContaining({
          invocation,
          reportProgress: expect.any(Function),
          isCancelled: expect.any(Function),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('returns failure result when no handler registered', async () => {
      const toolId = createToolId('note', 'create');
      const invocation = createTestInvocation(toolId);

      const result = await adapter.execute(invocation);

      expect(result.status).toBe('failure');
      if (result.status === 'failure') {
        expect(result.error.message).toContain('No handler registered');
        expect(result.error.message).toContain(toolId);
      }
    });

    it('returns failure result when handler throws', async () => {
      const toolId = createToolId('note', 'create');
      const error = new Error('Handler failed');
      const handler = vi.fn().mockRejectedValue(error);
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('failure');
      if (result.status === 'failure') {
        expect(result.error.message).toBe('Handler failed');
      }
    });

    it('converts non-Error throws to Error', async () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn().mockRejectedValue('string error');
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('failure');
      if (result.status === 'failure') {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });

    it('provides execution context with progress reporting', async () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        context.reportProgress(50, 'Halfway there');
        context.reportProgress(100, 'Done');
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(events.emit).toHaveBeenCalledWith('tool:progress', {
        invocationId: invocation.id,
        progress: 50,
        message: 'Halfway there',
      });
      expect(events.emit).toHaveBeenCalledWith('tool:progress', {
        invocationId: invocation.id,
        progress: 100,
        message: 'Done',
      });
    });

    it('reports progress without message when not provided', async () => {
      const toolId = createToolId('note', 'create');
      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        context.reportProgress(25);
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(events.emit).toHaveBeenCalledWith('tool:progress', {
        invocationId: invocation.id,
        progress: 25,
      });
    });

    it('supports cancellation via context.isCancelled()', async () => {
      const toolId = createToolId('note', 'create');
      let capturedContext: ToolExecutionContext | null = null;

      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        capturedContext = context;
        // Initially not cancelled
        expect(context.isCancelled()).toBe(false);
        // Simulate long operation that checks cancellation
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(capturedContext).not.toBeNull();
    });

    it('emits tool:executing event at start', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn().mockResolvedValue('result'));

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(events.emit).toHaveBeenCalledWith('tool:executing', {
        invocationId: invocation.id,
        toolId,
      });
    });

    it('emits tool:completed event on success', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn().mockResolvedValue('result'));

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(events.emit).toHaveBeenCalledWith(
        'tool:completed',
        expect.objectContaining({
          invocationId: invocation.id,
          result: expect.objectContaining({ status: 'success' }),
        })
      );
    });

    it('emits tool:failed event on failure', async () => {
      const toolId = createToolId('note', 'create');
      const error = new Error('Test error');
      adapter.registerHandler(toolId, vi.fn().mockRejectedValue(error));

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(events.emit).toHaveBeenCalledWith('tool:failed', {
        invocationId: invocation.id,
        error,
      });
    });
  });

  // =========================================================================
  // Sequential Execution
  // =========================================================================

  describe('executeSequence()', () => {
    it('executes invocations in order', async () => {
      const toolId = createToolId('note', 'create');
      const executionOrder: number[] = [];

      const handler = vi.fn().mockImplementation(async (args: { order: number }) => {
        executionOrder.push(args.order);
        return args.order;
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { order: 1 }, confirmed: true }),
        createInvocation({ toolId, args: { order: 2 }, confirmed: true }),
        createInvocation({ toolId, args: { order: 3 }, confirmed: true }),
      ];

      const results = await adapter.executeSequence(invocations);

      expect(executionOrder).toEqual([1, 2, 3]);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'success')).toBe(true);
    });

    it('stops on error when continueOnError is false (default)', async () => {
      const toolId = createToolId('note', 'create');
      let callCount = 0;

      const handler = vi.fn().mockImplementation(async (args: { shouldFail: boolean }) => {
        callCount++;
        if (args.shouldFail) {
          throw new Error('Planned failure');
        }
        return 'ok';
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: true }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
      ];

      const results = await adapter.executeSequence(invocations);

      expect(callCount).toBe(2); // Stopped after second invocation
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('failure');
    });

    it('continues on error when continueOnError is true', async () => {
      const toolId = createToolId('note', 'create');
      let callCount = 0;

      const handler = vi.fn().mockImplementation(async (args: { shouldFail: boolean }) => {
        callCount++;
        if (args.shouldFail) {
          throw new Error('Planned failure');
        }
        return 'ok';
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: true }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
      ];

      const results = await adapter.executeSequence(invocations, true);

      expect(callCount).toBe(3); // All executed
      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('failure');
      expect(results[2].status).toBe('success');
    });

    it('handles empty invocations array', async () => {
      const results = await adapter.executeSequence([]);

      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // Parallel Execution
  // =========================================================================

  describe('executeParallel()', () => {
    it('executes all invocations in parallel', async () => {
      const toolId = createToolId('note', 'read');
      const startTimes: number[] = [];

      const handler = vi.fn().mockImplementation(async (args: { id: number }) => {
        startTimes.push(Date.now());
        // Small delay to verify parallel execution
        await new Promise((resolve) => setTimeout(resolve, 10));
        return args.id;
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { id: 1 }, confirmed: true }),
        createInvocation({ toolId, args: { id: 2 }, confirmed: true }),
        createInvocation({ toolId, args: { id: 3 }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      // All three should have started at roughly the same time (within 5ms)
      expect(startTimes).toHaveLength(3);
      const maxDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxDiff).toBeLessThan(10);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'success')).toBe(true);
    });

    it('returns results in same order as invocations', async () => {
      const toolId = createToolId('note', 'read');

      // Handler with varying delays to ensure order is preserved regardless of completion time
      const handler = vi.fn().mockImplementation(async (args: { id: number; delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, args.delay));
        return args.id;
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { id: 1, delay: 30 }, confirmed: true }),
        createInvocation({ toolId, args: { id: 2, delay: 10 }, confirmed: true }),
        createInvocation({ toolId, args: { id: 3, delay: 20 }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('success');
      expect(results[2].status).toBe('success');
      if (results[0].status === 'success') expect(results[0].data).toBe(1);
      if (results[1].status === 'success') expect(results[1].data).toBe(2);
      if (results[2].status === 'success') expect(results[2].data).toBe(3);
    });

    it('handles failures without affecting other executions', async () => {
      const toolId = createToolId('note', 'read');

      const handler = vi.fn().mockImplementation(async (args: { shouldFail: boolean }) => {
        if (args.shouldFail) {
          throw new Error('Planned failure');
        }
        return 'ok';
      });
      adapter.registerHandler(toolId, handler);

      const invocations = [
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: true }, confirmed: true }),
        createInvocation({ toolId, args: { shouldFail: false }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('failure');
      expect(results[2].status).toBe('success');
    });

    it('handles empty invocations array', async () => {
      const results = await adapter.executeParallel([]);

      expect(results).toEqual([]);
    });

    it('serializes concurrent write tools targeting the same resource', async () => {
      const toolId = createToolId('note', 'update');
      const order: string[] = [];

      adapter.registerHandler(toolId, async (args: { id: string; noteId: string }) => {
        order.push(`start:${args.id}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${args.id}`);
        return args.id;
      });

      const invocations = [
        createInvocation({ toolId, args: { id: 'first', noteId: 'shared.md' }, confirmed: true }),
        createInvocation({ toolId, args: { id: 'second', noteId: 'shared.md' }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      expect(results.every((result) => result.status === 'success')).toBe(true);
      expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    });

    it('adds tool invocation owners to queued resource lock snapshots', async () => {
      const toolId = createToolId('note', 'update');
      let unblockFirst: (() => void) | null = null;
      const firstStarted = new Promise<void>((resolve) => {
        adapter.registerHandler(toolId, async (args: { id: string; noteId: string }) => {
          if (args.id === 'first') {
            resolve();
            await new Promise<void>((unblock) => {
              unblockFirst = unblock;
            });
          }
          return args.id;
        });
      });

      const first = createInvocation({
        toolId,
        args: { id: 'first', noteId: 'shared.md' },
        messageId: 'msg-first',
        confirmed: true,
      });
      const second = createInvocation({
        toolId,
        args: { id: 'second', noteId: 'shared.md' },
        messageId: 'msg-second',
        confirmed: true,
      });

      const firstResult = adapter.execute(first);
      await firstStarted;
      const secondResult = adapter.execute(second);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(resourceLock.snapshot()).toEqual([
        {
          resourceId: 'tool:shared.md',
          held: true,
          queued: 1,
          holder: {
            id: first.id,
            kind: 'tool',
            label: 'note:update',
            toolId: 'note:update',
            messageId: 'msg-first',
          },
          waiters: [{
            id: second.id,
            kind: 'tool',
            label: 'note:update',
            toolId: 'note:update',
            messageId: 'msg-second',
          }],
        },
      ]);

      unblockFirst?.();
      await expect(firstResult).resolves.toMatchObject({ status: 'success' });
      await expect(secondResult).resolves.toMatchObject({ status: 'success' });
    });

    it('allows concurrent write tools targeting different resources', async () => {
      const toolId = createToolId('note', 'update');
      const startTimes: number[] = [];

      adapter.registerHandler(toolId, async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 10));
        return true;
      });

      const invocations = [
        createInvocation({ toolId, args: { noteId: 'first.md' }, confirmed: true }),
        createInvocation({ toolId, args: { noteId: 'second.md' }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      expect(results.every((result) => result.status === 'success')).toBe(true);
      expect(startTimes).toHaveLength(2);
      expect(Math.max(...startTimes) - Math.min(...startTimes)).toBeLessThan(10);
    });

    it('serializes todo creation against the default todo list resource', async () => {
      const toolId = createToolId('todo', 'create');
      const order: string[] = [];

      adapter.registerHandler(toolId, async (args: { title: string }) => {
        order.push(`start:${args.title}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${args.title}`);
        return args.title;
      });

      const invocations = [
        createInvocation({ toolId, args: { title: 'First task' }, confirmed: true }),
        createInvocation({ toolId, args: { title: 'Second task' }, confirmed: true }),
      ];

      const results = await adapter.executeParallel(invocations);

      expect(results.every((result) => result.status === 'success')).toBe(true);
      expect(order).toEqual(['start:First task', 'end:First task', 'start:Second task', 'end:Second task']);
    });
  });

  // =========================================================================
  // Cancellation
  // =========================================================================

  describe('cancel()', () => {
    it('cancels a running execution', async () => {
      const toolId = createToolId('note', 'create');
      let wasCancelled = false;

      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        // Wait a bit and check cancellation
        await new Promise((resolve) => setTimeout(resolve, 50));
        wasCancelled = context.isCancelled();
        if (wasCancelled) {
          throw new Error('Cancelled');
        }
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);

      // Start execution
      const executePromise = adapter.execute(invocation);

      // Cancel after a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cancelled = adapter.cancel(invocation.id);

      const result = await executePromise;

      expect(cancelled).toBe(true);
      expect(wasCancelled).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('returns false when invocation is not executing', () => {
      const result = adapter.cancel('non-existent-id');

      expect(result).toBe(false);
    });

    it('emits tool:cancelled event', async () => {
      const toolId = createToolId('note', 'create');

      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (context.isCancelled()) {
          throw new Error('Cancelled');
        }
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const executePromise = adapter.execute(invocation);

      await new Promise((resolve) => setTimeout(resolve, 10));
      adapter.cancel(invocation.id);

      await executePromise;

      expect(events.emit).toHaveBeenCalledWith('tool:cancelled', {
        invocationId: invocation.id,
      });
    });
  });

  describe('cancelAll()', () => {
    it('cancels all running executions', async () => {
      const toolId = createToolId('note', 'create');
      const cancelledStates: boolean[] = [];

      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        cancelledStates.push(context.isCancelled());
        if (context.isCancelled()) {
          throw new Error('Cancelled');
        }
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation1 = createTestInvocation(toolId);
      const invocation2 = createTestInvocation(toolId);
      const invocation3 = createTestInvocation(toolId);

      // Start all executions in parallel
      const promises = [
        adapter.execute(invocation1),
        adapter.execute(invocation2),
        adapter.execute(invocation3),
      ];

      // Cancel all after a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      adapter.cancelAll();

      const results = await Promise.all(promises);

      expect(cancelledStates.every((state) => state === true)).toBe(true);
      expect(results.every((r) => r.status === 'cancelled')).toBe(true);
    });
  });

  // =========================================================================
  // Execution State
  // =========================================================================

  describe('isExecuting()', () => {
    it('returns true during execution', async () => {
      const toolId = createToolId('note', 'create');
      let wasExecutingDuringRun = false;

      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const executePromise = adapter.execute(invocation);

      // Check during execution
      await new Promise((resolve) => setTimeout(resolve, 10));
      wasExecutingDuringRun = adapter.isExecuting(invocation.id);

      await executePromise;

      expect(wasExecutingDuringRun).toBe(true);
      expect(adapter.isExecuting(invocation.id)).toBe(false);
    });

    it('returns false for unknown invocation', () => {
      expect(adapter.isExecuting('unknown-id')).toBe(false);
    });

    it('returns false after execution completes', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn().mockResolvedValue('result'));

      const invocation = createTestInvocation(toolId);
      await adapter.execute(invocation);

      expect(adapter.isExecuting(invocation.id)).toBe(false);
    });
  });

  describe('getExecutingIds()', () => {
    it('returns list of running invocation IDs', async () => {
      const toolId = createToolId('note', 'create');
      let capturedIds: string[] = [];

      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation1 = createTestInvocation(toolId);
      const invocation2 = createTestInvocation(toolId);

      // Start executions
      const promise1 = adapter.execute(invocation1);
      const promise2 = adapter.execute(invocation2);

      // Capture executing IDs
      await new Promise((resolve) => setTimeout(resolve, 10));
      capturedIds = adapter.getExecutingIds();

      // Wait for completion
      await Promise.all([promise1, promise2]);

      expect(capturedIds).toHaveLength(2);
      expect(capturedIds).toContain(invocation1.id);
      expect(capturedIds).toContain(invocation2.id);
      expect(adapter.getExecutingIds()).toEqual([]);
    });

    it('returns empty array when nothing is executing', () => {
      expect(adapter.getExecutingIds()).toEqual([]);
    });
  });

  // =========================================================================
  // Testing Utilities
  // =========================================================================

  describe('getHandlerCount()', () => {
    it('returns number of registered handlers', () => {
      expect(adapter.getHandlerCount()).toBe(0);

      adapter.registerHandler(createToolId('note', 'create'), vi.fn());
      expect(adapter.getHandlerCount()).toBe(1);

      adapter.registerHandler(createToolId('note', 'read'), vi.fn());
      expect(adapter.getHandlerCount()).toBe(2);
    });
  });

  describe('getRegisteredToolIds()', () => {
    it('returns array of registered tool IDs', () => {
      const toolId1 = createToolId('note', 'create');
      const toolId2 = createToolId('note', 'read');

      adapter.registerHandler(toolId1, vi.fn());
      adapter.registerHandler(toolId2, vi.fn());

      const ids = adapter.getRegisteredToolIds();

      expect(ids).toHaveLength(2);
      expect(ids).toContain(toolId1);
      expect(ids).toContain(toolId2);
    });

    it('returns empty array when no handlers registered', () => {
      expect(adapter.getRegisteredToolIds()).toEqual([]);
    });
  });

  describe('clearHandlers()', () => {
    it('removes all registered handlers', () => {
      adapter.registerHandler(createToolId('note', 'create'), vi.fn());
      adapter.registerHandler(createToolId('note', 'read'), vi.fn());

      expect(adapter.getHandlerCount()).toBe(2);

      adapter.clearHandlers();

      expect(adapter.getHandlerCount()).toBe(0);
      expect(adapter.getRegisteredToolIds()).toEqual([]);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles handler returning undefined', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn().mockResolvedValue(undefined));

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.data).toBeUndefined();
      }
    });

    it('handles handler returning null', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, vi.fn().mockResolvedValue(null));

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.data).toBeNull();
      }
    });

    it('handles synchronous handler errors', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, () => {
        throw new Error('Sync error');
      });

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.status).toBe('failure');
      if (result.status === 'failure') {
        expect(result.error.message).toBe('Sync error');
      }
    });

    it('measures execution duration', async () => {
      const toolId = createToolId('note', 'create');
      adapter.registerHandler(toolId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'result';
      });

      const invocation = createTestInvocation(toolId);
      const result = await adapter.execute(invocation);

      expect(result.durationMs).toBeGreaterThanOrEqual(20);
      expect(result.durationMs).toBeLessThan(100);
    });

    it('returns cancelled result when abort signal is already aborted during execution', async () => {
      const toolId = createToolId('note', 'create');

      // Handler that returns successfully but we cancel before completion check
      const handler = vi.fn().mockImplementation(async (_args, context: ToolExecutionContext) => {
        // Simulate operation
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'result';
      });
      adapter.registerHandler(toolId, handler);

      const invocation = createTestInvocation(toolId);
      const executePromise = adapter.execute(invocation);

      // Cancel immediately
      adapter.cancel(invocation.id);

      const result = await executePromise;

      // The result should be cancelled because we aborted
      expect(result.status).toBe('cancelled');
    });
  });
});
