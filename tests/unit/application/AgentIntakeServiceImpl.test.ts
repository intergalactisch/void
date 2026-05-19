import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { AgentIntakeServiceImpl } from '$lib/application/services/AgentIntakeServiceImpl';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import { createTool } from '$lib/domain/entities/Tool';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { ToolRegistryService } from '$lib/ports/inbound/ToolRegistryService';
import type { AIResponse } from '$lib/domain/values/AIResponse';

function response(chat: string): AIResponse {
  return {
    chat,
    toolCalls: [],
    meta: {
      provider: 'test',
      model: 'test-model',
      latencyMs: 1,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    },
    truncated: false,
    stopReason: 'end_turn',
  };
}

function createFixture(providerChat = '{"kind":"agent_run","confidence":0.93,"rationale":"Needs durable multi-step research."}') {
  const promptSpy = vi.fn(async () => ok(response(providerChat)));
  const provider: AIAssistantProviderPort = {
    getProviderType: () => 'openai',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    prompt: promptSpy,
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 128_000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
  const tools = [
    createTool({
      id: 'note:create' as never,
      name: 'Create note',
      description: 'Create a note without stealing focus during batch work.',
      category: 'note',
      parameters: {
        title: { type: 'string', description: 'Title', required: true },
      },
    }),
    createTool({
      id: 'search:content' as never,
      name: 'Search content',
      description: 'Search markdown bodies and excerpts.',
      category: 'search',
    }),
  ];
  const registry: ToolRegistryService = {
    getAll: vi.fn(async () => tools),
  } as unknown as ToolRegistryService;
  const context = createEmptyContext();
  const contextProvider: ContextProviderPort = {
    getContext: vi.fn(async () => context),
  } as unknown as ContextProviderPort;

  return {
    service: new AgentIntakeServiceImpl(provider, registry, contextProvider),
    provider,
    promptSpy,
    registry,
  };
}

describe('AgentIntakeServiceImpl', () => {
  it('routes explicit research prompts to a durable agent run without waiting for model classification', async () => {
    const { service, promptSpy } = createFixture();

    const decision = await service.decide('Doe onderzoek naar AI in de zorg');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('agent_run');
    expect(decision.value.confidence).toBe(0.96);
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('routes the command-center OpenAI research prompt to a durable agent run', async () => {
    const { service, promptSpy } = createFixture('{"kind":"direct_answer","confidence":0.8,"rationale":"Wrong model classification."}');

    const decision = await service.decide('Do research on OpenAI');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('agent_run');
    expect(decision.value.suggestedMode).toBe('research');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('routes mixed Dutch/English full research prompts to a durable research run', async () => {
    const { service, promptSpy } = createFixture('{"kind":"direct_answer","confidence":0.8,"rationale":"Wrong model classification."}');

    const decision = await service.decide('Doe full research on Ai coding agents');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('agent_run');
    expect(decision.value.suggestedMode).toBe('research');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('keeps simple current-info prompts in chat with native web mode suggested', async () => {
    const { service, promptSpy } = createFixture();

    const decision = await service.decide('What is the latest OpenAI model today?');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('direct_answer');
    expect(decision.value.suggestedMode).toBe('current_info');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('falls back to direct chat when the intake provider is unavailable', async () => {
    const { service, provider } = createFixture();
    vi.mocked(provider.isAvailable).mockResolvedValueOnce(false);

    const decision = await service.decide('anything');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('direct_answer');
  });

  it('keeps malformed model output in direct chat for non-durable prompts', async () => {
    const { service } = createFixture('not-json');

    const decision = await service.decide('What does research methodology mean?');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.kind).toBe('direct_answer');
    expect(decision.value.rationale).toContain('could not be parsed');
  });
});
