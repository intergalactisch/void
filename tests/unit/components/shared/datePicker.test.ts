import { describe, expect, it } from 'vitest';
import {
  addMonthsLocal,
  buildCalendarGrid,
  formatDateInputLocal,
  formatRangeDisplay,
  normalizeDateRange,
  parseDateInputLocal,
  resolveRangePreset,
  shortcutDateInput,
} from '$lib/components/shared/datePicker';

describe('date picker helpers', () => {
  const now = new Date(2026, 5, 1, 13, 30);

  it('formats local date input values without UTC conversion', () => {
    expect(formatDateInputLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('parses valid date inputs and rejects rolled-over dates', () => {
    expect(formatDateInputLocal(parseDateInputLocal('2024-02-29')!)).toBe('2024-02-29');
    expect(parseDateInputLocal('2023-02-29')).toBeNull();
    expect(parseDateInputLocal('2026-13-01')).toBeNull();
    expect(parseDateInputLocal('not-a-date')).toBeNull();
  });

  it('builds a stable six-week calendar grid for month boundaries', () => {
    const days = buildCalendarGrid(new Date(2026, 1, 1), now);

    expect(days).toHaveLength(42);
    expect(days[0]?.value).toBe('2026-02-01');
    expect(days[27]?.value).toBe('2026-02-28');
    expect(days[28]?.value).toBe('2026-03-01');
  });

  it('clamps month navigation to the target month length', () => {
    expect(formatDateInputLocal(addMonthsLocal(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(formatDateInputLocal(addMonthsLocal(new Date(2024, 0, 31), 1))).toBe('2024-02-29');
  });

  it('normalizes reversed ranges', () => {
    expect(normalizeDateRange({ from: '2026-06-10', to: '2026-06-01' })).toEqual({
      from: '2026-06-01',
      to: '2026-06-10',
    });
  });

  it('resolves range presets from a local today anchor', () => {
    expect(resolveRangePreset('today', now)).toEqual({
      from: '2026-06-01',
      to: '2026-06-01',
      preset: 'today',
    });
    expect(resolveRangePreset('last7Days', now)).toEqual({
      from: '2026-05-26',
      to: '2026-06-01',
      preset: 'last7Days',
    });
  });

  it('calculates single-date shortcuts', () => {
    expect(shortcutDateInput('today', now)).toBe('2026-06-01');
    expect(shortcutDateInput('tomorrow', now)).toBe('2026-06-02');
    expect(shortcutDateInput('nextWeek', now)).toBe('2026-06-08');
  });

  it('formats custom range labels', () => {
    expect(formatRangeDisplay({ from: '2026-06-01', to: '2026-06-10' }, 'custom', now)).toBe('Jun 1 - Jun 10');
    expect(formatRangeDisplay({ from: '2026-06-01', to: '2026-06-01' }, 'custom', now)).toBe('Today');
  });
});
