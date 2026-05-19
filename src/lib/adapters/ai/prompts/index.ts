/**
 * AI Prompts utilities barrel export
 *
 * System prompt building and Claude response parsing utilities.
 */

export {
  buildSystemPrompt,
  buildMinimalSystemPrompt,
  convertToolToClaudeFormat,
  convertToolsToClaudeFormat,
  type SystemPromptOptions,
} from './system';

export {
  // Response types
  type ClaudeResponse,
  type ClaudeContentBlock,
  type ClaudeTextBlock,
  type ClaudeToolUseBlock,
  // Streaming types
  type ClaudeStreamEvent,
  type ClaudeMessageStartEvent,
  type ClaudeContentBlockStartEvent,
  type ClaudeTextDeltaEvent,
  type ClaudeInputJsonDeltaEvent,
  type ClaudeContentBlockStopEvent,
  type ClaudeMessageDeltaEvent,
  type ClaudeMessageStopEvent,
  type ClaudePingEvent,
  type ClaudeErrorEvent,
  // Streaming state
  type StreamingState,
  createStreamingState,
  processStreamEvent,
  buildResponseFromState,
  // Parsing functions
  parseToolCalls,
  parseToolInvocations,
  extractTextContent,
  convertClaudeResponse,
  parseSSELine,
} from './toolParser';
