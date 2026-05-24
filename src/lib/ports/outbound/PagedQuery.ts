export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export interface SummaryQueryBase {
  query?: string;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
  limit?: number;
  cursor?: string | null;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export function clampPageLimit(limit: number | undefined, fallback = 80, max = 250): number {
  if (!Number.isFinite(limit) || limit === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

export function cursorToOffset(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

export function nextOffsetCursor(offset: number, limit: number, total: number): string | null {
  const next = offset + limit;
  return next < total ? String(next) : null;
}

export function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
