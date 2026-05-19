/**
 * Unit tests for ToolResult value object
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toolSuccess,
  toolPartial,
  toolFailure,
  toolCancelled,
  isToolSuccess,
  isToolPartial,
  isToolFailure,
  isToolCancelled,
  isToolCompleted,
  getToolData,
  serializeToolResult,
} from '$lib/domain/values/ToolResult';
import type {
  ToolResult,
  ToolResultSuccess,
  ToolResultPartial,
  ToolResultFailure,
  ToolResultCancelled,
  ResultMessage,
} from '$lib/domain/values/ToolResult';
import type { ToolId } from '$lib/domain/values/ToolId';

describe('ToolResult value object', () => {
  // Use a fixed timestamp for consistent testing
  let mockDate: Date;
  let startedAt: Date;
  const testToolId = 'note:create' as ToolId;

  beforeEach(() => {
    mockDate = new Date('2024-01-15T10:30:00.000Z');
    startedAt = new Date('2024-01-15T10:29:59.000Z'); // 1 second before mock date
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('toolSuccess()', () => {
    it('creates a success result with data', () => {
      const data = { title: 'New Note', id: 'note-123' };
      const result = toolSuccess(testToolId, data, startedAt);

      expect(result.status).toBe('success');
      expect(result.toolId).toBe(testToolId);
      expect(result.data).toEqual(data);
      expect(result.startedAt).toBe(startedAt);
      expect(result.completedAt).toEqual(mockDate);
      expect(result.durationMs).toBe(1000);
    });

    it('creates a success result without messages', () => {
      const result = toolSuccess(testToolId, 'simple data', startedAt);

      expect(result.status).toBe('success');
      expect(result.messages).toBeUndefined();
    });

    it('creates a success result with messages', () => {
      const messages: ResultMessage[] = [
        { severity: 'info', text: 'Note created successfully' },
        { severity: 'info', text: 'Tags applied', code: 'TAGS_APPLIED' },
      ];
      const result = toolSuccess(testToolId, { id: 1 }, startedAt, messages);

      expect(result.status).toBe('success');
      expect(result.messages).toEqual(messages);
      expect(result.messages).toHaveLength(2);
    });

    it('calculates duration correctly', () => {
      const earlyStart = new Date('2024-01-15T10:00:00.000Z'); // 30 minutes before
      const result = toolSuccess(testToolId, null, earlyStart);

      expect(result.durationMs).toBe(30 * 60 * 1000); // 30 minutes in ms
    });

    it('handles various data types', () => {
      expect(toolSuccess(testToolId, null, startedAt).data).toBe(null);
      expect(toolSuccess(testToolId, 42, startedAt).data).toBe(42);
      expect(toolSuccess(testToolId, 'string', startedAt).data).toBe('string');
      expect(toolSuccess(testToolId, [1, 2, 3], startedAt).data).toEqual([1, 2, 3]);
      expect(toolSuccess(testToolId, { nested: { value: true } }, startedAt).data).toEqual({
        nested: { value: true },
      });
    });
  });

  describe('toolPartial()', () => {
    it('creates a partial result with data and messages', () => {
      const data = { items: ['a', 'b'], skipped: 2 };
      const messages: ResultMessage[] = [
        { severity: 'warning', text: '2 items could not be processed' },
      ];
      const result = toolPartial(testToolId, data, startedAt, messages);

      expect(result.status).toBe('partial');
      expect(result.toolId).toBe(testToolId);
      expect(result.data).toEqual(data);
      expect(result.messages).toEqual(messages);
      expect(result.startedAt).toBe(startedAt);
      expect(result.completedAt).toEqual(mockDate);
      expect(result.durationMs).toBe(1000);
    });

    it('requires messages array (cannot be empty for semantics)', () => {
      const messages: ResultMessage[] = [
        { severity: 'warning', text: 'Some items skipped', code: 'PARTIAL_SKIP' },
      ];
      const result = toolPartial(testToolId, {}, startedAt, messages);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.severity).toBe('warning');
    });

    it('supports multiple warning messages', () => {
      const messages: ResultMessage[] = [
        { severity: 'warning', text: 'First warning' },
        { severity: 'warning', text: 'Second warning' },
        { severity: 'error', text: 'Non-fatal error' },
      ];
      const result = toolPartial(testToolId, { partial: true }, startedAt, messages);

      expect(result.messages).toHaveLength(3);
    });
  });

  describe('toolFailure()', () => {
    it('creates a failure result with error', () => {
      const error = new Error('Database connection failed');
      const result = toolFailure(testToolId, error, startedAt);

      expect(result.status).toBe('failure');
      expect(result.toolId).toBe(testToolId);
      expect(result.error).toBe(error);
      expect(result.error.message).toBe('Database connection failed');
      expect(result.startedAt).toBe(startedAt);
      expect(result.completedAt).toEqual(mockDate);
      expect(result.durationMs).toBe(1000);
    });

    it('creates a failure result without additional messages', () => {
      const error = new Error('Simple failure');
      const result = toolFailure(testToolId, error, startedAt);

      expect(result.messages).toBeUndefined();
    });

    it('creates a failure result with additional messages', () => {
      const error = new Error('Validation failed');
      const messages: ResultMessage[] = [
        { severity: 'error', text: 'Field "title" is required' },
        { severity: 'error', text: 'Field "content" must not be empty' },
      ];
      const result = toolFailure(testToolId, error, startedAt, messages);

      expect(result.messages).toEqual(messages);
      expect(result.messages).toHaveLength(2);
    });

    it('preserves error stack trace', () => {
      const error = new Error('With stack');
      const result = toolFailure(testToolId, error, startedAt);

      expect(result.error.stack).toBeDefined();
      expect(result.error.stack).toContain('Error: With stack');
    });

    it('serializes failure errors with their message for persisted chat logs', () => {
      const error = new Error('Document paths must be relative');
      const result = toolFailure(testToolId, error, startedAt);
      const serialized = JSON.parse(JSON.stringify(result)) as { error: { name: string; message: string } };

      expect(serialized.error).toEqual({
        name: 'Error',
        message: 'Document paths must be relative',
      });
    });
  });

  describe('toolCancelled()', () => {
    it('creates a cancelled result with reason', () => {
      const reason = 'User cancelled the operation';
      const result = toolCancelled(testToolId, reason, startedAt);

      expect(result.status).toBe('cancelled');
      expect(result.toolId).toBe(testToolId);
      expect(result.reason).toBe(reason);
      expect(result.startedAt).toBe(startedAt);
      expect(result.completedAt).toEqual(mockDate);
      expect(result.durationMs).toBe(1000);
    });

    it('handles empty reason string', () => {
      const result = toolCancelled(testToolId, '', startedAt);

      expect(result.status).toBe('cancelled');
      expect(result.reason).toBe('');
    });

    it('handles detailed cancellation reasons', () => {
      const reason = 'Operation timed out after 30 seconds - external service unavailable';
      const result = toolCancelled(testToolId, reason, startedAt);

      expect(result.reason).toBe(reason);
    });
  });

  describe('isToolSuccess()', () => {
    it('returns true for success result', () => {
      const result = toolSuccess(testToolId, { data: 1 }, startedAt);
      expect(isToolSuccess(result)).toBe(true);
    });

    it('returns false for partial result', () => {
      const result = toolPartial(testToolId, {}, startedAt, [
        { severity: 'warning', text: 'warning' },
      ]);
      expect(isToolSuccess(result)).toBe(false);
    });

    it('returns false for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(isToolSuccess(result)).toBe(false);
    });

    it('returns false for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(isToolSuccess(result)).toBe(false);
    });

    it('works as type guard', () => {
      const result: ToolResult<{ id: number }> = toolSuccess(testToolId, { id: 42 }, startedAt);
      if (isToolSuccess(result)) {
        // TypeScript should know result.data exists and is { id: number }
        expect(result.data.id).toBe(42);
      }
    });
  });

  describe('isToolPartial()', () => {
    it('returns true for partial result', () => {
      const result = toolPartial(testToolId, {}, startedAt, [
        { severity: 'warning', text: 'warning' },
      ]);
      expect(isToolPartial(result)).toBe(true);
    });

    it('returns false for success result', () => {
      const result = toolSuccess(testToolId, {}, startedAt);
      expect(isToolPartial(result)).toBe(false);
    });

    it('returns false for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(isToolPartial(result)).toBe(false);
    });

    it('returns false for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(isToolPartial(result)).toBe(false);
    });

    it('works as type guard', () => {
      const result: ToolResult<string[]> = toolPartial(testToolId, ['a', 'b'], startedAt, [
        { severity: 'warning', text: 'Some skipped' },
      ]);
      if (isToolPartial(result)) {
        // TypeScript should know result.data and result.messages exist
        expect(result.data).toEqual(['a', 'b']);
        expect(result.messages).toHaveLength(1);
      }
    });
  });

  describe('isToolFailure()', () => {
    it('returns true for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(isToolFailure(result)).toBe(true);
    });

    it('returns false for success result', () => {
      const result = toolSuccess(testToolId, {}, startedAt);
      expect(isToolFailure(result)).toBe(false);
    });

    it('returns false for partial result', () => {
      const result = toolPartial(testToolId, {}, startedAt, [
        { severity: 'warning', text: 'warning' },
      ]);
      expect(isToolFailure(result)).toBe(false);
    });

    it('returns false for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(isToolFailure(result)).toBe(false);
    });

    it('works as type guard', () => {
      const result: ToolResult = toolFailure(testToolId, new Error('Test error'), startedAt);
      if (isToolFailure(result)) {
        // TypeScript should know result.error exists
        expect(result.error.message).toBe('Test error');
      }
    });
  });

  describe('isToolCancelled()', () => {
    it('returns true for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(isToolCancelled(result)).toBe(true);
    });

    it('returns false for success result', () => {
      const result = toolSuccess(testToolId, {}, startedAt);
      expect(isToolCancelled(result)).toBe(false);
    });

    it('returns false for partial result', () => {
      const result = toolPartial(testToolId, {}, startedAt, [
        { severity: 'warning', text: 'warning' },
      ]);
      expect(isToolCancelled(result)).toBe(false);
    });

    it('returns false for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(isToolCancelled(result)).toBe(false);
    });

    it('works as type guard', () => {
      const result: ToolResult = toolCancelled(testToolId, 'User aborted', startedAt);
      if (isToolCancelled(result)) {
        // TypeScript should know result.reason exists
        expect(result.reason).toBe('User aborted');
      }
    });
  });

  describe('isToolCompleted()', () => {
    it('returns true for success result', () => {
      const result = toolSuccess(testToolId, { complete: true }, startedAt);
      expect(isToolCompleted(result)).toBe(true);
    });

    it('returns true for partial result', () => {
      const result = toolPartial(testToolId, { partial: true }, startedAt, [
        { severity: 'warning', text: 'warning' },
      ]);
      expect(isToolCompleted(result)).toBe(true);
    });

    it('returns false for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(isToolCompleted(result)).toBe(false);
    });

    it('returns false for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(isToolCompleted(result)).toBe(false);
    });

    it('works as type guard for union type', () => {
      const successResult: ToolResult<number> = toolSuccess(testToolId, 100, startedAt);
      const partialResult: ToolResult<number> = toolPartial(testToolId, 50, startedAt, [
        { severity: 'warning', text: 'Incomplete' },
      ]);

      if (isToolCompleted(successResult)) {
        // TypeScript should know result.data exists
        expect(successResult.data).toBe(100);
      }

      if (isToolCompleted(partialResult)) {
        expect(partialResult.data).toBe(50);
      }
    });
  });

  describe('getToolData()', () => {
    it('returns data for success result', () => {
      const data = { note: 'content', id: 'note-1' };
      const result = toolSuccess(testToolId, data, startedAt);
      expect(getToolData(result)).toEqual(data);
    });

    it('returns data for partial result', () => {
      const data = { items: [1, 2], missing: [3] };
      const result = toolPartial(testToolId, data, startedAt, [
        { severity: 'warning', text: 'Some items missing' },
      ]);
      expect(getToolData(result)).toEqual(data);
    });

    it('returns undefined for failure result', () => {
      const result = toolFailure(testToolId, new Error('fail'), startedAt);
      expect(getToolData(result)).toBeUndefined();
    });

    it('returns undefined for cancelled result', () => {
      const result = toolCancelled(testToolId, 'cancelled', startedAt);
      expect(getToolData(result)).toBeUndefined();
    });

    it('returns null data correctly (not undefined)', () => {
      const result = toolSuccess(testToolId, null, startedAt);
      expect(getToolData(result)).toBe(null);
    });

    it('returns empty object correctly', () => {
      const result = toolSuccess(testToolId, {}, startedAt);
      expect(getToolData(result)).toEqual({});
    });
  });

  describe('serializeToolResult()', () => {
    it('serializes success result', () => {
      const result = toolSuccess(testToolId, { title: 'Note', id: 1 }, startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe('Tool note:create succeeded: {"title":"Note","id":1}');
    });

    it('serializes partial result with warnings', () => {
      const result = toolPartial(testToolId, { count: 5 }, startedAt, [
        { severity: 'warning', text: 'Some items skipped' },
        { severity: 'warning', text: 'Rate limit approaching' },
      ]);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe(
        'Tool note:create partially succeeded: {"count":5} (warnings: Some items skipped, Rate limit approaching)'
      );
    });

    it('serializes failure result', () => {
      const error = new Error('Connection timeout');
      const result = toolFailure(testToolId, error, startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe('Tool note:create failed: Connection timeout');
    });

    it('serializes cancelled result', () => {
      const result = toolCancelled(testToolId, 'User pressed Escape', startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe('Tool note:create cancelled: User pressed Escape');
    });

    it('handles complex data in success result', () => {
      const data = {
        nested: { array: [1, 2, 3], obj: { key: 'value' } },
        null: null,
        bool: true,
      };
      const result = toolSuccess(testToolId, data, startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toContain('Tool note:create succeeded:');
      expect(serialized).toContain('"nested"');
      expect(serialized).toContain('"array":[1,2,3]');
    });

    it('handles null data in success result', () => {
      const result = toolSuccess(testToolId, null, startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe('Tool note:create succeeded: null');
    });

    it('handles different tool IDs', () => {
      const editorToolId = 'editor:format' as ToolId;
      const result = toolSuccess(editorToolId, { formatted: true }, startedAt);
      const serialized = serializeToolResult(result);

      expect(serialized).toBe('Tool editor:format succeeded: {"formatted":true}');
    });
  });
});
