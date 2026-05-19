/**
 * NoteStatus - Document lifecycle status
 *
 * Tracks where a document is in its lifecycle.
 * Used by Pulse (Phase 7) to detect stale documents.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export const NOTE_STATUSES = [
  'draft',
  'in-progress',
  'review',
  'polished',
  'archived',
] as const;

export type NoteStatus = typeof NOTE_STATUSES[number];

/**
 * Human-readable labels for each status.
 */
export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  'draft': 'Draft',
  'in-progress': 'In Progress',
  'review': 'Review',
  'polished': 'Polished',
  'archived': 'Archived',
};

/**
 * Check if a string is a valid NoteStatus.
 */
export function isValidStatus(value: string): value is NoteStatus {
  return NOTE_STATUSES.includes(value as NoteStatus);
}
