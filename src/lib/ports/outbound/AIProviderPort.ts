/**
 * AIProviderPort - Outbound port for AI provider operations
 *
 * This port defines the contract between the application and AI providers
 * (e.g., Claude, OpenAI). The application layer depends on this interface,
 * never on concrete implementations.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { AIOperation } from '$lib/domain/values/AIOperation';

/**
 * Request object for AI rewrite operations.
 */
export interface AIRewriteRequest {
  /** Text to rewrite */
  text: string;
  /** Instruction for rewriting (e.g., "make it more formal") */
  instruction: string;
  /** Context (surrounding text for better understanding) */
  context?: string;
}

/**
 * Response object from AI rewrite operations.
 */
export interface AIRewriteResponse {
  /** Rewritten text */
  text: string;
  /** Confidence score (0-1) indicating how confident the AI is */
  confidence: number;
}

/**
 * AIOperation lives in the domain so inbound ports can reference it
 * without depending on outbound ports. Re-exported here for adapters
 * already wired against `$lib/ports/outbound`.
 */
export type { AIOperation } from '$lib/domain/values/AIOperation';

/**
 * Outbound port for AI provider operations.
 *
 * This interface is implemented by secondary adapters (e.g., ClaudeAdapter, OpenAIAdapter)
 * and defines how the application interacts with AI services.
 */
export interface AIProviderPort {
  /**
   * Check if provider is configured and available.
   * Verifies that API keys are set and the service is reachable.
   * @returns True if the provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Rewrite text with AI.
   * @param request - The rewrite request containing text, instruction, and optional context
   * @returns Result containing the rewritten text or an error
   */
  rewrite(request: AIRewriteRequest): Promise<Result<AIRewriteResponse, Error>>;

  /**
   * Expand text with more detail.
   * Adds elaboration and additional content to the provided text.
   * @param text - The text to expand
   * @param context - Optional surrounding context
   * @returns Result containing the expanded text or an error
   */
  expand(text: string, context?: string): Promise<Result<string, Error>>;

  /**
   * Summarize text.
   * Creates a concise summary of the provided text.
   * @param text - The text to summarize
   * @returns Result containing the summary or an error
   */
  summarize(text: string): Promise<Result<string, Error>>;

  /**
   * Fix grammar and spelling.
   * Corrects grammatical errors and typos in the text.
   * @param text - The text to fix
   * @returns Result containing the corrected text or an error
   */
  fixGrammar(text: string): Promise<Result<string, Error>>;

  /**
   * Custom AI operation.
   * Allows for flexible, user-defined AI operations.
   * @param operation - The operation type/name
   * @param text - The text to process
   * @param instruction - Optional custom instruction
   * @returns Result containing the processed text or an error
   */
  custom(
    operation: string,
    text: string,
    instruction?: string
  ): Promise<Result<string, Error>>;

  /**
   * Stream response for long operations.
   * Provides real-time streaming of AI output for better UX.
   * @param operation - The operation type
   * @param text - The text to process
   * @param onChunk - Callback called with each response chunk
   * @returns Result indicating completion or an error
   */
  stream(
    operation: AIOperation,
    text: string,
    onChunk: (chunk: string) => void
  ): Promise<Result<void, Error>>;
}
