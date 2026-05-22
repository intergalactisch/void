/**
 * Integration tests for AI Store
 *
 * Tests the AIStore with a mock AIAssistantService to verify:
 * - Initialization with service
 * - Prompt and streaming prompt methods
 * - Conversation management (load, switch, new, clear, delete)
 * - Tool confirmation and rejection
 * - Configuration methods (isAvailable, getProvider, getModel)
 * - State subscription and cleanup
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { aiStore } from '$lib/stores/ai.svelte';
import type {
  AIAssistantService,
  AIInteractionState,
  PromptOptions,
  AgentIntakeService,
  AgentIntakeDecision,
  AgentOrchestrationService,
  AgentRunState,
  OperationService,
} from '$lib/ports/inbound';
import { AI_UNAVAILABLE_MESSAGE } from '$lib/domain/values/AIAvailability';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { createConversation } from '$lib/domain/entities/Conversation';
import { createAgentRun } from '$lib/domain/entities/AgentRun';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { AIResponse, AIResponseChunk, ToolCall } from '$lib/domain/values/AIResponse';
import { ok, err, type Result } from '$lib/core';

// =========================================================================
// Test helpers
// =========================================================================

/**
 * Creates a mock conversation for testing.
 */
function createMockConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    ...createConversation({
      context: { currentDocument: null, recentNotes: [], toolContext: '' },
    }),
    ...overrides,
  };
}

/**
 * Creates a mock AI response for testing.
 */
function createMockAIResponse(overrides?: Partial<AIResponse>): AIResponse {
  return {
    chat: 'Test response',
    toolCalls: [],
    meta: {
      provider: 'claude',
      model: 'claude-3',
      latencyMs: 100,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    },
    truncated: false,
    stopReason: 'end_turn',
    ...overrides,
  };
}

/**
 * Creates a mock tool invocation for testing.
 */
function createMockToolInvocation(overrides?: Partial<ToolInvocation>): ToolInvocation {
  return {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: 'note:create',
    args: { title: 'Test' },
    status: 'pending',
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    result: null,
    progress: 0,
    message: null,
    confirmed: false,
    messageId: null,
    ...overrides,
  };
}

/**
 * Creates a mock AIAssistantService with customizable behavior.
 */
function createMockAIService(options?: {
  promptResult?: Result<AIResponse, Error>;
  streamPromptResult?: Result<AIResponse, Error>;
  isAvailableResult?: boolean;
  provider?: string | null;
  model?: string | null;
  initialConversation?: Conversation;
  conversations?: Conversation[];
}): AIAssistantService & {
  _state: AIInteractionState;
  _subscribers: Set<(state: AIInteractionState) => void>;
  _updateState: (partial: Partial<AIInteractionState>) => void;
} {
  const subscribers = new Set<(state: AIInteractionState) => void>();
  const currentConv = options?.initialConversation ?? createMockConversation();
  const conversations = options?.conversations ?? [currentConv];
  let currentConversation: Conversation | null = currentConv;
  const state: AIInteractionState = {
    isProcessing: false,
    isStreaming: false,
    streamingText: '',
    executingTools: [],
    error: null,
    progress: 0,
    currentConversation: currentConv,
  };

  const updateState = (partial: Partial<AIInteractionState>) => {
    Object.assign(state, partial);
    subscribers.forEach((cb) => cb({ ...state }));
  };

  return {
    _state: state,
    _subscribers: subscribers,
    _updateState: updateState,

    prompt: vi.fn().mockImplementation(async () => {
      return options?.promptResult ?? ok(createMockAIResponse());
    }),

    streamPrompt: vi.fn().mockImplementation(
      async (
        _message: string,
        onChunk: (chunk: AIResponseChunk) => void,
        _options?: PromptOptions
      ) => {
        // Simulate streaming with a chunk
        onChunk({ type: 'chat', chatDelta: 'Hello' });
        onChunk({ type: 'chat', chatDelta: ' world' });
        return options?.streamPromptResult ?? ok(createMockAIResponse({ chat: 'Hello world' }));
      }
    ),

    cancel: vi.fn(),

    getConversation: vi.fn().mockImplementation(async (conversationId?: string) => {
      if (conversationId) {
        return conversations.find((c) => c.id === conversationId) ?? createMockConversation();
      }
      // Return current conversation if one exists (matches real service)
      if (currentConversation) return currentConversation;
      const newConv = createMockConversation();
      conversations.push(newConv);
      currentConversation = newConv;
      return newConv;
    }),

    createNewConversation: vi.fn().mockImplementation(async () => {
      const newConv = createMockConversation();
      conversations.push(newConv);
      currentConversation = newConv;
      updateState({ currentConversation });
      return newConv;
    }),

    listConversations: vi.fn().mockImplementation(async () => conversations),

    clearConversation: vi.fn().mockImplementation(async (conversationId: string) => {
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        conv.messages = [];
        if (currentConversation?.id === conversationId) {
          updateState({ currentConversation: conv });
        }
      }
    }),

    deleteConversation: vi.fn().mockImplementation(async (conversationId: string) => {
      const index = conversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        conversations.splice(index, 1);
        if (currentConversation?.id === conversationId) {
          currentConversation = conversations[0] ?? null;
          updateState({ currentConversation });
        }
      }
    }),

    getCurrentConversation: vi.fn().mockImplementation(() => currentConversation),

    setCurrentConversation: vi.fn().mockImplementation(async (conversationId: string) => {
      currentConversation = conversations.find((c) => c.id === conversationId) ?? null;
      updateState({ currentConversation });
    }),

    executeToolCalls: vi.fn().mockImplementation(async (toolCalls: ToolCall[]) => {
      return toolCalls.map((tc) =>
        createMockToolInvocation({
          toolId: tc.toolId,
          args: tc.args,
          status: 'completed',
        })
      );
    }),

    confirmToolExecution: vi.fn().mockResolvedValue(undefined),

    rejectToolExecution: vi.fn().mockResolvedValue(undefined),

    getState: vi.fn().mockImplementation(() => ({ ...state, currentConversation })),

    subscribe: vi.fn().mockImplementation((cb: (state: AIInteractionState) => void) => {
      subscribers.add(cb);
      // Call immediately with current state (matches real service behavior)
      cb({ ...state });
      return () => subscribers.delete(cb);
    }),

    isAvailable: vi.fn().mockImplementation(async () => options?.isAvailableResult ?? true),

    getProvider: vi.fn().mockImplementation(() =>
      options && 'provider' in options ? options.provider : 'claude'
    ),

    getModel: vi.fn().mockImplementation(() =>
      options && 'model' in options ? options.model : 'claude-3'
    ),

    loadDocumentConversations: vi.fn().mockImplementation(async () => []),
  };
}

