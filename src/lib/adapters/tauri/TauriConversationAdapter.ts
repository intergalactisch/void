/**
 * TauriConversationAdapter - File-based conversation persistence
 *
 * Implements ConversationStoragePort using Tauri's file system commands.
 * Stores conversations as individual JSON files in a dedicated directory.
 *
 * Storage structure:
 *   {notesPath}/.void/conversations/
 *     {conversation-id}.json
 *     {conversation-id}.json
 *     ...
 *
 * Part of Hexagonal Architecture secondary adapters layer.
 */

import { ok, err, toError, type Result } from '$lib/core';
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
import { fileCommands } from './commands';

/**
 * Directory name for storing conversations (relative to notes path).
 */
const CONVERSATIONS_DIR = '.void/conversations';

/**
 * File extension for conversation files.
 */
const CONVERSATION_EXT = '.json';
const COMMAND_CENTER_INDEX_DIR = '.void/index/command-center';
const CONVERSATION_INDEX_FILE = 'conversations.json';

/**
 * Raw conversation data from JSON (dates are strings).
 */
interface RawConversation {
  id: string;
  title: string;
  messages: RawMessage[];
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
  initialContext?: unknown;
  tags?: string[];
  totalTokens?: {
    input: number;
    output: number;
  };
  documentPath?: string | null;
}

/**
 * Raw message data from JSON (dates are strings).
 */
interface RawMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: unknown[];
  text: string;
  toolInvocations: unknown[];
  activity?: unknown[];
  createdAt: string;
  updatedAt: string;
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
  visibility?: 'visible' | 'internal';
  clientTurnId?: string;
}

interface IndexedConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
  preview: string;
  documentPath: string | null;
  tags: string[];
}

interface ConversationSummaryIndex {
  version: 1;
  summaries: IndexedConversationSummary[];
}

/**
 * Tauri file-based implementation of ConversationStoragePort.
 *
 * Stores conversations as JSON files in the notes directory.
 */
export class TauriConversationAdapter implements ConversationStoragePort {
  private notesPath: string;
  private conversationsDir: string;
  private indexDir: string;
  private indexPath: string;
  private initialized = false;

  constructor(notesPath: string) {
    this.notesPath = notesPath;
    this.conversationsDir = `${notesPath}/${CONVERSATIONS_DIR}`;
    this.indexDir = `${notesPath}/${COMMAND_CENTER_INDEX_DIR}`;
    this.indexPath = `${this.indexDir}/${CONVERSATION_INDEX_FILE}`;
  }

  /**
   * Ensure the conversations directory exists.
   */
  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;

