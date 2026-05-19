/**
 * MarkdownTodoParser - Parser for GFM-style TODO checkboxes
 *
 * Implements TodoParserPort to parse and serialize TODO items from/to
 * markdown format. Supports Obsidian Tasks-compatible syntax for dates,
 * priorities, and recurrence.
 *
 * Parsing:
 * - GFM checkboxes: `- [ ]`, `- [x]`, `* [ ]`, `* [x]`
 * - Date markers with emoji prefixes
 * - Priority markers (emoji)
 * - Hashtag-style tags
 *
 * Serialization:
 * - Preserves original list marker style (dash or asterisk)
 * - Maintains indentation for nested todos
 * - Adds metadata in Obsidian Tasks format
 */

import type { TodoParserPort, ParsedTodoMeta, TodoParseOptions } from '$lib/ports/outbound/TodoParserPort';
import type { CreateTodoParams, Todo } from '$lib/domain/entities/Todo';
import type { TodoDateMeta } from '$lib/domain/values/TodoDateMeta';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import { createTodo } from '$lib/domain/entities/Todo';
import { DATE_MARKERS, formatCompletedAt, formatCreatedAt, formatDateOnly } from '$lib/domain/values/TodoDateMeta';
import { TODO_FILENAME } from '$lib/domain/values/TodoConstants';
import { getTodoListFromHeading } from '$lib/domain/values/TodoView';
import {
  matchTodoLine,
  DATE_PATTERNS,
  PRIORITY_PATTERNS,
  extractTags,
  stripMetadata,
  calculateIndentLevel,
  createIndentation,
} from './regex';

/**
 * Determine if a file is the dedicated TODO file.
 */
function isDedicatedTodoFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() ?? '';
  return filename.toLowerCase() === TODO_FILENAME.toLowerCase();
}

/**
 * Parse a date string (YYYY-MM-DD or YYYY-MM-DDTHH:MM) to Date.
 */
function parseDate(dateStr: string): Date {
  // Handle both date-only and datetime formats
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // For date-only, parse as local date (midnight local time)
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year!, month! - 1, day);
}

/**
 * MarkdownTodoParser implementation of TodoParserPort.
 */
export class MarkdownTodoParser implements TodoParserPort {
  /**
   * Parse all todos from markdown content.
   */
  parse(content: string, filePath: string, options?: TodoParseOptions): Todo[] {
    const lines = content.split('\n');
    const todos: Todo[] = [];
    let currentSection: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const heading = parseHeading(lines[i]!);
      if (heading) {
        currentSection = heading;
        continue;
      }

      const todo = this.parseLine(lines[i]!, i, filePath, currentSection, options);
      if (todo) {
        todos.push(todo);
      }
    }

