/**
 * ClaudeAdapter - Anthropic Claude API implementation
 *
 * This adapter implements AIAssistantProviderPort for the Claude API.
 * It supports both non-streaming and streaming responses, and properly
 * handles tool use in Claude's native format.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import type {
  AIAssistantProviderPort,
  AIAssistantRequest,
  AIProviderConnectionConfig,
} from '$lib/ports/outbound/AIAssistantProviderPort';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';
import type { AIResponse, AIResponseChunk } from '$lib/domain/values/AIResponse';
import type { AIProviderType, ClaudeConfig } from '$lib/domain/values/AIProviderType';
import { DEFAULT_AI_CONFIGS, getProviderModels } from '$lib/domain/values/AIProviderType';
import type { Message } from '$lib/domain/entities/Message';

import { getLogger } from '$lib/logging';

import {
  buildSystemPrompt,
  convertToolsToClaudeFormat,
  type ClaudeResponse,
  type ClaudeStreamEvent,
  createStreamingState,
  processStreamEvent,
  buildResponseFromState,
  convertClaudeResponse,
  parseSSELine,
} from './prompts';

// =========================================================================
// Constants
// =========================================================================

const log = getLogger('ClaudeAdapter');

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Token estimation: ~4 characters per token (rough estimate) */
const CHARS_PER_TOKEN = 4;

/** Default max tokens if not specified */
const DEFAULT_MAX_TOKENS = 4096;

/** Default temperature if not specified */
const DEFAULT_TEMPERATURE = 0.7;

/** Maximum retry attempts for transient errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (milliseconds) */
const BASE_RETRY_DELAY = 1000;

/** Maximum delay between retries (milliseconds) */
const MAX_RETRY_DELAY = 30000;

/** HTTP status codes that should trigger retry */
const RETRYABLE_STATUS_CODES = [429, 503, 502, 500];

/** Maximum concurrent requests (for rate limiting) */
const MAX_CONCURRENT_REQUESTS = 5;

// =========================================================================
// Types
// =========================================================================

/**
 * Configuration options for ClaudeAdapter.
 */
export interface ClaudeAdapterOptions {
  /** API key for authentication */
  apiKey?: string;
  /** Model to use (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
  /** Custom API endpoint (for proxies) */
  apiEndpoint?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Claude API message format.
 */
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentItem[];
}

/**
 * Claude API content item (for tool results).
 */
type ClaudeContentItem =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * Claude API request body.
 */
interface ClaudeRequestBody {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;
  tools?: ReturnType<typeof convertToolsToClaudeFormat>;
  stream?: boolean;
}

/**
 * Claude API error response.
 */
interface ClaudeErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// =========================================================================
// Adapter Implementation
// =========================================================================

/**
 * Claude API adapter implementing AIAssistantProviderPort.
 *
 * Provides full AI assistant capabilities with tool use support
 * via the Anthropic Claude API.
 */
export class ClaudeAdapter implements AIAssistantProviderPort {
  private apiKey: string = '';
  private model: string;
  private apiEndpoint: string;
  private timeout: number;
  private abortController: AbortController | null = null;
  private rateLimitInfo: {
    remaining: number;
    limit: number;
    resetsAt: Date;
  } | null = null;

