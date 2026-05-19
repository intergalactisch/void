import { describe, it, expect, vi } from 'vitest';
import { ToolInvocationService } from '$lib/application/services/ToolInvocationService';
import { events } from '$lib/events';
import { toolSuccess } from '$lib/domain/values/ToolResult';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolCall } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolExecutorPort } from '$lib/ports/outbound';
import type { ToolRegistryService } from '$lib/ports/inbound';

describe('ToolInvocationService progress bridge', () => {
  it('updates the attached conversation invocation when tool progress events fire', async () => {
    const updates: ToolInvocation[] = [];
    const toolId = 'note:create' as ToolId;
    const toolCalls: ToolCall[] = [
      { id: 'tc-1', toolId, args: { title: 'Weather' } },
    ];

    const registry = {
      get: vi.fn().mockResolvedValue({ id: toolId, requiresConfirmation: false }),
    } as unknown as ToolRegistryService;

    const executor = {
      execute: vi.fn().mockImplementation(async (invocation: ToolInvocation) => {
        events.emit('tool:progress', {
          invocationId: invocation.id,
          progress: 45,
          message: 'Writing note...',
        });
        return toolSuccess(invocation.toolId, { noteId: 'weather.md' }, invocation.startedAt ?? new Date());
      }),
    } as unknown as ToolExecutorPort;

    const service = new ToolInvocationService({
      toolRegistry: registry,
      toolExecutor: executor,
      attachInvocation: vi.fn(),
      updateInvocation: (_conversationId, _messageId, invocation) => {
        updates.push(invocation);
      },
      setExecutingTools: vi.fn(),
    });

    const result = await service.executeToolCalls(toolCalls, 'conv-1', 'msg-1');

    expect(result[0]?.status).toBe('completed');
    expect(updates.some((invocation) => invocation.status === 'executing')).toBe(true);
    expect(updates.some((invocation) => invocation.progress === 45 && invocation.message === 'Writing note...')).toBe(true);
    expect(updates.at(-1)?.status).toBe('completed');

    service.dispose();
  });
});
