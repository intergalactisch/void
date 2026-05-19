import { describe, it, expect, vi } from 'vitest';
import { ok } from '$lib/core';
import { AIAssistantServiceImpl } from '$lib/application/services/AIAssistantServiceImpl';
import { ConversationStore } from '$lib/application/services/ConversationStore';
import { ToolInvocationService } from '$lib/application/services/ToolInvocationService';
import { MemoryConversationAdapter } from '$lib/adapters/memory/MemoryConversationAdapter';
import { createEmptyResponse } from '$lib/domain/values/AIResponse';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type {
  AIAssistantProviderPort,
  ContextProviderPort,
  ToolExecutorPort,
} from '$lib/ports/outbound';
import type { ToolRegistryService } from '$lib/ports/inbound';

function contextProvider(): ContextProviderPort {
  const context = createEmptyContext();
  return {
    getContext: async () => context,
    getCurrentDocument: async () => null,
    setCurrentDocument: vi.fn(),
    getEditorContext: async () => null,
    getNavigationContext: async () => context.navigation,
    getRecentNotes: async () => [],
    getLanguage: () => 'en',
    getTimezone: () => 'UTC',
    getNotesBasePath: () => '/notes',
    subscribe: () => () => {},
  };
}

function toolRegistry(): ToolRegistryService {
  return {
    getAll: vi.fn().mockResolvedValue([]),
    getToolsSystemPrompt: vi.fn().mockResolvedValue(''),
    get: vi.fn().mockResolvedValue(undefined),
  } as unknown as ToolRegistryService;
}

function toolExecutor(): ToolExecutorPort {
  return {
    cancelAll: vi.fn(),
  } as unknown as ToolExecutorPort;
}

