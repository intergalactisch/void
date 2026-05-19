/**
 * Message - Conversation message entity
 *
 * Represents a single message in a conversation between user and AI.
 * Messages can be from the user, assistant, or system (for context).
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { ToolInvocation } from './ToolInvocation';
import type { AIResponse, AIStatusUpdate, ToolCall } from '../values/AIResponse';

const MESSAGE_ACTIVITY_LIMIT = 12;

/**
 * Who sent the message.
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Whether a message belongs in the user-facing chat transcript.
 * Agent runners may keep internal turns out of chat while still using the
 * same provider pipeline.
 */
export type MessageVisibility = 'visible' | 'internal';

/**
 * Content block types within a message.
 */
export type ContentBlockType = 'text' | 'tool_use' | 'tool_result' | 'image';

/**
 * Text content block.
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * Tool use block (assistant requesting tool execution).
 */
export interface ToolUseBlock {
  type: 'tool_use';
  toolCall: ToolCall;
}

/**
 * Tool result block (result of tool execution).
 */
export interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  result: unknown;
  isError: boolean;
}

/**
 * Image content block.
 */
export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
}

/**
 * Union of all content block types.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

/**
 * Compact assistant work-log entry. This intentionally stores friendly labels
 * and short sanitized details rather than raw provider output.
 */
export interface MessageActivityEntry {
  /** Stable id so streaming status chunks can update an existing row */
  id: string;
  /** Activity lifecycle state */
  status: 'running' | 'completed' | 'failed';
  /** Friendly user-facing label */
  label: string;
  /** Optional short detail */
  detail?: string;
  /** When the activity first appeared */
  createdAt: Date;
  /** When the activity was last updated */
  updatedAt: Date;
  /** When the activity reached a terminal state */
  completedAt: Date | null;
}

/**
 * Message entity.
 */
export interface Message {
  /** Unique message ID */
  id: string;

  /** Who sent this message */
  role: MessageRole;

  /** Message content blocks */
  content: ContentBlock[];

  /** Plain text version of content (for search/display) */
  text: string;

  /** Tool invocations triggered by this message */
  toolInvocations: ToolInvocation[];

  /** When message was created */
  createdAt: Date;

  /** When message was last updated (for streaming) */
  updatedAt: Date;

  /** Whether message is still being streamed */
  isStreaming: boolean;

  /** UI/transcript visibility. Missing means visible for old persisted data. */
  visibility?: MessageVisibility;

  /** Client-side optimistic turn id used to reconcile pending UI messages. */
  clientTurnId?: string;

  /** Compact persisted work log for assistant activity */
  activity?: MessageActivityEntry[];

  /** AI response metadata (for assistant messages) */
  metadata?: {
    provider?: string;
    model?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
  };
}

/**
 * Create a user message.
 */
export function createUserMessage(
  text: string,
  params?: { visibility?: MessageVisibility; clientTurnId?: string }
): Message {
  const now = new Date();
  const message: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    text,
    toolInvocations: [],
    createdAt: now,
    updatedAt: now,
    isStreaming: false,
  };

  if (params?.visibility !== undefined) {
    message.visibility = params.visibility;
  }

  if (params?.clientTurnId !== undefined) {
    message.clientTurnId = params.clientTurnId;
  }

  return message;
}

/**
 * Create an assistant message (possibly streaming).
 */
export function createAssistantMessage(params?: {
  text?: string;
  isStreaming?: boolean;
  metadata?: Message['metadata'];
  visibility?: MessageVisibility;
}): Message {
  const now = new Date();
  const text = params?.text ?? '';

  const message: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    text,
    toolInvocations: [],
    createdAt: now,
    updatedAt: now,
    isStreaming: params?.isStreaming ?? false,
  };

  if (params?.metadata !== undefined) {
    message.metadata = params.metadata;
  }

  if (params?.visibility !== undefined) {
    message.visibility = params.visibility;
  }

  return message;
}

