/**
 * TodoDateMeta - Date-related metadata for TODO items
 *
 * Supports Obsidian Tasks-compatible date markers:
 * - due date - When the task is due
 * - scheduled date - When to start working on the task
 * - completed at - When the task was completed
 * - recurrence - Repeating pattern (e.g., "every day", "every week")
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Date-related metadata for a TODO item.
 */
export interface TodoDateMeta {
  /** Due date (calendar marker) */
  dueDate?: Date;
  /** Scheduled date (hourglass marker) */
  scheduledDate?: Date;
  /** Completion timestamp (checkmark marker) */
  completedAt?: Date;
  /** Creation timestamp (sparkle marker) */
  createdAt?: Date;
  /** Recurrence pattern (repeat marker) */
  recurrence?: string;
}

/**
 * Emoji markers for date metadata (Obsidian Tasks compatible).
 */
export const DATE_MARKERS = {
  /** Due date marker */
  DUE: '\u{1F4C5}',
  /** Scheduled date marker */
  SCHEDULED: '\u{23F3}',
  /** Completed date marker */
  COMPLETED: '\u{2705}',
  /** Created date marker */
  CREATED: '\u{2795}',
  /** Recurrence marker */
  RECURRENCE: '\u{1F501}',
  /** High priority marker */
  HIGH_PRIORITY: '\u{23EB}',
  /** Medium priority marker */
  MEDIUM_PRIORITY: '\u{1F53C}',
  /** Low priority marker */
  LOW_PRIORITY: '\u{1F53D}',
} as const;

/**
 * Create an empty TodoDateMeta object.
 */
export function createEmptyDateMeta(): TodoDateMeta {
  return {};
}

/**
 * Format a completion timestamp for markdown output.
 */
export function formatCompletedAt(date: Date): string {
  const iso = date.toISOString().slice(0, 16);
  return `${DATE_MARKERS.COMPLETED} ${iso}`;
}

/**
 * Format a created-at timestamp for markdown output.
 */
export function formatCreatedAt(date: Date): string {
  const dateStr = formatDateOnly(date);
  return `${DATE_MARKERS.CREATED} ${dateStr}`;
}

/**
 * Format a due date for markdown output.
 */
export function formatDueDate(date: Date): string {
  const dateStr = formatDateOnly(date);
  return `${DATE_MARKERS.DUE} ${dateStr}`;
}

/**
 * Format a scheduled date for markdown output.
 */
export function formatScheduledDate(date: Date): string {
  const dateStr = formatDateOnly(date);
  return `${DATE_MARKERS.SCHEDULED} ${dateStr}`;
}

/**
 * Format a recurrence pattern for markdown output.
 */
export function formatRecurrence(pattern: string): string {
  return `${DATE_MARKERS.RECURRENCE} ${pattern}`;
}

/**
 * Check if a todo has any date metadata.
 */
export function hasDateMeta(meta: TodoDateMeta): boolean {
  return !!(meta.dueDate || meta.scheduledDate || meta.completedAt || meta.createdAt || meta.recurrence);
}

/**
 * Check if a todo is overdue (due date is in the past and not completed).
 */
export function isOverdue(meta: TodoDateMeta, now: Date = new Date()): boolean {
  if (!meta.dueDate || meta.completedAt) return false;
  // Compare dates at day level (ignore time)
  const dueDay = new Date(meta.dueDate);
  dueDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return dueDay < today;
}

/**
 * Check if a todo is due today.
 */
export function isDueToday(meta: TodoDateMeta, now: Date = new Date()): boolean {
  if (!meta.dueDate) return false;
  const dueDay = meta.dueDate.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return dueDay === today;
}

/**
 * Check if a todo is scheduled for today or earlier.
 */
export function isScheduledForToday(meta: TodoDateMeta, now: Date = new Date()): boolean {
  if (!meta.scheduledDate) return false;
  const scheduledDay = new Date(meta.scheduledDate);
  scheduledDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return scheduledDay <= today;
}

export function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
