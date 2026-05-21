/**
 * AIAssistantService - Inbound port for AI assistant interactions
 *
 * This is the main entry point for AI features in the application.
 * It handles prompts, manages conversations, and coordinates tool execution.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { Conversation } from '$lib/domain/entities/Conversation';
import type { Message } from '$lib/domain/entities/Message';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { AIResponse, AIResponseChunk, AIStatusUpdate } from '$lib/domain/values/AIResponse';
import type { PromptContext } from '$lib/domain/values/PromptContext';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { ToolId } from '$lib/domain/values/ToolId';

/**
 * Options for sending a prompt.
 */
export interface PromptOptions {
  /** Conversation to add the prompt to (creates new if not provided) */
  conversationId?: string;

  /** Override the automatic context gathering */
  context?: PromptContext;

  /** Whether to stream the response */
  stream?: boolean;

  /** Whether to auto-execute tool calls */
  autoExecuteTools?: boolean;

  /**
   * Message to show in chat for this prompt. Undefined shows the prompt,
   * null keeps the prompt out of the visible transcript.
   */
  displayMessage?: string | null;

  /** Whether to persist the assistant response in chat (default true). */
  persistAssistantMessage?: boolean;

  /** Optimistic UI turn id to attach to the persisted user message. */
  clientTurnId?: string;

  /** Model override */
  model?: string;

  /** Whether this turn may use provider-native internet research. */
  webAccess?: AIWebAccess;

  /** Optional full system prompt override for this turn. */
  systemPrompt?: string;

  /** Restrict the tool manifest and executable tool calls to this allow-list. */
  allowedToolIds?: ToolId[];

  /** Bind a newly-created conversation to a note/document path. */
  documentPath?: string | null;
}

/**
 * State of an ongoing AI interaction.
 */
export interface AIInteractionState {
  /** Whether AI is currently processing */
  isProcessing: boolean;

  /** Whether response is streaming */
  isStreaming: boolean;

  /** Current streaming text (partial) */
  streamingText: string;

  /** Tool invocations being executed */
  executingTools: ToolInvocation[];

  /** Any error that occurred */
  error: Error | null;

  /** Progress indicator (0-100) for long operations */
  progress: number;

  /** Current active conversation (pushed reactively) */
  currentConversation: Conversation | null;

  /** Number of related notes included as context in the last prompt */
  relatedContextCount: number;
}

/**
 * Inbound port for AI assistant features.
 *
 * This is the service interface that UI components and stores use
 * to interact with AI functionality.
 */
export interface AIAssistantService {
  // =========================================================================
  // Prompt methods
  // =========================================================================

  /**
   * Send a prompt and get a response.
   * @param message - User's message
   * @param options - Optional configuration
   * @returns Result containing the AI response or an error
   */
  prompt(message: string, options?: PromptOptions): Promise<Result<AIResponse, Error>>;

  /**
   * Send a prompt with streaming response.
   * @param message - User's message
   * @param onChunk - Callback for each response chunk
   * @param options - Optional configuration
   * @returns Result containing the final response or an error
   */
  streamPrompt(
    message: string,
    onChunk: (chunk: AIResponseChunk) => void,
    options?: PromptOptions
  ): Promise<Result<AIResponse, Error>>;

  /**
   * Cancel the current prompt/streaming operation.
   */
  cancel(): void;

  // =========================================================================
  // Conversation methods
  // =========================================================================

  /**
   * Get an existing conversation by ID, or return the current conversation.
   * Creates a new conversation only if no current conversation exists.
   * @param conversationId - Optional ID of existing conversation
   * @returns The conversation
   */
  getConversation(
    conversationId?: string,
    options?: { documentPath?: string | null }
  ): Promise<Conversation>;

  /**
   * Always create a fresh new conversation.
   * Use this when the user explicitly wants a new conversation.
   * @returns The newly created conversation
   */
  createNewConversation(): Promise<Conversation>;

  /**
   * Get all conversations.
   * @returns Array of conversations, most recent first
   */
  listConversations(): Promise<Conversation[]>;

  /**
   * Clear a conversation's messages.
   * @param conversationId - ID of conversation to clear
   */
  clearConversation(conversationId: string): Promise<void>;

  /**
   * Delete a conversation.
   * @param conversationId - ID of conversation to delete
   */
  deleteConversation(conversationId: string): Promise<void>;

  /**
   * Get the current/active conversation.
   * @returns Current conversation or null
   */
  getCurrentConversation(): Conversation | null;

  /**
   * Set the current/active conversation.
   * @param conversationId - ID of conversation to make current
   */
  setCurrentConversation(conversationId: string): Promise<void>;

  /**
   * Load conversations bound to a specific document from .void/ storage.
   * @param documentPath - Path to the document
   * @returns Array of conversations for this document
   */
  loadDocumentConversations(documentPath: string): Promise<Conversation[]>;

  /**
   * Append a visible user message without calling the AI provider.
   * Used by durable agent runs so planning/progress can be shown without
   * exposing internal execution prompts.
   */
  appendUserMessage(
    message: string,
    conversationId?: string,
    options?: { clientTurnId?: string }
  ): Promise<Result<Conversation, Error>>;

  /**
   * Append a visible assistant message without calling the AI provider.
   */
  appendAssistantMessage(message: string, conversationId?: string): Promise<Result<Conversation, Error>>;

  /**
   * Append or update a visible assistant activity message without calling the
   * AI provider. Useful for provider/status streams that should remain one
   * compact live status card instead of separate chat messages.
   */
  appendOrUpdateAssistantActivity(
    message: string,
    activity: AIStatusUpdate,
    conversationId?: string,
    groupId?: string
  ): Promise<Result<Conversation, Error>>;

  // =========================================================================
  // Tool execution methods
  // =========================================================================

  /**
   * Execute tool calls from an AI response.
   * @param toolCalls - Tool calls to execute
   * @param conversationId - Conversation to track execution in
   * @returns Array of tool invocations with results
   */
  executeToolCalls(
    toolCalls: AIResponse['toolCalls'],
    conversationId: string
  ): Promise<ToolInvocation[]>;

  /**
   * Confirm and execute a pending tool invocation.
   * For tools that require user confirmation.
   * @param invocationId - ID of invocation to confirm
   */
  confirmToolExecution(invocationId: string): Promise<void>;

  /**
   * Reject a pending tool invocation.
   * @param invocationId - ID of invocation to reject
   * @param reason - Reason for rejection
   */
  rejectToolExecution(invocationId: string, reason: string): Promise<void>;

  // =========================================================================
  // State methods
  // =========================================================================

  /**
   * Get the current interaction state.
   * @returns Current state
   */
  getState(): AIInteractionState;

  /**
   * Subscribe to state changes.
   * @param callback - Function called when state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: AIInteractionState) => void): () => void;

  // =========================================================================
  // Configuration methods
  // =========================================================================

  /**
   * Check if AI is available and configured.
   * @returns True if AI can be used
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the current provider type.
   * @returns Provider type or null if not configured
   */
  getProvider(): string | null;

  /**
   * Get the current model.
   * @returns Model identifier or null if not configured
   */
  getModel(): string | null;
}
