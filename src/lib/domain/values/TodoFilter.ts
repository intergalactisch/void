/**
 * TodoFilter - Filtering criteria for TODO items
 *
 * Provides a structured way to filter todos by various criteria:
 * - Status (open, completed, all)
 * - Source file or source type
 * - Due dates
 * - Tags
 * - Text search
 * - Priority levels
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { Todo } from '../entities/Todo';
import type { TodoSource } from './TodoSource';
import type { TodoPriority } from './TodoPriority';

/**
 * Filter criteria for todos.
 */
export interface TodoFilter {
  /** Filter by completion status */
  status?: 'open' | 'completed' | 'all';
  /** Filter by specific source file path */
  sourceFile?: string;
  /** Filter by source type (dedicated or inline) */
  source?: TodoSource;
  /** Filter todos due before this date */
  dueBefore?: Date;
  /** Filter todos due after this date */
  dueAfter?: Date;
  /** Filter by tags (match any) */
  tags?: string[];
  /** Text search in content */
  search?: string;
  /** Filter by priority levels (match any) */
  priority?: TodoPriority[];
}

/**
 * Default filter: show open todos only.
 */
export const DEFAULT_TODO_FILTER: TodoFilter = {
  status: 'open',
};

/**
 * Filter showing all todos (including completed).
 */
export const ALL_TODOS_FILTER: TodoFilter = {
  status: 'all',
};

/**
 * Filter showing only completed todos.
 */
export const COMPLETED_TODOS_FILTER: TodoFilter = {
  status: 'completed',
};

/**
 * Check if a todo matches the given filter criteria.
 */
export function matchesFilter(todo: Todo, filter: TodoFilter): boolean {
  // Status filter
  if (filter.status === 'open' && todo.isCompleted) return false;
  if (filter.status === 'completed' && !todo.isCompleted) return false;

  // Source file filter
  if (filter.sourceFile && todo.sourceFile !== filter.sourceFile) return false;

  // Source type filter
  if (filter.source && todo.source !== filter.source) return false;

  // Due date filters
  if (filter.dueBefore && todo.dates.dueDate) {
    if (todo.dates.dueDate > filter.dueBefore) return false;
  }
  if (filter.dueAfter && todo.dates.dueDate) {
    if (todo.dates.dueDate < filter.dueAfter) return false;
  }

  // Tags filter (match any)
  if (filter.tags && filter.tags.length > 0) {
    const hasMatchingTag = filter.tags.some((tag) => todo.tags.includes(tag));
    if (!hasMatchingTag) return false;
  }

  // Text search
  if (filter.search) {
    const searchLower = filter.search.toLowerCase();
    if (!todo.content.toLowerCase().includes(searchLower)) return false;
  }

  // Priority filter (match any)
  if (filter.priority && filter.priority.length > 0) {
    if (!todo.priority || !filter.priority.includes(todo.priority)) return false;
  }

  return true;
}

/**
 * Filter an array of todos by the given criteria.
 */
export function filterTodos(todos: Todo[], filter: TodoFilter): Todo[] {
  return todos.filter((todo) => matchesFilter(todo, filter));
}

/**
 * Create a filter for todos due today or earlier.
 */
export function createDueTodayFilter(today: Date = new Date()): TodoFilter {
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);
  return {
    status: 'open',
    dueBefore: endOfDay,
  };
}

/**
 * Create a filter for todos from a specific file.
 */
export function createFileFilter(filePath: string): TodoFilter {
  return {
    status: 'all',
    sourceFile: filePath,
  };
}

/**
 * Create a filter for todos with specific tags.
 */
export function createTagsFilter(tags: string[]): TodoFilter {
  return {
    status: 'open',
    tags,
  };
}

/**
 * Merge two filters (second filter takes precedence).
 */
export function mergeFilters(base: TodoFilter, override: TodoFilter): TodoFilter {
  return { ...base, ...override };
}

/**
 * Check if a filter has any active criteria beyond the default.
 */
export function hasActiveFilters(filter: TodoFilter): boolean {
  return !!(
    filter.sourceFile ||
    filter.source ||
    filter.dueBefore ||
    filter.dueAfter ||
    (filter.tags && filter.tags.length > 0) ||
    filter.search ||
    (filter.priority && filter.priority.length > 0)
  );
}