describe('AIAssistantServiceImpl status chunks', () => {
  it('persists status activity without appending it to assistant text', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'claude',
      isAvailable: async () => true,
      configure: async () => undefined,
      prompt: vi.fn(),
      stream: async (_request, onChunk) => {
        onChunk({
          type: 'status',
          status: {
            id: 'cli-think',
            status: 'running',
            label: 'Thinking through the request',
          },
        });
        onChunk({ type: 'chat', chatDelta: 'Final answer' });
        return ok({
          ...createEmptyResponse('claude', 'cli'),
          chat: 'Final answer',
        });
      },
      cancel: vi.fn(),
      estimateTokens: (text: string) => text.length,
      getMaxContextSize: () => Infinity,
      getAvailableModels: async () => ['cli'],
      getRateLimitStatus: async () => null,
    };

    const registry = toolRegistry();
    const executor = toolExecutor();
    const conversations = new ConversationStore({
      contextProvider: contextProvider(),
      conversationStorage: new MemoryConversationAdapter(),
    });
    const toolInvocations = new ToolInvocationService({
      toolRegistry: registry,
      toolExecutor: executor,
      attachInvocation: vi.fn(),
      updateInvocation: vi.fn(),
      setExecutingTools: vi.fn(),
    });
    const service = new AIAssistantServiceImpl(
      provider,
      registry,
      executor,
      contextProvider(),
      conversations,
      toolInvocations
    );

    const result = await service.streamPrompt('hello', vi.fn(), { autoExecuteTools: false });
    const assistant = service
      .getCurrentConversation()
      ?.messages.find((message) => message.role === 'assistant');

    expect(result.ok).toBe(true);
    expect(assistant?.text).toBe('Final answer');
    expect(assistant?.text).not.toContain('Thinking through the request');
    expect(assistant?.activity?.[0]?.label).toBe('Thinking through the request');
    expect(assistant?.activity?.[0]?.status).toBe('completed');

    service.dispose();
  });

  it('can keep internal agent prompts out of the visible conversation', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'claude',
      isAvailable: async () => true,
      configure: async () => undefined,
      prompt: vi.fn(async () => ok({
        ...createEmptyResponse('claude', 'test'),
        chat: 'Internal tool planning',
      })),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: (text: string) => text.length,
      getMaxContextSize: () => Infinity,
      getAvailableModels: async () => ['test'],
      getRateLimitStatus: async () => null,
    };

    const registry = toolRegistry();
    const executor = toolExecutor();
    const conversations = new ConversationStore({
      contextProvider: contextProvider(),
      conversationStorage: new MemoryConversationAdapter(),
    });
    const toolInvocations = new ToolInvocationService({
      toolRegistry: registry,
      toolExecutor: executor,
      attachInvocation: vi.fn(),
      updateInvocation: vi.fn(),
      setExecutingTools: vi.fn(),
    });
    const service = new AIAssistantServiceImpl(
      provider,
      registry,
      executor,
      contextProvider(),
      conversations,
      toolInvocations
    );

    const result = await service.prompt('Execute internal run', {
      autoExecuteTools: false,
      displayMessage: null,
      persistAssistantMessage: false,
    });

    expect(result.ok).toBe(true);
    expect(service.getCurrentConversation()?.messages).toEqual([]);

    const user = await service.appendUserMessage('Research Anthropic');
    expect(user.ok).toBe(true);
    const assistant = await service.appendAssistantMessage('Paused for approval');
    expect(assistant.ok).toBe(true);
    expect(service.getCurrentConversation()?.messages.map((message) => message.text)).toEqual([
      'Research Anthropic',
      'Paused for approval',
    ]);

    service.dispose();
  });

  it('updates a single assistant activity message for live agent progress', async () => {
    const provider: AIAssistantProviderPort = {
      getProviderType: () => 'claude',
      isAvailable: async () => true,
      configure: async () => undefined,
      prompt: vi.fn(),
      stream: vi.fn(),
      cancel: vi.fn(),
      estimateTokens: (text: string) => text.length,
      getMaxContextSize: () => Infinity,
      getAvailableModels: async () => ['test'],
      getRateLimitStatus: async () => null,
    };

    const registry = toolRegistry();
    const executor = toolExecutor();
    const conversations = new ConversationStore({
      contextProvider: contextProvider(),
      conversationStorage: new MemoryConversationAdapter(),
    });
    const toolInvocations = new ToolInvocationService({
      toolRegistry: registry,
      toolExecutor: executor,
      attachInvocation: vi.fn(),
      updateInvocation: vi.fn(),
      setExecutingTools: vi.fn(),
    });
    const service = new AIAssistantServiceImpl(
      provider,
      registry,
      executor,
      contextProvider(),
      conversations,
      toolInvocations
    );

    const user = await service.appendUserMessage('Research Anthropic');
    expect(user.ok).toBe(true);
    const conversationId = service.getCurrentConversation()?.id;

    const first = await service.appendOrUpdateAssistantActivity(
      'I am working on "Research Anthropic".',
      {
        id: 'agent-run:run-1:task:plan',
        status: 'running',
        label: 'Planning the run',
      },
      conversationId,
      'agent-run:run-1'
    );
    const second = await service.appendOrUpdateAssistantActivity(
      'I am searching notes and sources.',
      {
        id: 'agent-run:run-1:task:search',
        status: 'running',
        label: 'Searching notes',
      },
      conversationId,
      'agent-run:run-1'
    );
    const searchDone = await service.appendOrUpdateAssistantActivity(
      'I found useful context.',
      {
        id: 'agent-run:run-1:task:search',
        status: 'completed',
        label: 'Searching notes',
      },
      conversationId,
      'agent-run:run-1'
    );
    const done = await service.appendOrUpdateAssistantActivity(
      'Research run completed.',
      {
        id: 'agent-run:run-1:run',
        status: 'completed',
        label: 'Run completed',
      },
      conversationId,
      'agent-run:run-1'
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(searchDone.ok).toBe(true);
    expect(done.ok).toBe(true);

    const messages = service.getCurrentConversation()?.messages ?? [];
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe('Research run completed.');
    expect(assistantMessages[0]?.isStreaming).toBe(false);
    expect(assistantMessages[0]?.activity?.map((entry) => entry.label)).toEqual([
      'Planning the run',
      'Searching notes',
      'Run completed',
    ]);
    expect(assistantMessages[0]?.activity?.[1]?.status).toBe('completed');

    service.dispose();
  });
});