/**
 * Create a system message (for context injection).
 */
export function createSystemMessage(text: string): Message {
  const now = new Date();
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'system',
    content: [{ type: 'text', text }],
    text,
    toolInvocations: [],
    createdAt: now,
    updatedAt: now,
    isStreaming: false,
  };
}

/**
 * Create a message from an AI response.
 */
export function createMessageFromResponse(
  response: AIResponse,
  params?: { visibility?: MessageVisibility }
): Message {
  const now = new Date();
  const content: ContentBlock[] = [];

  // Add text content
  if (response.chat) {
    content.push({ type: 'text', text: response.chat });
  }

  // Add tool use blocks
  for (const toolCall of response.toolCalls) {
    content.push({ type: 'tool_use', toolCall });
  }

  const message: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content,
    text: response.chat,
    toolInvocations: [],
    createdAt: now,
    updatedAt: now,
    isStreaming: false,
  };

  // Build metadata, only including usage if present
  const metadata: Message['metadata'] = {
    provider: response.meta.provider,
    model: response.meta.model,
  };

  if (response.meta.usage) {
    metadata.usage = {
      inputTokens: response.meta.usage.inputTokens,
      outputTokens: response.meta.usage.outputTokens,
    };
  }

  message.metadata = metadata;

  if (params?.visibility !== undefined) {
    message.visibility = params.visibility;
  }

  return message;
}

// =========================================================================
// Message updates
// =========================================================================

/**
 * Append text to a streaming message.
 */
export function appendText(message: Message, delta: string): Message {
  const newText = message.text + delta;
  const content = [...message.content];

  // Update or add text block
  const textBlockIndex = content.findIndex((b) => b.type === 'text');
  if (textBlockIndex >= 0) {
    content[textBlockIndex] = { type: 'text', text: newText };
  } else {
    content.push({ type: 'text', text: newText });
  }

  return {
    ...message,
    content,
    text: newText,
    updatedAt: new Date(),
  };
}

/**
 * Add a tool use block to a message.
 */
export function addToolUse(message: Message, toolCall: ToolCall): Message {
  return {
    ...message,
    content: [...message.content, { type: 'tool_use', toolCall }],
    updatedAt: new Date(),
  };
}

/**
 * Add a tool invocation to a message.
 */
export function addToolInvocation(
  message: Message,
  invocation: ToolInvocation
): Message {
  return {
    ...message,
    toolInvocations: [...message.toolInvocations, invocation],
    updatedAt: new Date(),
  };
}

/**
 * Update a tool invocation in a message.
 */
export function updateToolInvocation(
  message: Message,
  invocationId: string,
  updater: (inv: ToolInvocation) => ToolInvocation
): Message {
  return {
    ...message,
    toolInvocations: message.toolInvocations.map((inv) =>
      inv.id === invocationId ? updater(inv) : inv
    ),
    updatedAt: new Date(),
  };
}

/**
 * Upsert an assistant activity entry from a provider status chunk.
 * When a new running activity starts, any previous running activities are
 * marked completed so the log reads as a compact sequence of steps.
 */
