/**
 * MockAIAdapter - Mock implementation of AIProviderPort
 *
 * This adapter provides fake AI responses for testing and development.
 * It simulates network delay and returns predictable transformed text.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import type {
  AIProviderPort,
  AIRewriteRequest,
  AIRewriteResponse,
  AIOperation,
} from '$lib/ports/outbound';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';

/**
 * Configuration options for MockAIAdapter.
 */
export interface MockAIAdapterOptions {
  /** Simulated delay in milliseconds (default: 1000) */
  delay?: number;
  /** Whether to simulate being unavailable (default: false) */
  simulateUnavailable?: boolean;
  /** Whether to simulate errors (default: false) */
  simulateError?: boolean;
  /** Custom error message when simulating errors */
  errorMessage?: string;
}

/**
 * Mock AI adapter for testing without real AI API calls.
 *
 * Returns predictable responses:
 * - rewrite: "Rewritten: {text}"
 * - expand: "{text}\n\nAdditionally, this topic has many interesting aspects..."
 * - summarize: "Summary: {first 50 chars}..."
 * - fixGrammar: Capitalizes first letter and adds period
 */
export class MockAIAdapter implements AIProviderPort {
  private options: Required<MockAIAdapterOptions>;
  private abortController: AbortController | null = null;

  constructor(options: MockAIAdapterOptions = {}) {
    this.options = {
      delay: options.delay ?? 1000,
      simulateUnavailable: options.simulateUnavailable ?? false,
      simulateError: options.simulateError ?? false,
      errorMessage: options.errorMessage ?? 'Simulated AI error',
    };
  }

  /**
   * Check if provider is available.
   * Returns false if simulateUnavailable is true.
   */
  async isAvailable(): Promise<boolean> {
    await this.simulateDelay(100);
    return !this.options.simulateUnavailable;
  }

  /**
   * Rewrite text with AI (mocked).
   * Returns "Rewritten: {instruction applied to text}"
   */
  async rewrite(request: AIRewriteRequest): Promise<Result<AIRewriteResponse, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    await this.simulateDelay();

    const rewritten = this.applyRewriteInstruction(request.text, request.instruction);

    return ok({
      text: rewritten,
      confidence: 0.85,
    });
  }

  /**
   * Expand text with more detail (mocked).
   * Adds elaboration paragraph after the original text.
   */
  async expand(text: string, context?: string): Promise<Result<string, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    await this.simulateDelay();

    const expansion = `${text}

Additionally, this topic has many interesting aspects worth exploring. The context provided helps understand the nuances better. There are several key points to consider when examining this further, including the historical background, current implications, and future possibilities.`;

    return ok(expansion);
  }

  /**
   * Summarize text (mocked).
   * Returns first 50 characters with "Summary:" prefix.
   */
  async summarize(text: string): Promise<Result<string, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    await this.simulateDelay();

    // Create a simple summary by taking key words
    const words = text.split(/\s+/).filter((w) => w.length > 3);
    const keyWords = words.slice(0, Math.min(10, words.length));
    const summary = keyWords.length > 0
      ? `Summary: ${keyWords.join(' ')}...`
      : 'Summary: (content too brief to summarize)';

    return ok(summary);
  }

  /**
   * Fix grammar and spelling (mocked).
   * Capitalizes first letter, trims whitespace, ensures ending punctuation.
   */
  async fixGrammar(text: string): Promise<Result<string, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    await this.simulateDelay();

    let fixed = text.trim();

    // Capitalize first letter
    if (fixed.length > 0) {
      fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }

    // Ensure ending punctuation
    if (fixed.length > 0 && !/[.!?]$/.test(fixed)) {
      fixed = fixed + '.';
    }

    // Fix common typos (mock)
    fixed = fixed
      .replace(/\bteh\b/gi, 'the')
      .replace(/\brecieve\b/gi, 'receive')
      .replace(/\boccured\b/gi, 'occurred');

    return ok(fixed);
  }

  /**
   * Custom AI operation (mocked).
   * Returns text prefixed with the operation name.
   */
  async custom(
    operation: string,
    text: string,
    instruction?: string
  ): Promise<Result<string, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    await this.simulateDelay();

    const processed = instruction
      ? `[${operation}: ${instruction}] ${text}`
      : `[${operation}] ${text}`;

    return ok(processed);
  }

  /**
   * Stream response for long operations (mocked).
   * Sends chunks of the result with delays between them.
   */
  async stream(
    operation: AIOperation,
    text: string,
    onChunk: (chunk: string) => void
  ): Promise<Result<void, Error>> {
    if (this.options.simulateError) {
      await this.simulateDelay(500);
      return err(new Error(this.options.errorMessage));
    }

    this.abortController = new AbortController();

    try {
      // Generate the full response first
      let fullResponse: string;

      switch (operation) {
        case 'rewrite':
          fullResponse = `Rewritten: ${text}`;
          break;
        case 'expand':
          fullResponse = `${text}\n\nExpanded content with additional details.`;
          break;
        case 'summarize':
          fullResponse = `Summary: ${text.slice(0, 50)}...`;
          break;
        case 'fix-grammar':
          fullResponse = text.charAt(0).toUpperCase() + text.slice(1);
          break;
        default:
          fullResponse = `[${operation}] ${text}`;
      }

      // Stream the response in chunks
      const words = fullResponse.split(' ');
      const chunkSize = 3; // Words per chunk

      for (let i = 0; i < words.length; i += chunkSize) {
        if (this.abortController?.signal.aborted) {
          return err(new Error('Operation cancelled'));
        }

        const chunk = words.slice(i, i + chunkSize).join(' ');
        onChunk(chunk + (i + chunkSize < words.length ? ' ' : ''));

        // Simulate streaming delay
        await this.simulateDelay(100);
      }

      return ok(undefined);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel any ongoing streaming operation.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Update adapter options.
   */
  setOptions(options: Partial<MockAIAdapterOptions>): void {
    this.options = { ...this.options, ...options };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Simulate network delay.
   */
  private simulateDelay(overrideMs?: number): Promise<void> {
    const delay = overrideMs ?? this.options.delay;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Apply rewrite instruction to text (mock transformation).
   */
  private applyRewriteInstruction(text: string, instruction: string): string {
    const normalizedInstruction = instruction.toLowerCase();

    if (normalizedInstruction.includes('formal')) {
      return `Rewritten (formal): ${text.replace(/don't/gi, 'do not').replace(/can't/gi, 'cannot')}`;
    }

    if (normalizedInstruction.includes('casual') || normalizedInstruction.includes('informal')) {
      return `Rewritten (casual): Hey, so basically ${text.toLowerCase()}`;
    }

    if (normalizedInstruction.includes('shorter') || normalizedInstruction.includes('concise')) {
      const words = text.split(/\s+/);
      const shortened = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      return `Rewritten (concise): ${shortened}...`;
    }

    if (normalizedInstruction.includes('longer') || normalizedInstruction.includes('elaborate')) {
      return `Rewritten (elaborated): ${text} Furthermore, this is an important point that deserves additional consideration and analysis.`;
    }

    // Default rewrite
    return `Rewritten: ${text}`;
  }
}
