/**
 * MemoryConversationAdapter - In-memory conversation storage
 *
 * Implements ConversationStoragePort for testing and development.
 * Stores conversations in memory with no persistence across restarts.
 *
 * Part of Hexagonal Architecture secondary adapters layer.
 */

import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { getPreview } from '$lib/domain/entities/Conversation';
import { deserializeActivityEntries } from '$lib/domain/entities/Message';
import type {
  ConversationStoragePort,
  ConversationSummary,
  ConversationSummaryQuery,
  ListConversationsOptions,
} from '$lib/ports/outbound/ConversationStoragePort';
import {
  clampPageLimit,
  coerceDate,
  cursorToOffset,
  nextOffsetCursor,
  type PagedResult,
} from '$lib/ports/outbound/PagedQuery';

/**
 * In-memory implementation of ConversationStoragePort.
 *
 * Useful for:
 * - Unit and integration testing
 * - Development without file system access
 * - Browser-only mode
 */
export class MemoryConversationAdapter implements ConversationStoragePort {
  private conversations: Map<string, Conversation> = new Map();

  /**
   * Save a conversation (create or update).
   */
  async save(conversation: Conversation): Promise<Result<void, Error>> {
    try {
      // Deep clone to prevent mutation of stored data
      const cloned = JSON.parse(JSON.stringify(conversation)) as Conversation;

      // Restore Date objects that were serialized to strings
      cloned.createdAt = new Date(cloned.createdAt);
      cloned.updatedAt = new Date(cloned.updatedAt);
      for (const msg of cloned.messages) {
        msg.createdAt = new Date(msg.createdAt);
        msg.updatedAt = new Date(msg.updatedAt);
        const activity = deserializeActivityEntries(msg.activity);
        if (activity) {
          msg.activity = activity;
        } else {
          delete msg.activity;
        }
      }

      this.conversations.set(conversation.id, cloned);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Load a conversation by ID.
   */
  async load(id: string): Promise<Result<Conversation | null, Error>> {
    try {
      const conversation = this.conversations.get(id);
      if (!conversation) {
        return ok(null);
      }

      // Return a deep clone to prevent mutation
      const cloned = JSON.parse(JSON.stringify(conversation)) as Conversation;
      cloned.createdAt = new Date(cloned.createdAt);
      cloned.updatedAt = new Date(cloned.updatedAt);
      for (const msg of cloned.messages) {
        msg.createdAt = new Date(msg.createdAt);
        msg.updatedAt = new Date(msg.updatedAt);
        const activity = deserializeActivityEntries(msg.activity);
        if (activity) {
          msg.activity = activity;
        } else {
          delete msg.activity;
        }
      }

      return ok(cloned);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a conversation.
   */
  async delete(id: string): Promise<Result<void, Error>> {
    try {
      this.conversations.delete(id);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List conversation summaries.
   */
  async list(options: ListConversationsOptions = {}): Promise<Result<ConversationSummary[], Error>> {
    try {
      const {
        status,
        limit,
        offset = 0,
        sortBy = 'updatedAt',
        sortOrder = 'desc',
      } = options;

      // Get all conversations
      let conversations = Array.from(this.conversations.values());

      // Filter by status
      if (status) {
        conversations = conversations.filter((c) => c.status === status);
      }

      // Sort
      conversations.sort((a, b) => {
        const aValue = sortBy === 'createdAt' ? a.createdAt : a.updatedAt;
        const bValue = sortBy === 'createdAt' ? b.createdAt : b.updatedAt;
        const aTime = new Date(aValue).getTime();
        const bTime = new Date(bValue).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      // Paginate
      if (offset > 0) {
        conversations = conversations.slice(offset);
      }
      if (limit !== undefined) {
        conversations = conversations.slice(0, limit);
      }

      // Convert to summaries
      const summaries: ConversationSummary[] = conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c.messages.length,
        status: c.status,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        preview: getPreview(c),
      }));

      return ok(summaries);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async listSummaries(query: ConversationSummaryQuery = {}): Promise<Result<PagedResult<ConversationSummary>, Error>> {
    try {
      const limit = clampPageLimit(query.limit);
      const offset = cursorToOffset(query.cursor);
      const dateFrom = coerceDate(query.dateFrom);
      const dateTo = coerceDate(query.dateTo);
      const needle = query.query?.trim().toLocaleLowerCase() ?? '';
      const sortBy = query.sortBy ?? 'updatedAt';
      const sortOrder = query.sortOrder ?? 'desc';

      const summaries = Array.from(this.conversations.values())
        .filter((conversation) => query.status && query.status !== 'all' ? conversation.status === query.status : true)
        .filter((conversation) => query.documentPath ? conversation.documentPath === query.documentPath : true)
        .filter((conversation) => query.tag ? conversation.tags.includes(query.tag) : true)
        .filter((conversation) => {
          const updatedAt = new Date(conversation.updatedAt);
          if (dateFrom && updatedAt < dateFrom) return false;
          if (dateTo && updatedAt > dateTo) return false;
          return true;
        })
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          messageCount: conversation.messages.length,
          status: conversation.status,
          createdAt: new Date(conversation.createdAt),
          updatedAt: new Date(conversation.updatedAt),
          preview: getPreview(conversation),
        }))
        .filter((summary) => {
          if (!needle) return true;
          return [
            summary.title,
            summary.preview,
            summary.id,
          ].some((value) => value.toLocaleLowerCase().includes(needle));
        })
        .sort((a, b) => {
          const aTime = new Date(sortBy === 'createdAt' ? a.createdAt : a.updatedAt).getTime();
          const bTime = new Date(sortBy === 'createdAt' ? b.createdAt : b.updatedAt).getTime();
          return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
        });

      return ok({
        items: summaries.slice(offset, offset + limit),
        nextCursor: nextOffsetCursor(offset, limit, summaries.length),
        total: summaries.length,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Check if a conversation exists.
   */
  async exists(id: string): Promise<boolean> {
    return this.conversations.has(id);
  }

  /**
   * Get the count of stored conversations.
   */
  async count(status?: 'active' | 'completed' | 'archived'): Promise<number> {
    if (!status) {
      return this.conversations.size;
    }

    return Array.from(this.conversations.values()).filter((c) => c.status === status).length;
  }

  /**
   * Clear all stored conversations.
   */
  async clearAll(): Promise<Result<number, Error>> {
    try {
      const count = this.conversations.size;
      this.conversations.clear();
      return ok(count);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // =========================================================================
  // Test helpers (not part of the interface)
  // =========================================================================

  /**
   * Get the raw internal map (for testing).
   */
  _getInternalMap(): Map<string, Conversation> {
    return this.conversations;
  }

  /**
   * Set conversations directly (for testing).
   */
  _setConversations(conversations: Conversation[]): void {
    this.conversations.clear();
    for (const c of conversations) {
      this.conversations.set(c.id, c);
    }
  }
}

/**
 * Create a new MemoryConversationAdapter instance.
 */
export function createMemoryConversationAdapter(): ConversationStoragePort {
  return new MemoryConversationAdapter();
}
