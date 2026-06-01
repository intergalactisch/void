export type DatePickerMode = 'single' | 'range';

export type DatePickerRangePreset =
  | 'any'
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'last30Days'
  | 'custom';

export interface DatePickerRangeValue {
  from: string;
  to: string;
}

export interface DatePickerRangeChange extends DatePickerRangeValue {
  preset: DatePickerRangePreset;
}

export interface CalendarDay {
  date: Date;
  value: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export const DATE_PICKER_RANGE_PRESETS: DatePickerRangePreset[] = [
  'any',
  'today',
  'yesterday',
  'last7Days',
  'last30Days',
];

export const DATE_PICKER_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function formatDateInputLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateInputLocal(value: string | null | undefined): Date | null {
  if (!value || !DATE_INPUT_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfLocalDay(next);
}

export function addMonthsLocal(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const day = date.getDate();
  const target = new Date(year, month, 1);
  const clampedDay = Math.min(day, daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), clampedDay);
}

export function buildCalendarGrid(
  viewDate: Date,
  now: Date = new Date(),
  weekStartsOn = 0,
): CalendarDay[] {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = (monthStart.getDay() - weekStartsOn + 7) % 7;
  const gridStart = addDaysLocal(monthStart, -offset);
  const today = formatDateInputLocal(startOfLocalDay(now));

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDaysLocal(gridStart, index);
    const value = formatDateInputLocal(date);
    return {
      date,
      value,
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === viewDate.getMonth(),
      isToday: value === today,
    };
  });
}

export function formatMonthTitle(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatDatePickerDisplay(value: string, now: Date = new Date()): string {
  const date = parseDateInputLocal(value);
  if (!date) return '';

  const today = startOfLocalDay(now);
  const diffDays = Math.round((date.getTime() - today.getTime()) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function shortcutDateInput(
  shortcut: 'today' | 'tomorrow' | 'nextWeek',
  now: Date = new Date(),
): string {
  const today = startOfLocalDay(now);
  if (shortcut === 'tomorrow') return formatDateInputLocal(addDaysLocal(today, 1));
  if (shortcut === 'nextWeek') return formatDateInputLocal(addDaysLocal(today, 7));
  return formatDateInputLocal(today);
}

export function resolveRangePreset(
  preset: DatePickerRangePreset,
  now: Date = new Date(),
): DatePickerRangeChange {
  const today = startOfLocalDay(now);

  if (preset === 'today') {
    const value = formatDateInputLocal(today);
    return { from: value, to: value, preset };
  }

  if (preset === 'yesterday') {
    const value = formatDateInputLocal(addDaysLocal(today, -1));
    return { from: value, to: value, preset };
  }

  if (preset === 'last7Days') {
    return {
      from: formatDateInputLocal(addDaysLocal(today, -6)),
      to: formatDateInputLocal(today),
      preset,
    };
  }

  if (preset === 'last30Days') {
    return {
      from: formatDateInputLocal(addDaysLocal(today, -29)),
      to: formatDateInputLocal(today),
      preset,
    };
  }

  return { from: '', to: '', preset: preset === 'custom' ? 'custom' : 'any' };
}

export function normalizeDateRange(value: DatePickerRangeValue): DatePickerRangeValue {
  const from = parseDateInputLocal(value.from) ? value.from : '';
  const to = parseDateInputLocal(value.to) ? value.to : '';
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

export function formatRangeDisplay(
  value: DatePickerRangeValue,
  preset: DatePickerRangePreset = 'any',
  now: Date = new Date(),
): string {
  if (preset !== 'custom') return rangePresetLabel(preset);

  const normalized = normalizeDateRange(value);
  if (normalized.from && normalized.to) {
    if (normalized.from === normalized.to) return formatDatePickerDisplay(normalized.from, now);
    return `${formatShortDate(normalized.from, now)} - ${formatShortDate(normalized.to, now)}`;
  }
  if (normalized.from) return `From ${formatShortDate(normalized.from, now)}`;
  if (normalized.to) return `Until ${formatShortDate(normalized.to, now)}`;
  return rangePresetLabel('any');
}

export function rangePresetLabel(preset: DatePickerRangePreset): string {
  return ({
    any: 'Any date',
    today: 'Today',
    yesterday: 'Yesterday',
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
    custom: 'Custom',
  } as const)[preset];
}

export function isDateInRange(value: string, range: DatePickerRangeValue): boolean {
  const normalized = normalizeDateRange(range);
  if (!normalized.from || !normalized.to) return false;
  return value >= normalized.from && value <= normalized.to;
}

function formatShortDate(value: string, now: Date): string {
  const date = parseDateInputLocal(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
