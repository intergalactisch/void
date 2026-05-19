/**
 * AIAssistantProviderPort - Outbound port for AI assistant operations
 *
 * This port defines the contract for AI providers that support the full
 * assistant workflow with two-stream responses (chat + tool calls).
 *
 * Unlike the simpler AIProviderPort (for text rewriting), this port
 * supports conversation context, tool definitions, and streaming.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { AIResponse, AIResponseChunk } from '$lib/domain/values/AIResponse';
import type { PromptContext } from '$lib/domain/values/PromptContext';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { Tool } from '$lib/domain/entities/Tool';
import type { Message } from '$lib/domain/entities/Message';
import type { AIProviderType, AIProviderConfig } from '$lib/domain/values/AIProviderType';

/**
 * Request object for AI assistant prompts.
 */
export interface AIAssistantRequest {
  /** User's message/prompt */
  message: string;

  /** Current application context */
  context: PromptContext;

  /** Available tools the AI can invoke */
  tools: Tool[];

  /** Previous messages in the conversation */
  conversationHistory: Message[];

  /** System prompt override (optional) */
  systemPrompt?: string;

  /** Model override (optional) */
  model?: string;

  /** Max tokens for response */
  maxTokens?: number;

  /** Temperature (0-1) */
  temperature?: number;

  /** Whether this request may use provider-native internet research. */
  webAccess?: AIWebAccess;
}

/**
 * Configuration for connecting to an AI provider.
 */
export interface AIProviderConnectionConfig {
  /** Provider type */
  provider: AIProviderType;

  /** Provider-specific configuration */
  config: AIProviderConfig;

  /** API key (for cloud providers) */
  apiKey?: string;
}

/**
 * Outbound port for AI assistant providers.
 *
 * Implemented by adapters for each AI provider (Claude, OpenAI, Ollama, etc.).
 */
export interface AIAssistantProviderPort {
  /**
   * Get the provider type.
   * @returns Provider type identifier
   */
  getProviderType(): AIProviderType;

  /**
   * Check if provider is configured and available.
   * @returns True if the provider can accept requests
   */
  isAvailable(): Promise<boolean>;

  /**
   * Configure the provider connection.
   * @param config - Connection configuration
   */
  configure(config: AIProviderConnectionConfig): Promise<void>;

  /**
   * Send a prompt and get a complete response.
   * Waits for the full response before returning.
   * @param request - The prompt request
   * @returns Result containing the AI response or an error
   */
  prompt(request: AIAssistantRequest): Promise<Result<AIResponse, Error>>;

  /**
   * Send a prompt and stream the response.
   * Calls onChunk for each piece of the response as it arrives.
   * @param request - The prompt request
   * @param onChunk - Callback for each response chunk
   * @returns Result containing the final complete response or an error
   */
  stream(
    request: AIAssistantRequest,
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<Result<AIResponse, Error>>;

  /**
   * Cancel the current streaming request.
   */
  cancel(): void;

  /**
   * Get estimated token count for a message.
   * Useful for managing context window size.
   * @param text - Text to count tokens for
   * @returns Estimated token count
   */
  estimateTokens(text: string): number;

  /**
   * Get the maximum context window size for the current model.
   * @returns Maximum tokens
   */
  getMaxContextSize(): number;

  /**
   * Get available models for this provider.
   * @returns Array of model identifiers
   */
  getAvailableModels(): Promise<string[]>;

  /**
   * Check the current rate limit status.
   * @returns Rate limit info or null if not applicable
   */
  getRateLimitStatus(): Promise<{
    remaining: number;
    limit: number;
    resetsAt: Date;
  } | null>;
}
