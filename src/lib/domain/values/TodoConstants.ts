/**
 * TodoConstants - Constants for TODO file handling
 *
 * Provides shared constants and helper functions for working with
 * TODO files across the application.
 */

/** The filename used for the dedicated todo file */
export const TODO_FILENAME = 'TODO.md';

/**
 * Get the full path to the dedicated TODO.md file for a given notes directory.
 *
 * @param notesPath - Root path to the notes directory
 * @returns Full path to the TODO.md file
 */
export function getDefaultTodoFilePath(notesPath: string): string {
  const separator = notesPath.includes('\\') ? '\\' : '/';
  return `${notesPath}${separator}${TODO_FILENAME}`;
}
