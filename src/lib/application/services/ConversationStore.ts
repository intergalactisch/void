/**
 * ConversationStore — owns in-memory conversation lifecycle + persistence.
 *
 * Extracted from AIAssistantServiceImpl. Concerns:
 *   - In-memory map of conversations and the active conversation pointer
 *   - Bounded growth via LRU eviction (excluding the current conversation)
 *   - Debounced persistence (writes ~every 2s during streaming)
 *   - Document-bound persistence to `.void/conversations/{note}/{id}.json`
 *   - Lazy hydration from the persistent ConversationStoragePort
 *   - Deserialization of legacy on-disk records
 *
 * AIAssistantServiceImpl drives the high-level prompt flow and delegates
 * every conversation read/write through this store. State changes that
 * matter to the UI (current conversation switched, message added) flow
 * back via the `onCurrentConversationChanged` callback.
 */

import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type {
  ConversationStoragePort,
  ConversationSummary,
  ConversationSummaryQuery,
} from '$lib/ports/outbound/ConversationStoragePort';
import type { PagedResult } from '$lib/ports/outbound/PagedQuery';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type {
  Conversation,
  ConversationStatus,
} from '$lib/domain/entities/Conversation';
import {
  createConversation,
  clearMessages,
  serializeConversation,
  isDocumentBound,
} from '$lib/domain/entities/Conversation';
import type { Message } from '$lib/domain/entities/Message';
import {
  createUserMessage,
  createAssistantMessage,
  deserializeActivityEntries,
} from '$lib/domain/entities/Message';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';
import { redactSensitiveValue } from '$lib/core/privacyRedaction';
import { getLogger } from '$lib/logging';

const log = getLogger('ConversationStore');

/** Maximum conversations to keep in memory before eviction kicks in. */
const MAX_CONVERSATIONS = 100;
/** Eviction target: shrink to 75% of the cap when over. */
const EVICTION_TARGET_RATIO = 0.75;
/** Debounce window for persistence writes during streaming. */
const PERSIST_DEBOUNCE_MS = 2000;

export interface ConversationStoreDeps {
  contextProvider: ContextProviderPort;
  conversationStorage?: ConversationStoragePort | null;
  voidStorage?: VoidStoragePort | null;
  notesPath?: string;
  isProtectedDocumentPath?: (path: string) => boolean;
  /**
   * Called whenever the conversation map changes in a way that affects
   * UI state (current conversation switched, current conversation
   * mutated). The caller wires this to its state-subscriber pump.
   */
  onCurrentConversationChanged?: () => void;
}

export class ConversationStore {
  private readonly conversations: Map<string, Conversation> = new Map();
  private currentConversationId: string | null = null;
  private readonly persistDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private conversationsLoaded = false;

  private readonly contextProvider: ContextProviderPort;
  private readonly conversationStorage: ConversationStoragePort | null;
  private readonly voidStorage: VoidStoragePort | null;
  private readonly notesPath: string;
  private readonly isProtectedDocumentPath: (path: string) => boolean;
  private readonly notifyChanged: () => void;

  constructor(deps: ConversationStoreDeps) {
    this.contextProvider = deps.contextProvider;
    this.conversationStorage = deps.conversationStorage ?? null;
    this.voidStorage = deps.voidStorage ?? null;
    this.notesPath = deps.notesPath ?? '';
    this.isProtectedDocumentPath = deps.isProtectedDocumentPath ?? (() => false);
    this.notifyChanged = deps.onCurrentConversationChanged ?? (() => {});
  }

  // ─────────────────────────────────────────────────────────────────────
  // Read access
  // ─────────────────────────────────────────────────────────────────────

  /** Synchronous lookup; returns null if not in memory. */
  get(id: string): Conversation | null {
    return this.conversations.get(id) ?? null;
  }

  getCurrent(): Conversation | null {
    if (!this.currentConversationId) return null;
    return this.conversations.get(this.currentConversationId) ?? null;
  }

  getCurrentId(): string | null {
    return this.currentConversationId;
  }

