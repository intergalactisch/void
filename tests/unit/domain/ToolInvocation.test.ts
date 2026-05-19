/**
 * Unit tests for ToolInvocation entity
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createInvocation,
  startInvocation,
  updateProgress,
  completeInvocation,
  cancelInvocation,
  confirmInvocation,
  isTerminal,
  isPending,
  isExecuting,
  isSuccessful,
  needsConfirmation,
  getDuration,
  summarizeInvocation,
  serializeInvocation,
} from '$lib/domain/entities/ToolInvocation';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import { createToolId } from '$lib/domain/values/ToolId';
import { toolSuccess, toolFailure, toolPartial, toolCancelled } from '$lib/domain/values/ToolResult';
import type { ToolId } from '$lib/domain/values/ToolId';

// Helper to create a test tool ID
function testToolId(action: string): ToolId {
  return createToolId('note', action);
}

describe('ToolInvocation entity', () => {
  describe('createInvocation()', () => {
    it('creates invocation with required params', () => {
      const toolId = testToolId('create');
      const invocation = createInvocation({
        toolId,
        args: { title: 'Test' },
      });

      expect(invocation.id).toMatch(/^inv_\d+_[a-z0-9]+$/);
      expect(invocation.toolId).toBe(toolId);
      expect(invocation.args).toEqual({ title: 'Test' });
      expect(invocation.status).toBe('pending');
      expect(invocation.createdAt).toBeInstanceOf(Date);
      expect(invocation.startedAt).toBeNull();
      expect(invocation.completedAt).toBeNull();
      expect(invocation.result).toBeNull();
      expect(invocation.progress).toBe(0);
      expect(invocation.message).toBeNull();
      expect(invocation.confirmed).toBe(false);
      expect(invocation.messageId).toBeNull();
    });

    it('creates invocation with messageId', () => {
      const invocation = createInvocation({
        toolId: testToolId('read'),
        args: {},
        messageId: 'msg-123',
      });

      expect(invocation.messageId).toBe('msg-123');
    });

    it('creates invocation with confirmed flag', () => {
      const invocation = createInvocation({
        toolId: testToolId('delete'),
        args: { id: '1' },
        confirmed: true,
      });

      expect(invocation.confirmed).toBe(true);
    });

    it('creates unique IDs for each invocation', () => {
      const inv1 = createInvocation({ toolId: testToolId('a'), args: {} });
      const inv2 = createInvocation({ toolId: testToolId('b'), args: {} });
      expect(inv1.id).not.toBe(inv2.id);
    });

    it('creates invocation with empty args', () => {
      const invocation = createInvocation({
        toolId: testToolId('list'),
        args: {},
      });

      expect(invocation.args).toEqual({});
    });

    it('creates invocation with complex args', () => {
      const complexArgs = {
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value' },
      };

      const invocation = createInvocation({
        toolId: testToolId('complex'),
        args: complexArgs,
      });

      expect(invocation.args).toEqual(complexArgs);
    });
  });

  describe('startInvocation()', () => {
    it('transitions from pending to executing', () => {
      const invocation = createInvocation({
        toolId: testToolId('test'),
        args: {},
      });

      const started = startInvocation(invocation);

      expect(started.status).toBe('executing');
      expect(started.startedAt).toBeInstanceOf(Date);
      expect(started.message).toBe('Executing...');
    });

    it('preserves original invocation immutably', () => {
      const invocation = createInvocation({
        toolId: testToolId('test'),
        args: {},
      });

      const started = startInvocation(invocation);

      expect(invocation.status).toBe('pending');
      expect(invocation.startedAt).toBeNull();
      expect(started).not.toBe(invocation);
    });

    it('throws error when starting from executing state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      expect(() => startInvocation(started)).toThrow('Cannot start invocation in executing state');
    });

    it('throws error when starting from completed state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(testToolId('test'), {}, new Date());
      const completed = completeInvocation(started, result);

      expect(() => startInvocation(completed)).toThrow('Cannot start invocation in completed state');
    });

    it('throws error when starting from cancelled state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const cancelled = cancelInvocation(invocation, 'User cancelled');

      expect(() => startInvocation(cancelled)).toThrow('Cannot start invocation in cancelled state');
    });
  });

  describe('updateProgress()', () => {
    it('updates progress value', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const updated = updateProgress(started, 50);

      expect(updated.progress).toBe(50);
    });

    it('updates progress with message', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const updated = updateProgress(started, 75, 'Processing...');

      expect(updated.progress).toBe(75);
      expect(updated.message).toBe('Processing...');
    });

    it('preserves existing message when not provided', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      const withMessage = updateProgress(started, 25, 'First message');

      const updated = updateProgress(withMessage, 50);

      expect(updated.message).toBe('First message');
    });

    it('clamps progress to 0-100 range', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const tooLow = updateProgress(started, -10);
      expect(tooLow.progress).toBe(0);

      const tooHigh = updateProgress(started, 150);
      expect(tooHigh.progress).toBe(100);
    });

    it('throws error when not in executing state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });

      expect(() => updateProgress(invocation, 50)).toThrow('Cannot update progress in pending state');
    });

    it('throws error when in completed state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(testToolId('test'), {}, new Date());
      const completed = completeInvocation(started, result);

      expect(() => updateProgress(completed, 50)).toThrow('Cannot update progress in completed state');
    });
  });

  describe('completeInvocation()', () => {
    it('completes with success result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, { data: 'value' }, started.startedAt!);

      const completed = completeInvocation(started, result);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.result).toBe(result);
      expect(completed.progress).toBe(100);
      expect(completed.message).toBe('Completed');
    });

    it('completes with partial result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolPartial(toolId, { partial: 'data' }, started.startedAt!, [
        { severity: 'warning', text: 'Some items skipped' },
      ]);

      const completed = completeInvocation(started, result);

      expect(completed.status).toBe('completed');
      expect(completed.message).toBe('Completed');
    });

    it('completes with failure result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolFailure(toolId, new Error('Something went wrong'), started.startedAt!);

      const completed = completeInvocation(started, result);

      expect(completed.status).toBe('failed');
      expect(completed.message).toBe('Failed');
    });

    it('completes with cancelled result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolCancelled(toolId, 'User cancelled', started.startedAt!);

      const completed = completeInvocation(started, result);

      expect(completed.status).toBe('cancelled');
      expect(completed.message).toBe('Cancelled');
    });

    it('throws error when not in executing state', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const result = toolSuccess(toolId, {}, new Date());

      expect(() => completeInvocation(invocation, result)).toThrow(
        'Cannot complete invocation in pending state'
      );
    });
  });

  describe('cancelInvocation()', () => {
    it('cancels from pending state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });

      const cancelled = cancelInvocation(invocation, 'User requested');

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completedAt).toBeInstanceOf(Date);
      expect(cancelled.message).toBe('User requested');
    });

    it('cancels from executing state', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const cancelled = cancelInvocation(started, 'Timeout');

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.message).toBe('Timeout');
    });

    it('throws error when cancelling completed invocation', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);

      expect(() => cancelInvocation(completed, 'Too late')).toThrow(
        'Cannot cancel invocation in completed state'
      );
    });

    it('throws error when cancelling failed invocation', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolFailure(toolId, new Error('Failed'), new Date());
      const failed = completeInvocation(started, result);

      expect(() => cancelInvocation(failed, 'Too late')).toThrow(
        'Cannot cancel invocation in failed state'
      );
    });

    it('throws error when cancelling already cancelled invocation', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const cancelled = cancelInvocation(invocation, 'First cancel');

      expect(() => cancelInvocation(cancelled, 'Second cancel')).toThrow(
        'Cannot cancel invocation in cancelled state'
      );
    });
  });

  describe('confirmInvocation()', () => {
    it('confirms pending invocation', () => {
      const invocation = createInvocation({
        toolId: testToolId('delete'),
        args: { id: '1' },
        confirmed: false,
      });

      const confirmed = confirmInvocation(invocation);

      expect(confirmed.confirmed).toBe(true);
      expect(confirmed.status).toBe('pending');
    });

    it('preserves other fields', () => {
      const invocation = createInvocation({
        toolId: testToolId('delete'),
        args: { id: '1' },
        messageId: 'msg-1',
      });

      const confirmed = confirmInvocation(invocation);

      expect(confirmed.toolId).toBe(invocation.toolId);
      expect(confirmed.args).toEqual(invocation.args);
      expect(confirmed.messageId).toBe(invocation.messageId);
    });

    it('throws error when confirming non-pending invocation', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      expect(() => confirmInvocation(started)).toThrow(
        'Cannot confirm invocation in executing state'
      );
    });
  });

  describe('isTerminal()', () => {
    it('returns false for pending', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(isTerminal(invocation)).toBe(false);
    });

    it('returns false for executing', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      expect(isTerminal(started)).toBe(false);
    });

    it('returns true for completed', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);
      expect(isTerminal(completed)).toBe(true);
    });

    it('returns true for failed', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolFailure(toolId, new Error('Error'), new Date());
      const failed = completeInvocation(started, result);
      expect(isTerminal(failed)).toBe(true);
    });

    it('returns true for cancelled', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const cancelled = cancelInvocation(invocation, 'Cancelled');
      expect(isTerminal(cancelled)).toBe(true);
    });
  });

  describe('isPending()', () => {
    it('returns true for pending', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(isPending(invocation)).toBe(true);
    });

    it('returns false for executing', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      expect(isPending(started)).toBe(false);
    });

    it('returns false for completed', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);
      expect(isPending(completed)).toBe(false);
    });
  });

  describe('isExecuting()', () => {
    it('returns false for pending', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(isExecuting(invocation)).toBe(false);
    });

    it('returns true for executing', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      expect(isExecuting(started)).toBe(true);
    });

    it('returns false for completed', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);
      expect(isExecuting(completed)).toBe(false);
    });
  });

  describe('isSuccessful()', () => {
    it('returns false for pending', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(isSuccessful(invocation)).toBe(false);
    });

    it('returns false for executing', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      expect(isSuccessful(started)).toBe(false);
    });

    it('returns true for success result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, { data: 'test' }, new Date());
      const completed = completeInvocation(started, result);
      expect(isSuccessful(completed)).toBe(true);
    });

    it('returns false for partial result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolPartial(toolId, {}, new Date(), [{ severity: 'warning', text: 'Warning' }]);
      const completed = completeInvocation(started, result);
      expect(isSuccessful(completed)).toBe(false);
    });

    it('returns false for failed result', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolFailure(toolId, new Error('Error'), new Date());
      const failed = completeInvocation(started, result);
      expect(isSuccessful(failed)).toBe(false);
    });

    it('returns false for cancelled', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const cancelled = cancelInvocation(invocation, 'Cancelled');
      expect(isSuccessful(cancelled)).toBe(false);
    });
  });

  describe('needsConfirmation()', () => {
    it('returns true for pending unconfirmed', () => {
      const invocation = createInvocation({
        toolId: testToolId('delete'),
        args: {},
        confirmed: false,
      });
      expect(needsConfirmation(invocation)).toBe(true);
    });

    it('returns false for pending confirmed', () => {
      const invocation = createInvocation({
        toolId: testToolId('delete'),
        args: {},
        confirmed: true,
      });
      expect(needsConfirmation(invocation)).toBe(false);
    });

    it('returns false for executing', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);
      expect(needsConfirmation(started)).toBe(false);
    });

    it('returns false for completed', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);
      expect(needsConfirmation(completed)).toBe(false);
    });
  });

  describe('getDuration()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 0 for pending invocation', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(getDuration(invocation)).toBe(0);
    });

    it('returns elapsed time for executing invocation', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      vi.advanceTimersByTime(500);

      expect(getDuration(started)).toBe(500);
    });

    it('returns total duration for completed invocation', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);

      vi.advanceTimersByTime(250);

      const result = toolSuccess(toolId, {}, started.startedAt!);
      const completed = completeInvocation(started, result);

      // Advance more time - should not affect completed duration
      vi.advanceTimersByTime(1000);

      expect(getDuration(completed)).toBe(250);
    });
  });

  describe('summarizeInvocation()', () => {
    it('summarizes invocation with no args', () => {
      const invocation = createInvocation({
        toolId: testToolId('list'),
        args: {},
      });

      const summary = summarizeInvocation(invocation);
      expect(summary).toBe('note:list() [pending]');
    });

    it('summarizes invocation with args', () => {
      const invocation = createInvocation({
        toolId: testToolId('create'),
        args: { title: 'My Note', content: 'Hello' },
      });

      const summary = summarizeInvocation(invocation);
      expect(summary).toContain('note:create(');
      expect(summary).toContain('title="My Note"');
      expect(summary).toContain('[pending]');
    });

    it('truncates long arg lists', () => {
      const invocation = createInvocation({
        toolId: testToolId('update'),
        args: { a: 1, b: 2, c: 3, d: 4, e: 5 },
      });

      const summary = summarizeInvocation(invocation);
      expect(summary).toContain('...');
      // Should only show first 3 args
      expect(summary).toContain('a=1');
      expect(summary).toContain('b=2');
      expect(summary).toContain('c=3');
    });

    it('shows status in summary', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      expect(summarizeInvocation(invocation)).toContain('[pending]');

      const started = startInvocation(invocation);
      expect(summarizeInvocation(started)).toContain('[executing]');

      const cancelled = cancelInvocation(invocation, 'Cancelled');
      expect(summarizeInvocation(cancelled)).toContain('[cancelled]');
    });
  });

  describe('serializeInvocation()', () => {
    it('serializes pending invocation', () => {
      const invocation = createInvocation({
        toolId: testToolId('create'),
        args: { title: 'Test' },
        messageId: 'msg-1',
      });

      const serialized = serializeInvocation(invocation);

      expect(serialized.id).toBe(invocation.id);
      expect(serialized.toolId).toBe('note:create');
      expect(serialized.args).toEqual({ title: 'Test' });
      expect(serialized.status).toBe('pending');
      expect(typeof serialized.createdAt).toBe('string');
      expect(serialized.startedAt).toBeNull();
      expect(serialized.completedAt).toBeNull();
      expect(serialized.progress).toBe(0);
      expect(serialized.message).toBeNull();
      expect(serialized.messageId).toBe('msg-1');
    });

    it('serializes executing invocation', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const serialized = serializeInvocation(started);

      expect(serialized.status).toBe('executing');
      expect(typeof serialized.startedAt).toBe('string');
      expect(serialized.completedAt).toBeNull();
    });

    it('serializes completed invocation', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, {}, new Date());
      const completed = completeInvocation(started, result);

      const serialized = serializeInvocation(completed);

      expect(serialized.status).toBe('completed');
      expect(typeof serialized.startedAt).toBe('string');
      expect(typeof serialized.completedAt).toBe('string');
      expect(serialized.progress).toBe(100);
    });

    it('produces valid ISO date strings', () => {
      const invocation = createInvocation({ toolId: testToolId('test'), args: {} });
      const started = startInvocation(invocation);

      const serialized = serializeInvocation(started);

      // Should be parseable as ISO date
      expect(() => new Date(serialized.createdAt as string)).not.toThrow();
      expect(() => new Date(serialized.startedAt as string)).not.toThrow();
    });

    it('does not include result in serialization', () => {
      const toolId = testToolId('test');
      const invocation = createInvocation({ toolId, args: {} });
      const started = startInvocation(invocation);
      const result = toolSuccess(toolId, { sensitive: 'data' }, new Date());
      const completed = completeInvocation(started, result);

      const serialized = serializeInvocation(completed);

      expect(serialized).not.toHaveProperty('result');
    });
  });
});
