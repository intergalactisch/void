/**
 * TodoSource - Identifies where a TODO originates from
 *
 * TODOs can come from two sources:
 * - 'dedicated' - From a dedicated TODO.md file at the vault root
 * - 'inline' - From any other markdown file in the vault
 *
 * This distinction is useful for:
 * - Filtering todos by source type
 * - Applying different display/grouping logic
 * - Prioritizing dedicated todos over inline ones
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Source type for a TODO item.
 */
export type TodoSource = 'dedicated' | 'inline';

/**
 * Named constants for todo sources.
 */
export const TODO_SOURCES = {
  /** From the dedicated TODO.md file */
  DEDICATED: 'dedicated' as TodoSource,
  /** From any inline .md file */
  INLINE: 'inline' as TodoSource,
} as const;

/**
 * All valid todo source values.
 */
export const ALL_TODO_SOURCES: readonly TodoSource[] = [
  TODO_SOURCES.DEDICATED,
  TODO_SOURCES.INLINE,
] as const;

/**
 * Check if a value is a valid TodoSource.
 */
export function isValidTodoSource(value: string): value is TodoSource {
  return value === 'dedicated' || value === 'inline';
}

/**
 * Get display name for a todo source.
 */
export function getTodoSourceDisplayName(source: TodoSource): string {
  switch (source) {
    case 'dedicated':
      return 'TODO.md';
    case 'inline':
      return 'Inline';
  }
}
