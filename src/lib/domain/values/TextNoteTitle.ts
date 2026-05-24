import { formatDailyDate, formatDailyTime } from './DailyDate';

const DEFAULT_MAX_TITLE_LENGTH = 60;
const TITLE_SANITIZE_RE = /[\\/:*?"<>|\n\r\t]+/g;

export interface TextNoteTitleOptions {
  now?: Date;
  fallbackPrefix?: string;
  maxLength?: number;
}

export function deriveTextNoteTitle(
  text: string,
  options: TextNoteTitleOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_TITLE_LENGTH;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';

  if (firstLine) {
    const sanitized = firstLine
      .replace(TITLE_SANITIZE_RE, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();

    if (sanitized) {
      return sanitized.length > maxLength
        ? sanitized.slice(0, maxLength).trim()
        : sanitized;
    }
  }

  const now = options.now ?? new Date();
  const date = formatDailyDate(now);
  const time = formatDailyTime(now).replace(':', '');
  return `${options.fallbackPrefix ?? 'Capture'} ${date} ${time}`;
}
