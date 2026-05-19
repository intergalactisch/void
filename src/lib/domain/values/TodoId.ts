/**
 * TodoId - File path and line number based identifier
 *
 * TODOs are identified by their location: "filepath:linenumber".
 * This provides stable references that can be used to update the
 * original markdown file.
 *
 * Examples:
 * - "notes/project.md:42" - TODO on line 42 of project.md
 * - "TODO.md:5" - TODO on line 5 of the dedicated TODO file
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Todo ID in the format 'filepath:linenumber'.
 * Branded type for type safety.
 */
export type TodoId = string & { readonly __brand: 'TodoId' };

/**
 * Generate a TodoId from file path and line number.
 */
export function generateTodoId(filePath: string, lineNumber: number): TodoId {
  if (!filePath) {
    throw new Error('File path cannot be empty');
  }
  if (lineNumber < 0) {
    throw new Error('Line number cannot be negative');
  }
  return `${filePath}:${lineNumber}` as TodoId;
}

/**
 * Parse a TodoId string into file path and line number.
 */
export function parseTodoId(id: TodoId): { filePath: string; lineNumber: number } {
  const lastColon = id.lastIndexOf(':');
  if (lastColon === -1) {
    throw new Error(`Invalid TodoId: "${id}" - missing colon separator`);
  }
  return {
    filePath: id.substring(0, lastColon),
    lineNumber: parseInt(id.substring(lastColon + 1), 10),
  };
}

/**
 * Check if a string is a valid TodoId.
 */
export function isValidTodoId(id: string): id is TodoId {
  const lastColon = id.lastIndexOf(':');
  if (lastColon === -1) return false;
  const filePath = id.substring(0, lastColon);
  const lineNum = parseInt(id.substring(lastColon + 1), 10);
  return filePath.length > 0 && !isNaN(lineNum) && lineNum >= 0;
}

/**
 * Get the file path from a TodoId.
 */
export function getTodoFilePath(id: TodoId): string {
  return parseTodoId(id).filePath;
}

/**
 * Get the line number from a TodoId.
 */
export function getTodoLineNumber(id: TodoId): number {
  return parseTodoId(id).lineNumber;
}
