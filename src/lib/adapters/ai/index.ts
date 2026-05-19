/**
 * AI Adapters barrel export
 *
 * Adapters that implement AI provider ports for various AI services.
 *
 * Available adapters:
 * - MockAIAdapter: Mock implementation for testing and development (implements AIProviderPort)
 * - ClaudeAdapter: Anthropic Claude API (implements AIAssistantProviderPort)
 *
 * Utilities:
 * - System prompt builder for constructing AI prompts
 * - Tool parser for parsing Claude's response format
 *
 * Future adapters:
 * - OpenAIAdapter: OpenAI GPT API
 * - OllamaAdapter: Local Ollama models
 */

// Adapters
export { MockAIAdapter, type MockAIAdapterOptions } from './MockAIAdapter';
export { MockAIAssistantAdapter, type MockAIAssistantAdapterOptions } from './MockAIAssistantAdapter';
export { ClaudeAdapter, type ClaudeAdapterOptions } from './ClaudeAdapter';
export { CLIAIAdapter, type CLIAIAdapterOptions } from './CLIAIAdapter';

// Prompt utilities
export {
  // System prompt builder
  buildSystemPrompt,
  buildMinimalSystemPrompt,
  convertToolToClaudeFormat,
  convertToolsToClaudeFormat,
  type SystemPromptOptions,
  // Tool parser - response types
  type ClaudeResponse,
  type ClaudeContentBlock,
  type ClaudeTextBlock,
  type ClaudeToolUseBlock,
  // Tool parser - streaming types
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
  // Tool parser - streaming state
  type StreamingState,
  createStreamingState,
  processStreamEvent,
  buildResponseFromState,
  // Tool parser - parsing functions
  parseToolCalls,
  parseToolInvocations,
  extractTextContent,
  convertClaudeResponse,
  parseSSELine,
} from './prompts';

// CLI Session Manager
export { CLISessionManagerAdapter } from './CLISessionManagerAdapter';
export { MemoryCLISessionManagerAdapter, type MemoryCLIOptions } from './MemoryCLISessionManagerAdapter';

// Result Parser
export { ResultParserAdapter } from './ResultParserAdapter';

// Future exports:
// export { OpenAIAdapter, type OpenAIAdapterOptions } from './OpenAIAdapter';
// export { OllamaAdapter, type OllamaAdapterOptions } from './OllamaAdapter';
