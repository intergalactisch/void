/**
 * Conversation - Chat conversation entity
 *
 * Represents a conversation between the user and AI assistant.
 * Conversations contain messages and maintain context.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { Message } from './Message';
import type { PromptContext } from '../values/PromptContext';

/**
 * Conversation status.
 */
export type ConversationStatus =
  | 'active'    // Conversation is ongoing
  | 'completed' // Conversation ended naturally
  | 'archived'; // Conversation archived by user

/**
 * Conversation entity.
 */
export interface Conversation {
  /** Unique conversation ID */
  id: string;

  /** Conversation title (auto-generated or user-set) */
  title: string;

  /** Messages in chronological order */
  messages: Message[];

  /** Current status */
  status: ConversationStatus;

  /** Context at conversation start */
  initialContext: PromptContext | null;

  /** When conversation started */
  createdAt: Date;

  /** When conversation was last updated */
  updatedAt: Date;

  /** Total token usage across all messages */
  totalTokens: {
    input: number;
    output: number;
  };

  /** Tags for organization */
  tags: string[];

  /** Path to the bound document (null for global conversations) */
  documentPath: string | null;
}

/**
 * Create a new conversation.
 */
export function createConversation(params?: {
  title?: string;
  context?: PromptContext;
  tags?: string[];
  documentPath?: string | null;
}): Conversation {
  const now = new Date();
  return {
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: params?.title ?? 'New Conversation',
    messages: [],
    status: 'active',
    initialContext: params?.context ?? null,
    createdAt: now,
    updatedAt: now,
    totalTokens: { input: 0, output: 0 },
    tags: params?.tags ?? [],
    documentPath: params?.documentPath ?? null,
  };
}

// =========================================================================
// Conversation updates
// =========================================================================

/**
 * Add a message to the conversation.
 */
export function addMessage(
  conversation: Conversation,
  message: Message
): Conversation {
  const updatedTokens = { ...conversation.totalTokens };

  // Update token counts from message metadata
  if (message.metadata?.usage) {
    updatedTokens.input += message.metadata.usage.inputTokens;
    updatedTokens.output += message.metadata.usage.outputTokens;
  }

  // Auto-generate title from first user message
  let title = conversation.title;
  if (
    title === 'New Conversation' &&
    message.role === 'user' &&
    conversation.messages.length === 0
  ) {
    title = generateTitle(message.text);
  }

  return {
    ...conversation,
    title,
    messages: [...conversation.messages, message],
    updatedAt: new Date(),
    totalTokens: updatedTokens,
  };
}

/**
 * Update a message in the conversation.
 */
export function updateMessage(
  conversation: Conversation,
  messageId: string,
  updater: (msg: Message) => Message
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((msg) =>
      msg.id === messageId ? updater(msg) : msg
    ),
    updatedAt: new Date(),
  };
}

/**
 * Remove a message from the conversation.
 */
export function removeMessage(
  conversation: Conversation,
  messageId: string
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.filter((msg) => msg.id !== messageId),
    updatedAt: new Date(),
  };
}

/**
 * Set conversation title.
 */
export function setTitle(conversation: Conversation, title: string): Conversation {
  return {
    ...conversation,
    title: title.trim() || 'Untitled Conversation',
    updatedAt: new Date(),
  };
}

/**
 * Set conversation status.
 */
export function setStatus(
  conversation: Conversation,
  status: ConversationStatus
): Conversation {
  return {
    ...conversation,
    status,
    updatedAt: new Date(),
  };
}

/**
 * Add tags to conversation.
 */
export function addTags(conversation: Conversation, tags: string[]): Conversation {
  const newTags = [...new Set([...conversation.tags, ...tags])];
  return {
    ...conversation,
    tags: newTags,
    updatedAt: new Date(),
  };
}

/**
 * Remove tags from conversation.
 */
export function removeTags(conversation: Conversation, tags: string[]): Conversation {
  return {
    ...conversation,
    tags: conversation.tags.filter((t) => !tags.includes(t)),
    updatedAt: new Date(),
  };
}

