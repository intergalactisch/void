/**
 * AIRewriteServiceImpl - Implementation of AIRewriteService
 *
 * This service orchestrates AI text operations, managing state and
 * coordinating between the editor (for selection) and AI provider
 * (for text transformation).
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { AIRewriteService, AIRewriteState } from '$lib/ports/inbound';
import type { AIProviderPort, EditorPort, AIOperation } from '$lib/ports/outbound';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';

/**
 * Initial state for AI rewrite operations.
 */
const INITIAL_STATE: AIRewriteState = {
  isProcessing: false,
  operation: null,
  processingBlockId: null,
  processingRange: null,
  originalText: null,
  streamingText: '',
  error: null,
};

/**
 * Implementation of AIRewriteService.
 *
 * Handles:
 * - Getting selection from editor
 * - Calling AI provider for text operations
 * - Managing processing state
 * - Accept/reject result handling
 * - State subscriptions for UI reactivity
 */
export class AIRewriteServiceImpl implements AIRewriteService {
  private state: AIRewriteState = { ...INITIAL_STATE };
  private subscribers: Set<(state: AIRewriteState) => void> = new Set();
  private aiProvider: AIProviderPort;
  private editorPort: EditorPort | null = null;
  private resultText: string = '';

  constructor(aiProvider: AIProviderPort) {
    this.aiProvider = aiProvider;
  }

  /**
   * Set the editor port reference.
   * Required for getting selection and applying results.
   */
  setEditorPort(editorPort: EditorPort): void {
    this.editorPort = editorPort;
  }

  /**
   * Get current AI state.
   */
  getState(): AIRewriteState {
    return { ...this.state };
  }

  /**
   * Check if AI is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.aiProvider.isAvailable();
  }

  /**
   * Rewrite selected text.
   */
  async rewriteSelection(instruction?: string): Promise<Result<string, Error>> {
    return this.executeOperation('rewrite', instruction);
  }

  /**
   * Expand selected text.
   */
  async expandSelection(): Promise<Result<string, Error>> {
    return this.executeOperation('expand');
  }

  /**
   * Summarize selected text.
   */
  async summarizeSelection(): Promise<Result<string, Error>> {
    return this.executeOperation('summarize');
  }

  /**
   * Fix grammar in selection.
   */
  async fixGrammarInSelection(): Promise<Result<string, Error>> {
    return this.executeOperation('fix-grammar');
  }

  /**
   * Custom operation on selection.
   */
  async customOperation(instruction: string): Promise<Result<string, Error>> {
    return this.executeOperation('custom', instruction);
  }

  /**
   * Accept the AI result and apply to document.
   */
  acceptResult(): void {
    if (!this.editorPort || !this.state.processingRange || !this.resultText) {
      this.resetState();
      return;
    }

    // The result has already been applied during processing
    // Just reset state to complete the operation
    this.resetState();
  }

  /**
   * Reject the AI result and restore original.
   */
  rejectResult(): void {
    if (!this.editorPort || !this.state.processingRange || !this.state.originalText) {
      this.resetState();
      return;
    }

    // Note: In a full implementation, we would restore the original text
    // by using the editor's undo functionality or replacing the text
    // For now, we just reset state
    this.resetState();
  }

  /**
   * Cancel ongoing operation.
   */
  cancel(): void {
    // If the AI provider supports cancellation, call it
    if ('cancel' in this.aiProvider && typeof this.aiProvider.cancel === 'function') {
      (this.aiProvider as { cancel: () => void }).cancel();
    }

    this.resetState();
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: (state: AIRewriteState) => void): () => void {
    this.subscribers.add(callback);

    // Immediately call with current state
    callback(this.getState());

    return () => {
      this.subscribers.delete(callback);
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Execute an AI operation on the current selection.
   */
  private async executeOperation(
    operation: AIOperation,
    instruction?: string
  ): Promise<Result<string, Error>> {
    // Get selection from editor
    if (!this.editorPort) {
      return err(new Error('Editor not connected'));
    }

    const selection = this.editorPort.getSelection();

    if (selection.from === selection.to || !selection.text) {
      return err(new Error('No text selected'));
    }

    // Check if AI is available
    const available = await this.aiProvider.isAvailable();
    if (!available) {
      return err(new Error('AI provider is not available'));
    }

    // Update state to processing
    this.updateState({
      isProcessing: true,
      operation,
      processingBlockId: selection.anchorBlockId,
      processingRange: { from: selection.from, to: selection.to },
      originalText: selection.text,
      streamingText: '',
      error: null,
    });

    try {
      // Execute the operation
      let result: Result<string, Error>;

      switch (operation) {
        case 'rewrite':
          const rewriteResult = await this.aiProvider.rewrite({
            text: selection.text,
            instruction: instruction ?? 'improve clarity and readability',
          });
          result = rewriteResult.ok ? ok(rewriteResult.value.text) : rewriteResult;
          break;

        case 'expand':
          result = await this.aiProvider.expand(selection.text);
          break;

        case 'summarize':
          result = await this.aiProvider.summarize(selection.text);
          break;

        case 'fix-grammar':
          result = await this.aiProvider.fixGrammar(selection.text);
          break;

        case 'custom':
          result = await this.aiProvider.custom('custom', selection.text, instruction);
          break;

        default:
          result = err(new Error(`Unknown operation: ${operation}`));
      }

      if (!result.ok) {
        this.updateState({
          isProcessing: false,
          error: result.error,
        });
        return result;
      }

      // Store the result
      this.resultText = result.value;

      // Update state with result
      this.updateState({
        isProcessing: false,
        streamingText: result.value,
      });

      return result;
    } catch (error) {
      const err_ = error instanceof Error ? error : new Error(String(error));
      this.updateState({
        isProcessing: false,
        error: err_,
      });
      return err(err_);
    }
  }

  /**
   * Update state and notify subscribers.
   */
  private updateState(partial: Partial<AIRewriteState>): void {
    this.state = { ...this.state, ...partial };
    this.notifySubscribers();
  }

  /**
   * Reset state to initial.
   */
  private resetState(): void {
    this.state = { ...INITIAL_STATE };
    this.resultText = '';
    this.notifySubscribers();
  }

  /**
   * Notify all subscribers of state change.
   */
  private notifySubscribers(): void {
    const state = this.getState();
    this.subscribers.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in AIRewriteService subscriber:', error);
      }
    });
  }
}
