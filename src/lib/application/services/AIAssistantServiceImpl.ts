/**
 * AIAssistantServiceImpl - Implementation of AIAssistantService
 *
 * This is the main service for AI assistant interactions. It orchestrates:
 * - Conversations (create, manage, persist in-memory)
 * - Context gathering (from ContextProviderPort)
 * - Tool management (from ToolRegistryService)
 * - AI provider calls (via AIAssistantProviderPort)
 * - Tool execution (via ToolExecutorPort)
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { Result } from '$lib/core';
import { ok, err, toError } from '$lib/core';
import type {
  AIAssistantService,
  PromptOptions,
  AIInteractionState,
} from '$lib/ports/inbound/AIAssistantService';
import type { ReferenceService } from '$lib/ports/inbound/ReferenceService';
import type { ToolRegistryService } from '$lib/ports/inbound/ToolRegistryService';
import type {
  AIAssistantProviderPort,
  AIAssistantRequest,
} from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ToolExecutorPort } from '$lib/ports/outbound/ToolExecutorPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import type { IndexService, RelatedContext } from '$lib/ports/inbound/IndexService';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { isDocumentBound } from '$lib/domain/entities/Conversation';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';
import { isAIEvent } from '$lib/domain/values/ProvenanceEvent';
import {
  addMessage,
  updateMessage,
} from '$lib/domain/entities/Conversation';
import {
  createUserMessage,
  createAssistantMessage,
  createMessageFromResponse,
  appendText,
  upsertActivity,
  finishRunningActivity,
  finishStreaming,
} from '$lib/domain/entities/Message';
import type { Message } from '$lib/domain/entities/Message';
import { ConversationStore } from './ConversationStore';
import type { ToolInvocationService } from './ToolInvocationService';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { Tool } from '$lib/domain/entities/Tool';
import { formatToolForAI } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { AIResponse, AIResponseChunk, AIStatusUpdate, ToolCall } from '$lib/domain/values/AIResponse';
import { createEmptyResponse } from '$lib/domain/values/AIResponse';
import { serializeContext } from '$lib/domain/values/PromptContext';
import type { ResolvedPromptReference } from '$lib/domain/values/PromptContext';
import { events } from '$lib/events';
import { getLogger } from '$lib/logging';

const log = getLogger('AIAssistant');

/**
 * Initial state for AI interactions.
 */
const INITIAL_STATE: AIInteractionState = {
  isProcessing: false,
  isStreaming: false,
  streamingText: '',
  executingTools: [],
  error: null,
  progress: 0,
  currentConversation: null,
  relatedContextCount: 0,
};

/**
 * Implementation of AIAssistantService.
 *
 * Handles the full AI assistant workflow including context gathering,
 * conversation management, prompt handling, and tool execution.
 *
 * @example
 * ```typescript
 * const service = new AIAssistantServiceImpl(
 *   aiProviderPort,
 *   toolRegistryService,
 *   toolExecutorPort,
 *   contextProviderPort
 * );
 *
 * // Simple prompt
 * const result = await service.prompt('Create a new note about TypeScript');
 *
 * // Streaming prompt
 * const result = await service.streamPrompt(
 *   'Help me organize my notes',
 *   (chunk) => console.log(chunk.chatDelta),
 *   { autoExecuteTools: true }
 * );
 *
 * // Execute tool calls manually
 * if (result.ok && result.value.toolCalls.length > 0) {
 *   const invocations = await service.executeToolCalls(
 *     result.value.toolCalls,
 *     conversationId
 *   );
 * }
 * ```
 */
export class AIAssistantServiceImpl implements AIAssistantService {
  private readonly aiProvider: AIAssistantProviderPort;
  private readonly toolRegistry: ToolRegistryService;
  private readonly toolExecutor: ToolExecutorPort;
  private readonly contextProvider: ContextProviderPort;
  private readonly provenanceService: ProvenanceService | null;
  private readonly indexService: IndexService | null;
  /** All conversation lifecycle + persistence is delegated here. */
  private readonly conversationStore: ConversationStore;
  /**
   * Tool-call execution / confirmation lifecycle. The host registers
   * callbacks so the service can attach invocations to messages and
   * push the executingTools list back to the UI without depending on
   * Conversation or AIInteractionState.
   */
  private readonly toolInvocationService: ToolInvocationService;