/**
 * Clear all messages from conversation.
 */
export function clearMessages(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [],
    totalTokens: { input: 0, output: 0 },
    updatedAt: new Date(),
  };
}

// =========================================================================
// Conversation queries
// =========================================================================

/**
 * Get the last message in the conversation.
 */
export function getLastMessage(conversation: Conversation): Message | undefined {
  return conversation.messages[conversation.messages.length - 1];
}

/**
 * Get the last user message.
 */
export function getLastUserMessage(conversation: Conversation): Message | undefined {
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const msg = conversation.messages[i];
    if (msg && msg.role === 'user') {
      return msg;
    }
  }
  return undefined;
}

/**
 * Get the last assistant message.
 */
export function getLastAssistantMessage(conversation: Conversation): Message | undefined {
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const msg = conversation.messages[i];
    if (msg && msg.role === 'assistant') {
      return msg;
    }
  }
  return undefined;
}

/**
 * Check if conversation has any messages.
 */
export function isEmpty(conversation: Conversation): boolean {
  return conversation.messages.length === 0;
}

/**
 * Check if conversation is waiting for assistant response.
 */
export function isAwaitingResponse(conversation: Conversation): boolean {
  const last = getLastMessage(conversation);
  return last?.role === 'user';
}

/**
 * Check if any message is currently streaming.
 */
export function hasStreamingMessage(conversation: Conversation): boolean {
  return conversation.messages.some((msg) => msg.isStreaming);
}

/**
 * Check if any message has pending tool invocations.
 */
export function hasPendingTools(conversation: Conversation): boolean {
  return conversation.messages.some((msg) =>
    msg.toolInvocations.some(
      (inv) => inv.status === 'pending' || inv.status === 'executing'
    )
  );
}

/**
 * Get message count.
 */
export function getMessageCount(conversation: Conversation): number {
  return conversation.messages.length;
}

/**
 * Get message count by role.
 */
export function getMessageCountByRole(
  conversation: Conversation,
  role: Message['role']
): number {
  return conversation.messages.filter((msg) => msg.role === role).length;
}

/**
 * Get total word count across all messages.
 */
export function getTotalWordCount(conversation: Conversation): number {
  return conversation.messages.reduce((count, msg) => {
    return count + msg.text.split(/\s+/).filter((w) => w.length > 0).length;
  }, 0);
}

/**
 * Get messages for API (format for sending to AI).
 */
export function getMessagesForAPI(
  conversation: Conversation
): Array<{ role: Message['role']; content: string }> {
  return conversation.messages
    .filter((msg) => msg.role !== 'system') // System messages handled separately
    .filter((msg) => msg.visibility !== 'internal')
    .map((msg) => ({
      role: msg.role,
      content: msg.text,
    }));
}

/**
 * Get a preview of the conversation.
 */
export function getPreview(conversation: Conversation): string {
  const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
  if (!firstUserMsg) {
    return 'Empty conversation';
  }

  const preview = firstUserMsg.text.slice(0, 100);
  return preview.length < firstUserMsg.text.length ? preview + '...' : preview;
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Generate a title from message text.
 */
function generateTitle(text: string): string {
  // Take first line or first 50 characters
  const firstLine = (text.split('\n')[0] ?? '').trim();
  if (firstLine.length <= 50) {
    return firstLine || 'New Conversation';
  }

  // Truncate at word boundary
  const truncated = firstLine.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 30) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Serialize conversation for persistence.
 */
export function serializeConversation(
  conversation: Conversation
): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    totalTokens: conversation.totalTokens,
    tags: conversation.tags,
    messageCount: conversation.messages.length,
    documentPath: conversation.documentPath,
  };
}

/**
 * Check if a conversation is bound to a specific document.
 */
export function isDocumentBound(conversation: Conversation): boolean {
  return conversation.documentPath !== null;
}
