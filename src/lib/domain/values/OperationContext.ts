/**
 * OperationContext - Pre-resolved context for AI operations
 *
 * Contains all the note content, summaries, and prompts needed
 * for an operation. Built by ContextBuilder before execution.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Summary of a note for inclusion in context.
 */
export interface NoteSummaryEntry {
  path: string;
  title: string;
  excerpt: string;
}

/**
 * User preferences for AI response style.
 */
export interface UserPreferences {
  language: string;
  style: string;
}

/**
 * Pre-resolved context for an operation.
 */
export interface OperationContext {
  /** Full note contents keyed by path */
  noteContents: Map<string, string>;
  /** Lightweight note index */
  noteSummaries: NoteSummaryEntry[];
  /** System prompt tailored for this operation */
  systemPrompt: string;
  /** User preferences */
  userPreferences: UserPreferences;
}

/**
 * Create an empty operation context.
 */
export function createEmptyOperationContext(): OperationContext {
  return {
    noteContents: new Map(),
    noteSummaries: [],
    systemPrompt: '',
    userPreferences: { language: 'en', style: 'concise' },
  };
}
