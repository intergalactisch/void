/**
 * AI Assistant Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the AIAssistantService application service.
 *
 * Provides reactive state for AI interactions including:
 * - Processing and streaming states
 * - Current and historical conversations
 * - Tool execution tracking
 * - Pending tool confirmations
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
import type {
  AIAssistantService,
  PromptOptions,
  AIInteractionState,
  AgentLoopService,
  AgentState,
  AgentOptions,
  AgentResult,
  OperationService,
  AgentOrchestrationService,
  AgentRunState,
  StartAgentRunOptions,
  ContinueWorkerOptions,
  AgentIntakeService,
  AgentIntakeDecision,
} from '$lib/ports/inbound';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { Conversation } from '$lib/domain/entities/Conversation';
import type { Document } from '$lib/domain/entities/Document';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { AIResponse, AIResponseChunk } from '$lib/domain/values/AIResponse';
import type {
  ConversationSummary,
  ConversationSummaryQuery,
} from '$lib/ports/outbound/ConversationStoragePort';
import type { AgentRunSummary, AgentRunSummaryQuery } from '$lib/ports/outbound/AgentRunStoragePort';
import type { PagedResult } from '$lib/ports/outbound/PagedQuery';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';
import {
  AI_UNAVAILABLE_MESSAGE,
  type AIAvailabilityStatus,
} from '$lib/domain/values/AIAvailability';

/** Sidebar view states */
export type SidebarView = 'chat' | 'history' | 'actions';

export interface SubmitPromptOptions {
  conversationId?: string;
  clientTurnId?: string;
}

/**
 * AI Assistant Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to AI interaction state and methods to
 * send prompts, manage conversations, and handle tool confirmations.
 */
class AIStore {
  #service: AIAssistantService | null = null;
  #agentService: AgentLoopService | null = null;
  #agentOrchestrationService: AgentOrchestrationService | null = null;
  #agentIntakeService: AgentIntakeService | null = null;
  #operationService: OperationService | null = null;
  #contextProvider: ContextProviderPort | null = null;
  #unsubscribe: (() => void) | null = null;
  #agentUnsubscribe: (() => void) | null = null;
  #agentRunUnsubscribe: (() => void) | null = null;

  // Reactive state from AIInteractionState
  isProcessing = $state(false);
  isStreaming = $state(false);
  isRouting = $state(false);
  streamingText = $state('');
  progress = $state(0);
  error = $state<Error | null>(null);

  // Local AI CLI availability. Unknown is optimistic so tests/browser mock
  // paths keep working until bootstrap or Settings resolves the real state.
  availabilityStatus = $state<AIAvailabilityStatus>('unknown');
  isAIAvailable = $state(true);
  availabilityMessage = $state<string | null>(null);

  // Conversation state
  currentConversation = $state<Conversation | null>(null);
  conversations = $state<Conversation[]>([]);

  // Tool execution state
  executingTools = $state<ToolInvocation[]>([]);
  pendingConfirmations = $state<ToolInvocation[]>([]);

  // Last response for UI access
  lastResponse = $state<AIResponse | null>(null);

  // Knowledge graph context
  relatedContextCount = $state(0);

  // Sidebar view state
  sidebarView = $state<SidebarView>('chat');
  conversationSummaries = $state<ConversationSummary[]>([]);
  conversationSummaryPage = $state<PagedResult<ConversationSummary>>({
    items: [],
    nextCursor: null,
    total: null,
  });

  // Operations state (for quick actions)
  activeOperations = $state<Operation[]>([]);

  // Agent loop state
  agentState = $state<AgentState>({
    status: 'idle',
    currentTurn: 0,
    maxTurns: 15,
    activeTools: [],
    completedTools: [],
  });

  // Durable agent-run state
  agentRunState = $state<AgentRunState>({
    currentRun: null,
    runs: [],
    isRunning: false,
    error: null,
  });
  agentRunSummaryPage = $state<PagedResult<AgentRunSummary>>({
    items: [],
    nextCursor: null,
    total: null,
  });

