/**
 * Todo - Task item from markdown files
 *
 * A Todo represents a task/checkbox item from markdown content.
 * TODOs can exist in dedicated TODO.md files or inline within any note.
 * Uses Obsidian Tasks-compatible syntax for dates and priorities.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { TodoId } from '../values/TodoId';
import type { TodoSource } from '../values/TodoSource';
import type { TodoDateMeta } from '../values/TodoDateMeta';
import type { TodoPriority } from '../values/TodoPriority';
import type { TodoList } from '../values/TodoView';
import { generateTodoId } from '../values/TodoId';
import { DATE_MARKERS, formatCompletedAt, formatCreatedAt, formatDateOnly } from '../values/TodoDateMeta';
import { priorityOrder } from '../values/TodoPriority';

/**
 * Todo entity representing a task item.
 */
export interface Todo {
  /** Unique identifier (filepath:lineNumber) */
  id: TodoId;
  /** Task text content (without checkbox and metadata) */
  content: string;
  /** Whether the task is completed */
  isCompleted: boolean;
  /** Where the todo comes from (dedicated file or inline) */
  source: TodoSource;
  /** Path to the source file */
  sourceFile: string;
  /** Line number in the source file (0-indexed) */
  lineNumber: number;
  /** Indentation level (number of indent units) */
  indent: number;
  /** Date-related metadata */
  dates: TodoDateMeta;
  /** Priority level */
  priority?: TodoPriority;
  /** Tags found in the content */
  tags: string[];
  /** Original raw line from the file */
  rawLine: string;
  /** Nearest markdown heading section, mainly for dedicated TODO.md files */
  section?: string;
  /** Dedicated TODO.md list derived from section or legacy placement */
  list?: TodoList;
}

/**
 * Markdown heading section inside a dedicated todo-list file.
 */
export interface TodoSection {
  /** Path to the todo-list markdown file */
  filePath: string;
  /** Section heading text without leading ## */
  title: string;
  /** Heading line number (0-indexed) */
  lineNumber: number;
  /** Number of todos currently under this section */
  todoCount: number;
}

export type TodoMoveTarget =
  | {
      kind: 'todo';
      targetId: TodoId;
      position: 'before' | 'after';
    }
  | {
      kind: 'section';
      filePath: string;
      section: string;
    };

export type TodoSectionMovePosition = 'before' | 'after';

/**
 * Parameters for creating a new Todo.
 */
export interface CreateTodoParams {
  content: string;
  isCompleted?: boolean;
  source: TodoSource;
  sourceFile: string;
  lineNumber: number;
  indent?: number;
  dates?: TodoDateMeta;
  priority?: TodoPriority;
  tags?: string[];
  rawLine: string;
  section?: string;
  list?: TodoList;
}

/**
 * Patch object for editing task metadata while preserving markdown storage.
 * Use null to clear optional metadata fields.
 */
export interface TodoUpdatePatch {
  content?: string;
  dueDate?: Date | null;
  scheduledDate?: Date | null;
  priority?: TodoPriority | null;
  tags?: string[];
  recurrence?: string | null;
  /** Move a dedicated TODO.md task to a top-level task list section */
  targetList?: TodoList;
  /** Move a dedicated todo-list task to an arbitrary markdown heading section */
  targetSection?: string;
  /** Override the parsed section heading; null clears it */
  section?: string | null;
}

/**
 * Create a new Todo entity.
 */
export function createTodo(params: CreateTodoParams): Todo {
  const todo: Todo = {
    id: generateTodoId(params.sourceFile, params.lineNumber),
    content: params.content,
    isCompleted: params.isCompleted ?? false,
    source: params.source,
    sourceFile: params.sourceFile,
    lineNumber: params.lineNumber,
    indent: params.indent ?? 0,
    dates: params.dates ?? {},
    tags: params.tags ?? [],
    rawLine: params.rawLine,
  };

  // Only set priority if it's defined (exactOptionalPropertyTypes compliance)
  if (params.priority !== undefined) {
    todo.priority = params.priority;
  }
  if (params.section !== undefined) {
    todo.section = params.section;
  }
  if (params.list !== undefined) {
    todo.list = params.list;
  }

  return todo;
}

/**
 * Toggle the completion state of a todo.
 * Returns a new Todo with updated state.
 */
export function toggleTodo(todo: Todo, completedAt: Date = new Date()): Todo {
  const newCompleted = !todo.isCompleted;

  // Build dates object without undefined values (exactOptionalPropertyTypes compliance)
  const newDates: TodoDateMeta = {};
  if (todo.dates.dueDate) newDates.dueDate = todo.dates.dueDate;
  if (todo.dates.scheduledDate) newDates.scheduledDate = todo.dates.scheduledDate;
  if (todo.dates.recurrence) newDates.recurrence = todo.dates.recurrence;
  if (todo.dates.createdAt) newDates.createdAt = todo.dates.createdAt;
  if (newCompleted) newDates.completedAt = completedAt;

  return {
    ...todo,
    isCompleted: newCompleted,
    dates: newDates,
  };
}

/**
 * Update the content of a todo.
 * Returns a new Todo with updated content.
 */
