/**
 * Tool Parser - Parse Claude API responses into ToolInvocation entities
 *
 * Extracts tool_use blocks from Claude's response format and converts
 * them into the application's ToolInvocation entities.
 *
 * Part of the Hexagonal Architecture adapters layer.
 */

import type { ToolId } from '$lib/domain/values/ToolId';
import { isValidToolId } from '$lib/domain/values/ToolId';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolCall, AIResponse, AIResponseChunk } from '$lib/domain/values/AIResponse';
import { getLogger } from '$lib/logging';

const log = getLogger('ToolParser');

// =========================================================================
// Claude API Response Types
// =========================================================================

/**
 * Claude API text content block.
 */
export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

/**
 * Claude API tool_use content block.
 */
export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Union of Claude content block types.
 */
export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock;

/**
 * Claude API message response.
 */
export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// =========================================================================
// Claude Streaming Event Types
// =========================================================================

/**
 * Claude streaming message_start event.
 */
export interface ClaudeMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Claude streaming content_block_start event.
 */
export interface ClaudeContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ClaudeTextBlock | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
}

/**
 * Claude streaming content_block_delta event for text.
 */
export interface ClaudeTextDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

/**
 * Claude streaming content_block_delta event for tool input.
 */
export interface ClaudeInputJsonDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'input_json_delta';
    partial_json: string;
  };
}

/**
 * Claude streaming content_block_stop event.
 */
export interface ClaudeContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

/**
 * Claude streaming message_delta event.
 */
export interface ClaudeMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

/**
 * Claude streaming message_stop event.
 */
export interface ClaudeMessageStopEvent {
  type: 'message_stop';
}

/**
 * Claude streaming ping event.
 */
export interface ClaudePingEvent {
  type: 'ping';
}

/**
 * Claude streaming error event.
 */
export interface ClaudeErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/**
 * Union of all Claude streaming events.
 */
export type ClaudeStreamEvent =
  | ClaudeMessageStartEvent
  | ClaudeContentBlockStartEvent
  | ClaudeTextDeltaEvent
  | ClaudeInputJsonDeltaEvent
  | ClaudeContentBlockStopEvent
  | ClaudeMessageDeltaEvent
  | ClaudeMessageStopEvent
  | ClaudePingEvent
  | ClaudeErrorEvent;

// =========================================================================
// Parsing Functions
// =========================================================================

/**
 * Parse tool_use blocks from a Claude response into ToolCall objects.
 *
 * @param response - The Claude API response
 * @returns Array of ToolCall objects
 */
export function parseToolCalls(response: ClaudeResponse): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'tool_use') {
      // Validate the tool name is a valid ToolId
      if (!isValidToolId(block.name)) {
        log.warn('Invalid tool ID in response', { name: block.name });
        continue;
      }

      toolCalls.push({
        id: block.id,
        toolId: block.name as ToolId,
        args: block.input,
      });
    }
  }

  return toolCalls;
}

/**
 * Parse tool_use blocks from a Claude response into ToolInvocation entities.
 *
 * @param response - The Claude API response
 * @param messageId - The parent message ID (optional)
 * @returns Array of ToolInvocation entities
 */
export function parseToolInvocations(
  response: ClaudeResponse,
  messageId?: string
): ToolInvocation[] {
  const invocations: ToolInvocation[] = [];

  for (const block of response.content) {
    if (block.type === 'tool_use') {
      // Validate the tool name is a valid ToolId
      if (!isValidToolId(block.name)) {
        log.warn('Invalid tool ID in response', { name: block.name });
        continue;
      }

      const invocationParams: {
        toolId: ToolId;
        args: Record<string, unknown>;
        messageId?: string;
        confirmed?: boolean;
      } = {
        toolId: block.name as ToolId,
        args: block.input,
        confirmed: false, // Will be set based on tool's requiresConfirmation
      };

      if (messageId !== undefined) {
        invocationParams.messageId = messageId;
      }

      invocations.push(createInvocation(invocationParams));
    }
  }

  return invocations;
}

/**
 * Extract text content from a Claude response.
 *
 * @param response - The Claude API response
 * @returns Combined text content
 */
export function extractTextContent(response: ClaudeResponse): string {
  const textBlocks = response.content.filter(
    (block): block is ClaudeTextBlock => block.type === 'text'
  );

  return textBlocks.map(block => block.text).join('');
}

/**
 * Convert a Claude response to our AIResponse format.
 *
 * @param response - The Claude API response
 * @param startTime - When the request started (for latency calculation)
 * @returns AIResponse object
 */
export function convertClaudeResponse(
  response: ClaudeResponse,
  startTime: number
): AIResponse {
  const stopReason = mapStopReason(response.stop_reason);

  return {
    chat: extractTextContent(response),
    toolCalls: parseToolCalls(response),
    meta: {
      provider: 'claude',
      model: response.model,
      latencyMs: Date.now() - startTime,
      responseId: response.id,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    },
    truncated: response.stop_reason === 'max_tokens',
    stopReason,
  };
}

/**
 * Map Claude stop_reason to our AIResponse stop_reason.
 */