  private state: AIInteractionState = { ...INITIAL_STATE };
  private stateSubscribers: Set<(state: AIInteractionState) => void> = new Set();

  constructor(
    aiProvider: AIAssistantProviderPort,
    toolRegistry: ToolRegistryService,
    toolExecutor: ToolExecutorPort,
    contextProvider: ContextProviderPort,
    conversationStore: ConversationStore,
    toolInvocationService: ToolInvocationService,
    provenanceService?: ProvenanceService | null,
    indexService?: IndexService | null,
    private readonly referenceService?: ReferenceService | null
  ) {
    this.aiProvider = aiProvider;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;
    this.contextProvider = contextProvider;
    this.conversationStore = conversationStore;
    this.toolInvocationService = toolInvocationService;
    this.provenanceService = provenanceService ?? null;
    this.indexService = indexService ?? null;
  }

  /**
   * Public hook so ToolInvocationService can refresh the host's
   * executingTools list. Mirrors the existing `notifyStateSubscribers`
   * public escape hatch used by ConversationStore.
   */
  setExecutingTools(executing: ToolInvocation[]): void {
    this.updateState({ executingTools: executing });
  }

  // =========================================================================
  // Prompt methods
  // =========================================================================

  async prompt(message: string, options?: PromptOptions): Promise<Result<AIResponse, Error>> {
    // Get or create conversation
    const conversationOptions =
      options?.documentPath !== undefined
        ? { documentPath: options.documentPath }
        : undefined;
    const conversation = await this.getConversation(options?.conversationId, conversationOptions);
    const conversationId = conversation.id;

    // Update state
    this.updateState({
      isProcessing: true,
      error: null,
      progress: 0,
    });

    try {
      // Build request BEFORE adding messages (history must not include current turn)
      const request = await this.buildRequest(message, conversationId, options);

      // Add the user-facing message only when this turn belongs in chat.
      if (options?.displayMessage !== null) {
        const userMessageParams: NonNullable<Parameters<typeof createUserMessage>[1]> = {};
        if (options?.clientTurnId !== undefined) {
          userMessageParams.clientTurnId = options.clientTurnId;
        }
        const userMessage = createUserMessage(options?.displayMessage ?? message, userMessageParams);
        this.updateConversation(conversationId, (conv) => addMessage(conv, userMessage));
      }

      log.info('Prompt started', { conversationId, messageLength: message.length });

      // Call AI provider
      const result = await this.aiProvider.prompt(request);

      if (!result.ok) {
        log.error('Prompt failed', { conversationId, error: result.error.message });
        this.updateState({
          isProcessing: false,
          error: result.error,
        });
        return result;
      }

      // Process response
      const response = result.value;
      const allowedError = this.validateAllowedToolCalls(response, options?.allowedToolIds);
      if (allowedError) {
        this.updateState({
          isProcessing: false,
          error: allowedError,
        });
        return err(allowedError);
      }

      log.info('Prompt completed', {
        conversationId,
        chat: response.chat.slice(0, 200),
        toolCalls: response.toolCalls.map(tc => ({ toolId: tc.toolId, args: tc.args })),
        tokens: response.meta.usage,
        latencyMs: response.meta.latencyMs,
      });

      // Create assistant message from response unless this is an internal run turn.
      if (options?.persistAssistantMessage !== false) {
        const assistantMessage = createMessageFromResponse(response);
        this.updateConversation(conversationId, (conv) => addMessage(conv, assistantMessage));
      }

      // Emit event
      events.emit('ai:response', {
        conversationId,
        response,
      });

      // Auto-execute tools if enabled
      if (options?.autoExecuteTools && response.toolCalls.length > 0) {
        await this.executeToolCalls(response.toolCalls, conversationId);
      }

      this.updateState({
        isProcessing: false,
        progress: 100,
      });

      return ok(response);
    } catch (error) {
      const err1 = error instanceof Error ? error : new Error(String(error));
      log.error('Prompt exception', { conversationId, error: err1.message });
      this.updateState({
        isProcessing: false,
        error: err1,
      });
      return err(err1);
    }
  }

