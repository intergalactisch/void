/**
 * AIResponse - Two-stream response structure
 *
 * AI responses in void contain two distinct streams:
 * 1. Chat Stream - Human-readable text shown to the user
 * 2. Tool Stream - Structured tool invocations for the application
 *
 * The AI interprets user requests and outputs both a conversational
 * response AND actionable tool calls.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { ToolId } from './ToolId';
import type { ResearchCitation } from './ResearchCitation';

/**
 * A tool invocation requested by the AI.
 * This is the parsed result from the AI's tool stream.
 */
export interface ToolCall {
  /** Unique ID for this invocation */
  id: string;
  /** Which tool to invoke */
  toolId: ToolId;
  /** Arguments to pass to the tool */
  args: Record<string, unknown>;
}

/**
 * Compact, user-facing status update emitted while an AI provider is working.
 * These updates are separate from chat text so they can be displayed as a work
 * log without polluting the assistant's final answer.
 */
export interface AIStatusUpdate {
  /** Stable id for upserting this activity entry */
  id?: string;
  /** Lifecycle state for this activity */
  status: 'running' | 'completed' | 'failed';
  /** Friendly user-facing label */
  label: string;
  /** Optional short detail; raw provider output should not be persisted here */
  detail?: string;
}

/**
 * Usage statistics for the AI response.
 */
export interface AIUsage {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Cost estimate in USD (if available) */
  estimatedCost?: number;
}

/**
 * Metadata about the AI response.
 */
export interface AIResponseMeta {
  /** Which provider generated this response */
  provider: string;
  /** Which model was used */
  model: string;
  /** Response generation time in ms */
  latencyMs: number;
  /** Token usage */
  usage?: AIUsage;
  /** Unique response ID from provider */
  responseId?: string;
  /** Normalized citations discovered or used by the provider. */
  citations?: ResearchCitation[];
}

/**
 * Complete AI response with both streams.
 */
export interface AIResponse {
  /** Human-readable chat response */
  chat: string;
  /** Tool calls to execute */
  toolCalls: ToolCall[];
  /** Response metadata */
  meta: AIResponseMeta;
  /** Whether response was truncated */
  truncated: boolean;
  /** Stop reason from the model */
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'error';
}

/**
 * Streaming chunk for partial responses.
 */
export interface AIResponseChunk {
  /** Type of content in this chunk */
  type: 'chat' | 'tool_start' | 'tool_args' | 'tool_end' | 'status';
  /** Chat text delta */
  chatDelta?: string;
  /** User-facing provider/tool status update */
  status?: AIStatusUpdate;
  /** Tool call being built (for tool_* types) */
  toolCall?: Partial<ToolCall>;
  /** Index of tool call being streamed */
  toolIndex?: number;
}

// =========================================================================
// Constructors and helpers
// =========================================================================

/**
 * Create an empty AI response.
 */
export function createEmptyResponse(provider: string, model: string): AIResponse {
  return {
    chat: '',
    toolCalls: [],
    meta: {
      provider,
      model,
      latencyMs: 0,
    },
    truncated: false,
    stopReason: 'end_turn',
  };
}

/**
 * Create a tool call with generated ID.
 */
export function createToolCall(
  toolId: ToolId,
  args: Record<string, unknown>
): ToolCall {
  return {
    id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId,
    args,
  };
}

/**
 * Check if response contains tool calls.
 */
export function hasToolCalls(response: AIResponse): boolean {
  return response.toolCalls.length > 0;
}

/**
 * Check if response has chat content.
 */
export function hasChatContent(response: AIResponse): boolean {
  return response.chat.trim().length > 0;
}

/**
 * Get a summary of the response for logging.
 */
export function summarizeResponse(response: AIResponse): string {
  const chatPreview = response.chat.length > 50
    ? response.chat.slice(0, 50) + '...'
    : response.chat;

  const toolSummary = response.toolCalls.length > 0
    ? ` + ${response.toolCalls.length} tool call(s): ${response.toolCalls.map(t => t.toolId).join(', ')}`
    : '';

  return `[${response.meta.provider}/${response.meta.model}] "${chatPreview}"${toolSummary}`;
}

/**
 * Merge a streaming chunk into a building response.
 */
export function mergeChunk(
  response: AIResponse,
  chunk: AIResponseChunk
): AIResponse {
  const updated = { ...response };

  switch (chunk.type) {
    case 'chat':
      updated.chat += chunk.chatDelta ?? '';
      break;

    case 'tool_start':
      // Start building a new tool call
      if (chunk.toolCall) {
        const newCall: ToolCall = {
          id: chunk.toolCall.id ?? `tc_${Date.now()}`,
          toolId: chunk.toolCall.toolId!,
          args: chunk.toolCall.args ?? {},
        };
        updated.toolCalls = [...updated.toolCalls, newCall];
      }
      break;

    case 'tool_args':
      // Append to the current tool call's args
      if (chunk.toolIndex !== undefined && chunk.toolCall?.args) {
        const calls = [...updated.toolCalls];
        const existing = calls[chunk.toolIndex];
        if (existing) {
          calls[chunk.toolIndex] = {
            ...existing,
            args: { ...existing.args, ...chunk.toolCall.args },
          };
          updated.toolCalls = calls;
        }
      }
      break;

    case 'tool_end':
      // Tool call is complete, nothing to do
      break;

    case 'status':
      // Status chunks are UI metadata and do not affect the final response.
      break;
  }

  return updated;
}

/**
 * Parse tool calls from raw AI output.
 * This handles the XML-like format we instruct the AI to use.
 *
 * Expected format:
 * <tool_call>
 * <tool>note:create</tool>
 * <args>{"title": "New Note", "content": "Hello"}</args>
 * </tool_call>
 */
export function parseToolCalls(rawOutput: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const toolCallRegex = /<tool_call>\s*<tool>([^<]+)<\/tool>\s*<args>([\s\S]*?)<\/args>\s*<\/tool_call>/g;

  let match;
  while ((match = toolCallRegex.exec(rawOutput)) !== null) {
    const toolId = match[1];
    const argsJson = match[2];

    if (!toolId || !argsJson) {
      continue;
    }

    try {
      const args = JSON.parse(argsJson.trim());
      toolCalls.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        toolId: toolId.trim() as ToolId,
        args,
      });
    } catch {
      // Skip invalid tool calls
      console.warn(`Failed to parse tool call args: ${argsJson}`);
    }
  }

  return toolCalls;
}

/**
 * Extract chat content (removing tool call blocks).
 */
export function extractChatContent(rawOutput: string): string {
  return rawOutput
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}
