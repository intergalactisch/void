/**
 * TodoParserPort - Outbound port for parsing markdown TODO syntax
 *
 * This port defines the interface for parsing and serializing TODO items
 * from/to markdown content. Supports GFM-style checkboxes with Obsidian
 * Tasks-compatible date markers and priority indicators.
 *
 * Syntax support:
 * - Checkboxes: `- [ ]`, `- [x]`, `* [ ]`, `* [x]`
 * - Due date: `[due date marker] YYYY-MM-DD`
 * - Scheduled: `[scheduled marker] YYYY-MM-DD`
 * - Completed: `[completed marker] YYYY-MM-DDTHH:MM`
 * - Recurrence: `[recurrence marker] every day/week/etc.`
 * - Priority: high/medium/low markers
 * - Tags: `#tag-name`
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Todo } from '$lib/domain/entities/Todo';
import type { TodoDateMeta } from '$lib/domain/values/TodoDateMeta';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';
import type { TodoSource } from '$lib/domain/values/TodoSource';

/**
 * Parsed metadata from a todo line.
 */
export interface ParsedTodoMeta {
  /** Parsed date metadata */
  dates: TodoDateMeta;
  /** Parsed priority level */
  priority?: TodoPriority;
  /** Parsed tags */
  tags: string[];
  /** Content with metadata stripped */
  cleanContent: string;
}

export interface TodoParseOptions {
  /**
   * Explicit source override. Used when repository-level metadata marks a
   * non-TODO.md markdown file as a dedicated todo list.
   */
  source?: TodoSource;
}

/**
 * Outbound port for TODO parsing operations.
 *
 * Implemented by adapters that handle markdown parsing and serialization.
 */
export interface TodoParserPort {
  /**
   * Parse all todos from markdown content.
   * @param content - Full markdown file content
   * @param filePath - Path to the source file (for ID generation)
   * @returns Array of parsed todos
   */
  parse(content: string, filePath: string, options?: TodoParseOptions): Todo[];

  /**
   * Parse a single line as a potential todo.
   * @param line - Single line of markdown
   * @param lineNumber - Line number in the file (0-indexed)
   * @param filePath - Path to the source file
   * @returns Parsed todo or null if line is not a todo
   */
  parseLine(
    line: string,
    lineNumber: number,
    filePath: string,
    section?: string,
    options?: TodoParseOptions,
  ): Todo | null;

  /**
   * Parse date and priority metadata from a todo line.
   * @param line - Todo line content
   * @returns Parsed metadata including cleaned content
   */
  parseMetadata(line: string): ParsedTodoMeta;

  /**
   * Serialize a todo back to markdown format.
   * Preserves original formatting style (dash vs asterisk).
   * @param todo - Todo to serialize
   * @returns Markdown line string
   */
  serialize(todo: Todo): string;

  /**
   * Serialize a todo with completion timestamp added.
   * Used when marking a todo as complete.
   * @param todo - Todo to serialize
   * @param completedAt - Completion timestamp
   * @returns Markdown line string with completion marker
   */
  serializeCompleted(todo: Todo, completedAt: Date): string;
}