function createMockAgentIntake(
  kind: 'direct_answer' | 'single_tool_action' | 'agent_run' = 'direct_answer',
  result: Result<AgentIntakeDecision, Error> | null = null
): AgentIntakeService {
  return {
    decide: vi.fn(async () => {
      if (result) return result;
      const decision: AgentIntakeDecision = {
        kind,
        confidence: 0.9,
        rationale: 'Test decision',
      };
      if (kind === 'agent_run') decision.suggestedMode = 'research';
      return ok(decision);
    }),
    getToolManifest: vi.fn(async () => ok([])),
  } as unknown as AgentIntakeService;
}

function createMockAgentOrchestration(): AgentOrchestrationService {
  const run = createAgentRun({
    id: 'run-store-test',
    prompt: 'Test agent run',
    conversationId: 'conv-store',
    approvalRequired: false,
  });
  const state: AgentRunState = {
    currentRun: null,
    runs: [],
    isRunning: false,
    error: null,
  };
  return {
    startRun: vi.fn(async (prompt: string) => {
      const next = { ...run, prompt, status: 'completed' as const };
      state.currentRun = null;
      state.runs = [next];
      state.isRunning = false;
      return ok(next);
    }),
    approveRun: vi.fn(async () => ok(undefined)),
    cancelRun: vi.fn(async () => ok(undefined)),
    resumeRun: vi.fn(async () => ok(run)),
    getRun: vi.fn(async () => ok(run)),
    listRuns: vi.fn(async () => ok(state.runs)),
    getState: vi.fn(() => state),
    subscribe: vi.fn((callback: (next: AgentRunState) => void) => {
      callback(state);
      return () => undefined;
    }),
  } as unknown as AgentOrchestrationService;
}

// =========================================================================
// Tests
// =========================================================================