  /**
   * Either return the requested conversation, the current one, or
   * create a fresh conversation. Mirrors the prior
   * `AIAssistantService.getConversation` semantics.
   */
  async getOrCreate(id?: string, options?: { documentPath?: string | null }): Promise<Conversation> {
    const documentPath = options?.documentPath ?? null;
    if (id) {
      const conv = this.conversations.get(id);
      if (conv) return conv;
    }
    if (!id && documentPath) {
      if (this.currentConversationId) {
        const current = this.conversations.get(this.currentConversationId);
        if (current?.documentPath === documentPath) return current;
      }

      const existing = Array.from(this.conversations.values())
        .filter((conv) => conv.documentPath === documentPath)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      if (existing) {
        this.currentConversationId = existing.id;
        this.notifyChanged();
        return existing;
      }

      return this.create({ documentPath });
    }
    if (documentPath) {
      return this.create({ documentPath });
    }
    if (!id && this.currentConversationId) {
      const current = this.conversations.get(this.currentConversationId);
      if (current) return current;
    }
    return this.create();
  }

  /**
   * Hydrate from the persistent storage on first call, then return all
   * known conversations sorted by recency.
   */
  async list(): Promise<Conversation[]> {
    if (!this.conversationsLoaded && this.conversationStorage) {
      this.conversationsLoaded = true;
      try {
        const summaries = await this.conversationStorage.list({
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        });
        if (summaries.ok) {
          for (const summary of summaries.value) {
            if (this.conversations.has(summary.id)) continue;
            const loaded = await this.conversationStorage.load(summary.id);
            if (loaded.ok && loaded.value) {
              this.conversations.set(summary.id, loaded.value);
            }
          }
        }
      } catch (e) {
        log.warn('Failed to hydrate conversations from storage', { error: String(e) });
      }
    }

    return Array.from(this.conversations.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  async listSummaries(query?: ConversationSummaryQuery): Promise<PagedResult<ConversationSummary>> {
    if (this.conversationStorage) {
      const summaries = await this.conversationStorage.listSummaries(query);
      if (summaries.ok) return summaries.value;
      log.warn('Failed to query conversation summaries from storage', { error: String(summaries.error) });
    }

    const conversations = await this.list();
    const needle = query?.query?.trim().toLocaleLowerCase() ?? '';
    const dateFrom = query?.dateFrom ? new Date(query.dateFrom) : null;
    const dateTo = query?.dateTo ? new Date(query.dateTo) : null;
    const offset = query?.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const limit = Math.max(1, Math.min(query?.limit ?? 80, 250));
    const sortBy = query?.sortBy ?? 'updatedAt';
    const sortOrder = query?.sortOrder ?? 'desc';

    const summaries = conversations
      .filter((conv) => query?.status && query.status !== 'all' ? conv.status === query.status : true)
      .filter((conv) => query?.documentPath ? conv.documentPath === query.documentPath : true)
      .filter((conv) => query?.tag ? conv.tags.includes(query.tag) : true)
      .filter((conv) => {
        if (dateFrom && conv.updatedAt < dateFrom) return false;
        if (dateTo && conv.updatedAt > dateTo) return false;
        return true;
      })
      .map((conv) => ({
        id: conv.id,
        title: conv.title,
        messageCount: conv.messages.filter((message) => message.visibility !== 'internal').length,
        status: conv.status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        preview: conv.messages.find((message) => message.role === 'user' && message.visibility !== 'internal')?.text.slice(0, 100) ?? '',
      }))
      .filter((summary) => {
        if (!needle) return true;
        return [summary.id, summary.title, summary.preview].some((value) => value.toLocaleLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const aTime = (sortBy === 'createdAt' ? a.createdAt : a.updatedAt).getTime();
        const bTime = (sortBy === 'createdAt' ? b.createdAt : b.updatedAt).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

    return {
      items: summaries.slice(offset, offset + limit),
      nextCursor: offset + limit < summaries.length ? String(offset + limit) : null,
      total: summaries.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Mutations
  // ─────────────────────────────────────────────────────────────────────

  async create(params?: { documentPath?: string | null }): Promise<Conversation> {
    if (this.conversations.size >= MAX_CONVERSATIONS) {
      this.evictOldest();
    }

    const context = await this.contextProvider.getContext();
    const conversation = createConversation({
      context,
      documentPath: params?.documentPath ?? null,
    });
    this.conversations.set(conversation.id, conversation);

    if (!this.currentConversationId || params?.documentPath) {
      this.currentConversationId = conversation.id;
      this.notifyChanged();
    }

    return conversation;
  }

  async setCurrent(id: string): Promise<void> {
    if (!this.conversations.has(id) && this.conversationStorage) {
      const loaded = await this.conversationStorage.load(id);
      if (loaded.ok && loaded.value) {
        this.conversations.set(id, loaded.value);
      }
    }

    if (this.conversations.has(id)) {
      this.currentConversationId = id;
      this.notifyChanged();
    }
  }

  async clear(id: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    this.conversations.set(id, clearMessages(conversation));
    if (id === this.currentConversationId) {
      this.notifyChanged();
    }
  }

  async delete(id: string): Promise<void> {
    const wasCurrent = this.currentConversationId === id;
    this.conversations.delete(id);

    if (this.conversationStorage) {
      const result = await this.conversationStorage.delete(id);
      if (!result.ok) {
        log.error('Failed to delete conversation from storage', {
          conversationId: id,
          error: String(result.error),
        });
      }
    }

    if (wasCurrent) {
      this.currentConversationId = null;
      this.notifyChanged();
    }
  }

  /**
   * Mutate a conversation in place (immutable updater) and schedule
   * persistence. Notifies the caller's state pump if the active
   * conversation was the one mutated.
   */
  update(id: string, updater: (conv: Conversation) => Conversation): void {
    const conversation = this.conversations.get(id);
    if (!conversation) return;

    const updated = updater(conversation);
    this.conversations.set(id, updated);

    if (id === this.currentConversationId) {
      this.notifyChanged();
    }

    this.schedulePersist(updated);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Schedule debounced persistence. Multiple rapid updates collapse into
   * a single write — important during streaming to avoid hammering disk.
   */
  schedulePersist(conversation: Conversation): void {
    const existing = this.persistDebounceTimers.get(conversation.id);
    if (existing) clearTimeout(existing);

    this.persistDebounceTimers.set(
      conversation.id,
      setTimeout(() => {
        this.persistDebounceTimers.delete(conversation.id);
        this.persist(conversation).catch((e) => {
          log.error('Failed to persist conversation', {
            conversationId: conversation.id,
            error: String(e),
          });
        });
      }, PERSIST_DEBOUNCE_MS)
    );
  }

  /** Force any pending debounced write for a conversation to run now. */
  flushPersist(id: string): void {
    const timer = this.persistDebounceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.persistDebounceTimers.delete(id);
    }

    const conversation = this.conversations.get(id);
    if (conversation) {
      this.persist(conversation).catch((e) => {
        log.error('Failed to persist conversation', { conversationId: id, error: String(e) });
      });
    }
  }

  /**
   * Persist a conversation now. Writes to:
   *   - `ConversationStoragePort` (global persistence)
   *   - `.void/conversations/{note}/{id}.json` (document-bound only,
   *     kept for backward compatibility with the artifact viewer).
   */
  private async persist(conversation: Conversation): Promise<void> {
    const persistentConversation = this.redactForPersistence(conversation);
    if (this.conversationStorage) {
      const result = await this.conversationStorage.save(persistentConversation);
      if (!result.ok) {
        log.error('Failed to persist conversation to storage', {
          conversationId: conversation.id,
          error: String(result.error),
        });
      }
    }

    if (this.voidStorage && persistentConversation.documentPath) {
      const noteName = noteNameFromPath(persistentConversation.documentPath);
      const path = `conversations/${noteName}/${persistentConversation.id}.json`;
      const data = {
        ...serializeConversation(persistentConversation),
        messages: persistentConversation.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          text: msg.text,
          createdAt: msg.createdAt.toISOString(),
          updatedAt: msg.updatedAt.toISOString(),
          activity: msg.activity,
          toolInvocations: msg.toolInvocations,
          metadata: msg.metadata,
          visibility: msg.visibility,
          clientTurnId: msg.clientTurnId,
        })),
      };
      await this.voidStorage.writeJson(this.notesPath, path, data);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Document-bound load (legacy `.void/conversations/{note}/` viewer)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Load every conversation associated with `documentPath` from
   * `.void/conversations/{note}/`. Conversations are inserted into the
   * in-memory map so subsequent `get()` calls hit cache.
   */
  async loadForDocument(documentPath: string): Promise<Conversation[]> {
    if (!this.voidStorage || !this.notesPath) return [];

    const noteName = noteNameFromPath(documentPath);
    const dirPath = `conversations/${noteName}`;
    const listResult = await this.voidStorage.listDir(this.notesPath, dirPath);
    if (!listResult.ok) return [];

    const result: Conversation[] = [];
    for (const filename of listResult.value) {
      if (!filename.endsWith('.json')) continue;

      const filePath = `${dirPath}/${filename}`;
      const readResult = await this.voidStorage.readJson<Record<string, unknown>>(
        this.notesPath,
        filePath
      );
      if (!readResult.ok || !readResult.value) continue;

      const conv = this.deserialize(readResult.value, documentPath);
      if (conv) {
        this.conversations.set(conv.id, conv);
        result.push(conv);
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────

  private evictOldest(): void {
    const target = Math.floor(MAX_CONVERSATIONS * EVICTION_TARGET_RATIO);
    const sorted = Array.from(this.conversations.entries())
      .filter(([id]) => id !== this.currentConversationId)
      .sort(([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime());

    let removed = 0;
    for (const [id] of sorted) {
      if (this.conversations.size <= target) break;
      this.flushPersist(id);
      this.conversations.delete(id);
      removed++;
    }

    if (removed > 0) {
      log.info('Evicted conversations', { removed, remaining: this.conversations.size });
    }
  }

  private redactForPersistence(conversation: Conversation): Conversation {
    if (!this.shouldRedactConversation(conversation)) return conversation;
    return {
      ...conversation,
      title: conversation.title,
      initialContext: null,
      tags: [...new Set([...(conversation.tags ?? []), 'protected'])],
      messages: conversation.messages.map((message) => {
        const redacted: Message = {
          ...message,
          text: '[protected content redacted]',
          content: [{ type: 'text', text: '[protected content redacted]' }],
          toolInvocations: [],
        };
        if (message.activity) {
          redacted.activity = redactSensitiveValue(message.activity, { aggressive: true }) as NonNullable<Message['activity']>;
        }
        return redacted;
      }),
    };
  }

  private shouldRedactConversation(conversation: Conversation): boolean {
    if (conversation.documentPath && this.isProtectedDocumentPath(conversation.documentPath)) {
      return true;
    }
    const context = conversation.initialContext as { currentNote?: { meta?: { protection?: { level?: string } } } } | null;
    return context?.currentNote?.meta?.protection?.level === 'protected';
  }

  /**
   * Reconstruct a Conversation from the legacy `.void/conversations/`
   * JSON shape. Returns null if the data is malformed (missing id).
   */
  private deserialize(
    data: Record<string, unknown>,
    documentPath: string
  ): Conversation | null {
    if (!data.id || typeof data.id !== 'string') return null;

    const messages: Message[] = [];
    if (Array.isArray(data.messages)) {
      for (const msgData of data.messages) {
        if (
          msgData &&
          typeof msgData === 'object' &&
          'role' in msgData &&
          'text' in msgData
        ) {
          const md = msgData as Record<string, unknown>;
          if (md.role === 'user') {
            const params: NonNullable<Parameters<typeof createUserMessage>[1]> = {
              visibility: md.visibility === 'internal' ? 'internal' : 'visible',
            };
            if (typeof md.clientTurnId === 'string') {
              params.clientTurnId = md.clientTurnId;
            }
            messages.push(createUserMessage(md.text as string, params));
          } else if (md.role === 'assistant') {
            const message = createAssistantMessage({
              text: md.text as string,
              visibility: md.visibility === 'internal' ? 'internal' : 'visible',
            });
            const activity = deserializeActivityEntries(md.activity);
            if (activity) {
              message.activity = activity;
            }
            messages.push(message);
          }
        }
      }
    }

    return {
      id: data.id as string,
      title: (data.title as string) ?? 'Restored Conversation',
      messages,
      status: (data.status as ConversationStatus) ?? 'active',
      initialContext: null,
      createdAt: data.createdAt ? new Date(data.createdAt as string) : new Date(),
      updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : new Date(),
      totalTokens:
        (data.totalTokens as { input: number; output: number }) ?? { input: 0, output: 0 },
      tags: (data.tags as string[]) ?? [],
      documentPath,
    };
  }
}

// Re-export so AIAssistant doesn't need to import from `Conversation`
// just to pass the helper through.
export { isDocumentBound };