  async streamPrompt(
    message: string,
    onChunk: (chunk: AIResponseChunk) => void,
    options?: PromptOptions
  ): Promise<Result<AIResponse, Error>> {
    // Get or create conversation
    const conversationOptions =
      options?.documentPath !== undefined
        ? { documentPath: options.documentPath }
        : undefined;
    const conversation = await this.getConversation(options?.conversationId, conversationOptions);
    const conversationId = conversation.id;

    // Update state
    this.updateState({
      isProcessing: true,
      isStreaming: true,
      streamingText: '',
      error: null,
      progress: 0,
    });

    try {
      // Build request BEFORE adding messages (history must not include current turn)
      const request = await this.buildRequest(message, conversationId, options);

      // Add visible chat messages only when this turn belongs in the transcript.
      if (options?.displayMessage !== null) {
        const userMessageParams: NonNullable<Parameters<typeof createUserMessage>[1]> = {};
        if (options?.clientTurnId !== undefined) {
          userMessageParams.clientTurnId = options.clientTurnId;
        }
        const userMessage = createUserMessage(options?.displayMessage ?? message, userMessageParams);
        this.updateConversation(conversationId, (conv) => addMessage(conv, userMessage));
      }

      let assistantMessage =
        options?.persistAssistantMessage === false
          ? null
          : createAssistantMessage({ isStreaming: true });
      if (assistantMessage) {
        this.updateConversation(conversationId, (conv) => addMessage(conv, assistantMessage!));
      }

      log.info('Stream prompt started', { conversationId, messageLength: message.length });

      // Build response incrementally
      let response = createEmptyResponse(
        this.aiProvider.getProviderType(),
        options?.model ?? 'default'
      );

      // Call AI provider with streaming
      const result = await this.aiProvider.stream(request, (chunk) => {
        // Update streaming text for UI
        if (chunk.type === 'chat' && chunk.chatDelta) {
          this.updateState({
            streamingText: this.state.streamingText + chunk.chatDelta,
          });

          // Update assistant message if this streaming turn is visible.
          if (assistantMessage) {
            assistantMessage = appendText(assistantMessage, chunk.chatDelta);
            this.updateConversation(conversationId, (conv) =>
              updateMessage(conv, assistantMessage!.id, () => assistantMessage!)
            );
          }
        }

        if (chunk.type === 'status' && chunk.status && assistantMessage) {
          assistantMessage = upsertActivity(assistantMessage, chunk.status);
          this.updateConversation(conversationId, (conv) =>
            updateMessage(conv, assistantMessage!.id, () => assistantMessage!)
          );
        }

        // Forward chunk to caller
        onChunk(chunk);
      });

      if (!result.ok) {
        log.error('Stream prompt failed', { conversationId, error: result.error.message });
        // Mark message as finished even on error
        if (assistantMessage) {
          assistantMessage = finishRunningActivity(assistantMessage, 'failed');
          assistantMessage = finishStreaming(assistantMessage);
          this.updateConversation(conversationId, (conv) =>
            updateMessage(conv, assistantMessage!.id, () => assistantMessage!)
          );
        }

        this.updateState({
          isProcessing: false,
          isStreaming: false,
          error: result.error,
        });
        return result;
      }

      response = result.value;
      const allowedError = this.validateAllowedToolCalls(response, options?.allowedToolIds);
      if (allowedError) {
        this.updateState({
          isProcessing: false,
          isStreaming: false,
          error: allowedError,
        });
        return err(allowedError);
      }

      log.info('Stream prompt completed', {
        conversationId,
        chat: response.chat.slice(0, 200),
        toolCalls: response.toolCalls.map(tc => ({ toolId: tc.toolId, args: tc.args })),
        tokens: response.meta.usage,
        latencyMs: response.meta.latencyMs,
      });

      // Finalize assistant message
      if (assistantMessage) {
        assistantMessage = finishStreaming(assistantMessage);
        this.updateConversation(conversationId, (conv) =>
          updateMessage(conv, assistantMessage!.id, () => assistantMessage!)
        );
      }

      // Emit event
      events.emit('ai:response', {
        conversationId,
        response,
      });

      // Auto-execute tools if enabled
      if (options?.autoExecuteTools && response.toolCalls.length > 0) {
        await this.executeToolCalls(response.toolCalls, conversationId);
      }

      this.updateState({
        isProcessing: false,
        isStreaming: false,
        streamingText: '',
        progress: 100,
      });

      // Flush any pending persistence immediately when streaming completes
      this.flushPersistence(conversationId);

      return ok(response);
    } catch (error) {
      const err1 = error instanceof Error ? error : new Error(String(error));
      log.error('Stream prompt exception', { conversationId, error: err1.message });
      this.updateState({
        isProcessing: false,
        isStreaming: false,
        error: err1,
      });

      // Flush persistence on error too to save partial responses
      this.flushPersistence(conversationId);

      return err(err1);
    }
  }

