import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { AgentLoopServiceImpl } from '$lib/application/services/AgentLoopServiceImpl';
import { createEmptyResponse, type ToolCall } from '$lib/domain/values/AIResponse';
import { toolSuccess } from '$lib/domain/values/ToolResult';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { AIAssistantService } from '$lib/ports/inbound/AIAssistantService';
import type { ToolExecutorPort } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import { OperationRunner } from '$lib/pipeline/OperationRunner';

describe('AgentLoopServiceImpl resource scheduling', () => {
  it('runs independent declared write resources in the same wave', async () => {
    const { service, order } = createLoop([
      toolCall('note:create', 'create-a', { title: 'A', folder: 'Research' }),
      toolCall('note:create', 'create-b', { title: 'B', folder: 'Research' }),
    ]);

    const result = await service.run('Create two notes', { maxTurns: 2, maxConcurrency: 5 });

    expect(result.error).toBeUndefined();
    expect(order.slice(0, 2)).toEqual(['start:create-a', 'start:create-b']);
    expect(order).toEqual(['start:create-a', 'start:create-b', 'end:create-a', 'end:create-b']);
  });

  it('keeps same-resource writes ordered across waves', async () => {
    const { service, order } = createLoop([
      toolCall('note:update', 'first', { noteId: 'Research/shared.md', content: 'First' }),
      toolCall('note:update', 'second', { noteId: 'Research/shared.md', content: 'Second' }),
    ]);

    const result = await service.run('Update the same note twice', { maxTurns: 2, maxConcurrency: 5 });

    expect(result.error).toBeUndefined();
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('treats ambient-scope write tools as sequential barriers', async () => {
    const { service, order } = createLoop([
      toolCall('note:update', 'note-a', { noteId: 'Research/a.md', content: 'A' }),
      toolCall('editor:replace', 'active-editor', { text: 'Replace selected text' }),
      toolCall('note:update', 'note-b', { noteId: 'Research/b.md', content: 'B' }),
    ]);

    const result = await service.run('Update notes and active editor', { maxTurns: 2, maxConcurrency: 5 });

    expect(result.error).toBeUndefined();
    expect(order).toEqual([
      'start:note-a',
      'end:note-a',
      'start:active-editor',
      'end:active-editor',
      'start:note-b',
      'end:note-b',
    ]);
  });
});

function createLoop(toolCalls: ToolCall[]): { service: AgentLoopServiceImpl; order: string[] } {
  const responses = [
    {
      ...createEmptyResponse('test', 'model'),
      chat: 'I will use tools.',
      toolCalls,
      stopReason: 'tool_use' as const,
    },
    {
      ...createEmptyResponse('test', 'model'),
      chat: 'Done.',
      toolCalls: [],
      stopReason: 'end_turn' as const,
    },
  ];
  const aiService = {
    prompt: vi.fn(async () => ok(responses.shift() ?? responses[responses.length - 1]!)),
    getCurrentConversation: () => null,
  } as unknown as AIAssistantService;
  const order: string[] = [];
  const executor = createExecutor(order);
  return {
    service: new AgentLoopServiceImpl(aiService, executor, new OperationRunner()),
    order,
  };
}

function createExecutor(order: string[]): ToolExecutorPort {
  return {
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    hasHandler: vi.fn(),
    execute: vi.fn(async (invocation: ToolInvocation) => {
      const label = String(invocation.messageId);
      order.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${label}`);
      return toolSuccess(invocation.toolId, { label }, invocation.startedAt ?? new Date());
    }),
    executeSequence: vi.fn(),
    executeParallel: vi.fn(),
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    isExecuting: vi.fn(),
    getExecutingIds: vi.fn(),
  } as unknown as ToolExecutorPort;
}

function toolCall(toolId: string, id: string, args: Record<string, unknown>): ToolCall {
  return {
    id,
    toolId: toolId as ToolId,
    args,
  };
}