    return todos;
  }

  /**
   * Parse a single line as a potential todo.
   * Supports standard list markers (-, *, +), numbered lists, and bare checkboxes.
   */
  parseLine(
    line: string,
    lineNumber: number,
    filePath: string,
    section?: string,
    options?: TodoParseOptions,
  ): Todo | null {
    const match = matchTodoLine(line);
    if (!match) {
      return null;
    }

    // Parse metadata from content
    const meta = this.parseMetadata(match.content);

    // Determine source type
    const source: TodoSource = options?.source ?? (isDedicatedTodoFile(filePath) ? 'dedicated' : 'inline');
    const list = source === 'dedicated' ? getTodoListFromHeading(section) ?? 'inbox' : undefined;

    // Calculate indentation level
    const indent = calculateIndentLevel(match.indentation);

    // Check if completed (x or X)
    const isCompleted = match.checkboxState.toLowerCase() === 'x';

    // Build params without undefined priority (exactOptionalPropertyTypes compliance)
    const params: CreateTodoParams = {
      content: meta.cleanContent,
      isCompleted,
      source,
      sourceFile: filePath,
      lineNumber,
      indent,
      dates: meta.dates,
      tags: meta.tags,
      rawLine: line,
    };
    if (section !== undefined) params.section = section;
    if (list !== undefined) params.list = list;

    // Only add priority if it's defined
    if (meta.priority !== undefined) {
      return createTodo({ ...params, priority: meta.priority });
    }

    return createTodo(params);
  }

  /**
   * Parse metadata from todo content.
   */
  parseMetadata(line: string): ParsedTodoMeta {
    const dates: TodoDateMeta = {};
    let priority: TodoPriority | undefined;

    // Parse due date
    const dueMatch = DATE_PATTERNS.DUE.exec(line);
    if (dueMatch?.[1]) {
      dates.dueDate = parseDate(dueMatch[1]);
    }

    // Parse scheduled date
    const scheduledMatch = DATE_PATTERNS.SCHEDULED.exec(line);
    if (scheduledMatch?.[1]) {
      dates.scheduledDate = parseDate(scheduledMatch[1]);
    }

    // Parse completed date
    const completedMatch = DATE_PATTERNS.COMPLETED.exec(line);
    if (completedMatch?.[1]) {
      dates.completedAt = parseDate(completedMatch[1]);
    }

    // Parse created date
    const createdMatch = DATE_PATTERNS.CREATED.exec(line);
    if (createdMatch?.[1]) {
      dates.createdAt = parseDate(createdMatch[1]);
    }

    // Parse recurrence
    const recurrenceMatch = DATE_PATTERNS.RECURRENCE.exec(line);
    if (recurrenceMatch?.[1]) {
      dates.recurrence = recurrenceMatch[1];
    }

    // Parse priority (check in order of precedence)
    if (PRIORITY_PATTERNS.HIGH.test(line)) {
      priority = 'high';
    } else if (PRIORITY_PATTERNS.MEDIUM.test(line)) {
      priority = 'medium';
    } else if (PRIORITY_PATTERNS.LOW.test(line)) {
      priority = 'low';
    }

    // Extract tags
    const tags = extractTags(line);

    // Get clean content (stripped of metadata)
    const cleanContent = stripMetadata(line);

    // Build result without undefined priority (exactOptionalPropertyTypes compliance)
    const result: ParsedTodoMeta = { dates, tags, cleanContent };
    if (priority !== undefined) {
      result.priority = priority;
    }

    return result;
  }

  /**
   * Serialize a todo back to markdown format.
   */
  serialize(todo: Todo): string {
    const checkbox = todo.isCompleted ? '[x]' : '[ ]';
    const indent = createIndentation(todo.indent);

    // Preserve original list marker from rawLine
    const prefix = this.detectPrefix(todo.rawLine);

    // Build the line — prefix already includes trailing space for list markers
    let line = `${indent}${prefix}${checkbox} ${todo.content}`;

    // Add priority marker
    if (todo.priority) {
      line += ` ${this.serializePriority(todo.priority)}`;
    }

    // Add date markers
    if (todo.dates.dueDate) {
      line += ` ${DATE_MARKERS.DUE} ${this.formatDate(todo.dates.dueDate)}`;
    }
    if (todo.dates.scheduledDate) {
      line += ` ${DATE_MARKERS.SCHEDULED} ${this.formatDate(todo.dates.scheduledDate)}`;
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

    // Add tags
    for (const tag of todo.tags) {
      line += ` #${tag}`;
    }

    return line;
  }

  /**
   * Serialize a todo with completion timestamp.
   */
  serializeCompleted(todo: Todo, completedAt: Date): string {
    // Create a temporary todo with updated completion state
    const completedTodo: Todo = {
      ...todo,
      isCompleted: true,
      dates: {
        ...todo.dates,
        completedAt,
      },
    };
    return this.serialize(completedTodo);
  }

  /**
   * Format a date as YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    return formatDateOnly(date);
  }

  /**
   * Detect the list prefix from a raw line for serialization.
   * Returns prefix with trailing space (e.g. "- ", "* ", "1. ") or "- " for bare checkboxes.
   */
  private detectPrefix(rawLine: string): string {
    const trimmed = rawLine.trimStart();

    // Numbered list: "1. [ ]", "2) [ ]"
    const numberedMatch = /^(\d+[.)]\s+)\[/.exec(trimmed);
    if (numberedMatch) return numberedMatch[1]!;

    // Standard list markers: -, *, +
    if (trimmed.startsWith('- ')) return '- ';
    if (trimmed.startsWith('* ')) return '* ';
    if (trimmed.startsWith('+ ')) return '+ ';

    // Bare checkbox — use "- " as default serialization prefix
    return '- ';
  }

  /**
   * Get the emoji marker for a priority level.
   */
  private serializePriority(priority: TodoPriority): string {
    switch (priority) {
      case 'high':
        return DATE_MARKERS.HIGH_PRIORITY;
      case 'medium':
        return DATE_MARKERS.MEDIUM_PRIORITY;
      case 'low':
        return DATE_MARKERS.LOW_PRIORITY;
    }
  }
}

function parseHeading(line: string): string | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match?.[2]) return undefined;
  return match[2].replace(/\s+#+\s*$/, '').trim();
}

/**
 * Create a new MarkdownTodoParser instance.
 */
export function createMarkdownTodoParser(): TodoParserPort {
  return new MarkdownTodoParser();
}
