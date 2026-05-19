/**
 * TODO Serialization Utilities
 *
 * Functions for serializing TODOs back to markdown format. Handles:
 * - Checkbox state changes
 * - Completion timestamps
 * - Content updates
 * - Line-level modifications in files
 *
 * These utilities work with the raw line content in files, handling
 * the specific markdown syntax while preserving formatting.
 */

import type { Todo } from '$lib/domain/entities/Todo';
import { DATE_MARKERS, formatCompletedAt, formatDateOnly } from '$lib/domain/values/TodoDateMeta';
import { createIndentation } from './regex';

// ──────────────────────────────────────────────────────────────────────────────
// Checkbox Manipulation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Toggle the checkbox state in a raw markdown line.
 * Changes `[ ]` to `[x]` or `[x]` to `[ ]`.
 */
export function toggleCheckbox(line: string): string {
  // Match both unchecked and checked states
  if (/\[\s\]/.test(line)) {
    return line.replace(/\[\s\]/, '[x]');
  }
  if (/\[[xX]\]/.test(line)) {
    return line.replace(/\[[xX]\]/, '[ ]');
  }
  return line;
}

/**
 * Set checkbox to completed state.
 */
export function setCheckboxCompleted(line: string): string {
  return line.replace(/\[[xX\s]\]/, '[x]');
}

/**
 * Set checkbox to incomplete state.
 */
export function setCheckboxIncomplete(line: string): string {
  return line.replace(/\[[xX\s]\]/, '[ ]');
}

// ──────────────────────────────────────────────────────────────────────────────
// Completion Timestamp
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Add completion timestamp to a line.
 * Appends the timestamp at the end if not already present.
 */
export function addCompletionTimestamp(line: string, completedAt: Date): string {
  // Remove any existing completion timestamp first
  const withoutTimestamp = removeCompletionTimestamp(line);
  // Append new timestamp
  return `${withoutTimestamp} ${formatCompletedAt(completedAt)}`;
}

/**
 * Remove completion timestamp from a line.
 */
export function removeCompletionTimestamp(line: string): string {
  const pattern = new RegExp(`\\s*${DATE_MARKERS.COMPLETED}\\s*\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2})?`, 'g');
  return line.replace(pattern, '').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Content Replacement
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Replace the content portion of a todo line.
 * Preserves indentation, list marker, and checkbox state.
 * Supports -, *, +, numbered lists, and bare checkboxes.
 *
 * @param originalLine - Original markdown line
 * @param newContent - New content (without checkbox/metadata)
 * @returns Updated line with new content
 */
export function replaceContent(originalLine: string, newContent: string): string {
  // Standard list markers: -, *, +
  const standardMatch = /^(\s*)([-*+])\s+\[([xX\s])\]\s+/.exec(originalLine);
  if (standardMatch) {
    const [, indentation, listMarker, checkboxState] = standardMatch;
    return `${indentation}${listMarker} [${checkboxState}] ${newContent}`;
  }

  // Numbered list: 1. [ ], 2) [ ]
  const numberedMatch = /^(\s*)(\d+[.)]\s+)\[([xX\s])\]\s+/.exec(originalLine);
  if (numberedMatch) {
    const [, indentation, numPrefix, checkboxState] = numberedMatch;
    return `${indentation}${numPrefix}[${checkboxState}] ${newContent}`;
  }

  // Bare checkbox: [ ] task
  const bareMatch = /^(\s*)\[([xX\s])\]\s+/.exec(originalLine);
  if (bareMatch) {
    const [, indentation, checkboxState] = bareMatch;
    return `${indentation}[${checkboxState}] ${newContent}`;
  }

  // Not a valid todo line, return as-is
  return originalLine;
}

// ──────────────────────────────────────────────────────────────────────────────
// File Content Manipulation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Update a specific line in file content.
 *
 * @param content - Full file content
 * @param lineNumber - Line number to update (0-indexed)
 * @param newLine - New line content
 * @returns Updated file content
 */
export function updateLineInContent(content: string, lineNumber: number, newLine: string): string {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber >= lines.length) {
    throw new Error(`Line number ${lineNumber} out of bounds (0-${lines.length - 1})`);
  }

  lines[lineNumber] = newLine;
  return lines.join('\n');
}

