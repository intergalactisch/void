/**
 * ContextProviderPort - Outbound port for gathering application context
 *
 * This port defines how to gather current application state to provide
 * context for AI prompts. The context helps the AI understand what the
 * user is working on.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { PromptContext, EditorContext, NavigationContext, NoteSummary } from '$lib/domain/values/PromptContext';
import type { Document } from '$lib/domain/entities/Document';

/**
 * Outbound port for gathering application context.
 *
 * Implemented by adapters that collect state from various parts
 * of the application (editor, navigation, recent files, etc.).
 */
export interface ContextProviderPort {
  /**
   * Get the full current context for AI prompts.
   * Aggregates all context sources into a single object.
   * @returns Current prompt context
   */
  getContext(): Promise<PromptContext>;

  /**
   * Get the currently open document, if any.
   * @returns Current document or null
   */
  getCurrentDocument(): Promise<Document | null>;

  /**
   * Set the currently active document so subsequent context queries
   * (and AI prompts) reflect what the user is working on. Pass `null`
   * when no document is open.
   */
  setCurrentDocument(document: Document | null): void;

  /**
   * Get the current editor context.
   * @returns Editor context or null if editor not active
   */
  getEditorContext(): Promise<EditorContext | null>;

  /**
   * Get the current navigation context.
   * @returns Navigation context
   */
  getNavigationContext(): Promise<NavigationContext>;

  /**
   * Get recently accessed notes.
   * @param limit - Maximum number of notes to return
   * @returns Array of note summaries, most recent first
   */
  getRecentNotes(limit?: number): Promise<NoteSummary[]>;

  /**
   * Get the user's preferred language.
   * Used for AI response language.
   * @returns Language code (e.g., 'en', 'nl')
   */
  getLanguage(): string;

  /**
   * Get the user's timezone.
   * Used for time-aware AI responses.
   * @returns Timezone string (e.g., 'America/New_York')
   */
  getTimezone(): string;

  /**
   * Get the base path for notes storage.
   * @returns Absolute path to the notes folder
   */
  getNotesBasePath(): string;

  /**
   * Subscribe to context changes.
   * Called whenever relevant context changes (document change, selection, etc.).
   * @param callback - Function called with new context
   * @returns Unsubscribe function
   */
  subscribe(callback: (context: PromptContext) => void): () => void;
}
