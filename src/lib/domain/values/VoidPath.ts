/**
 * VoidPath - Path resolution helpers for .void/ sidecar directory
 *
 * All .void/ paths are relative to the notes directory.
 * These helpers ensure consistent path construction.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Get the provenance file path for a note.
 * @returns Relative path like "provenance/my-note.jsonl"
 */
export function provenancePath(noteName: string): string {
  return `provenance/${sanitizeName(noteName)}.jsonl`;
}

/**
 * Get the conversation directory for a note.
 * @returns Relative path like "conversations/my-note/"
 */
export function conversationDir(noteName: string): string {
  return `conversations/${sanitizeName(noteName)}`;
}

/**
 * Get the branch directory for a note.
 * @returns Relative path like "branches/my-note/"
 */
export function branchDir(noteName: string): string {
  return `branches/${sanitizeName(noteName)}`;
}

/**
 * Get the index directory path.
 * @returns "index"
 */
export function indexPath(): string {
  return 'index';
}

/**
 * Get the insights directory path.
 * @returns "insights"
 */
export function insightsPath(): string {
  return 'insights';
}

/**
 * Extract a note name from a file path.
 * Strips directory and .md extension.
 * "path/to/my-note.md" -> "my-note"
 */
export function noteNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.md$/, '');
}

/**
 * Sanitize a note name for use as a file/directory name.
 * Removes .md extension if present.
 */
function sanitizeName(name: string): string {
  return name.replace(/\.md$/, '');
}
