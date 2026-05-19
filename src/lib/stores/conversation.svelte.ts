/**
 * Conversation Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that provides
 * focused management of conversation state.
 *
 * This store is simpler than AIStore and focuses purely on
 * conversation CRUD operations without AI interaction concerns.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
import type { AIAssistantService } from '$lib/ports/inbound';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { createConversation } from '$lib/domain/entities/Conversation';

/**
 * Conversation Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to conversation list and methods to
 * manage conversations (create, select, delete, clear).
 */
class ConversationStore {
  #service: AIAssistantService | null = null;

  // Reactive state
  conversations = $state<Conversation[]>([]);
  current = $state<Conversation | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  /**
   * Initialize the store with an AIAssistantService instance.
   * Must be called before using any other methods.
   *
   * @param service - The AIAssistantService to use
   */
  init(service: AIAssistantService) {
    this.#service = service;

    // Get current conversation from service
    this.current = service.getCurrentConversation();
  }

  /**
   * Load all conversations from the service.
   */
  async load(): Promise<void> {
    if (!this.#service) throw new Error('ConversationStore not initialized');

    this.loading = true;
    this.error = null;

    try {
      this.conversations = await this.#service.listConversations();
      this.current = this.#service.getCurrentConversation();
    } catch (e) {
      this.error = toError(e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Select a conversation by ID.
   *
   * @param conversationId - ID of the conversation to select
   */
  async select(conversationId: string): Promise<void> {
    if (!this.#service) throw new Error('ConversationStore not initialized');

    this.error = null;

    try {
      await this.#service.setCurrentConversation(conversationId);
      this.current = this.#service.getCurrentConversation();
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Create a new conversation and select it.
   *
   * @param title - Optional title for the conversation
   * @returns The newly created conversation
   */
  async create(title?: string): Promise<Conversation> {
    if (!this.#service) throw new Error('ConversationStore not initialized');

    this.error = null;

    try {
      // Create a new conversation via the service
      const conversation = await this.#service.createNewConversation();

      // Refresh the list
      this.conversations = await this.#service.listConversations();
      this.current = conversation;

      return conversation;
    } catch (e) {
      this.error = toError(e);
      // Return a new local conversation as fallback
      return createConversation(title ? { title } : undefined);
    }
  }

  /**
   * Delete a conversation by ID.
   *
   * @param conversationId - ID of the conversation to delete
   */
  async delete(conversationId: string): Promise<void> {
    if (!this.#service) throw new Error('ConversationStore not initialized');

    this.error = null;

    try {
      await this.#service.deleteConversation(conversationId);

      // Update local state
      this.conversations = this.conversations.filter((c) => c.id !== conversationId);

      // If we deleted the current conversation, clear selection
      if (this.current?.id === conversationId) {
        this.current = this.#service.getCurrentConversation();
      }
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Clear all messages from a conversation.
   *
   * @param conversationId - ID of the conversation to clear
   */
  async clear(conversationId: string): Promise<void> {
    if (!this.#service) throw new Error('ConversationStore not initialized');

    this.error = null;

    try {
      await this.#service.clearConversation(conversationId);

      // Refresh current conversation if it was cleared
      if (this.current?.id === conversationId) {
        this.current = this.#service.getCurrentConversation();
      }

      // Refresh the full list to get updated conversation
      this.conversations = await this.#service.listConversations();
    } catch (e) {
      this.error = toError(e);
    }
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if a conversation is selected.
   */
  get hasSelection(): boolean {
    return this.current !== null;
  }

  /**
   * Get the count of conversations.
   */
  get count(): number {
    return this.conversations.length;
  }

  /**
   * Get active (non-archived) conversations.
   */
  get activeConversations(): Conversation[] {
    return this.conversations.filter((c) => c.status === 'active');
  }

  /**
   * Get archived conversations.
   */
  get archivedConversations(): Conversation[] {
    return this.conversations.filter((c) => c.status === 'archived');
  }

  /**
   * Find a conversation by ID.
   */
  find(conversationId: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === conversationId);
  }

  /**
   * Check if a conversation exists.
   */
  has(conversationId: string): boolean {
    return this.conversations.some((c) => c.id === conversationId);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Destroy the store and reset state.
   */
  destroy() {
    this.#service = null;
    this.conversations = [];
    this.current = null;
    this.loading = false;
    this.error = null;
  }
}

export const conversationStore = new ConversationStore();