function mapStopReason(
  claudeReason: ClaudeResponse['stop_reason']
): AIResponse['stopReason'] {
  switch (claudeReason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

// =========================================================================
// Streaming State Machine
// =========================================================================

/**
 * State for building a response from streaming events.
 */
export interface StreamingState {
  /** Response ID from message_start */
  responseId: string;
  /** Model used */
  model: string;
  /** Accumulated text content */
  text: string;
  /** Tool calls being built */
  toolCalls: Map<number, {
    id: string;
    name: string;
    inputJson: string;
  }>;
  /** Input tokens (from message_start) */
  inputTokens: number;
  /** Output tokens (accumulated from message_delta) */
  outputTokens: number;
  /** Stop reason (from message_delta) */
  stopReason: AIResponse['stopReason'] | null;
  /** Whether the stream is complete */
  complete: boolean;
}

/**
 * Create initial streaming state.
 */
export function createStreamingState(): StreamingState {
  return {
    responseId: '',
    model: '',
    text: '',
    toolCalls: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    stopReason: null,
    complete: false,
  };
}

/**
 * Process a streaming event and update state.
 *
 * @param state - Current streaming state
 * @param event - The streaming event to process
 * @returns Updated state and optional chunk to emit
 */
export function processStreamEvent(
  state: StreamingState,
  event: ClaudeStreamEvent
): { state: StreamingState; chunk?: AIResponseChunk } {
  switch (event.type) {
    case 'message_start': {
      return {
        state: {
          ...state,
          responseId: event.message.id,
          model: event.message.model,
          inputTokens: event.message.usage.input_tokens,
        },
      };
    }

    case 'content_block_start': {
      if (event.content_block.type === 'text') {
        // Text block starting, nothing to emit yet
        return { state };
      } else if (event.content_block.type === 'tool_use') {
        // Tool use block starting
        const toolBlock = event.content_block;
        const newToolCalls = new Map(state.toolCalls);
        newToolCalls.set(event.index, {
          id: toolBlock.id,
          name: toolBlock.name,
          inputJson: '',
        });

        const toolCallPartial: Partial<ToolCall> = { id: toolBlock.id };
        if (isValidToolId(toolBlock.name)) {
          toolCallPartial.toolId = toolBlock.name as ToolId;
        }

        return {
          state: { ...state, toolCalls: newToolCalls },
          chunk: {
            type: 'tool_start',
            toolCall: toolCallPartial,
            toolIndex: event.index,
          },
        };
      }
      return { state };
    }

    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        return {
          state: { ...state, text: state.text + event.delta.text },
          chunk: {
            type: 'chat',
            chatDelta: event.delta.text,
          },
        };
      } else if (event.delta.type === 'input_json_delta') {
        // Accumulate JSON for tool input
        const existing = state.toolCalls.get(event.index);
        if (existing) {
          const newToolCalls = new Map(state.toolCalls);
          newToolCalls.set(event.index, {
            ...existing,
            inputJson: existing.inputJson + event.delta.partial_json,
          });

          return {
            state: { ...state, toolCalls: newToolCalls },
            chunk: {
              type: 'tool_args',
              toolIndex: event.index,
            },
          };
        }
      }
      return { state };
    }

    case 'content_block_stop': {
      const toolData = state.toolCalls.get(event.index);
      if (toolData && toolData.inputJson) {
        // Parse the accumulated JSON
        try {
          const args = JSON.parse(toolData.inputJson) as Record<string, unknown>;
          const toolCallPartial: Partial<ToolCall> = { id: toolData.id, args };
          if (isValidToolId(toolData.name)) {
            toolCallPartial.toolId = toolData.name as ToolId;
          }

          return {
            state,
            chunk: {
              type: 'tool_end',
              toolCall: toolCallPartial,
              toolIndex: event.index,
            },
          };
        } catch {
          log.warn('Failed to parse tool input JSON', { json: toolData.inputJson });
        }
      }
      return { state };
    }

    case 'message_delta': {
      return {
        state: {
          ...state,
          outputTokens: event.usage.output_tokens,
          stopReason: mapStopReason(event.delta.stop_reason),
        },
      };
    }

    case 'message_stop': {
      return {
        state: { ...state, complete: true },
      };
    }

    case 'ping': {
      // Ignore ping events
      return { state };
    }

    case 'error': {
      log.error('Claude streaming error', { errorType: event.error.type, message: event.error.message });
      return {
        state: { ...state, complete: true, stopReason: 'error' },
      };
    }

    default: {
      // Unknown event type
      return { state };
    }
  }
}

/**
 * Build final AIResponse from completed streaming state.
 *
 * @param state - Completed streaming state
 * @param startTime - When the request started
 * @returns AIResponse object
 */
export function buildResponseFromState(
  state: StreamingState,
  startTime: number
): AIResponse {
  // Convert accumulated tool calls to ToolCall array
  const toolCalls: ToolCall[] = [];
  for (const [, toolData] of state.toolCalls) {
    if (toolData.inputJson && isValidToolId(toolData.name)) {
      try {
        const args = JSON.parse(toolData.inputJson) as Record<string, unknown>;
        toolCalls.push({
          id: toolData.id,
          toolId: toolData.name as ToolId,
          args,
        });
      } catch {
        log.warn('Failed to parse tool input JSON in response', { json: toolData.inputJson });
      }
    }
  }

  return {
    chat: state.text,
    toolCalls,
    meta: {
      provider: 'claude',
      model: state.model,
      latencyMs: Date.now() - startTime,
      responseId: state.responseId,
      usage: {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        totalTokens: state.inputTokens + state.outputTokens,
      },
    },
    truncated: state.stopReason === 'max_tokens',
    stopReason: state.stopReason ?? 'end_turn',
  };
}

/**
 * Parse a Server-Sent Events line into a ClaudeStreamEvent.
 *
 * @param line - SSE data line (without "data: " prefix)
 * @returns Parsed event or null if invalid
 */
export function parseSSELine(line: string): ClaudeStreamEvent | null {
  if (!line || line === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(line) as ClaudeStreamEvent;
  } catch {
    log.warn('Failed to parse SSE line', { line });
    return null;
  }
}