    const exists = await fileCommands.exists(this.conversationsDir);
    if (!exists) {
      await fileCommands.createDirectory(this.conversationsDir);
    }
    this.initialized = true;
  }

  /**
   * Get the file path for a conversation ID.
   */
  private getFilePath(id: string): string {
    return `${this.conversationsDir}/${id}${CONVERSATION_EXT}`;
  }

  /**
   * Transform raw JSON data to Conversation with proper Date objects.
   */
  private transformConversation(raw: RawConversation): Conversation {
    return {
      id: raw.id,
      title: raw.title,
      messages: raw.messages.map((msg) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.updatedAt),
        activity: deserializeActivityEntries(msg.activity),
      })) as Conversation['messages'],
      status: raw.status,
      createdAt: new Date(raw.createdAt),
      updatedAt: new Date(raw.updatedAt),
      initialContext: raw.initialContext as Conversation['initialContext'],
      tags: raw.tags ?? [],
      totalTokens: raw.totalTokens ?? { input: 0, output: 0 },
      documentPath: raw.documentPath ?? null,
    };
  }

  /**
   * Save a conversation (create or update).
   */
  async save(conversation: Conversation): Promise<Result<void, Error>> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(conversation.id);
      const content = JSON.stringify(conversation, null, 2);

      await fileCommands.writeFile(filePath, content);
      await this.upsertIndexedSummary(conversation);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Load a conversation by ID.
   */
  async load(id: string): Promise<Result<Conversation | null, Error>> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(id);
      const exists = await fileCommands.exists(filePath);

      if (!exists) {
        return ok(null);
      }

      const content = await fileCommands.readFile(filePath);
      const raw = JSON.parse(content) as RawConversation;

      return ok(this.transformConversation(raw));
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Delete a conversation.
   */
  async delete(id: string): Promise<Result<void, Error>> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(id);
      const exists = await fileCommands.exists(filePath);

      if (exists) {
        await fileCommands.deleteFile(filePath);
      }
      await this.removeIndexedSummary(id);

      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * List conversation summaries.
   */
  async list(options: ListConversationsOptions = {}): Promise<Result<ConversationSummary[], Error>> {
    const query: ConversationSummaryQuery = { status: options.status ?? 'all' };
    if (options.limit !== undefined) query.limit = options.limit;
    if (options.offset !== undefined) query.cursor = String(options.offset);
    if (options.sortBy !== undefined) query.sortBy = options.sortBy;
    if (options.sortOrder !== undefined) query.sortOrder = options.sortOrder;
    const result = await this.listSummaries(query);
    if (!result.ok) return err(result.error);
    return ok(result.value.items);
  }

  async listSummaries(query: ConversationSummaryQuery = {}): Promise<Result<PagedResult<ConversationSummary>, Error>> {
    try {
      await this.ensureDirectory();

      const limit = clampPageLimit(query.limit);
      const offset = cursorToOffset(query.cursor);
      const dateFrom = coerceDate(query.dateFrom);
      const dateTo = coerceDate(query.dateTo);
      const needle = query.query?.trim().toLocaleLowerCase() ?? '';
      const sortBy = query.sortBy ?? 'updatedAt';
      const sortOrder = query.sortOrder ?? 'desc';

      let summaries = (await this.readSummaryIndex())
        .filter((summary) => query.status && query.status !== 'all' ? summary.status === query.status : true)
        .filter((summary) => query.documentPath ? summary.documentPath === query.documentPath : true)
        .filter((summary) => query.tag ? summary.tags.includes(query.tag) : true)
        .filter((summary) => {
          const updatedAt = new Date(summary.updatedAt);
          if (dateFrom && updatedAt < dateFrom) return false;
          if (dateTo && updatedAt > dateTo) return false;
          return true;
        })
        .filter((summary) => {
          if (!needle) return true;
          return [
            summary.title,
            summary.preview,
            summary.id,
            summary.documentPath ?? '',
            ...summary.tags,
          ].some((value) => value.toLocaleLowerCase().includes(needle));
        });

      // Sort
      summaries.sort((a, b) => {
        const aValue = new Date(sortBy === 'createdAt' ? a.createdAt : a.updatedAt);
        const bValue = new Date(sortBy === 'createdAt' ? b.createdAt : b.updatedAt);
        return sortOrder === 'asc'
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime();
      });

      const total = summaries.length;
      const items: ConversationSummary[] = summaries.slice(offset, offset + limit).map((summary) => ({
        id: summary.id,
        title: summary.title,
        messageCount: summary.messageCount,
        status: summary.status,
        createdAt: new Date(summary.createdAt),
        updatedAt: new Date(summary.updatedAt),
        preview: summary.preview,
      }));

      return ok({
        items,
        nextCursor: nextOffsetCursor(offset, limit, total),
        total,
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Check if a conversation exists.
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.ensureDirectory();
      const filePath = this.getFilePath(id);
      return await fileCommands.exists(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Get the count of stored conversations.
   */
  async count(status?: 'active' | 'completed' | 'archived'): Promise<number> {
    try {
      await this.ensureDirectory();

      const entries = await fileCommands.listDirectory(this.conversationsDir);
      const jsonFiles = entries.filter(
        (e) => e.isFile && e.name.endsWith(CONVERSATION_EXT)
      );

      if (!status) {
        return jsonFiles.length;
      }

      // Count by status requires loading each file
      let count = 0;
      for (const file of jsonFiles) {
        try {
          const content = await fileCommands.readFile(file.path);
          const raw = JSON.parse(content) as RawConversation;
          if (raw.status === status) {
            count++;
          }
        } catch {
          // Skip invalid files
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Clear all stored conversations.
   */
  async clearAll(): Promise<Result<number, Error>> {
    try {
      await this.ensureDirectory();

      const entries = await fileCommands.listDirectory(this.conversationsDir);
      const jsonFiles = entries.filter(
        (e) => e.isFile && e.name.endsWith(CONVERSATION_EXT)
      );

      let deleted = 0;
      for (const file of jsonFiles) {
        try {
          await fileCommands.deleteFile(file.path);
          deleted++;
        } catch {
          // Continue on individual file errors
          console.warn(`[TauriConversationAdapter] Failed to delete ${file.path}`);
        }
      }
      await this.writeSummaryIndex([]);

      return ok(deleted);
    } catch (e) {
      return err(toError(e));
    }
  }

  // =========================================================================
  // Additional methods
  // =========================================================================

  /**
   * Get the conversations directory path.
   */
  getConversationsPath(): string {
    return this.conversationsDir;
  }

  private async ensureIndexDirectory(): Promise<void> {
    const exists = await fileCommands.exists(this.indexDir);
    if (!exists) {
      await fileCommands.createDirectory(this.indexDir);
    }
  }

  private toIndexedSummary(conversation: Conversation): IndexedConversationSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.filter((message) => message.visibility !== 'internal').length,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      preview: getPreview(conversation),
      documentPath: conversation.documentPath,
      tags: conversation.tags,
    };
  }

  private async readSummaryIndex(): Promise<IndexedConversationSummary[]> {
    await this.ensureIndexDirectory();
    const exists = await fileCommands.exists(this.indexPath);
    if (exists) {
      try {
        const raw = JSON.parse(await fileCommands.readFile(this.indexPath)) as ConversationSummaryIndex;
        if (raw.version === 1 && Array.isArray(raw.summaries)) {
          return raw.summaries;
        }
      } catch {
        // Rebuild below.
      }
    }

    return this.rebuildSummaryIndex();
  }

  private async writeSummaryIndex(summaries: IndexedConversationSummary[]): Promise<void> {
    await this.ensureIndexDirectory();
    await fileCommands.writeFile(this.indexPath, JSON.stringify({ version: 1, summaries }, null, 2));
  }

  private async rebuildSummaryIndex(): Promise<IndexedConversationSummary[]> {
    const entries = await fileCommands.listDirectory(this.conversationsDir);
    const jsonFiles = entries.filter((entry) => entry.isFile && entry.name.endsWith(CONVERSATION_EXT));
    const summaries: IndexedConversationSummary[] = [];

    for (const file of jsonFiles) {
      try {
        const raw = JSON.parse(await fileCommands.readFile(file.path)) as RawConversation;
        summaries.push(this.toIndexedSummary(this.transformConversation(raw)));
      } catch {
        console.warn(`[TauriConversationAdapter] Failed to index ${file.path}`);
      }
    }

    await this.writeSummaryIndex(summaries);
    return summaries;
  }

  private async upsertIndexedSummary(conversation: Conversation): Promise<void> {
    try {
      const summaries = await this.readSummaryIndex();
      const next = summaries.filter((summary) => summary.id !== conversation.id);
      next.push(this.toIndexedSummary(conversation));
      await this.writeSummaryIndex(next);
    } catch {
      // Derived cache; listing will rebuild if needed.
    }
  }

  private async removeIndexedSummary(id: string): Promise<void> {
    try {
      const summaries = await this.readSummaryIndex();
      await this.writeSummaryIndex(summaries.filter((summary) => summary.id !== id));
    } catch {
      // Derived cache; listing will rebuild if needed.
    }
  }

  /**
   * Update the notes path (called when settings change).
   */
  setNotesPath(notesPath: string): void {
    this.notesPath = notesPath;
    this.conversationsDir = `${notesPath}/${CONVERSATIONS_DIR}`;
    this.indexDir = `${notesPath}/${COMMAND_CENTER_INDEX_DIR}`;
    this.indexPath = `${this.indexDir}/${CONVERSATION_INDEX_FILE}`;
    this.initialized = false;
  }
}

/**
 * Create a new TauriConversationAdapter instance.
 */
export function createTauriConversationAdapter(notesPath: string): ConversationStoragePort {
  return new TauriConversationAdapter(notesPath);
}
