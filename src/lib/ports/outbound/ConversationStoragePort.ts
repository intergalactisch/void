/**
 * ConversationStoragePort - Interface for conversation persistence
 *
 * Defines the contract for storing and retrieving AI conversations.
 * Implementations can use file system, database, or in-memory storage.
 *
 * Part of Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type { Conversation } from '$lib/domain/entities/Conversation';
import type { PagedResult, SummaryQueryBase } from './PagedQuery';

/**
 * Metadata about a stored conversation (for listing without full content).
 */
export interface ConversationSummary {
  /** Conversation ID */
  id: string;
  /** Conversation title */
  title: string;
  /** Number of messages */
  messageCount: number;
  /** Conversation status */
  status: 'active' | 'completed' | 'archived';
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Preview of the conversation (first user message) */
  preview: string;
}

/**
 * Options for listing conversations.
 */
export interface ListConversationsOptions {
  /** Filter by status */
  status?: 'active' | 'completed' | 'archived';
  /** Maximum number to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  sortBy?: 'createdAt' | 'updatedAt';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

export interface ConversationSummaryQuery extends SummaryQueryBase {
  /** Filter by status */
  status?: 'active' | 'completed' | 'archived' | 'all';
  /** Filter by document-bound conversations */
  documentPath?: string | null;
  /** Filter by tag */
  tag?: string | null;
}

/**
 * Port for conversation persistence operations.
 *
 * All methods return Result types for explicit error handling.
 */
export interface ConversationStoragePort {
  /**
   * Save a conversation (create or update).
   *
   * @param conversation - The conversation to save
   * @returns Result with void on success, Error on failure
   */
  save(conversation: Conversation): Promise<Result<void, Error>>;

  /**
   * Load a conversation by ID.
   *
   * @param id - The conversation ID
   * @returns Result with the conversation or null if not found
   */
  load(id: string): Promise<Result<Conversation | null, Error>>;

  /**
   * Delete a conversation.
   *
   * @param id - The conversation ID to delete
   * @returns Result with void on success
   */
  delete(id: string): Promise<Result<void, Error>>;

  /**
   * List conversation summaries.
   *
   * @param options - Filter and pagination options
   * @returns Result with array of conversation summaries
   */
  list(options?: ListConversationsOptions): Promise<Result<ConversationSummary[], Error>>;

  /**
   * Query conversation summaries without hydrating full transcripts.
   */
  listSummaries(query?: ConversationSummaryQuery): Promise<Result<PagedResult<ConversationSummary>, Error>>;

  /**
   * Check if a conversation exists.
   *
   * @param id - The conversation ID
   * @returns True if the conversation exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get the count of stored conversations.
   *
   * @param status - Optional status filter
   * @returns Number of conversations
   */
  count(status?: 'active' | 'completed' | 'archived'): Promise<number>;

  /**
   * Clear all stored conversations.
   *
   * @returns Result with number of deleted conversations
   */
  clearAll(): Promise<Result<number, Error>>;
}
