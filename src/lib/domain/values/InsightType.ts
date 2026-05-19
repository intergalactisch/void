/**
 * InsightType - Types of proactive insights from Pulse system
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export const INSIGHT_TYPES = [
  'contradiction',  // Notes contain conflicting information
  'stale',          // Note hasn't been touched in a while, has open items
  'overdue',        // Action items past their due date
  'connection',     // New connection found between notes
  'completion',     // Note is missing expected sections based on intent
] as const;

export type InsightType = typeof INSIGHT_TYPES[number];

export const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  contradiction: 'Contradiction',
  stale: 'Stale Note',
  overdue: 'Overdue',
  connection: 'Connection',
  completion: 'Incomplete',
};

export function isValidInsightType(value: string): value is InsightType {
  return INSIGHT_TYPES.includes(value as InsightType);
}