  lastIntakeDecision = $state<AgentIntakeDecision | null>(null);

  /**
   * Initialize the store with an AIAssistantService instance.
   * Must be called before using any other methods.
   *
   * @param service - The AIAssistantService to use
   */
  init(service: AIAssistantService) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;
    this.availabilityStatus = 'unknown';
    this.isAIAvailable = true;
    this.availabilityMessage = null;

    // Subscribe to service state changes (includes conversation)
    this.#unsubscribe = service.subscribe((state: AIInteractionState) => {
      this.isProcessing = state.isProcessing;
      this.isStreaming = state.isStreaming;
      this.streamingText = state.streamingText;
      this.progress = state.progress;
      this.error = state.error;
      this.executingTools = state.executingTools;
      this.currentConversation = state.currentConversation;
      this.relatedContextCount = state.relatedContextCount;

      // Filter for pending confirmations
      this.pendingConfirmations = state.executingTools.filter(
        (inv) => inv.status === 'pending' && !inv.confirmed
      );
    });
  }

  /**
   * Initialize the agent loop service.
   * Called during bootstrap after the main service.
   */
  initAgent(agentService: AgentLoopService) {
    if (this.#agentUnsubscribe) this.#agentUnsubscribe();

    this.#agentService = agentService;
    this.#agentUnsubscribe = agentService.subscribe((state: AgentState) => {
      this.agentState = state;
    });
  }

  /**
   * Initialize the durable agent orchestration service.
   */
  initAgentOrchestration(agentService: AgentOrchestrationService) {
    if (this.#agentRunUnsubscribe) this.#agentRunUnsubscribe();

    this.#agentOrchestrationService = agentService;
    this.#agentRunUnsubscribe = agentService.subscribe((state: AgentRunState) => {
      this.agentRunState = state;
    });
    void this.loadAgentRuns();
  }

  /**
   * Initialize model-led intake. This replaces prompt keyword routing.
   */
  initAgentIntake(service: AgentIntakeService) {
    this.#agentIntakeService = service;
  }

  /**
   * Initialize the operation service for quick actions.
   */
  initOperations(operationService: OperationService) {
    this.#operationService = operationService;
  }

  /**
   * Initialize the context provider so the editor can publish the
   * currently active document to AI prompt context.
   */
  initContextProvider(provider: ContextProviderPort) {
    this.#contextProvider = provider;
  }

  /**
   * Set the document the user is currently editing. The context provider
   * uses this to include document metadata, recent provenance, and related
   * notes in subsequent AI prompts.
   */
  setActiveDocument(document: Document | null): void {
    this.#contextProvider?.setCurrentDocument(document);
  }

  // =========================================================================
  // Sidebar view methods
  // =========================================================================

  /**
   * Switch the sidebar view.
   */
  setSidebarView(view: SidebarView) {
    this.sidebarView = view;
    if (view === 'history') {
      this.loadConversationHistory();
    }
  }

  /**
   * Load conversation summaries for the history view.
   */
  async loadConversationHistory(): Promise<void> {
    await this.loadConversationSummaries();
  }

  async loadConversationSummaries(query?: ConversationSummaryQuery): Promise<PagedResult<ConversationSummary>> {
    if (!this.#service) {
      this.conversationSummaryPage = { items: [], nextCursor: null, total: 0 };
      this.conversationSummaries = [];
      return this.conversationSummaryPage;
    }

    const result = await this.#service.listConversationSummaries(query);
    if (!result.ok) {
      this.error = result.error;
      return this.conversationSummaryPage;
    }
    this.conversationSummaryPage = result.value;
    this.conversationSummaries = result.value.items;
    return result.value;
  }

  /**
   * Get operation templates from the operation service.
   */
  get templates(): OperationTemplate[] {
    return this.#operationService?.getTemplates() ?? [];
  }

  /**
   * Queue an operation from a template.
   */
  async queueFromTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean>
  ): Promise<Operation | null> {
    if (!this.#guardAIAvailable()) return null;
    if (!this.#operationService) return null;

    const result = await this.#operationService.queueFromTemplate(templateId, variables);
    if (result.ok) {
      return result.value;
    }
    this.error = result.error;
    return null;
  }

  // =========================================================================
  // Agent loop methods
  // =========================================================================

  /**
   * Run an agentic loop: AI plans and executes multi-turn tool calls.
   */
  async runAgent(prompt: string, options?: AgentOptions): Promise<AgentResult | null> {
    if (!this.#agentService) throw new Error('Agent service not initialized');
    if (!this.#guardAIAvailable()) return null;

    this.error = null;
    try {
      return await this.#agentService.run(prompt, options);
    } catch (e) {
      this.error = toError(e);
      return null;
    }
  }

  /**
   * Cancel the running agent loop.
   */
  cancelAgent() {
    if (!this.#agentService) return;
    this.#agentService.cancel();
  }

  /**
   * Whether the agent is currently running.
   */
  get isAgentRunning(): boolean {
    return this.agentRunState.isRunning ||
      this.agentState.status === 'executing' ||
      this.agentState.status === 'planning';
  }

  /**
   * Start a durable agent run with planning, approval, and task tracking.
   */
  async startAgentRun(prompt: string, options?: StartAgentRunOptions) {
    if (!this.#agentOrchestrationService) throw new Error('Agent orchestration service not initialized');
    if (!this.#guardAIAvailable()) return null;

    this.error = null;
    const result = await this.#agentOrchestrationService.startRun(prompt, options);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    await this.#refreshConversations();
    return result.value;
  }

  /**
   * Approve an agent run that is waiting before batch writes.
   */
  async approveAgentRun(runId: string): Promise<boolean> {
    if (!this.#agentOrchestrationService) throw new Error('Agent orchestration service not initialized');
    if (!this.#guardAIAvailable()) return false;

    this.error = null;
    const result = await this.#agentOrchestrationService.approveRun(runId);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    await this.#refreshConversations();
    return true;
  }

  /**
   * Send a user follow-up to a specific worker (or directive to the orchestrator)
   * and resume the worker's conversation in place.
   */
  async continueWorker(options: ContinueWorkerOptions) {
    if (!this.#agentOrchestrationService) throw new Error('Agent orchestration service not initialized');
    if (!this.#guardAIAvailable()) return null;

    this.error = null;
    const result = await this.#agentOrchestrationService.continueWorker(options);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    return result.value;
  }

  /**
   * Cancel the durable run if one is active.
   */
  async cancelAgentRun(runId?: string): Promise<boolean> {
    const id = runId ?? this.agentRunState.currentRun?.id;
    if (!id || !this.#agentOrchestrationService) {
      this.cancelAgent();
      return false;
    }

    const result = await this.#agentOrchestrationService.cancelRun(id);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    return true;
  }

  /**
   * Load persisted agent runs for the Command Center.
   */
  async loadAgentRuns(): Promise<void> {
    if (!this.#agentOrchestrationService) return;
    const result = await this.#agentOrchestrationService.listRuns();
    if (!result.ok) {
      this.error = result.error;
    }
  }

  async loadAgentRun(runId: string): Promise<void> {
    if (!this.#agentOrchestrationService) return;
    const result = await this.#agentOrchestrationService.getRun(runId);
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    if (!result.value) return;
    const runs = this.agentRunState.runs.filter((run) => run.id !== runId);
    this.agentRunState = {
      ...this.agentRunState,
      runs: [...runs, result.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      currentRun: this.agentRunState.currentRun?.id === runId ? result.value : this.agentRunState.currentRun,
    };
  }

  async loadAgentRunSummaries(query?: AgentRunSummaryQuery): Promise<PagedResult<AgentRunSummary>> {
    if (!this.#agentOrchestrationService) {
      this.agentRunSummaryPage = { items: [], nextCursor: null, total: 0 };
      return this.agentRunSummaryPage;
    }
    const result = await this.#agentOrchestrationService.listRunSummaries(query);
    if (!result.ok) {
      this.error = result.error;
      return this.agentRunSummaryPage;
    }
    this.agentRunSummaryPage = result.value;
    return result.value;
  }

  // =========================================================================
  // Prompt methods
  // =========================================================================

  /**
   * Let the model decide whether this is chat, a single action, or a durable run.
   */
  async submitPrompt(message: string, options?: SubmitPromptOptions): Promise<AIResponse | null> {
    if (!this.#guardAIAvailable()) return null;

    const conversationId = options?.conversationId ?? this.currentConversation?.id;
    const promptOptions: PromptOptions = {};
    if (conversationId) promptOptions.conversationId = conversationId;
    if (options?.clientTurnId !== undefined) promptOptions.clientTurnId = options.clientTurnId;

    if (!this.#agentIntakeService) {
      return this.streamPrompt(message, promptOptions);
    }

    this.error = null;
    this.isRouting = true;
    let decision!: Awaited<ReturnType<AgentIntakeService['decide']>>;
    try {
      decision = await this.#agentIntakeService.decide(
        message,
        conversationId ? { conversationId } : undefined
      );
    } catch (e) {
      this.error = toError(e);
      return null;
    } finally {
      this.isRouting = false;
    }
    if (!decision.ok) {
      this.error = decision.error;
      return null;
    }

    this.lastIntakeDecision = decision.value;
    const useNativeWeb = shouldUseNativeWebAccess(message, decision.value);

    if (decision.value.kind === 'agent_run') {
      const suggested = decision.value.suggestedMode;
      const useSwarm = suggested === 'research' || suggested === 'multi_step';
      const options: StartAgentRunOptions = {
        requireApproval: false,
        orchestrationMode: useSwarm ? 'swarm' : 'single',
      };
      if (useSwarm) options.maxWorkers = 4;
      if (conversationId) options.conversationId = conversationId;
      if (promptOptions.clientTurnId !== undefined) options.clientTurnId = promptOptions.clientTurnId;
      if (useNativeWeb) options.webAccess = 'native';
      await this.startAgentRun(message, options);
      return null;
    }

    if (useNativeWeb) {
      promptOptions.webAccess = 'native';
    }

    return this.streamPrompt(message, promptOptions);
  }

  /**
   * Send a prompt to the AI assistant.
   * Updates processing state and returns the response.
   *
   * @param message - The user's message
   * @param options - Optional prompt configuration
   * @returns The AI response or null on error
   */
  async prompt(message: string, options?: PromptOptions): Promise<AIResponse | null> {
    if (!this.#service) throw new Error('AIStore not initialized');
    if (!this.#guardAIAvailable()) return null;

    this.error = null;
    this.lastResponse = null;

    const conversationId = options?.conversationId ?? this.currentConversation?.id;
    const promptOptions: PromptOptions = {
      autoExecuteTools: true,
      ...options,
    };
    if (conversationId) promptOptions.conversationId = conversationId;

    const result = await this.#service.prompt(message, promptOptions);

    if (result.ok) {
      this.lastResponse = result.value;
      await this.#refreshConversations();
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  /**
   * Send a prompt with streaming response.
   * Updates streamingText on each chunk.
   *
   * @param message - The user's message
   * @param options - Optional prompt configuration
   * @returns The final AI response or null on error
   */
  async streamPrompt(message: string, options?: PromptOptions): Promise<AIResponse | null> {
    if (!this.#service) throw new Error('AIStore not initialized');
    if (!this.#guardAIAvailable()) return null;

    this.error = null;
    this.lastResponse = null;

    const onChunk = (chunk: AIResponseChunk) => {
      // Chunks are handled by the service which pushes conversation updates
    };

    const conversationId = options?.conversationId ?? this.currentConversation?.id;
    const streamOptions: PromptOptions = {
      autoExecuteTools: true,
      ...options,
      stream: true,
    };
    if (conversationId) streamOptions.conversationId = conversationId;

    const result = await this.#service.streamPrompt(message, onChunk, streamOptions);

    if (result.ok) {
      this.lastResponse = result.value;
      await this.#refreshConversations();
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  /**
   * Cancel the current prompt or streaming operation.
   */
  async cancel(): Promise<void> {
    if (this.agentRunState.currentRun && this.agentRunState.isRunning) {
      await this.cancelAgentRun(this.agentRunState.currentRun.id);
      return;
    }
    if (!this.#service) return;
    this.#service.cancel();
  }

  // =========================================================================
  // Conversation management
  // =========================================================================

  /**
   * Load all conversations from the service.
   */
  async loadConversations(): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');
    await this.#refreshConversations();
  }

  /**
   * Switch to a different conversation.
   *
   * @param conversationId - ID of the conversation to switch to
   */
  async switchConversation(conversationId: string): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');

    await this.#service.setCurrentConversation(conversationId);
    this.error = null;
  }

  /**
   * Create a new conversation and switch to it.
   *
   * @returns The new conversation
   */
  async newConversation(): Promise<Conversation> {
    if (!this.#service) throw new Error('AIStore not initialized');

    const conversation = await this.#service.createNewConversation();
    await this.#service.setCurrentConversation(conversation.id);
    await this.#refreshConversations();
    this.error = null;
    return conversation;
  }

  /**
   * Clear messages from the current conversation.
   */
  async clearConversation(): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');
    if (!this.currentConversation) return;

    await this.#service.clearConversation(this.currentConversation.id);
    this.error = null;
  }

  /**
   * Delete a conversation.
   *
   * @param conversationId - ID of the conversation to delete
   */
  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');

    await this.#service.deleteConversation(conversationId);
    await this.#refreshConversations();
  }

  // =========================================================================
  // Tool confirmation methods
  // =========================================================================

  /**
   * Confirm and execute a pending tool invocation.
   *
   * @param invocationId - ID of the tool invocation to confirm
   */
  async confirmTool(invocationId: string): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');

    try {
      await this.#service.confirmToolExecution(invocationId);
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Reject a pending tool invocation.
   *
   * @param invocationId - ID of the tool invocation to reject
   * @param reason - Reason for rejection
   */
  async rejectTool(invocationId: string, reason: string): Promise<void> {
    if (!this.#service) throw new Error('AIStore not initialized');

    try {
      await this.#service.rejectToolExecution(invocationId, reason);
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Execute tool calls from the last response.
   * Useful for manually triggering tool execution.
   */
  async executeLastToolCalls(): Promise<ToolInvocation[]> {
    if (!this.#service) throw new Error('AIStore not initialized');
    if (!this.lastResponse || !this.currentConversation) return [];

    const invocations = await this.#service.executeToolCalls(
      this.lastResponse.toolCalls,
      this.currentConversation.id
    );

    return invocations;
  }

  // =========================================================================
  // Configuration methods
  // =========================================================================

  /**
   * Check if AI is available and configured.
   */
  async isAvailable(): Promise<boolean> {
    return this.refreshAvailability();
  }

  async refreshAvailability(): Promise<boolean> {
    if (!this.#service) {
      this.#setAvailability(false);
      return false;
    }
    this.availabilityStatus = 'checking';
    this.availabilityMessage = null;

    try {
      const available = await this.#service.isAvailable();
      this.#setAvailability(available);
      return available;
    } catch (e) {
      this.#setAvailability(false);
      this.error = toError(e);
      return false;
    }
  }

  get canStartAIWork(): boolean {
    return this.availabilityStatus !== 'unavailable' && this.isAIAvailable;
  }

  ensureAIAvailable(): boolean {
    return this.#guardAIAvailable();
  }

  /**
   * Get the current AI provider.
   */
  getProvider(): string | null {
    if (!this.#service) return null;
    return this.#service.getProvider();
  }

  /**
   * Get the current AI model.
   */
  getModel(): string | null {
    if (!this.#service) return null;
    return this.#service.getModel();
  }

  // =========================================================================
  // Store state
  // =========================================================================

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if a conversation is active.
   */
  get hasConversation(): boolean {
    return this.currentConversation !== null;
  }

  /**
   * Check if there are pending tool confirmations.
   */
  get hasPendingConfirmations(): boolean {
    return this.pendingConfirmations.length > 0;
  }

  /**
   * Get message count in current conversation.
   */
  get messageCount(): number {
    return this.currentConversation?.messages.length ?? 0;
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Refresh the conversations list from the service.
   */
  async #refreshConversations(): Promise<void> {
    if (!this.#service) return;
    const conversations = await this.#service.listConversations();
    this.conversations = conversations;
    this.conversationSummaries = this.#toConversationSummaries(conversations);
    this.conversationSummaryPage = {
      items: this.conversationSummaries,
      nextCursor: null,
      total: this.conversationSummaries.length,
    };
  }

  #toConversationSummaries(conversations: Conversation[]): ConversationSummary[] {
    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.filter((message) => message.visibility !== 'internal').length,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      preview: c.messages
        .find((m) => m.role === 'user' && m.visibility !== 'internal')
        ?.text.slice(0, 100) ?? '',
    }));
  }

  #setAvailability(available: boolean): void {
    this.isAIAvailable = available;
    this.availabilityStatus = available ? 'available' : 'unavailable';
    this.availabilityMessage = available ? null : AI_UNAVAILABLE_MESSAGE;
    if (available && this.error?.message === AI_UNAVAILABLE_MESSAGE) {
      this.error = null;
    }
  }

  #guardAIAvailable(): boolean {
    if (this.canStartAIWork) return true;
    const message = this.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE;
    this.error = new Error(message);
    this.isRouting = false;
    return false;
  }

  /**
   * Cleanup subscriptions.
   */
  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    this.#cleanup();
    if (this.#agentUnsubscribe) {
      this.#agentUnsubscribe();
      this.#agentUnsubscribe = null;
    }
    if (this.#agentRunUnsubscribe) {
      this.#agentRunUnsubscribe();
      this.#agentRunUnsubscribe = null;
    }
    this.#service = null;
    this.#agentService = null;
    this.#agentOrchestrationService = null;
    this.#agentIntakeService = null;
    this.#operationService = null;
    this.isProcessing = false;
    this.isStreaming = false;
    this.isRouting = false;
    this.streamingText = '';
    this.progress = 0;
    this.error = null;
    this.availabilityStatus = 'unknown';
    this.isAIAvailable = true;
    this.availabilityMessage = null;
    this.currentConversation = null;
    this.conversations = [];
    this.executingTools = [];
    this.pendingConfirmations = [];
    this.lastResponse = null;
    this.lastIntakeDecision = null;
    this.relatedContextCount = 0;
    this.sidebarView = 'chat';
    this.conversationSummaries = [];
    this.activeOperations = [];
    this.agentRunState = {
      currentRun: null,
      runs: [],
      isRunning: false,
      error: null,
    };
  }
}

export const aiStore = new AIStore();

function shouldUseNativeWebAccess(message: string, decision: AgentIntakeDecision): boolean {
  if (decision.suggestedMode === 'research' || decision.suggestedMode === 'current_info') {
    return true;
  }

  const normalized = message.toLowerCase();
  return /\b(latest|today|current|recent|newest|up-to-date|web|internet)\b/.test(normalized) ||
    /\b(vandaag|laatste|recent|actueel|internet)\b/.test(normalized);
}
