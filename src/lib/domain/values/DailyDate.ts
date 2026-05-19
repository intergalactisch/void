/**
 * DailyDate — pure helpers for the `daily/YYYY-MM-DD.md` note convention.
 *
 * No external dependencies. Pure domain value.
 */

/** Format a Date as the canonical daily-note slug (`YYYY-MM-DD`). */
export function formatDailyDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a Date's wall-clock time as `HH:MM` (24-hour). */
export function formatDailyTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Build the `daily/YYYY-MM-DD.md` path for a given Date. */
export function dailyNotePath(date: Date): string {
  return `daily/${formatDailyDate(date)}.md`;
}