  cancel(): void {
    this.aiProvider.cancel();
    this.toolExecutor.cancelAll();

    this.updateState({
      isProcessing: false,
      isStreaming: false,
      streamingText: '',
      executingTools: [],
    });
  }

  dispose(): void {
    this.toolInvocationService.dispose?.();
  }

  // =========================================================================
  // Conversation methods — thin delegations to ConversationStore.
  // =========================================================================

  async getConversation(
    conversationId?: string,
    options?: { documentPath?: string | null }
  ): Promise<Conversation> {
    return this.conversationStore.getOrCreate(conversationId, options);
  }

  async createNewConversation(options?: { documentPath?: string | null }): Promise<Conversation> {
    return this.conversationStore.create(options);
  }

  async listConversations(): Promise<Conversation[]> {
    return this.conversationStore.list();
  }

  async clearConversation(conversationId: string): Promise<void> {
    return this.conversationStore.clear(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return this.conversationStore.delete(conversationId);
  }

  getCurrentConversation(): Conversation | null {
    return this.conversationStore.getCurrent();
  }

  async setCurrentConversation(conversationId: string): Promise<void> {
    return this.conversationStore.setCurrent(conversationId);
  }

  // =========================================================================
  // Tool execution methods — delegate to ToolInvocationService.
  // =========================================================================

  async executeToolCalls(
    toolCalls: AIResponse['toolCalls'],
    conversationId: string
  ): Promise<ToolInvocation[]> {
    // The service stays free of Conversation by accepting the resolved
    // assistant-message id. AIAssistant looks it up here once.
    const conversation = this.conversationStore.get(conversationId);
    const lastAssistantMessageId =
      conversation?.messages
        .slice()
        .reverse()
        .find((m) => m.role === 'assistant')?.id ?? null;

    return this.toolInvocationService.executeToolCalls(
      toolCalls,
      conversationId,
      lastAssistantMessageId,
    );
  }

  async confirmToolExecution(invocationId: string): Promise<void> {
    return this.toolInvocationService.confirmToolExecution(invocationId);
  }

  async rejectToolExecution(invocationId: string, reason: string): Promise<void> {
    return this.toolInvocationService.rejectToolExecution(invocationId, reason);
  }

  // =========================================================================
  // State methods
  // =========================================================================

  getState(): AIInteractionState {
    return {
      ...this.state,
      currentConversation: this.getCurrentConversation(),
      relatedContextCount: this._lastRelatedContextCount,
    };
  }

  subscribe(callback: (state: AIInteractionState) => void): () => void {
    this.stateSubscribers.add(callback);
    // Immediately call with current state
    callback(this.getState());
    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  // =========================================================================
  // Configuration methods
  // =========================================================================

  async isAvailable(): Promise<boolean> {
    return this.aiProvider.isAvailable();
  }

  getProvider(): string | null {
    return this.aiProvider.getProviderType();
  }

  getModel(): string | null {
    // Could be enhanced to track current model from last request
    return null;
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Build an AI request from the current state.
   */
  private async buildRequest(
    message: string,
    conversationId: string,
    options?: PromptOptions
  ): Promise<AIAssistantRequest> {
    // Get context
    let context = options?.context ?? (await this.contextProvider.getContext());
    if (this.referenceService) {
      const references = await this.referenceService.resolvePrompt(message);
      if (references.ok && references.value.length > 0) {
        context = {
          ...context,
          references: mergeReferences(context.references, references.value),
        };
      }
    }

    // Get tools
    const allTools = await this.toolRegistry.getAll(true);
    const allowedToolIds = options?.allowedToolIds
      ? new Set<ToolId>(options.allowedToolIds)
      : null;
    const tools = allowedToolIds
      ? allTools.filter((tool) => allowedToolIds.has(tool.id))
      : allTools;

    // Get conversation history
    const conversation = this.conversationStore.get(conversationId);
    const history = (conversation?.messages ?? []).filter(
      (historyMessage) => historyMessage.visibility !== 'internal'
    );

    // Build system prompt with tools
    const toolsPrompt = buildToolsSystemPrompt(tools);
    const contextPrompt = serializeContext(context);

    const notesBasePath = this.contextProvider.getNotesBasePath();

    // Load artifact memory for document-bound conversations
    const artifactMemory = await this.loadArtifactMemory(conversation ?? null);

    // Load related knowledge graph context
    const relatedKnowledge = await this.loadRelatedContext(conversation ?? null, message);

    // Track related context count for UI
    this._lastRelatedContextCount = relatedKnowledge.count;

    const defaultSystemPrompt = `You are a helpful AI assistant integrated into a note-taking application.

## Current Context
${contextPrompt}
Notes Folder: ${notesBasePath}
${artifactMemory}${relatedKnowledge.section}
${toolsPrompt}

When the user asks you to perform actions, use the appropriate tools.
Only interact with notes inside the configured notes folder.
Respond conversationally while being helpful and concise.`;

    const systemPrompt =
      options?.model !== undefined
        ? undefined
        : options?.systemPrompt ?? defaultSystemPrompt;

    log.debug('AI request built', {
      toolCount: tools.length,
      historyLength: history.length,
      relatedNotes: relatedKnowledge.count,
    });

    const request: AIAssistantRequest = {
      message,
      context,
      tools,
      conversationHistory: history,
    };

    if (systemPrompt !== undefined) {
      request.systemPrompt = systemPrompt;
    }

    if (options?.model !== undefined) {
      request.model = options.model;
    }

    if (options?.webAccess !== undefined) {
      request.webAccess = options.webAccess;
    }

    return request;
  }

  /** Last related context count, exposed for the store */
  private _lastRelatedContextCount = 0;

  private validateAllowedToolCalls(
    response: AIResponse,
    allowedToolIds?: ToolId[]
  ): Error | null {
    if (!allowedToolIds) return null;

    const allowed = new Set<ToolId>(allowedToolIds);
    const disallowed = response.toolCalls.filter((toolCall) => !allowed.has(toolCall.toolId));
    if (disallowed.length === 0) return null;

    return new Error(
      `AI attempted disallowed tool call(s): ${disallowed.map((toolCall) => toolCall.toolId).join(', ')}`
    );
  }

  /** Get how many related notes were included in the last prompt's context */
  getLastRelatedContextCount(): number {
    return this._lastRelatedContextCount;
  }

  /**
   * Load related context from the knowledge graph.
   * Queries IndexService for notes related to the current document.
   */
  private async loadRelatedContext(
    conversation: Conversation | null,
    userMessage: string
  ): Promise<{ section: string; count: number }> {
    if (!this.indexService) return { section: '', count: 0 };

    // Determine the note to find related context for
    let noteName: string | null = null;

    if (conversation && isDocumentBound(conversation) && conversation.documentPath) {
      noteName = noteNameFromPath(conversation.documentPath);
    }

    if (!noteName) return { section: '', count: 0 };

    try {
      const result = await this.indexService.getRelatedContext(noteName, 5);
      if (!result.ok || result.value.length === 0) {
        return { section: '', count: 0 };
      }

      const contexts = result.value;
      const lines: string[] = [];
      let totalChars = 0;
      const maxChars = 2000; // ~500 tokens budget

      for (const ctx of contexts) {
        if (totalChars >= maxChars) break;

        const entry = ctx.excerpt
          ? `- **${ctx.title}** (${ctx.concepts.join(', ')}): ${ctx.excerpt}`
          : `- **${ctx.title}** (${ctx.concepts.join(', ')})`;

        totalChars += entry.length;
        if (totalChars <= maxChars) {
          lines.push(entry);
        }
      }

      if (lines.length === 0) return { section: '', count: 0 };

      const section = `\n## Related Knowledge\nYour vault contains notes related to the current document:\n${lines.join('\n')}\n\nUse this context to provide richer, more connected answers. Reference related notes when relevant.\n`;

      return { section, count: lines.length };
    } catch (e) {
      log.warn('Failed to load related context', { error: String(e) });
      return { section: '', count: 0 };
    }
  }

  /**
   * Load artifact memory for a conversation.
   * For document-bound conversations, reads provenance history
   * to give the AI context about previous interactions.
   */
  private async loadArtifactMemory(conversation: Conversation | null): Promise<string> {
    if (!conversation || !isDocumentBound(conversation) || !this.provenanceService) {
      return '';
    }

    const docPath = conversation.documentPath!;
    const noteName = noteNameFromPath(docPath);

    const historyResult = await this.provenanceService.getHistory(noteName);
    if (!historyResult.ok || historyResult.value.length === 0) {
      return '';
    }

    const events = historyResult.value;
    const aiEvents = events.filter(isAIEvent);

    if (aiEvents.length === 0) {
      return '';
    }

    // Summarize recent interactions (last 10 AI events)
    const recent = aiEvents.slice(-10);
    const summaries = recent.map((evt) => {
      const date = new Date(evt.ts).toLocaleDateString();
      const accepted = evt.accepted !== undefined ? (evt.accepted ? 'accepted' : 'rejected') : '';
      const detail = evt.prompt ? `: "${evt.prompt}"` : evt.action ? `: ${evt.action}` : '';
      return `- [${date}] ${evt.type}${detail}${accepted ? ` (${accepted})` : ''}`;
    });

    return `\n## Artifact Memory\nThis document has been worked on before. Previous AI interactions:\n${summaries.join('\n')}\n\nUse this context to give more relevant, personalized assistance.\n`;
  }

  /**
   * Mutate a conversation immutably and schedule persistence. Thin
   * adapter over `ConversationStore.update` so the rest of this file
   * keeps the call sites it had before the split.
   */
  private updateConversation(
    conversationId: string,
    updater: (conv: Conversation) => Conversation
  ): void {
    this.conversationStore.update(conversationId, updater);
  }

  /** Force any pending debounced write for a conversation to run now. */
  private flushPersistence(conversationId: string): void {
    this.conversationStore.flushPersist(conversationId);
  }

  /**
   * Load every conversation associated with `documentPath` from the
   * legacy `.void/conversations/{note}/` viewer directory.
   */
  async loadDocumentConversations(documentPath: string): Promise<Conversation[]> {
    return this.conversationStore.loadForDocument(documentPath);
  }

  async appendUserMessage(
    message: string,
    conversationId?: string,
    options?: { clientTurnId?: string }
  ): Promise<Result<Conversation, Error>> {
    try {
      const conversation = await this.getConversation(conversationId);
      const userMessageParams: NonNullable<Parameters<typeof createUserMessage>[1]> = {};
      if (options?.clientTurnId !== undefined) {
        userMessageParams.clientTurnId = options.clientTurnId;
      }
      this.updateConversation(conversation.id, (conv) => addMessage(conv, createUserMessage(message, userMessageParams)));
      this.flushPersistence(conversation.id);
      const updated = this.conversationStore.get(conversation.id) ?? conversation;
      return ok(updated);
    } catch (e) {
      return err(toError(e));
    }
  }

  async appendAssistantMessage(
    message: string,
    conversationId?: string
  ): Promise<Result<Conversation, Error>> {
    try {
      const conversation = await this.getConversation(conversationId);
      this.updateConversation(
        conversation.id,
        (conv) => addMessage(conv, createAssistantMessage({ text: message }))
      );
      this.flushPersistence(conversation.id);
      const updated = this.conversationStore.get(conversation.id) ?? conversation;
      return ok(updated);
    } catch (e) {
      return err(toError(e));
    }
  }

  async appendOrUpdateAssistantActivity(
    message: string,
    activity: AIStatusUpdate,
    conversationId?: string,
    groupId?: string
  ): Promise<Result<Conversation, Error>> {
    try {
      const conversation = await this.getConversation(conversationId);
      const activityGroupId = groupId ?? activity.id ?? `activity:${Date.now()}`;
      const target = findAssistantActivityMessage(conversation, activityGroupId);

      if (!target) {
        const nextMessage = upsertActivity(
          createAssistantMessage({
            text: message,
            isStreaming: activity.status === 'running',
          }),
          activity
        );
        this.updateConversation(conversation.id, (conv) => addMessage(conv, nextMessage));
      } else {
        this.updateConversation(
          conversation.id,
          (conv) => updateMessage(conv, target.id, (existing) => {
            const withText = replaceMessageText(existing, message);
            const withActivity = upsertActivity(withText, activity);
            const hasRunningActivity = withActivity.activity?.some((entry) => entry.status === 'running') ?? false;
            return {
              ...withActivity,
              isStreaming: hasRunningActivity,
              updatedAt: new Date(),
            };
          })
        );
      }

      this.flushPersistence(conversation.id);
      const updated = this.conversationStore.get(conversation.id) ?? conversation;
      return ok(updated);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Update state and notify subscribers.
   */
  private updateState(partial: Partial<AIInteractionState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateSubscribers();
  }

  /**
   * Notify all state subscribers. Public so the ConversationStore
   * callback can re-pump UI state when the active conversation changes.
   */
  notifyStateSubscribers(): void {
    const state = this.getState();
    for (const callback of this.stateSubscribers) {
      try {
        callback(state);
      } catch (error) {
        log.error('Subscriber error', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

function findAssistantActivityMessage(conversation: Conversation, groupId: string): Message | null {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const message = conversation.messages[i];
    if (!message || message.role !== 'assistant') continue;
    if (message.activity?.some((entry) => entry.id === groupId || entry.id.startsWith(`${groupId}:`))) {
      return message;
    }
  }
  return null;
}

function replaceMessageText(message: Message, text: string): Message {
  const contentWithoutText = message.content.filter((block) => block.type !== 'text');
  const content: Message['content'] = text
    ? [{ type: 'text', text }, ...contentWithoutText]
    : contentWithoutText;

  return {
    ...message,
    content,
    text,
    updatedAt: new Date(),
  };
}

function buildToolsSystemPrompt(tools: Tool[]): string {
  if (tools.length === 0) return '';

  const lines: string[] = [
    '## Available Tools',
    '',
    'You have access to the following tools. To use a tool, include a tool call in your response using this format:',
    '',
    '<tool_call>',
    '<tool>namespace:action</tool>',
    '<args>{"param": "value"}</args>',
    '</tool_call>',
    '',
    'You can make multiple tool calls in a single response.',
    '',
    '---',
    '',
  ];

  for (const tool of tools) {
    lines.push(formatToolForAI(tool));
    lines.push('');
  }

  return lines.join('\n');
}

function mergeReferences(
  existing: ResolvedPromptReference[],
  incoming: ResolvedPromptReference[]
): ResolvedPromptReference[] {
  const byRef = new Map<string, ResolvedPromptReference>();
  for (const reference of existing) byRef.set(reference.refId, reference);
  for (const reference of incoming) byRef.set(reference.refId, reference);
  return Array.from(byRef.values());
}