/**
 * Delete a specific line from file content.
 *
 * @param content - Full file content
 * @param lineNumber - Line number to delete (0-indexed)
 * @returns Updated file content with line removed
 */
export function deleteLineFromContent(content: string, lineNumber: number): string {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber >= lines.length) {
    throw new Error(`Line number ${lineNumber} out of bounds (0-${lines.length - 1})`);
  }

  lines.splice(lineNumber, 1);
  return lines.join('\n');
}

/**
 * Insert a new line into file content.
 *
 * @param content - Full file content
 * @param lineNumber - Line number to insert at (0-indexed)
 * @param newLine - Line content to insert
 * @returns Updated file content with line inserted
 */
export function insertLineInContent(content: string, lineNumber: number, newLine: string): string {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber > lines.length) {
    throw new Error(`Line number ${lineNumber} out of bounds (0-${lines.length})`);
  }

  lines.splice(lineNumber, 0, newLine);
  return lines.join('\n');
}

/**
 * Append a line to the end of file content.
 *
 * @param content - Full file content
 * @param newLine - Line content to append
 * @returns Updated file content with line appended
 */
export function appendLineToContent(content: string, newLine: string): string {
  // Ensure we don't double-append newlines
  const trimmedContent = content.trimEnd();
  if (trimmedContent.length === 0) {
    return newLine;
  }
  return `${trimmedContent}\n${newLine}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// New Todo Line Generation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create a new todo line from components.
 *
 * @param content - Task text content
 * @param options - Optional formatting options
 * @returns Formatted markdown todo line
 */
export interface NewTodoOptions {
  /** Indentation level (default: 0) */
  indent?: number;
  /** List marker style (default: '-') */
  marker?: '-' | '*';
  /** Due date */
  dueDate?: Date;
  /** Scheduled date */
  scheduledDate?: Date;
  /** Recurrence pattern */
  recurrence?: string;
  /** Created date */
  createdAt?: Date;
  /** Priority level */
  priority?: 'high' | 'medium' | 'low';
  /** Tags to include */
  tags?: string[];
}

export function createNewTodoLine(content: string, options: NewTodoOptions = {}): string {
  const indent = createIndentation(options.indent ?? 0);
  const marker = options.marker ?? '-';

  let line = `${indent}${marker} [ ] ${content}`;

  // Add priority
  if (options.priority) {
    switch (options.priority) {
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

  // Add dates
  if (options.dueDate) {
    line += ` ${DATE_MARKERS.DUE} ${formatDate(options.dueDate)}`;
  }
  if (options.scheduledDate) {
    line += ` ${DATE_MARKERS.SCHEDULED} ${formatDate(options.scheduledDate)}`;
  }
  if (options.recurrence) {
    line += ` ${DATE_MARKERS.RECURRENCE} ${options.recurrence}`;
  }
  if (options.createdAt) {
    line += ` ${DATE_MARKERS.CREATED} ${formatDate(options.createdAt)}`;
  }

  // Add tags
  if (options.tags) {
    for (const tag of options.tags) {
      line += ` #${tag}`;
    }
  }

  return line;
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  return formatDateOnly(date);
}

// ──────────────────────────────────────────────────────────────────────────────
// Batch Operations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Result of a batch line update operation.
 */
export interface BatchUpdateResult {
  /** Updated file content */
  content: string;
  /** Number of lines modified */
  modifiedCount: number;
}

/**
 * Update multiple lines in file content.
 * More efficient than multiple updateLineInContent calls.
 *
 * @param content - Full file content
 * @param updates - Map of line numbers to new content
 * @returns Updated file content and modification count
 */
export function batchUpdateLines(
  content: string,
  updates: Map<number, string>
): BatchUpdateResult {
  const lines = content.split('\n');
  let modifiedCount = 0;

  for (const [lineNumber, newLine] of updates) {
    if (lineNumber >= 0 && lineNumber < lines.length) {
      lines[lineNumber] = newLine;
      modifiedCount++;
    }
  }

  return {
    content: lines.join('\n'),
    modifiedCount,
  };
}
