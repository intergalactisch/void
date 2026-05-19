/**
 * Regular expressions for parsing TODO markdown syntax
 *
 * Supports GFM-style task list items with Obsidian Tasks-compatible
 * metadata markers (dates, priorities, recurrence, tags).
 *
 * GFM Checkbox Format:
 * - `- [ ] task` (incomplete with dash)
 * - `- [x] task` (complete with dash)
 * - `* [ ] task` (incomplete with asterisk)
 * - `* [x] task` (complete with asterisk)
 *
 * Obsidian Tasks Markers:
 * - Due date: [calendar emoji] YYYY-MM-DD
 * - Scheduled: [hourglass emoji] YYYY-MM-DD
 * - Completed: [checkmark emoji] YYYY-MM-DDTHH:MM
 * - Recurrence: [repeat emoji] every day/week/etc.
 * - Priority: high/medium/low emoji markers
 */

import { DATE_MARKERS } from '$lib/domain/values/TodoDateMeta';

// ──────────────────────────────────────────────────────────────────────────────
// Main TODO Pattern
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Match markdown task list items (GFM format).
 *
 * Groups:
 * 1. Indentation (spaces/tabs before marker)
 * 2. List marker (-, *, or +)
 * 3. Checkbox state (x or space)
 * 4. Content (everything after the checkbox)
 */
export const TODO_PATTERN = /^(\s*)([-*+])\s+\[([xX ])\]\s+(.+)$/;

/**
 * Match numbered list todo items.
 *
 * Groups:
 * 1. Indentation (spaces/tabs before number)
 * 2. Number prefix (e.g. "1. " or "2) ")
 * 3. Checkbox state (x or space)
 * 4. Content (everything after the checkbox)
 */
export const NUMBERED_TODO_PATTERN = /^(\s*)(\d+[.)]\s+)\[([xX ])\]\s+(.+)$/;

/**
 * Match bare checkbox items (no list marker).
 *
 * Groups:
 * 1. Indentation (spaces/tabs before checkbox)
 * 2. Checkbox state (x or space)
 * 3. Content (everything after the checkbox)
 */
export const BARE_TODO_PATTERN = /^(\s*)\[([xX ])\]\s+(.+)$/;

/**
 * Structured result from matching a todo line.
 */
export interface TodoLineMatch {
  /** Leading whitespace */
  indentation: string;
  /** List prefix (e.g. "- ", "* ", "+ ", "1. ", "" for bare) */
  prefix: string;
  /** Checkbox state character: "x", "X", or " " */
  checkboxState: string;
  /** Content text after the checkbox */
  content: string;
}

/**
 * Try to match a line as a todo item using all supported formats.
 * Tries standard list markers first, then numbered lists, then bare checkboxes.
 *
 * @returns Match result or null if not a todo line
 */
export function matchTodoLine(line: string): TodoLineMatch | null {
  // Standard list markers: -, *, +
  const standardMatch = TODO_PATTERN.exec(line);
  if (standardMatch) {
    return {
      indentation: standardMatch[1] ?? '',
      prefix: `${standardMatch[2]} `,
      checkboxState: standardMatch[3] ?? ' ',
      content: standardMatch[4] ?? '',
    };
  }

  // Numbered list: 1. [ ] task, 2) [ ] task
  const numberedMatch = NUMBERED_TODO_PATTERN.exec(line);
  if (numberedMatch) {
    return {
      indentation: numberedMatch[1] ?? '',
      prefix: numberedMatch[2] ?? '',
      checkboxState: numberedMatch[3] ?? ' ',
      content: numberedMatch[4] ?? '',
    };
  }

  // Bare checkbox: [ ] task
  const bareMatch = BARE_TODO_PATTERN.exec(line);
  if (bareMatch) {
    return {
      indentation: bareMatch[1] ?? '',
      prefix: '',
      checkboxState: bareMatch[2] ?? ' ',
      content: bareMatch[3] ?? '',
    };
  }

  return null;
}

/**
 * Test if a line is a TODO item.
 */
