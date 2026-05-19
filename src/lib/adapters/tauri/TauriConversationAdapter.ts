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
  ListConversationsOptions,
} from '$lib/ports/outbound/ConversationStoragePort';
import { fileCommands } from './commands';

/**
 * Directory name for storing conversations (relative to notes path).
 */
const CONVERSATIONS_DIR = '.void/conversations';

/**
 * File extension for conversation files.
 */
const CONVERSATION_EXT = '.json';

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

/**
 * Tauri file-based implementation of ConversationStoragePort.
 *
 * Stores conversations as JSON files in the notes directory.
 */
export class TauriConversationAdapter implements ConversationStoragePort {
  private notesPath: string;
  private conversationsDir: string;
  private initialized = false;

  constructor(notesPath: string) {
    this.notesPath = notesPath;
    this.conversationsDir = `${notesPath}/${CONVERSATIONS_DIR}`;
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

      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * List conversation summaries.
   */
  async list(options: ListConversationsOptions = {}): Promise<Result<ConversationSummary[], Error>> {
    try {
      await this.ensureDirectory();

      const {
        status,
        limit,
        offset = 0,
        sortBy = 'updatedAt',
        sortOrder = 'desc',
      } = options;

      // List all conversation files
      const entries = await fileCommands.listDirectory(this.conversationsDir);
      const jsonFiles = entries.filter(
        (e) => e.isFile && e.name.endsWith(CONVERSATION_EXT)
      );

      // Load and filter conversations
      const summaries: ConversationSummary[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fileCommands.readFile(file.path);
          const raw = JSON.parse(content) as RawConversation;

          // Filter by status if specified
          if (status && raw.status !== status) {
            continue;
          }

          const conversation = this.transformConversation(raw);

          summaries.push({
            id: conversation.id,
            title: conversation.title,
            messageCount: conversation.messages.length,
            status: conversation.status,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            preview: getPreview(conversation),
          });
        } catch {
          // Skip invalid files
          console.warn(`[TauriConversationAdapter] Failed to load ${file.path}`);
        }
      }

      // Sort
      summaries.sort((a, b) => {
        const aValue = sortBy === 'createdAt' ? a.createdAt : a.updatedAt;
        const bValue = sortBy === 'createdAt' ? b.createdAt : b.updatedAt;
        return sortOrder === 'asc'
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime();
      });

      // Paginate
      let result = summaries;
      if (offset > 0) {
        result = result.slice(offset);
      }
      if (limit !== undefined) {
        result = result.slice(0, limit);
      }

      return ok(result);
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

  /**
   * Update the notes path (called when settings change).
   */
  setNotesPath(notesPath: string): void {
    this.notesPath = notesPath;
    this.conversationsDir = `${notesPath}/${CONVERSATIONS_DIR}`;
    this.initialized = false;
  }
}

/**
 * Create a new TauriConversationAdapter instance.
 */
export function createTauriConversationAdapter(notesPath: string): ConversationStoragePort {
  return new TauriConversationAdapter(notesPath);
}
