/**
 * TodoPriority - Priority levels for TODO items
 *
 * Priority is indicated using emoji markers (Obsidian Tasks compatible):
 * - High priority: arrow-double-up
 * - Medium priority: arrow-up
 * - Low priority: arrow-down
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Priority level for a TODO item.
 */
export type TodoPriority = 'high' | 'medium' | 'low';

/**
 * Named constants for todo priorities.
 */
export const TODO_PRIORITIES = {
  HIGH: 'high' as TodoPriority,
  MEDIUM: 'medium' as TodoPriority,
  LOW: 'low' as TodoPriority,
} as const;

/**
 * All valid todo priority values.
 */
export const ALL_TODO_PRIORITIES: readonly TodoPriority[] = [
  TODO_PRIORITIES.HIGH,
  TODO_PRIORITIES.MEDIUM,
  TODO_PRIORITIES.LOW,
] as const;

/**
 * Get sort order for priority (lower number = higher priority).
 * Returns 3 for undefined priority (sorts after all explicit priorities).
 */
export function priorityOrder(priority?: TodoPriority): number {
  if (!priority) return 3;
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
  }
}

/**
 * Check if a value is a valid TodoPriority.
 */
export function isValidTodoPriority(value: string): value is TodoPriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

/**
 * Compare two priorities for sorting (high priority first).
 * Returns negative if a should come before b.
 */
export function comparePriority(a?: TodoPriority, b?: TodoPriority): number {
  return priorityOrder(a) - priorityOrder(b);
}

/**
 * Get display name for a priority level.
 */
export function getPriorityDisplayName(priority: TodoPriority): string {
  switch (priority) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
  }
}
