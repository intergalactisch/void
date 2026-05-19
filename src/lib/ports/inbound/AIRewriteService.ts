/**
 * AIRewriteService - Inbound port for AI text operations
 *
 * This port defines the application API for AI-powered text operations,
 * exposing how the UI layer can request AI rewrites, expansions, and other
 * text transformations. Primary adapters (Svelte components, stores) depend
 * on this interface.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { AIOperation } from '$lib/domain/values/AIOperation';

/**
 * AI rewrite state exposed to the UI.
 */
export interface AIRewriteState {
  /** Whether an AI operation is in progress */
  isProcessing: boolean;
  /** Current operation type, or null if not processing */
  operation: AIOperation | null;
  /** Block ID being processed, or null if not processing */
  processingBlockId: string | null;
  /** Selection range being processed */
  processingRange: {
    /** Start position */
    from: number;
    /** End position */
    to: number;
  } | null;
  /** Original text (for undo/reject) */
  originalText: string | null;
  /** Streaming response text (built up during streaming) */
  streamingText: string;
  /** Error if operation failed, or null */
  error: Error | null;
}

/**
 * Inbound port - AI rewrite service API.
 *
 * This interface is implemented by application services (AIRewriteServiceImpl)
 * and defines the API available to UI components and stores.
 */
export interface AIRewriteService {
  /**
   * Get current AI state.
   * @returns The current AI rewrite state
   */
  getState(): AIRewriteState;

  /**
   * Check if AI is available.
   * Verifies that an AI provider is configured and accessible.
   * @returns True if AI is available
   */
  isAvailable(): Promise<boolean>;

  // ========== Rewrite operations ==========

  /**
   * Rewrite selected text.
   * Uses AI to rewrite the current selection based on the instruction.
   * @param instruction - Optional instruction for how to rewrite (default: "improve clarity")
   * @returns Result containing the rewritten text or an error
   */
  rewriteSelection(instruction?: string): Promise<Result<string, Error>>;

  /**
   * Expand selected text.
   * Uses AI to add more detail and elaboration to the selection.
   * @returns Result containing the expanded text or an error
   */
  expandSelection(): Promise<Result<string, Error>>;

  /**
   * Summarize selected text.
   * Uses AI to create a concise summary of the selection.
   * @returns Result containing the summary or an error
   */
  summarizeSelection(): Promise<Result<string, Error>>;

  /**
   * Fix grammar in selection.
   * Uses AI to correct grammatical errors and typos.
   * @returns Result containing the corrected text or an error
   */
  fixGrammarInSelection(): Promise<Result<string, Error>>;

  /**
   * Custom operation on selection.
   * Allows for user-defined AI operations.
   * @param instruction - Custom instruction for the AI
   * @returns Result containing the processed text or an error
   */
  customOperation(instruction: string): Promise<Result<string, Error>>;

  // ========== Result handling ==========

  /**
   * Accept the AI result and apply to document.
   * Commits the rewritten text and clears the processing state.
   */
  acceptResult(): void;

  /**
   * Reject the AI result and restore original.
   * Reverts to the original text and clears the processing state.
   */
  rejectResult(): void;

  /**
   * Cancel ongoing operation.
   * Aborts the current AI request and restores original text.
   */
  cancel(): void;

  // ========== Subscriptions ==========

  /**
   * Subscribe to state changes.
   * @param callback - Called whenever the AI rewrite state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: AIRewriteState) => void): () => void;
}