export function updateTodoContent(todo: Todo, content: string): Todo {
  return { ...todo, content };
}

/**
 * Apply a structured metadata/content patch to a todo.
 */
export function applyTodoPatch(todo: Todo, patch: TodoUpdatePatch): Todo {
  const dates: TodoDateMeta = { ...todo.dates };

  if ('dueDate' in patch) {
    if (patch.dueDate === null) delete dates.dueDate;
    else if (patch.dueDate !== undefined) dates.dueDate = patch.dueDate;
  }

  if ('scheduledDate' in patch) {
    if (patch.scheduledDate === null) delete dates.scheduledDate;
    else if (patch.scheduledDate !== undefined) dates.scheduledDate = patch.scheduledDate;
  }

  if ('recurrence' in patch) {
    if (patch.recurrence === null || patch.recurrence === '') delete dates.recurrence;
    else if (patch.recurrence !== undefined) dates.recurrence = patch.recurrence;
  }

  const next: Todo = {
    ...todo,
    content: patch.content ?? todo.content,
    dates,
    tags: patch.tags ?? todo.tags,
  };

  if ('priority' in patch) {
    if (patch.priority === null || patch.priority === undefined) {
      delete next.priority;
    } else {
      next.priority = patch.priority;
    }
  }

  if ('section' in patch) {
    if (patch.section === null || patch.section === undefined || patch.section.trim() === '') {
      delete next.section;
    } else {
      next.section = patch.section.trim();
    }
  }

  if ('targetList' in patch && patch.targetList !== undefined) {
    next.list = patch.targetList;
  }

  if ('targetSection' in patch && patch.targetSection !== undefined) {
    const section = patch.targetSection.trim();
    if (section) next.section = section;
  }

  return next;
}

/**
 * Update the priority of a todo.
 * Returns a new Todo with updated priority.
 */
export function updateTodoPriority(todo: Todo, priority: TodoPriority | undefined): Todo {
  // Build new todo without undefined priority (exactOptionalPropertyTypes compliance)
  const newTodo: Todo = {
    id: todo.id,
    content: todo.content,
    isCompleted: todo.isCompleted,
    source: todo.source,
    sourceFile: todo.sourceFile,
    lineNumber: todo.lineNumber,
    indent: todo.indent,
    dates: todo.dates,
    tags: todo.tags,
    rawLine: todo.rawLine,
  };

  if (priority !== undefined) {
    newTodo.priority = priority;
  }
  if (todo.section !== undefined) {
    newTodo.section = todo.section;
  }
  if (todo.list !== undefined) {
    newTodo.list = todo.list;
  }

  return newTodo;
}

/**
 * Update the due date of a todo.
 * Returns a new Todo with updated dates.
 */
export function updateTodoDueDate(todo: Todo, dueDate: Date | undefined): Todo {
  // Build dates object without undefined values (exactOptionalPropertyTypes compliance)
  const newDates: TodoDateMeta = {};
  if (dueDate !== undefined) newDates.dueDate = dueDate;
  else if (todo.dates.dueDate) newDates.dueDate = todo.dates.dueDate;
  if (todo.dates.scheduledDate) newDates.scheduledDate = todo.dates.scheduledDate;
  if (todo.dates.completedAt) newDates.completedAt = todo.dates.completedAt;
  if (todo.dates.createdAt) newDates.createdAt = todo.dates.createdAt;
  if (todo.dates.recurrence) newDates.recurrence = todo.dates.recurrence;

  // When dueDate is explicitly undefined, we want to remove it
  if (dueDate === undefined) {
    delete newDates.dueDate;
  }

  return { ...todo, dates: newDates };
}

/**
 * Update the scheduled date of a todo.
 * Returns a new Todo with updated dates.
 */
export function updateTodoScheduledDate(todo: Todo, scheduledDate: Date | undefined): Todo {
  // Build dates object without undefined values (exactOptionalPropertyTypes compliance)
  const newDates: TodoDateMeta = {};
  if (todo.dates.dueDate) newDates.dueDate = todo.dates.dueDate;
  if (scheduledDate !== undefined) newDates.scheduledDate = scheduledDate;
  else if (todo.dates.scheduledDate) newDates.scheduledDate = todo.dates.scheduledDate;
  if (todo.dates.completedAt) newDates.completedAt = todo.dates.completedAt;
  if (todo.dates.createdAt) newDates.createdAt = todo.dates.createdAt;
  if (todo.dates.recurrence) newDates.recurrence = todo.dates.recurrence;

  // When scheduledDate is explicitly undefined, we want to remove it
  if (scheduledDate === undefined) {
    delete newDates.scheduledDate;
  }

  return { ...todo, dates: newDates };
}

/**
 * Add a tag to a todo.
 * Returns a new Todo with the tag added (if not already present).
 */
export function addTodoTag(todo: Todo, tag: string): Todo {
  if (todo.tags.includes(tag)) return todo;
  return { ...todo, tags: [...todo.tags, tag] };
}

/**
 * Remove a tag from a todo.
 * Returns a new Todo with the tag removed.
 */