export function isTodoLine(line: string): boolean {
  return matchTodoLine(line) !== null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Date Patterns
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Date regex patterns with emoji markers.
 * Uses Unicode escapes for reliability across environments.
 */
export const DATE_PATTERNS = {
  /** Due date: [calendar emoji] YYYY-MM-DD */
  DUE: new RegExp(`${DATE_MARKERS.DUE}\\s*(\\d{4}-\\d{2}-\\d{2})`),
  /** Scheduled date: [hourglass emoji] YYYY-MM-DD */
  SCHEDULED: new RegExp(`${DATE_MARKERS.SCHEDULED}\\s*(\\d{4}-\\d{2}-\\d{2})`),
  /** Completed: [checkmark emoji] YYYY-MM-DDTHH:MM (or just date) */
  COMPLETED: new RegExp(`${DATE_MARKERS.COMPLETED}\\s*(\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2})?)`),
  /** Created: [plus emoji] YYYY-MM-DD */
  CREATED: new RegExp(`${DATE_MARKERS.CREATED}\\s*(\\d{4}-\\d{2}-\\d{2})`),
  /** Recurrence: [repeat emoji] every day/week/month/year or N days/weeks/etc. */
  RECURRENCE: new RegExp(
    `${DATE_MARKERS.RECURRENCE}\\s*(every\\s+(?:day|week|month|year|\\d+\\s+(?:days?|weeks?|months?|years?)))`,
    'i'
  ),
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Priority Patterns
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Priority emoji patterns.
 */
export const PRIORITY_PATTERNS = {
  /** High priority: double up arrow emoji */
  HIGH: new RegExp(DATE_MARKERS.HIGH_PRIORITY),
  /** Medium priority: single up arrow emoji */
  MEDIUM: new RegExp(DATE_MARKERS.MEDIUM_PRIORITY),
  /** Low priority: down arrow emoji */
  LOW: new RegExp(DATE_MARKERS.LOW_PRIORITY),
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Tag Pattern
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Match hashtag-style tags.
 * Captures: #tag-name, #tag_name, #tag123
 */
export const TAG_PATTERN = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * Extract all tags from content.
 */
export function extractTags(content: string): string[] {
  const tags: string[] = [];
  const regex = new RegExp(TAG_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      tags.push(match[1]);
    }
  }
  return tags;
}

// ──────────────────────────────────────────────────────────────────────────────
// Metadata Stripping
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pattern to match all metadata markers and their values.
 * Used to strip metadata from content to get clean task text.
 */
const METADATA_PATTERNS = [
  // Date markers with values
  new RegExp(`${DATE_MARKERS.DUE}\\s*\\d{4}-\\d{2}-\\d{2}`, 'g'),
  new RegExp(`${DATE_MARKERS.SCHEDULED}\\s*\\d{4}-\\d{2}-\\d{2}`, 'g'),
  new RegExp(`${DATE_MARKERS.COMPLETED}\\s*\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2})?`, 'g'),
  new RegExp(`${DATE_MARKERS.CREATED}\\s*\\d{4}-\\d{2}-\\d{2}`, 'g'),
  new RegExp(
    `${DATE_MARKERS.RECURRENCE}\\s*every\\s+(?:day|week|month|year|\\d+\\s+(?:days?|weeks?|months?|years?))`,
    'gi'
  ),
  // Priority markers (standalone)
  new RegExp(DATE_MARKERS.HIGH_PRIORITY, 'g'),
  new RegExp(DATE_MARKERS.MEDIUM_PRIORITY, 'g'),
  new RegExp(DATE_MARKERS.LOW_PRIORITY, 'g'),
  // Tags
  /#[a-zA-Z][a-zA-Z0-9_-]*/g,
];

/**
 * Strip all metadata (dates, priority, tags) from content.
 * Returns clean task text.
 */
export function stripMetadata(content: string): string {
  let result = content;
  for (const pattern of METADATA_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // Clean up extra whitespace
  return result.replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Indentation Utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calculate indentation level from whitespace string.
 * Treats tabs as 2 spaces equivalent.
 */
export function calculateIndentLevel(indentation: string): number {
  let spaces = 0;
  for (const char of indentation) {
    if (char === '\t') {
      spaces += 2;
    } else if (char === ' ') {
      spaces += 1;
    }
  }
  // Each indent level is 2 spaces
  return Math.floor(spaces / 2);
}

/**
 * Create indentation string for a given level.
 * Uses 2 spaces per level.
 */
export function createIndentation(level: number): string {
  return '  '.repeat(level);
}