  // Request queue for rate limiting
  private requestQueue: Array<{
    execute: () => Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private activeRequests = 0;
  private isProcessingQueue = false;

  // Token usage tracking
  private tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requestCount: number;
    lastResetAt: Date;
  } = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    lastResetAt: new Date(),
  };

  constructor(options: ClaudeAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model ?? (DEFAULT_AI_CONFIGS.claude as ClaudeConfig).defaultModel;
    this.apiEndpoint = options.apiEndpoint ?? CLAUDE_API_ENDPOINT;
    this.timeout = options.timeout ?? 120000; // 2 minutes default
  }

  // =========================================================================
  // AIAssistantProviderPort Implementation
  // =========================================================================

  /**
   * Get the provider type identifier.
   */
  getProviderType(): AIProviderType {
    return 'claude';
  }

  /**
   * Check if the adapter is available (has API key).
   */
  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  /**
   * Configure the adapter with connection settings.
   */
  async configure(config: AIProviderConnectionConfig): Promise<void> {
    if (config.provider !== 'claude') {
      throw new Error(`Invalid provider type: expected 'claude', got '${config.provider}'`);
    }

    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }

    const claudeConfig = config.config as ClaudeConfig;
    if (claudeConfig.defaultModel) {
      this.model = claudeConfig.defaultModel;
    }
    if (claudeConfig.apiEndpoint) {
      this.apiEndpoint = claudeConfig.apiEndpoint;
    }
  }

  /**
   * Send a prompt and get a complete response (non-streaming).
   */
  async prompt(request: AIAssistantRequest): Promise<Result<AIResponse, Error>> {
    if (!this.apiKey) {
      return err(new Error('Claude API key is not configured'));
    }

    const startTime = Date.now();

    try {
      const body = this.buildRequestBody(request, false);

      log.info('Sending request', { model: body.model, messageCount: body.messages.length, stream: false });

      // Use request queue and retry logic
      const aiResponse = await this.enqueueRequest(() =>
        this.executeWithRetry(
          () => this.makeRequest(body),
          async (response) => {
            if (!response.ok) {
              const errorData = await response.json() as ClaudeErrorResponse;
              throw new Error(`Claude API error: ${errorData.error?.message ?? response.statusText}`);
            }

            const data = await response.json() as ClaudeResponse;

            // Track token usage
            if (data.usage) {
              this.updateTokenUsageFromResponse(data.usage);
            }

            const aiResp = convertClaudeResponse(data, startTime);
            log.info('Request complete', { textLength: aiResp.chat.length, toolCount: aiResp.toolCalls.length, latencyMs: aiResp.meta.latencyMs });
            return aiResp;
          }
        )
      );

      return ok(aiResponse);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new Error('Request was cancelled'));
      }
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Send a prompt and stream the response.
   */
  async stream(
    request: AIAssistantRequest,
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<Result<AIResponse, Error>> {
    if (!this.apiKey) {
      return err(new Error('Claude API key is not configured'));
    }

    const startTime = Date.now();
    this.abortController = new AbortController();

    try {
      const body = this.buildRequestBody(request, true);

      log.info('Sending request', { model: body.model, messageCount: body.messages.length, stream: true });

      // Use request queue for rate limiting (but not retry for streaming)
      const aiResponse = await this.enqueueRequest(async () => {
        const response = await this.makeRequest(body);

        if (!response.ok) {
          // Handle retryable errors for initial connection
          if (RETRYABLE_STATUS_CODES.includes(response.status)) {
            const retryAfter = this.parseRetryAfter(response.headers);
            const delay = retryAfter ?? this.calculateBackoffDelay(0);

            // For streaming, we only retry the initial connection once
            log.warn(`Streaming request failed, retrying`, { status: response.status, delayMs: delay });
            await this.sleep(delay);

            const retryResponse = await this.makeRequest(body);
            if (!retryResponse.ok) {
              const errorData = await retryResponse.json() as ClaudeErrorResponse;
              throw new Error(`Claude API error: ${errorData.error?.message ?? retryResponse.statusText}`);
            }
            return this.processStreamResponse(retryResponse, startTime, onChunk);
          }

          const errorData = await response.json() as ClaudeErrorResponse;
          throw new Error(`Claude API error: ${errorData.error?.message ?? response.statusText}`);
        }

        this.updateRateLimitInfo(response.headers);
        return this.processStreamResponse(response, startTime, onChunk);
      });

      return ok(aiResponse);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new Error('Request was cancelled'));
      }
      return err(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Process a streaming response.
   */
  private async processStreamResponse(
    response: Response,
    startTime: number,
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<AIResponse> {
    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    log.info('Stream connected');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let state = createStreamingState();
    let buffer = '';
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    try {
      while (true) {
        if (this.abortController?.signal.aborted) {
          reader.cancel();
          throw new Error('Request was cancelled');
        }

        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        try {
          // Decode and process the chunk
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6); // Remove "data: " prefix
              const event = parseSSELine(data);

              if (event) {
                const result = processStreamEvent(state, event);
                state = result.state;

                if (result.chunk) {
                  onChunk(result.chunk);
                }

                // Track token usage from message_delta events
                if (event.type === 'message_delta' && event.usage) {
                  this.updateTokenUsageFromResponse(event.usage);
                }

                if (state.complete) {
                  break;
                }
              }
            }
          }

          // Reset error counter on successful chunk processing
          consecutiveErrors = 0;

          if (state.complete) {
            break;
          }
        } catch (chunkError) {
          consecutiveErrors++;
          log.warn('Error processing stream chunk', {
            attempt: consecutiveErrors,
            max: MAX_CONSECUTIVE_ERRORS,
            error: chunkError instanceof Error ? chunkError.message : String(chunkError),
          });

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error(`Stream processing failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
          }
          // Continue processing - skip malformed chunk
        }
      }
    } finally {
      reader.releaseLock();
    }

    const result = buildResponseFromState(state, startTime);
    log.info('Stream complete', { textLength: result.chat.length, toolCount: result.toolCalls.length, latencyMs: result.meta.latencyMs });
    return result;
  }

  /**
   * Cancel the current streaming request.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Estimate token count for text.
   * Uses a simple character-based estimation (Claude tokenizer is more complex).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Get the maximum context size for the current model.
   */
  getMaxContextSize(): number {
    // Claude models have different context sizes
    if (this.model.includes('claude-3-5') || this.model.includes('claude-sonnet-4') || this.model.includes('claude-opus-4')) {
      return 200000; // 200k context
    }
    if (this.model.includes('claude-3')) {
      return 200000; // 200k context
    }
    // Default for unknown models
    return 100000;
  }

  /**
   * Get available models for Claude.
   */
  async getAvailableModels(): Promise<string[]> {
    return getProviderModels('claude');
  }

  /**
   * Get current rate limit status.
   */
  async getRateLimitStatus(): Promise<{
    remaining: number;
    limit: number;
    resetsAt: Date;
  } | null> {
    return this.rateLimitInfo;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Build the Claude API request body.
   */
  private buildRequestBody(request: AIAssistantRequest, stream: boolean): ClaudeRequestBody {
    const model = request.model ?? this.model;
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = request.temperature ?? DEFAULT_TEMPERATURE;

    // Build system prompt
    const systemPrompt = request.systemPrompt ?? buildSystemPrompt(
      request.tools,
      request.context,
      { includeTools: true, includeContext: true }
    );

    // Convert conversation history to Claude format
    const messages = this.convertMessages(request.conversationHistory, request.message);

    // Build request body
    const body: ClaudeRequestBody = {
      model,
      max_tokens: maxTokens,
      messages,
      system: systemPrompt,
      temperature,
      stream,
    };

    // Add tools if available
    if (request.tools.length > 0) {
      const claudeTools = convertToolsToClaudeFormat(request.tools);
      if (claudeTools.length > 0) {
        body.tools = claudeTools;
      }
    }

    return body;
  }

  /**
   * Convert application messages to Claude message format.
   */
  private convertMessages(history: Message[], currentMessage: string): ClaudeMessage[] {
    const messages: ClaudeMessage[] = [];

    // Convert history
    for (const msg of history) {
      if (msg.role === 'system') {
        // System messages are handled via the system parameter
        continue;
      }

      if (msg.role === 'user') {
        messages.push({
          role: 'user',
          content: msg.text,
        });
      } else if (msg.role === 'assistant') {
        // Build content array for assistant messages with tool use
        const content: ClaudeContentItem[] = [];

        // Add text content
        if (msg.text) {
          content.push({ type: 'text', text: msg.text });
        }

        // Add tool use blocks
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            content.push({
              type: 'tool_use',
              id: block.toolCall.id,
              name: block.toolCall.toolId,
              input: block.toolCall.args,
            });
          }
        }

        if (content.length > 0) {
          const firstBlock = content[0];
          const assistantContent = content.length === 1 && firstBlock && firstBlock.type === 'text'
            ? firstBlock.text
            : content;
          messages.push({
            role: 'assistant',
            content: assistantContent,
          });
        }

        // Add tool results as user messages (Claude's format)
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            messages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: block.toolCallId,
                content: typeof block.result === 'string'
                  ? block.result
                  : JSON.stringify(block.result),
                is_error: block.isError,
              }],
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: currentMessage,
    });

    return messages;
  }

  /**
   * Make the HTTP request to Claude API.
   */
  private async makeRequest(body: ClaudeRequestBody): Promise<Response> {
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, this.timeout);

    try {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      };

      // Only add signal if abortController exists
      if (this.abortController) {
        fetchOptions.signal = this.abortController.signal;
      }

      return await fetch(this.apiEndpoint, fetchOptions);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update rate limit info from response headers.
   */
  private updateRateLimitInfo(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-limit-requests');
    const limit = headers.get('x-ratelimit-remaining-requests');
    const resetTime = headers.get('x-ratelimit-reset-requests');

    if (remaining && limit) {
      this.rateLimitInfo = {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        resetsAt: resetTime ? new Date(resetTime) : new Date(Date.now() + 60000),
      };
    }
  }

  // =========================================================================
  // Public Configuration Methods
  // =========================================================================

  /**
   * Set the API key.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Set the model to use.
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Set the API endpoint (for proxies).
   */
  setApiEndpoint(endpoint: string): void {
    this.apiEndpoint = endpoint;
  }

  /**
   * Set the request timeout.
   */
  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  /**
   * Get the current model.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Check if API key is configured.
   */
  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Get current token usage statistics.
   */
  getTokenUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requestCount: number;
    lastResetAt: Date;
  } {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage statistics.
   */
  resetTokenUsage(): void {
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastResetAt: new Date(),
    };
  }

  // =========================================================================
  // Request Queue Management
  // =========================================================================

  /**
   * Add a request to the queue and wait for it to be processed.
   */
  private async enqueueRequest<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        execute: async () => {
          try {
            const result = await execute();
            resolve(result);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        resolve: () => {},
        reject,
      });
      this.processQueue();
    });
  }

  /**
   * Process queued requests respecting concurrency limits.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0 && this.activeRequests < MAX_CONCURRENT_REQUESTS) {
      const item = this.requestQueue.shift();
      if (!item) continue;

      this.activeRequests++;
      item.execute().finally(() => {
        this.activeRequests--;
        this.processQueue();
      });
    }

    this.isProcessingQueue = false;
  }

  // =========================================================================
  // Retry Logic
  // =========================================================================

  /**
   * Execute a request with retry logic for transient errors.
   */
  private async executeWithRetry<T>(
    operation: () => Promise<Response>,
    processResponse: (response: Response) => Promise<T>,
    maxRetries: number = MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const response = await operation();

        // Check if we should retry based on status code
        if (RETRYABLE_STATUS_CODES.includes(response.status)) {
          const retryAfter = this.parseRetryAfter(response.headers);
          const delay = retryAfter ?? this.calculateBackoffDelay(retryCount);

          if (retryCount < maxRetries) {
            log.warn('Request failed, retrying', { status: response.status, delayMs: delay, attempt: retryCount + 1, maxRetries });
            await this.sleep(delay);
            retryCount++;
            continue;
          }
        }

        // Update rate limit info from successful response
        this.updateRateLimitInfo(response.headers);

        // Process the response
        return await processResponse(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on abort
        if (lastError.name === 'AbortError') {
          throw lastError;
        }

        // Retry on network errors
        if (retryCount < maxRetries) {
          const delay = this.calculateBackoffDelay(retryCount);
          log.warn('Request error, retrying', { error: lastError.message, delayMs: delay, attempt: retryCount + 1, maxRetries });
          await this.sleep(delay);
          retryCount++;
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * Calculate exponential backoff delay with jitter.
   */
  private calculateBackoffDelay(retryCount: number): number {
    const exponentialDelay = BASE_RETRY_DELAY * Math.pow(2, retryCount);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY);
  }

  /**
   * Parse Retry-After header from response.
   */
  private parseRetryAfter(headers: Headers): number | null {
    const retryAfter = headers.get('retry-after');
    if (!retryAfter) return null;

    // Check if it's a number (seconds)
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }

    // Check if it's a date
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }

    return null;
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // =========================================================================
  // Token Usage Tracking
  // =========================================================================

  /**
   * Update token usage from API response.
   */
  private updateTokenUsageFromResponse(usage: { input_tokens?: number; output_tokens?: number }): void {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    this.tokenUsage.inputTokens += inputTokens;
    this.tokenUsage.outputTokens += outputTokens;
    this.tokenUsage.totalTokens += inputTokens + outputTokens;
    this.tokenUsage.requestCount++;
  }
}