export function removeTodoTag(todo: Todo, tag: string): Todo {
  return { ...todo, tags: todo.tags.filter((t) => t !== tag) };
}

/**
 * Detect the list prefix from a raw line for serialization.
 * Returns prefix with trailing space (e.g. "- ", "* ", "1. ") or "- " for bare checkboxes.
 */
function detectListPrefix(rawLine: string): string {
  const trimmed = rawLine.trimStart();
  const numberedMatch = /^(\d+[.)]\s+)\[/.exec(trimmed);
  if (numberedMatch) return numberedMatch[1]!;
  if (trimmed.startsWith('- ')) return '- ';
  if (trimmed.startsWith('* ')) return '* ';
  if (trimmed.startsWith('+ ')) return '+ ';
  return '- ';
}

/**
 * Serialize a todo back to markdown line format.
 * Maintains Obsidian Tasks compatibility.
 */
export function serializeTodo(todo: Todo): string {
  const checkbox = todo.isCompleted ? '[x]' : '[ ]';
  const indent = '  '.repeat(todo.indent);

  // Preserve original list prefix from rawLine
  const prefix = detectListPrefix(todo.rawLine);

  let line = `${indent}${prefix}${checkbox} ${todo.content}`;

  // Add priority marker
  if (todo.priority) {
    switch (todo.priority) {
      case 'high':
        line += ` ${DATE_MARKERS.HIGH_PRIORITY}`;
        break;
      case 'medium':
        line += ` ${DATE_MARKERS.MEDIUM_PRIORITY}`;
        break;
      case 'low':
        line += ` ${DATE_MARKERS.LOW_PRIORITY}`;
        break;
    }
  }

  // Add date markers
  if (todo.dates.dueDate) {
    line += ` ${DATE_MARKERS.DUE} ${formatDateOnly(todo.dates.dueDate)}`;
  }
  if (todo.dates.scheduledDate) {
    line += ` ${DATE_MARKERS.SCHEDULED} ${formatDateOnly(todo.dates.scheduledDate)}`;
  }
  if (todo.dates.recurrence) {
    line += ` ${DATE_MARKERS.RECURRENCE} ${todo.dates.recurrence}`;
  }
  if (todo.dates.createdAt) {
    line += ` ${formatCreatedAt(todo.dates.createdAt)}`;
  }
  if (todo.isCompleted && todo.dates.completedAt) {
    line += ` ${formatCompletedAt(todo.dates.completedAt)}`;
  }

  for (const tag of todo.tags) {
    line += ` #${tag}`;
  }

  return line;
}

/**
 * Sort todos by priority, then by due date, then by source order.
 * Returns a new sorted array.
 */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // Priority first (high > medium > low > none)
    const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    // Then by due date (earlier first, no date last)
    if (a.dates.dueDate && b.dates.dueDate) {
      const dateDiff = a.dates.dueDate.getTime() - b.dates.dueDate.getTime();
      if (dateDiff !== 0) return dateDiff;
    }
    if (a.dates.dueDate && !b.dates.dueDate) return -1;
    if (!a.dates.dueDate && b.dates.dueDate) return 1;

    // Then by line number (source order)
    return a.lineNumber - b.lineNumber;
  });
}

/**
 * Sort todos with completed items at the end.
 */
export function sortTodosWithCompletedLast(todos: Todo[]): Todo[] {
  const open = todos.filter((t) => !t.isCompleted);
  const completed = todos.filter((t) => t.isCompleted);
  return [...sortTodos(open), ...sortCompletedTodosByCompletedAt(completed)];
}

/**
 * Sort completed todos by completion timestamp, newest first.
 * Legacy completed items without timestamps stay after dated completions.
 */
export function sortCompletedTodosByCompletedAt(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const aCompletedAt = a.dates.completedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bCompletedAt = b.dates.completedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const completedDiff = bCompletedAt - aCompletedAt;
    if (completedDiff !== 0) return completedDiff;

    const sourceDiff = a.sourceFile.localeCompare(b.sourceFile);
    if (sourceDiff !== 0) return sourceDiff;
    return a.lineNumber - b.lineNumber;
  });
}

/**
 * Group todos by their source file.
 */
export function groupTodosByFile(todos: Todo[]): Map<string, Todo[]> {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    const existing = groups.get(todo.sourceFile) ?? [];
    groups.set(todo.sourceFile, [...existing, todo]);
  }
  return groups;
}

/**
 * Group todos by priority.
 */
export function groupTodosByPriority(todos: Todo[]): Map<TodoPriority | 'none', Todo[]> {
  const groups = new Map<TodoPriority | 'none', Todo[]>();
  for (const todo of todos) {
    const key = todo.priority ?? 'none';
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, todo]);
  }
  return groups;
}

/**
 * Get all unique tags from a list of todos.
 */
export function getAllTags(todos: Todo[]): string[] {
  const tagSet = new Set<string>();
  for (const todo of todos) {
    for (const tag of todo.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Count todos by status.
 */
export function countTodosByStatus(todos: Todo[]): { open: number; completed: number; total: number } {
  const open = todos.filter((t) => !t.isCompleted).length;
  const completed = todos.length - open;
  return { open, completed, total: todos.length };
}
