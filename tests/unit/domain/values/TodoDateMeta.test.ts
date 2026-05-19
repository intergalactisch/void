/**
 * Unit tests for TodoDateMeta value object
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DATE_MARKERS,
  createEmptyDateMeta,
  formatCompletedAt,
  formatDateOnly,
  formatDueDate,
  formatScheduledDate,
  formatRecurrence,
  hasDateMeta,
  isOverdue,
  isDueToday,
  isScheduledForToday,
} from '$lib/domain/values/TodoDateMeta';
import type { TodoDateMeta } from '$lib/domain/values/TodoDateMeta';

describe('TodoDateMeta value object', () => {
  describe('DATE_MARKERS constant', () => {
    it('has correct DUE marker (calendar emoji)', () => {
      expect(DATE_MARKERS.DUE).toBe('\u{1F4C5}');
    });

    it('has correct SCHEDULED marker (hourglass emoji)', () => {
      expect(DATE_MARKERS.SCHEDULED).toBe('\u{23F3}');
    });

    it('has correct COMPLETED marker (checkmark emoji)', () => {
      expect(DATE_MARKERS.COMPLETED).toBe('\u{2705}');
    });

    it('has correct RECURRENCE marker (repeat emoji)', () => {
      expect(DATE_MARKERS.RECURRENCE).toBe('\u{1F501}');
    });

    it('has correct HIGH_PRIORITY marker', () => {
      expect(DATE_MARKERS.HIGH_PRIORITY).toBe('\u{23EB}');
    });

    it('has correct MEDIUM_PRIORITY marker', () => {
      expect(DATE_MARKERS.MEDIUM_PRIORITY).toBe('\u{1F53C}');
    });

    it('has correct LOW_PRIORITY marker', () => {
      expect(DATE_MARKERS.LOW_PRIORITY).toBe('\u{1F53D}');
    });
  });

  describe('createEmptyDateMeta()', () => {
    it('creates an empty object', () => {
      const meta = createEmptyDateMeta();
      expect(meta).toEqual({});
    });

    it('has no dueDate', () => {
      const meta = createEmptyDateMeta();
      expect(meta.dueDate).toBeUndefined();
    });

    it('has no scheduledDate', () => {
      const meta = createEmptyDateMeta();
      expect(meta.scheduledDate).toBeUndefined();
    });

    it('has no completedAt', () => {
      const meta = createEmptyDateMeta();
      expect(meta.completedAt).toBeUndefined();
    });

    it('has no recurrence', () => {
      const meta = createEmptyDateMeta();
      expect(meta.recurrence).toBeUndefined();
    });
  });

  describe('formatCompletedAt()', () => {
    it('formats date with checkmark marker and ISO datetime', () => {
      const date = new Date('2024-03-15T14:30:00.000Z');
      const result = formatCompletedAt(date);
      expect(result).toBe('\u{2705} 2024-03-15T14:30');
    });

    it('formats midnight correctly', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = formatCompletedAt(date);
      expect(result).toBe('\u{2705} 2024-01-01T00:00');
    });

    it('formats end of day correctly', () => {
      const date = new Date('2024-12-31T23:59:00.000Z');
      const result = formatCompletedAt(date);
      expect(result).toBe('\u{2705} 2024-12-31T23:59');
    });
  });

  describe('formatDueDate()', () => {
    it('formats date with calendar marker and ISO date', () => {
      const date = new Date('2024-03-15T14:30:00.000Z');
      const result = formatDueDate(date);
      expect(result).toBe('\u{1F4C5} 2024-03-15');
    });

    it('formats first day of year correctly', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = formatDueDate(date);
      expect(result).toBe('\u{1F4C5} 2024-01-01');
    });

    it('formats last day of year correctly', () => {
      const date = new Date('2024-12-31T23:59:59.000Z');
      const result = formatDueDate(date);
      expect(result).toBe(`\u{1F4C5} ${formatDateOnly(date)}`);
    });

    it('excludes time component', () => {
      const date = new Date('2024-06-15T18:45:30.000Z');
      const result = formatDueDate(date);
      expect(result).not.toContain('T');
      expect(result).not.toContain('18');
    });
  });

  describe('formatScheduledDate()', () => {
    it('formats date with hourglass marker and ISO date', () => {
      const date = new Date('2024-03-15T14:30:00.000Z');
      const result = formatScheduledDate(date);
      expect(result).toBe('\u{23F3} 2024-03-15');
    });

    it('formats first day of year correctly', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = formatScheduledDate(date);
      expect(result).toBe('\u{23F3} 2024-01-01');
    });

    it('formats last day of year correctly', () => {
      const date = new Date('2024-12-31T23:59:59.000Z');
      const result = formatScheduledDate(date);
      expect(result).toBe(`\u{23F3} ${formatDateOnly(date)}`);
    });

    it('excludes time component', () => {
      const date = new Date('2024-06-15T18:45:30.000Z');
      const result = formatScheduledDate(date);
      expect(result).not.toContain('T');
      expect(result).not.toContain('18');
    });
  });

  describe('formatRecurrence()', () => {
    it('formats pattern with repeat marker', () => {
      const result = formatRecurrence('every day');
      expect(result).toBe('\u{1F501} every day');
    });

    it('formats weekly pattern', () => {
      const result = formatRecurrence('every week');
      expect(result).toBe('\u{1F501} every week');
    });

    it('formats monthly pattern', () => {
      const result = formatRecurrence('every month');
      expect(result).toBe('\u{1F501} every month');
    });

    it('formats complex pattern', () => {
      const result = formatRecurrence('every 2 weeks on Monday');
      expect(result).toBe('\u{1F501} every 2 weeks on Monday');
    });

    it('handles empty pattern', () => {
      const result = formatRecurrence('');
      expect(result).toBe('\u{1F501} ');
    });
  });

  describe('hasDateMeta()', () => {
    it('returns false for empty meta', () => {
      const meta: TodoDateMeta = {};
      expect(hasDateMeta(meta)).toBe(false);
    });

    it('returns true when dueDate is set', () => {
      const meta: TodoDateMeta = { dueDate: new Date() };
      expect(hasDateMeta(meta)).toBe(true);
    });

    it('returns true when scheduledDate is set', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date() };
      expect(hasDateMeta(meta)).toBe(true);
    });

    it('returns true when completedAt is set', () => {
      const meta: TodoDateMeta = { completedAt: new Date() };
      expect(hasDateMeta(meta)).toBe(true);
    });

    it('returns true when recurrence is set', () => {
      const meta: TodoDateMeta = { recurrence: 'every day' };
      expect(hasDateMeta(meta)).toBe(true);
    });

    it('returns true when multiple fields are set', () => {
      const meta: TodoDateMeta = {
        dueDate: new Date(),
        scheduledDate: new Date(),
        recurrence: 'every week',
      };
      expect(hasDateMeta(meta)).toBe(true);
    });

    it('returns false when recurrence is empty string', () => {
      const meta: TodoDateMeta = { recurrence: '' };
      expect(hasDateMeta(meta)).toBe(false);
    });
  });

  describe('isOverdue()', () => {
    it('returns false for meta without dueDate', () => {
      const meta: TodoDateMeta = {};
      expect(isOverdue(meta)).toBe(false);
    });

    it('returns false when task is completed', () => {
      const meta: TodoDateMeta = {
        dueDate: new Date('2020-01-01'),
        completedAt: new Date('2020-01-02'),
      };
      expect(isOverdue(meta)).toBe(false);
    });

    it('returns true when dueDate is in the past', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2020-01-01') };
      const now = new Date('2024-03-15');
      expect(isOverdue(meta, now)).toBe(true);
    });

    it('returns false when dueDate is today', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-15T10:00:00') };
      const now = new Date('2024-03-15T14:00:00');
      expect(isOverdue(meta, now)).toBe(false);
    });

    it('returns false when dueDate is in the future', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-12-31') };
      const now = new Date('2024-03-15');
      expect(isOverdue(meta, now)).toBe(false);
    });

    it('compares at day level, ignoring time', () => {
      // Due at end of yesterday
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-14T23:59:59') };
      // Now is early morning today
      const now = new Date('2024-03-15T00:00:01');
      expect(isOverdue(meta, now)).toBe(true);
    });

    it('handles due date at midnight', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-14T00:00:00') };
      const now = new Date('2024-03-15T00:00:00');
      expect(isOverdue(meta, now)).toBe(true);
    });
  });

  describe('isDueToday()', () => {
    it('returns false for meta without dueDate', () => {
      const meta: TodoDateMeta = {};
      expect(isDueToday(meta)).toBe(false);
    });

    it('returns true when dueDate is today', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-15T10:00:00.000Z') };
      const now = new Date('2024-03-15T14:00:00.000Z');
      expect(isDueToday(meta, now)).toBe(true);
    });

    it('returns false when dueDate is yesterday', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-14T10:00:00.000Z') };
      const now = new Date('2024-03-15T14:00:00.000Z');
      expect(isDueToday(meta, now)).toBe(false);
    });

    it('returns false when dueDate is tomorrow', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-16T10:00:00.000Z') };
      const now = new Date('2024-03-15T14:00:00.000Z');
      expect(isDueToday(meta, now)).toBe(false);
    });

    it('compares dates at day level', () => {
      // Due at start of day
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-15T00:00:00.000Z') };
      // Now is end of day
      const now = new Date('2024-03-15T23:59:59.000Z');
      expect(isDueToday(meta, now)).toBe(true);
    });

    it('handles different times on same day', () => {
      const meta: TodoDateMeta = { dueDate: new Date('2024-03-15T06:00:00.000Z') };
      const now = new Date('2024-03-15T18:00:00.000Z');
      expect(isDueToday(meta, now)).toBe(true);
    });
  });

  describe('isScheduledForToday()', () => {
    it('returns false for meta without scheduledDate', () => {
      const meta: TodoDateMeta = {};
      expect(isScheduledForToday(meta)).toBe(false);
    });

    it('returns true when scheduledDate is today', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-15T10:00:00') };
      const now = new Date('2024-03-15T14:00:00');
      expect(isScheduledForToday(meta, now)).toBe(true);
    });

    it('returns true when scheduledDate is in the past', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-10') };
      const now = new Date('2024-03-15');
      expect(isScheduledForToday(meta, now)).toBe(true);
    });

    it('returns false when scheduledDate is in the future', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-20') };
      const now = new Date('2024-03-15');
      expect(isScheduledForToday(meta, now)).toBe(false);
    });

    it('compares at day level, ignoring time', () => {
      // Scheduled for start of today
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-15T00:00:00') };
      // Now is end of today
      const now = new Date('2024-03-15T23:59:59');
      expect(isScheduledForToday(meta, now)).toBe(true);
    });

    it('handles scheduledDate at midnight', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-15T00:00:00') };
      const now = new Date('2024-03-15T00:00:00');
      expect(isScheduledForToday(meta, now)).toBe(true);
    });

    it('returns true for tasks scheduled yesterday (should be worked on today)', () => {
      const meta: TodoDateMeta = { scheduledDate: new Date('2024-03-14') };
      const now = new Date('2024-03-15');
      expect(isScheduledForToday(meta, now)).toBe(true);
    });
  });
});