export function upsertActivity(
  message: Message,
  update: AIStatusUpdate
): Message {
  const now = new Date();
  const id = update.id ?? `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = message.activity ?? [];
  const existingIndex = existing.findIndex((entry) => entry.id === id);

  let activity =
    existingIndex >= 0
      ? existing.map((entry, index) =>
          index === existingIndex
            ? {
                ...entry,
                status: update.status,
                label: update.label,
                ...(update.detail !== undefined ? { detail: update.detail } : {}),
                updatedAt: now,
                completedAt: update.status === 'running' ? null : now,
              }
            : entry
        )
      : [
          ...existing.map((entry) =>
            update.status === 'running' && entry.status === 'running'
              ? { ...entry, status: 'completed' as const, updatedAt: now, completedAt: now }
              : entry
          ),
          {
            id,
            status: update.status,
            label: update.label,
            ...(update.detail !== undefined ? { detail: update.detail } : {}),
            createdAt: now,
            updatedAt: now,
            completedAt: update.status === 'running' ? null : now,
          },
        ];

  if (activity.length > MESSAGE_ACTIVITY_LIMIT) {
    activity = activity.slice(activity.length - MESSAGE_ACTIVITY_LIMIT);
  }

  return {
    ...message,
    activity,
    updatedAt: now,
  };
}

/**
 * Mark all currently running activity entries with the provided terminal state.
 */
export function finishRunningActivity(
  message: Message,
  status: 'completed' | 'failed' = 'completed'
): Message {
  if (!message.activity?.some((entry) => entry.status === 'running')) {
    return message;
  }

  const now = new Date();
  return {
    ...message,
    activity: message.activity.map((entry) =>
      entry.status === 'running'
        ? { ...entry, status, updatedAt: now, completedAt: now }
        : entry
    ),
    updatedAt: now,
  };
}

/**
 * Restore activity entries loaded from JSON persistence.
 */
export function deserializeActivityEntries(raw: unknown): MessageActivityEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const entries: MessageActivityEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.label !== 'string') continue;
    if (
      record.status !== 'running' &&
      record.status !== 'completed' &&
      record.status !== 'failed'
    ) {
      continue;
    }

    const createdAt = record.createdAt ? new Date(record.createdAt as string) : new Date();
    const updatedAt = record.updatedAt ? new Date(record.updatedAt as string) : createdAt;
    const entry: MessageActivityEntry = {
      id: record.id,
      status: record.status,
      label: record.label,
      createdAt,
      updatedAt,
      completedAt: record.completedAt ? new Date(record.completedAt as string) : null,
    };

    if (typeof record.detail === 'string') {
      entry.detail = record.detail;
    }

    entries.push(entry);
  }

  return entries.slice(Math.max(0, entries.length - MESSAGE_ACTIVITY_LIMIT));
}

/**
 * Mark message as finished streaming.
 */
export function finishStreaming(message: Message): Message {
  const finished = finishRunningActivity(message);
  return {
    ...finished,
    isStreaming: false,
    updatedAt: new Date(),
  };
}

/**
 * Set message metadata.
 */
export function setMetadata(
  message: Message,
  metadata: NonNullable<Message['metadata']>
): Message {
  const updated: Message = {
    ...message,
    updatedAt: new Date(),
  };
  updated.metadata = metadata;
  return updated;
}

// =========================================================================
// Message queries
// =========================================================================

/**
 * Get all text content from a message.
 */
export function getTextContent(message: Message): string {
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Get all tool calls from a message.
 */
export function getToolCalls(message: Message): ToolCall[] {
  return message.content
    .filter((b): b is ToolUseBlock => b.type === 'tool_use')
    .map((b) => b.toolCall);
}

/**
 * Check if message has pending tool invocations.
 */
export function hasPendingInvocations(message: Message): boolean {
  return message.toolInvocations.some(
    (inv) => inv.status === 'pending' || inv.status === 'executing'
  );
}

/**
 * Check if message has any tool invocations.
 */
export function hasToolInvocations(message: Message): boolean {
  return message.toolInvocations.length > 0;
}

/**
 * Get a preview of the message (first N characters).
 */
export function getPreview(message: Message, maxLength = 100): string {
  if (message.text.length <= maxLength) {
    return message.text;
  }
  return message.text.slice(0, maxLength).trim() + '...';
}

/**
 * Serialize message for persistence.
 */
export function serializeMessage(message: Message): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    id: message.id,
    role: message.role,
    content: message.content,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    metadata: message.metadata,
  };

  if (message.activity !== undefined) {
    serialized.activity = message.activity;
  }

  if (message.visibility !== undefined) {
    serialized.visibility = message.visibility;
  }

  if (message.clientTurnId !== undefined) {
    serialized.clientTurnId = message.clientTurnId;
  }

  return serialized;
}