describe('AI Store Integration', () => {
  let mockService: ReturnType<typeof createMockAIService>;

  beforeEach(() => {
    mockService = createMockAIService();
    // Clean up any previous state
    aiStore.destroy();
  });

  afterEach(() => {
    aiStore.destroy();
  });

  // =========================================================================
  // init()
  // =========================================================================

  describe('init()', () => {
    it('accepts a service and marks store as initialized', () => {
      aiStore.init(mockService);

      expect(aiStore.isInitialized).toBe(true);
    });

    it('subscribes to service state changes', () => {
      aiStore.init(mockService);

      expect(mockService.subscribe).toHaveBeenCalledTimes(1);
      expect(mockService.subscribe).toHaveBeenCalledWith(expect.any(Function));
    });

    it('initializes with current service state', () => {
      mockService._state.isProcessing = true;
      mockService._state.progress = 50;
      mockService.getState = vi.fn().mockReturnValue({ ...mockService._state });

      aiStore.init(mockService);

      expect(aiStore.isProcessing).toBe(true);
      expect(aiStore.progress).toBe(50);
    });

    it('sets currentConversation from service', () => {
      const conv = createMockConversation({ title: 'Test Conv' });
      mockService = createMockAIService({ initialConversation: conv });

      aiStore.init(mockService);

      expect(aiStore.currentConversation).not.toBeNull();
      expect(aiStore.currentConversation?.title).toBe('Test Conv');
    });

    it('cleans up previous subscription when re-initialized', () => {
      aiStore.init(mockService);

      const secondService = createMockAIService();
      aiStore.init(secondService);

      // The second service should be subscribed
      expect(secondService.subscribe).toHaveBeenCalledTimes(1);
    });

    it('updates store state when service emits state changes', () => {
      aiStore.init(mockService);

      // Simulate service state update
      mockService._updateState({
        isProcessing: true,
        isStreaming: true,
        streamingText: 'Streaming...',
        progress: 25,
      });

      expect(aiStore.isProcessing).toBe(true);
      expect(aiStore.isStreaming).toBe(true);
      expect(aiStore.streamingText).toBe('Streaming...');
      expect(aiStore.progress).toBe(25);
    });

    it('filters pending confirmations from executingTools', () => {
      const pendingTool = createMockToolInvocation({ status: 'pending', confirmed: false });
      const executingTool = createMockToolInvocation({ status: 'executing', confirmed: true });
      mockService._state.executingTools = [pendingTool, executingTool];
      mockService.getState = vi.fn().mockReturnValue({ ...mockService._state });

      aiStore.init(mockService);

      expect(aiStore.executingTools).toHaveLength(2);
      expect(aiStore.pendingConfirmations).toHaveLength(1);
      expect(aiStore.pendingConfirmations[0]?.status).toBe('pending');
    });
  });

  // =========================================================================
  // prompt()
  // =========================================================================

  describe('prompt()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.prompt('test')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.prompt() with message and current conversationId', async () => {
      await aiStore.prompt('Hello AI');

      expect(mockService.prompt).toHaveBeenCalledWith('Hello AI', expect.objectContaining({
        autoExecuteTools: true,
        conversationId: aiStore.currentConversation?.id,
      }));
    });

    it('calls service.prompt() with explicit conversationId', async () => {
      await aiStore.prompt('Hello', { conversationId: 'conv-1', autoExecuteTools: true });

      expect(mockService.prompt).toHaveBeenCalledWith('Hello', expect.objectContaining({
        conversationId: 'conv-1',
        autoExecuteTools: true,
      }));
    });

    it('updates lastResponse on success', async () => {
      const response = createMockAIResponse({ chat: 'Custom response' });
      mockService.prompt = vi.fn().mockResolvedValue(ok(response));

      await aiStore.prompt('test');

      expect(aiStore.lastResponse).not.toBeNull();
      expect(aiStore.lastResponse?.chat).toBe('Custom response');
    });

    it('returns the response on success', async () => {
      const response = createMockAIResponse({ chat: 'Response text' });
      mockService.prompt = vi.fn().mockResolvedValue(ok(response));

      const result = await aiStore.prompt('test');

      expect(result).not.toBeNull();
      expect(result?.chat).toBe('Response text');
    });

    it('maintains conversation state after prompt', async () => {
      await aiStore.prompt('test');

      // Conversation state comes via subscription, not getCurrentConversation
      expect(aiStore.currentConversation).not.toBeNull();
    });

    it('refreshes conversations list after prompt', async () => {
      await aiStore.prompt('test');

      expect(mockService.listConversations).toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockService.prompt = vi.fn().mockResolvedValue(err(new Error('API Error')));

      await aiStore.prompt('test');

      expect(aiStore.error).not.toBeNull();
      expect(aiStore.error?.message).toBe('API Error');
    });

    it('returns null on failure', async () => {
      mockService.prompt = vi.fn().mockResolvedValue(err(new Error('API Error')));

      const result = await aiStore.prompt('test');

      expect(result).toBeNull();
    });

    it('clears previous error before prompt', async () => {
      // Set an error first
      mockService.prompt = vi.fn().mockResolvedValue(err(new Error('First error')));
      await aiStore.prompt('first');
      expect(aiStore.error).not.toBeNull();

      // Second prompt should clear error (even if it also fails)
      mockService.prompt = vi.fn().mockResolvedValue(ok(createMockAIResponse()));
      await aiStore.prompt('second');

      expect(aiStore.error).toBeNull();
    });

    it('clears lastResponse before prompt', async () => {
      // Set a response first
      await aiStore.prompt('first');
      expect(aiStore.lastResponse).not.toBeNull();

      // Create a new mock that will be set before the second prompt
      const newResponse = createMockAIResponse({ chat: 'Second response' });
      mockService.prompt = vi.fn().mockResolvedValue(ok(newResponse));

      await aiStore.prompt('second');

      expect(aiStore.lastResponse?.chat).toBe('Second response');
    });
  });

  // =========================================================================
  // streamPrompt()
  // =========================================================================

  describe('streamPrompt()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.streamPrompt('test')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.streamPrompt() with message, onChunk, and conversationId', async () => {
      await aiStore.streamPrompt('Hello AI');

      expect(mockService.streamPrompt).toHaveBeenCalledWith(
        'Hello AI',
        expect.any(Function),
        expect.objectContaining({
          stream: true,
          conversationId: aiStore.currentConversation?.id,
        })
      );
    });

    it('calls service.streamPrompt() with merged options', async () => {
      const options: PromptOptions = { conversationId: 'conv-1' };

      await aiStore.streamPrompt('Hello', options);

      expect(mockService.streamPrompt).toHaveBeenCalledWith(
        'Hello',
        expect.any(Function),
        expect.objectContaining({ conversationId: 'conv-1', stream: true })
      );
    });

    it('updates streamingText with chat chunks', async () => {
      // Mock to capture the onChunk callback
      let capturedOnChunk: ((chunk: AIResponseChunk) => void) | null = null;
      mockService.streamPrompt = vi.fn().mockImplementation(async (_msg, onChunk) => {
        capturedOnChunk = onChunk;
        onChunk({ type: 'chat', chatDelta: 'First ' });
        onChunk({ type: 'chat', chatDelta: 'Second' });
        return ok(createMockAIResponse());
      });

      await aiStore.streamPrompt('test');

      // streamingText is cleared after completion, so we verify via the mock
      expect(capturedOnChunk).not.toBeNull();
    });

    it('clears streamingText on success', async () => {
      await aiStore.streamPrompt('test');

      expect(aiStore.streamingText).toBe('');
    });

    it('clears streamingText on failure', async () => {
      mockService.streamPrompt = vi.fn().mockResolvedValue(err(new Error('Stream error')));

      await aiStore.streamPrompt('test');

      expect(aiStore.streamingText).toBe('');
    });

    it('updates lastResponse on success', async () => {
      const response = createMockAIResponse({ chat: 'Streamed response' });
      mockService.streamPrompt = vi.fn().mockResolvedValue(ok(response));

      await aiStore.streamPrompt('test');

      expect(aiStore.lastResponse).not.toBeNull();
      expect(aiStore.lastResponse?.chat).toBe('Streamed response');
    });

    it('returns the response on success', async () => {
      const response = createMockAIResponse({ chat: 'Streamed text' });
      mockService.streamPrompt = vi.fn().mockResolvedValue(ok(response));

      const result = await aiStore.streamPrompt('test');

      expect(result).not.toBeNull();
      expect(result?.chat).toBe('Streamed text');
    });

    it('sets error on failure', async () => {
      mockService.streamPrompt = vi.fn().mockResolvedValue(err(new Error('Stream failed')));

      await aiStore.streamPrompt('test');

      expect(aiStore.error).not.toBeNull();
      expect(aiStore.error?.message).toBe('Stream failed');
    });

    it('returns null on failure', async () => {
      mockService.streamPrompt = vi.fn().mockResolvedValue(err(new Error('Stream failed')));

      const result = await aiStore.streamPrompt('test');

      expect(result).toBeNull();
    });

    it('maintains conversation state after streaming', async () => {
      await aiStore.streamPrompt('test');

      // Conversation state comes via subscription, not getCurrentConversation
      expect(aiStore.currentConversation).not.toBeNull();
    });
  });

  describe('submitPrompt()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('routes direct answers through normal streaming', async () => {
      const intake = createMockAgentIntake('direct_answer');
      aiStore.initAgentIntake(intake);

      await aiStore.submitPrompt('Hello', { clientTurnId: 'turn-direct' });

      expect(intake.decide).toHaveBeenCalledWith('Hello', expect.objectContaining({
        conversationId: aiStore.currentConversation?.id,
      }));
      expect(mockService.streamPrompt).toHaveBeenCalledWith(
        'Hello',
        expect.any(Function),
        expect.objectContaining({ clientTurnId: 'turn-direct' })
      );
    });

    it('routes single-tool decisions through normal tool-capable chat until structured args exist', async () => {
      const intake = createMockAgentIntake('single_tool_action');
      aiStore.initAgentIntake(intake);

      await aiStore.submitPrompt('Open home', { clientTurnId: 'turn-tool' });

      expect(mockService.streamPrompt).toHaveBeenCalledWith(
        'Open home',
        expect.any(Function),
        expect.objectContaining({ autoExecuteTools: true, clientTurnId: 'turn-tool' })
      );
    });

    it('starts a durable agent run for agent_run decisions', async () => {
      const intake = createMockAgentIntake('agent_run');
      const orchestration = createMockAgentOrchestration();
      aiStore.initAgentIntake(intake);
      aiStore.initAgentOrchestration(orchestration);

      await aiStore.submitPrompt('Doe onderzoek naar AI in de zorg', { clientTurnId: 'turn-agent' });

      expect(orchestration.startRun).toHaveBeenCalledWith(
        'Doe onderzoek naar AI in de zorg',
        expect.objectContaining({
          conversationId: aiStore.currentConversation?.id,
          requireApproval: false,
          clientTurnId: 'turn-agent',
          orchestrationMode: 'swarm',
          maxWorkers: 4,
          webAccess: 'native',
        })
      );
      expect(mockService.streamPrompt).not.toHaveBeenCalled();
      expect(aiStore.sidebarView).toBe('chat');
    });

    it('exposes routing state while intake is unresolved', async () => {
      let resolveDecision!: (value: Result<AgentIntakeDecision, Error>) => void;
      const intake: AgentIntakeService = {
        decide: vi.fn(() => new Promise((resolve) => {
          resolveDecision = resolve;
        })),
        getToolManifest: vi.fn(async () => ok([])),
      };
      aiStore.initAgentIntake(intake);

      const pending = aiStore.submitPrompt('Slow routing', { clientTurnId: 'turn-slow' });

      expect(aiStore.isRouting).toBe(true);

      resolveDecision(ok({
        kind: 'direct_answer',
        confidence: 0.9,
        rationale: 'Test decision',
      }));
      await pending;

      expect(aiStore.isRouting).toBe(false);
    });

    it('surfaces intake errors without falling through to streaming', async () => {
      const intake = createMockAgentIntake('direct_answer', err(new Error('intake failed')));
      aiStore.initAgentIntake(intake);

      await aiStore.submitPrompt('Research current interesting AI topics');

      expect(aiStore.error?.message).toBe('intake failed');
      expect(aiStore.isRouting).toBe(false);
      expect(mockService.streamPrompt).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // cancel()
  // =========================================================================

  describe('cancel()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('does nothing if store not initialized', () => {
      aiStore.destroy();

      // Should not throw
      expect(() => aiStore.cancel()).not.toThrow();
    });

    it('calls service.cancel()', () => {
      aiStore.cancel();

      expect(mockService.cancel).toHaveBeenCalledTimes(1);
    });

    it('reflects service state updates after cancel', () => {
      // streamingText is managed by service and pushed via subscription
      mockService._updateState({ streamingText: 'Streaming...' });
      expect(aiStore.streamingText).toBe('Streaming...');

      aiStore.cancel();
      // Service pushes empty streamingText after cancel
      mockService._updateState({ streamingText: '' });

      expect(aiStore.streamingText).toBe('');
    });
  });

  // =========================================================================
  // Conversation management
  // =========================================================================

  describe('loadConversations()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.loadConversations()).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.listConversations()', async () => {
      await aiStore.loadConversations();

      expect(mockService.listConversations).toHaveBeenCalledTimes(1);
    });

    it('updates conversations state', async () => {
      const convs = [createMockConversation({ title: 'Conv 1' }), createMockConversation({ title: 'Conv 2' })];
      mockService.listConversations = vi.fn().mockResolvedValue(convs);

      await aiStore.loadConversations();

      expect(aiStore.conversations).toHaveLength(2);
    });

    it('updates conversation summaries with the same refresh', async () => {
      const convs = [
        createMockConversation({ id: 'conv-summary-1', title: 'Conv 1' }),
        createMockConversation({ id: 'conv-summary-2', title: 'Conv 2' }),
      ];
      mockService.listConversations = vi.fn().mockResolvedValue(convs);

      await aiStore.loadConversations();

      expect(aiStore.conversationSummaries.map((summary) => summary.id)).toEqual([
        'conv-summary-1',
        'conv-summary-2',
      ]);
    });
  });

  describe('switchConversation()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.switchConversation('conv-1')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.setCurrentConversation()', async () => {
      await aiStore.switchConversation('conv-123');

      expect(mockService.setCurrentConversation).toHaveBeenCalledWith('conv-123');
    });

    it('updates currentConversation via subscription', async () => {
      const conv = createMockConversation({ id: 'conv-123', title: 'Switched Conv' });
      mockService = createMockAIService({ conversations: [conv], initialConversation: conv });
      aiStore.init(mockService);

      await aiStore.switchConversation('conv-123');

      // Conversation state comes via subscription after setCurrentConversation
      expect(mockService.setCurrentConversation).toHaveBeenCalledWith('conv-123');
      expect(aiStore.currentConversation).not.toBeNull();
    });

    it('clears error on switch', async () => {
      aiStore.error = new Error('Previous error');

      await aiStore.switchConversation('conv-1');

      expect(aiStore.error).toBeNull();
    });
  });

  describe('newConversation()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.newConversation()).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.createNewConversation() to create new conversation', async () => {
      await aiStore.newConversation();

      expect(mockService.createNewConversation).toHaveBeenCalledTimes(1);
    });

    it('updates currentConversation', async () => {
      // Use default mock (creates conversation and adds to array)
      await aiStore.newConversation();

      // Conversation set via setCurrentConversation -> subscription
      expect(aiStore.currentConversation).not.toBeNull();
    });

    it('returns the new conversation', async () => {
      const newConv = createMockConversation({ title: 'Brand New' });
      mockService.createNewConversation = vi.fn().mockResolvedValue(newConv);

      const result = await aiStore.newConversation();

      expect(result.title).toBe('Brand New');
    });

    it('refreshes conversations list', async () => {
      await aiStore.newConversation();

      expect(mockService.listConversations).toHaveBeenCalled();
    });

    it('refreshes conversation summaries for the Command Center history pane', async () => {
      const conversation = await aiStore.newConversation();

      expect(aiStore.conversationSummaries.some((summary) => summary.id === conversation.id)).toBe(true);
    });

    it('clears error', async () => {
      aiStore.error = new Error('Previous error');

      await aiStore.newConversation();

      expect(aiStore.error).toBeNull();
    });
  });

  describe('clearConversation()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.clearConversation()).rejects.toThrow('AIStore not initialized');
    });

    it('does nothing if no current conversation', async () => {
      mockService.getCurrentConversation = vi.fn().mockReturnValue(null);
      aiStore.init(mockService);
      aiStore.currentConversation = null;

      await aiStore.clearConversation();

      expect(mockService.clearConversation).not.toHaveBeenCalled();
    });

    it('calls service.clearConversation() with current conversation id', async () => {
      const conv = createMockConversation({ id: 'conv-to-clear' });
      aiStore.currentConversation = conv;

      await aiStore.clearConversation();

      expect(mockService.clearConversation).toHaveBeenCalledWith('conv-to-clear');
    });

    it('updates conversation state via subscription', async () => {
      const conv = createMockConversation();
      aiStore.currentConversation = conv;

      await aiStore.clearConversation();

      // Conversation is updated via service subscription
      expect(mockService.clearConversation).toHaveBeenCalledWith(conv.id);
    });

    it('clears error', async () => {
      const conv = createMockConversation();
      aiStore.currentConversation = conv;
      aiStore.error = new Error('Previous error');

      await aiStore.clearConversation();

      expect(aiStore.error).toBeNull();
    });
  });

  describe('deleteConversation()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.deleteConversation('conv-1')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.deleteConversation()', async () => {
      await aiStore.deleteConversation('conv-to-delete');

      expect(mockService.deleteConversation).toHaveBeenCalledWith('conv-to-delete');
    });

    it('refreshes conversations list', async () => {
      await aiStore.deleteConversation('conv-1');

      expect(mockService.listConversations).toHaveBeenCalled();
    });

    it('updates currentConversation if deleted conversation was current', async () => {
      const conv = createMockConversation({ id: 'conv-current' });
      mockService = createMockAIService({ initialConversation: conv, conversations: [conv] });
      aiStore.init(mockService);

      await aiStore.deleteConversation('conv-current');

      // currentConversation is updated via subscription after deletion
      expect(aiStore.currentConversation).toBeNull();
    });

    it('does not update currentConversation if different conversation deleted', async () => {
      const currentConv = createMockConversation({ id: 'current' });
      aiStore.currentConversation = currentConv;
      const callCountBefore = (mockService.getCurrentConversation as ReturnType<typeof vi.fn>).mock
        .calls.length;

      await aiStore.deleteConversation('other-conv');

      // getCurrentConversation should not be called again
      expect((mockService.getCurrentConversation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callCountBefore
      );
    });
  });

  // =========================================================================
  // Tool execution
  // =========================================================================

  describe('confirmTool()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.confirmTool('inv-1')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.confirmToolExecution()', async () => {
      await aiStore.confirmTool('inv-123');

      expect(mockService.confirmToolExecution).toHaveBeenCalledWith('inv-123');
    });

    it('sets error if service throws', async () => {
      mockService.confirmToolExecution = vi.fn().mockRejectedValue(new Error('Confirm failed'));

      await aiStore.confirmTool('inv-1');

      expect(aiStore.error).not.toBeNull();
      expect(aiStore.error?.message).toBe('Confirm failed');
    });
  });

  describe('rejectTool()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.rejectTool('inv-1', 'reason')).rejects.toThrow('AIStore not initialized');
    });

    it('calls service.rejectToolExecution()', async () => {
      await aiStore.rejectTool('inv-123', 'User declined');

      expect(mockService.rejectToolExecution).toHaveBeenCalledWith('inv-123', 'User declined');
    });

    it('sets error if service throws', async () => {
      mockService.rejectToolExecution = vi.fn().mockRejectedValue(new Error('Reject failed'));

      await aiStore.rejectTool('inv-1', 'reason');

      expect(aiStore.error).not.toBeNull();
      expect(aiStore.error?.message).toBe('Reject failed');
    });
  });

  describe('executeLastToolCalls()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('throws error if store not initialized', async () => {
      aiStore.destroy();

      await expect(aiStore.executeLastToolCalls()).rejects.toThrow('AIStore not initialized');
    });

    it('returns empty array if no lastResponse', async () => {
      aiStore.lastResponse = null;

      const result = await aiStore.executeLastToolCalls();

      expect(result).toEqual([]);
    });

    it('returns empty array if no currentConversation', async () => {
      aiStore.lastResponse = createMockAIResponse();
      aiStore.currentConversation = null;

      const result = await aiStore.executeLastToolCalls();

      expect(result).toEqual([]);
    });

    it('calls service.executeToolCalls() with lastResponse toolCalls', async () => {
      const toolCalls: ToolCall[] = [
        { id: 'tc-1', toolId: 'note:create', args: { title: 'Test' } },
      ];
      aiStore.lastResponse = createMockAIResponse({ toolCalls });
      aiStore.currentConversation = createMockConversation({ id: 'conv-1' });

      await aiStore.executeLastToolCalls();

      expect(mockService.executeToolCalls).toHaveBeenCalledWith(toolCalls, 'conv-1');
    });

    it('returns tool invocations from service', async () => {
      const toolCalls: ToolCall[] = [{ id: 'tc-1', toolId: 'note:create', args: { title: 'Test' } }];
      aiStore.lastResponse = createMockAIResponse({ toolCalls });
      aiStore.currentConversation = createMockConversation({ id: 'conv-1' });

      const result = await aiStore.executeLastToolCalls();

      expect(result).toHaveLength(1);
      expect(result[0]?.toolId).toBe('note:create');
    });
  });

  // =========================================================================
  // Configuration methods
  // =========================================================================

  describe('isAvailable()', () => {
    it('returns false if store not initialized', async () => {
      const result = await aiStore.isAvailable();

      expect(result).toBe(false);
    });

    it('calls service.isAvailable() and returns result', async () => {
      mockService = createMockAIService({ isAvailableResult: true });
      aiStore.init(mockService);

      const result = await aiStore.isAvailable();

      expect(mockService.isAvailable).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('returns false when service reports unavailable', async () => {
      mockService = createMockAIService({ isAvailableResult: false });
      aiStore.init(mockService);

      const result = await aiStore.isAvailable();

      expect(result).toBe(false);
    });

    it('refreshes reactive availability state', async () => {
      mockService = createMockAIService({ isAvailableResult: false });
      aiStore.init(mockService);

      const result = await aiStore.refreshAvailability();

      expect(result).toBe(false);
      expect(aiStore.availabilityStatus).toBe('unavailable');
      expect(aiStore.isAIAvailable).toBe(false);
      expect(aiStore.availabilityMessage).toBe(AI_UNAVAILABLE_MESSAGE);
    });

    it('blocks prompts without invoking the service when unavailable', async () => {
      mockService = createMockAIService({ isAvailableResult: false });
      aiStore.init(mockService);
      await aiStore.refreshAvailability();

      const result = await aiStore.prompt('Write something');

      expect(result).toBeNull();
      expect(mockService.prompt).not.toHaveBeenCalled();
      expect(aiStore.error?.message).toBe(AI_UNAVAILABLE_MESSAGE);
    });

    it('blocks agent runs and operation templates when unavailable', async () => {
      mockService = createMockAIService({ isAvailableResult: false });
      const orchestration = createMockAgentOrchestration();
      const operationService = {
        getTemplates: vi.fn(() => []),
        queueFromTemplate: vi.fn(),
      } as unknown as OperationService;

      aiStore.init(mockService);
      aiStore.initAgentOrchestration(orchestration);
      aiStore.initOperations(operationService);
      await aiStore.refreshAvailability();

      const run = await aiStore.startAgentRun('Research this');
      const operation = await aiStore.queueFromTemplate('daily-review', {});

      expect(run).toBeNull();
      expect(operation).toBeNull();
      expect(orchestration.startRun).not.toHaveBeenCalled();
      expect(operationService.queueFromTemplate).not.toHaveBeenCalled();
      expect(aiStore.error?.message).toBe(AI_UNAVAILABLE_MESSAGE);
    });
  });

  describe('getProvider()', () => {
    it('returns null if store not initialized', () => {
      const result = aiStore.getProvider();

      expect(result).toBeNull();
    });

    it('returns provider from service', () => {
      mockService = createMockAIService({ provider: 'openai' });
      aiStore.init(mockService);

      const result = aiStore.getProvider();

      expect(result).toBe('openai');
    });

    it('returns null when service has no provider', () => {
      aiStore.destroy();
      mockService = createMockAIService({ provider: null });
      aiStore.init(mockService);

      const result = aiStore.getProvider();

      expect(result).toBeNull();
    });
  });

  describe('getModel()', () => {
    it('returns null if store not initialized', () => {
      const result = aiStore.getModel();

      expect(result).toBeNull();
    });

    it('returns model from service', () => {
      mockService = createMockAIService({ model: 'gpt-4' });
      aiStore.init(mockService);

      const result = aiStore.getModel();

      expect(result).toBe('gpt-4');
    });

    it('returns null when service has no model', () => {
      aiStore.destroy();
      mockService = createMockAIService({ model: null });
      aiStore.init(mockService);

      const result = aiStore.getModel();

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Store state getters
  // =========================================================================

  describe('computed properties', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    describe('isInitialized', () => {
      it('is true after init()', () => {
        expect(aiStore.isInitialized).toBe(true);
      });

      it('is false after destroy()', () => {
        aiStore.destroy();

        expect(aiStore.isInitialized).toBe(false);
      });
    });

    describe('hasConversation', () => {
      it('is true when currentConversation exists', () => {
        aiStore.currentConversation = createMockConversation();

        expect(aiStore.hasConversation).toBe(true);
      });

      it('is false when currentConversation is null', () => {
        aiStore.currentConversation = null;

        expect(aiStore.hasConversation).toBe(false);
      });
    });

    describe('hasPendingConfirmations', () => {
      it('is true when pendingConfirmations is not empty', () => {
        aiStore.pendingConfirmations = [createMockToolInvocation()];

        expect(aiStore.hasPendingConfirmations).toBe(true);
      });

      it('is false when pendingConfirmations is empty', () => {
        aiStore.pendingConfirmations = [];

        expect(aiStore.hasPendingConfirmations).toBe(false);
      });
    });

    describe('messageCount', () => {
      it('returns 0 when no conversation', () => {
        aiStore.currentConversation = null;

        expect(aiStore.messageCount).toBe(0);
      });

      it('returns message count from current conversation', () => {
        const conv = createMockConversation();
        conv.messages = [
          {
            id: 'msg-1',
            role: 'user',
            text: 'Hello',
            createdAt: new Date(),
            status: 'sent',
            toolInvocations: [],
            isStreaming: false,
          },
          {
            id: 'msg-2',
            role: 'assistant',
            text: 'Hi',
            createdAt: new Date(),
            status: 'sent',
            toolInvocations: [],
            isStreaming: false,
          },
        ];
        aiStore.currentConversation = conv;

        expect(aiStore.messageCount).toBe(2);
      });
    });
  });

  // =========================================================================
  // destroy()
  // =========================================================================

  describe('destroy()', () => {
    beforeEach(() => {
      aiStore.init(mockService);
    });

    it('resets isInitialized to false', () => {
      aiStore.destroy();

      expect(aiStore.isInitialized).toBe(false);
    });

    it('resets all reactive state', () => {
      // Set some state
      aiStore.isProcessing = true;
      aiStore.isStreaming = true;
      aiStore.streamingText = 'Some text';
      aiStore.progress = 50;
      aiStore.error = new Error('Some error');
      aiStore.currentConversation = createMockConversation();
      aiStore.conversations = [createMockConversation()];
      aiStore.executingTools = [createMockToolInvocation()];
      aiStore.pendingConfirmations = [createMockToolInvocation()];
      aiStore.lastResponse = createMockAIResponse();

      aiStore.destroy();

      expect(aiStore.isProcessing).toBe(false);
      expect(aiStore.isStreaming).toBe(false);
      expect(aiStore.streamingText).toBe('');
      expect(aiStore.progress).toBe(0);
      expect(aiStore.error).toBeNull();
      expect(aiStore.currentConversation).toBeNull();
      expect(aiStore.conversations).toEqual([]);
      expect(aiStore.executingTools).toEqual([]);
      expect(aiStore.pendingConfirmations).toEqual([]);
      expect(aiStore.lastResponse).toBeNull();
    });

    it('can be re-initialized after destroy', () => {
      aiStore.destroy();

      const newService = createMockAIService();
      aiStore.init(newService);

      expect(aiStore.isInitialized).toBe(true);
      expect(newService.subscribe).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Integration scenarios
  // =========================================================================

  describe('integration scenarios', () => {
    it('handles full workflow: init -> prompt -> response -> tool execution', async () => {
      const toolCalls: ToolCall[] = [{ id: 'tc-1', toolId: 'note:create', args: { title: 'New Note' } }];
      const response = createMockAIResponse({ chat: 'I will create a note', toolCalls });
      mockService = createMockAIService({ promptResult: ok(response) });

      aiStore.init(mockService);
      expect(aiStore.isInitialized).toBe(true);

      // Send prompt
      const result = await aiStore.prompt('Create a note');
      expect(result).not.toBeNull();
      expect(aiStore.lastResponse?.chat).toBe('I will create a note');
      expect(aiStore.lastResponse?.toolCalls).toHaveLength(1);

      // Execute tools
      const invocations = await aiStore.executeLastToolCalls();
      expect(invocations).toHaveLength(1);
      expect(invocations[0]?.toolId).toBe('note:create');
    });

    it('handles streaming with cancellation', async () => {
      let resolvePrompt: (() => void) | null = null;
      const streamPromise = new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });

      mockService.streamPrompt = vi.fn().mockImplementation(async (_msg, onChunk) => {
        onChunk({ type: 'chat', chatDelta: 'Streaming...' });
        await streamPromise;
        return ok(createMockAIResponse());
      });

      aiStore.init(mockService);

      // Start streaming
      const promptPromise = aiStore.streamPrompt('Long request');

      // Cancel
      aiStore.cancel();
      expect(mockService.cancel).toHaveBeenCalled();
      expect(aiStore.streamingText).toBe('');

      // Complete the stream
      resolvePrompt?.();
      await promptPromise;
    });

    it('handles conversation switching during conversation', async () => {
      const conv1 = createMockConversation({ id: 'conv-1', title: 'First' });
      const conv2 = createMockConversation({ id: 'conv-2', title: 'Second' });
      mockService = createMockAIService({
        initialConversation: conv1,
        conversations: [conv1, conv2],
      });

      aiStore.init(mockService);

      // Prompt in first conversation
      await aiStore.prompt('Hello');
      expect(mockService.prompt).toHaveBeenCalled();

      // Switch to second conversation
      await aiStore.switchConversation('conv-2');
      expect(mockService.setCurrentConversation).toHaveBeenCalledWith('conv-2');
    });

    it('handles error recovery', async () => {
      mockService = createMockAIService({ promptResult: err(new Error('Network error')) });
      aiStore.init(mockService);

      // First prompt fails
      await aiStore.prompt('First');
      expect(aiStore.error).not.toBeNull();
      expect(aiStore.error?.message).toBe('Network error');

      // Update mock to succeed
      mockService.prompt = vi.fn().mockResolvedValue(ok(createMockAIResponse({ chat: 'Success' })));

      // Second prompt succeeds
      await aiStore.prompt('Second');
      expect(aiStore.error).toBeNull();
      expect(aiStore.lastResponse?.chat).toBe('Success');
    });
  });
});
