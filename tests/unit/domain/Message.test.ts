/**
 * Unit tests for Message entity
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createMessageFromResponse,
  appendText,
  addToolUse,
  addToolInvocation,
  updateToolInvocation,
  upsertActivity,
  finishRunningActivity,
  deserializeActivityEntries,
  finishStreaming,
  setMetadata,
  getTextContent,
  getToolCalls,
  hasPendingInvocations,
  hasToolInvocations,
  getPreview,
  serializeMessage,
  type Message,
  type ContentBlock,
} from '$lib/domain/entities/Message';
import type { ToolInvocation, InvocationStatus } from '$lib/domain/entities/ToolInvocation';
import type { AIResponse, ToolCall } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';

// =========================================================================
// Test helpers
// =========================================================================

/**
 * Create a test ToolCall.
 */
function createTestToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: 'note:create' as ToolId,
    args: { title: 'Test Note' },
    ...overrides,
  };
}

/**
 * Create a test ToolInvocation.
 */
function createTestToolInvocation(overrides?: Partial<ToolInvocation>): ToolInvocation {
  return {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: 'note:create' as ToolId,
    args: { title: 'Test Note' },
    status: 'pending' as InvocationStatus,
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
 * Create a test AIResponse.
 */
function createTestAIResponse(overrides?: Partial<AIResponse>): AIResponse {
  return {
    chat: 'Hello, how can I help?',
    toolCalls: [],
    meta: {
      provider: 'anthropic',
      model: 'claude-3',
      latencyMs: 150,
    },
    truncated: false,
    stopReason: 'end_turn',
    ...overrides,
  };
}

/**
 * Create a test Message.
 */
function createTestMessage(overrides?: Partial<Message>): Message {
  const now = new Date();
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text: 'Test message' }],
    text: 'Test message',
    toolInvocations: [],
    createdAt: now,
    updatedAt: now,
    isStreaming: false,
    ...overrides,
  };
}

// =========================================================================
// Tests
// =========================================================================

describe('Message entity', () => {
  describe('createUserMessage()', () => {
    it('creates a message with the provided text', () => {
      const message = createUserMessage('Hello, world!');

      expect(message.text).toBe('Hello, world!');
      expect(message.role).toBe('user');
    });

    it('generates a unique ID with msg_ prefix', () => {
      const message = createUserMessage('Test');

      expect(message.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });

    it('generates unique IDs for each message', () => {
      const msg1 = createUserMessage('First');
      const msg2 = createUserMessage('Second');

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('creates a text content block', () => {
      const message = createUserMessage('Hello');

      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({ type: 'text', text: 'Hello' });
    });

    it('initializes with empty toolInvocations', () => {
      const message = createUserMessage('Test');

      expect(message.toolInvocations).toEqual([]);
    });

    it('sets isStreaming to false', () => {
      const message = createUserMessage('Test');

      expect(message.isStreaming).toBe(false);
    });

    it('sets createdAt and updatedAt to the same time', () => {
      const message = createUserMessage('Test');

      expect(message.createdAt).toEqual(message.updatedAt);
    });

    it('handles empty string text', () => {
      const message = createUserMessage('');

      expect(message.text).toBe('');
      expect(message.content[0]).toEqual({ type: 'text', text: '' });
    });

    it('handles multiline text', () => {
      const multiline = 'Line 1\nLine 2\nLine 3';
      const message = createUserMessage(multiline);

      expect(message.text).toBe(multiline);
    });
  });

  describe('createAssistantMessage()', () => {
    it('creates a message with default values when no params provided', () => {
      const message = createAssistantMessage();

      expect(message.role).toBe('assistant');
      expect(message.text).toBe('');
      expect(message.content).toEqual([]);
      expect(message.isStreaming).toBe(false);
    });

    it('creates a message with provided text', () => {
      const message = createAssistantMessage({ text: 'Hello!' });

      expect(message.text).toBe('Hello!');
      expect(message.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    });

    it('creates a streaming message when isStreaming is true', () => {
      const message = createAssistantMessage({ isStreaming: true });

      expect(message.isStreaming).toBe(true);
    });

    it('creates a non-streaming message when isStreaming is false', () => {
      const message = createAssistantMessage({ isStreaming: false });

      expect(message.isStreaming).toBe(false);
    });

    it('sets metadata when provided', () => {
      const metadata = {
        provider: 'anthropic',
        model: 'claude-3',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
      const message = createAssistantMessage({ metadata });

      expect(message.metadata).toEqual(metadata);
    });

    it('does not include metadata when not provided', () => {
      const message = createAssistantMessage({ text: 'Test' });

      expect(message.metadata).toBeUndefined();
    });

    it('creates empty content array when text is empty', () => {
      const message = createAssistantMessage({ text: '' });

      expect(message.content).toEqual([]);
      expect(message.text).toBe('');
    });

    it('generates unique IDs', () => {
      const msg1 = createAssistantMessage();
      const msg2 = createAssistantMessage();

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('combines text, streaming, and metadata', () => {
      const message = createAssistantMessage({
        text: 'Thinking...',
        isStreaming: true,
        metadata: { provider: 'anthropic', model: 'claude-3' },
      });

      expect(message.text).toBe('Thinking...');
      expect(message.isStreaming).toBe(true);
      expect(message.metadata?.provider).toBe('anthropic');
    });
  });

  describe('createSystemMessage()', () => {
    it('creates a system message with the provided text', () => {
      const message = createSystemMessage('You are a helpful assistant.');

      expect(message.role).toBe('system');
      expect(message.text).toBe('You are a helpful assistant.');
    });

    it('creates a text content block', () => {
      const message = createSystemMessage('System context');

      expect(message.content).toEqual([{ type: 'text', text: 'System context' }]);
    });

    it('sets isStreaming to false', () => {
      const message = createSystemMessage('Test');

      expect(message.isStreaming).toBe(false);
    });

    it('initializes with empty toolInvocations', () => {
      const message = createSystemMessage('Test');

      expect(message.toolInvocations).toEqual([]);
    });

    it('generates unique IDs', () => {
      const msg1 = createSystemMessage('First');
      const msg2 = createSystemMessage('Second');

      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('createMessageFromResponse()', () => {
    it('creates a message from an AIResponse with text', () => {
      const response = createTestAIResponse({ chat: 'Here is the answer.' });
      const message = createMessageFromResponse(response);

      expect(message.role).toBe('assistant');
      expect(message.text).toBe('Here is the answer.');
    });

    it('creates text content block from chat', () => {
      const response = createTestAIResponse({ chat: 'Hello' });
      const message = createMessageFromResponse(response);

      const textBlock = message.content.find((b) => b.type === 'text');
      expect(textBlock).toEqual({ type: 'text', text: 'Hello' });
    });

    it('creates tool_use content blocks from toolCalls', () => {
      const toolCall = createTestToolCall({ toolId: 'note:create' as ToolId });
      const response = createTestAIResponse({
        chat: 'Creating a note.',
        toolCalls: [toolCall],
      });
      const message = createMessageFromResponse(response);

      const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks).toHaveLength(1);
      expect((toolUseBlocks[0] as { type: 'tool_use'; toolCall: ToolCall }).toolCall).toEqual(toolCall);
    });

    it('creates multiple tool_use blocks for multiple toolCalls', () => {
      const toolCall1 = createTestToolCall({ toolId: 'note:create' as ToolId });
      const toolCall2 = createTestToolCall({ toolId: 'note:update' as ToolId });
      const response = createTestAIResponse({
        chat: 'Doing stuff.',
        toolCalls: [toolCall1, toolCall2],
      });
      const message = createMessageFromResponse(response);

      const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks).toHaveLength(2);
    });

    it('sets metadata from response meta', () => {
      const response = createTestAIResponse({
        meta: {
          provider: 'openai',
          model: 'gpt-4',
          latencyMs: 200,
        },
      });
      const message = createMessageFromResponse(response);

      expect(message.metadata?.provider).toBe('openai');
      expect(message.metadata?.model).toBe('gpt-4');
    });

    it('includes usage in metadata when present', () => {
      const response = createTestAIResponse({
        meta: {
          provider: 'anthropic',
          model: 'claude-3',
          latencyMs: 100,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      });
      const message = createMessageFromResponse(response);

      expect(message.metadata?.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
    });

    it('does not include usage when not in response', () => {
      const response = createTestAIResponse({
        meta: {
          provider: 'anthropic',
          model: 'claude-3',
          latencyMs: 100,
        },
      });
      const message = createMessageFromResponse(response);

      expect(message.metadata?.usage).toBeUndefined();
    });

    it('sets isStreaming to false', () => {
      const response = createTestAIResponse();
      const message = createMessageFromResponse(response);

      expect(message.isStreaming).toBe(false);
    });

    it('initializes toolInvocations as empty array', () => {
      const response = createTestAIResponse();
      const message = createMessageFromResponse(response);

      expect(message.toolInvocations).toEqual([]);
    });

    it('handles response with no chat content', () => {
      const toolCall = createTestToolCall();
      const response = createTestAIResponse({
        chat: '',
        toolCalls: [toolCall],
      });
      const message = createMessageFromResponse(response);

      expect(message.text).toBe('');
      const textBlocks = message.content.filter((b) => b.type === 'text');
      expect(textBlocks).toHaveLength(0);
    });
  });

  describe('appendText()', () => {
    it('appends text to an existing text block', () => {
      const message = createTestMessage({
        text: 'Hello',
        content: [{ type: 'text', text: 'Hello' }],
      });
      const updated = appendText(message, ' World');

      expect(updated.text).toBe('Hello World');
    });

    it('updates the text block in content', () => {
      const message = createTestMessage({
        text: 'Hello',
        content: [{ type: 'text', text: 'Hello' }],
      });
      const updated = appendText(message, ' World');

      const textBlock = updated.content.find((b) => b.type === 'text');
      expect(textBlock).toEqual({ type: 'text', text: 'Hello World' });
    });

    it('creates a text block if none exists', () => {
      const message = createTestMessage({
        text: '',
        content: [],
      });
      const updated = appendText(message, 'New text');

      expect(updated.text).toBe('New text');
      expect(updated.content).toContainEqual({ type: 'text', text: 'New text' });
    });

    it('updates updatedAt timestamp', () => {
      const message = createTestMessage();
      const originalUpdatedAt = message.updatedAt;

      // Small delay to ensure time difference
      const updated = appendText(message, ' more');

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const message = createTestMessage({
        text: 'Original',
        content: [{ type: 'text', text: 'Original' }],
      });
      const updated = appendText(message, ' Added');

      expect(message.text).toBe('Original');
      expect(updated.text).toBe('Original Added');
    });

    it('handles empty delta string', () => {
      const message = createTestMessage({
        text: 'Hello',
        content: [{ type: 'text', text: 'Hello' }],
      });
      const updated = appendText(message, '');

      expect(updated.text).toBe('Hello');
    });

    it('preserves other content blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        text: 'Hello',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', toolCall },
        ],
      });
      const updated = appendText(message, ' World');

      expect(updated.content).toHaveLength(2);
      const toolBlock = updated.content.find((b) => b.type === 'tool_use');
      expect(toolBlock).toBeDefined();
    });
  });

  describe('addToolUse()', () => {
    it('adds a tool use block to the message', () => {
      const message = createTestMessage();
      const toolCall = createTestToolCall();
      const updated = addToolUse(message, toolCall);

      const toolBlocks = updated.content.filter((b) => b.type === 'tool_use');
      expect(toolBlocks).toHaveLength(1);
    });

    it('preserves existing content blocks', () => {
      const message = createTestMessage({
        content: [{ type: 'text', text: 'Hello' }],
      });
      const toolCall = createTestToolCall();
      const updated = addToolUse(message, toolCall);

      expect(updated.content).toHaveLength(2);
      expect(updated.content[0]).toEqual({ type: 'text', text: 'Hello' });
    });

    it('updates updatedAt timestamp', () => {
      const message = createTestMessage();
      const toolCall = createTestToolCall();
      const updated = addToolUse(message, toolCall);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.updatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const message = createTestMessage();
      const originalLength = message.content.length;
      const toolCall = createTestToolCall();
      addToolUse(message, toolCall);

      expect(message.content.length).toBe(originalLength);
    });

    it('can add multiple tool use blocks', () => {
      let message = createTestMessage();
      const toolCall1 = createTestToolCall({ toolId: 'note:create' as ToolId });
      const toolCall2 = createTestToolCall({ toolId: 'note:update' as ToolId });

      message = addToolUse(message, toolCall1);
      message = addToolUse(message, toolCall2);

      const toolBlocks = message.content.filter((b) => b.type === 'tool_use');
      expect(toolBlocks).toHaveLength(2);
    });
  });

  describe('addToolInvocation()', () => {
    it('adds a tool invocation to the message', () => {
      const message = createTestMessage();
      const invocation = createTestToolInvocation();
      const updated = addToolInvocation(message, invocation);

      expect(updated.toolInvocations).toHaveLength(1);
      expect(updated.toolInvocations[0]).toEqual(invocation);
    });

    it('preserves existing tool invocations', () => {
      const invocation1 = createTestToolInvocation();
      const message = createTestMessage({
        toolInvocations: [invocation1],
      });
      const invocation2 = createTestToolInvocation();
      const updated = addToolInvocation(message, invocation2);

      expect(updated.toolInvocations).toHaveLength(2);
    });

    it('updates updatedAt timestamp', () => {
      const message = createTestMessage();
      const invocation = createTestToolInvocation();
      const updated = addToolInvocation(message, invocation);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.updatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const message = createTestMessage();
      const invocation = createTestToolInvocation();
      addToolInvocation(message, invocation);

      expect(message.toolInvocations).toHaveLength(0);
    });
  });

  describe('updateToolInvocation()', () => {
    it('updates the specified tool invocation', () => {
      const invocation = createTestToolInvocation({ status: 'pending' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      const updated = updateToolInvocation(message, invocation.id, (inv) => ({
        ...inv,
        status: 'executing',
      }));

      expect(updated.toolInvocations[0].status).toBe('executing');
    });

    it('does not modify other invocations', () => {
      const inv1 = createTestToolInvocation({ status: 'pending' });
      const inv2 = createTestToolInvocation({ status: 'pending' });
      const message = createTestMessage({
        toolInvocations: [inv1, inv2],
      });

      const updated = updateToolInvocation(message, inv1.id, (inv) => ({
        ...inv,
        status: 'executing',
      }));

      expect(updated.toolInvocations[0].status).toBe('executing');
      expect(updated.toolInvocations[1].status).toBe('pending');
    });

    it('does nothing if invocation ID not found', () => {
      const invocation = createTestToolInvocation();
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      const updated = updateToolInvocation(message, 'nonexistent_id', (inv) => ({
        ...inv,
        status: 'executing',
      }));

      expect(updated.toolInvocations[0].status).toBe(invocation.status);
    });

    it('updates updatedAt timestamp', () => {
      const invocation = createTestToolInvocation();
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      const updated = updateToolInvocation(message, invocation.id, (inv) => inv);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.updatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const invocation = createTestToolInvocation({ status: 'pending' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      updateToolInvocation(message, invocation.id, (inv) => ({
        ...inv,
        status: 'executing',
      }));

      expect(message.toolInvocations[0].status).toBe('pending');
    });
  });

  describe('activity helpers', () => {
    it('adds a compact activity entry without changing message text', () => {
      const message = createTestMessage({ role: 'assistant', text: 'Final answer' });
      const updated = upsertActivity(message, {
        id: 'cli-think',
        status: 'running',
        label: 'Thinking through the request',
      });

      expect(updated.text).toBe('Final answer');
      expect(updated.activity).toHaveLength(1);
      expect(updated.activity?.[0]?.status).toBe('running');
      expect(updated.activity?.[0]?.label).toBe('Thinking through the request');
    });

    it('updates an existing activity entry by id', () => {
      let message = createTestMessage({ role: 'assistant' });
      message = upsertActivity(message, {
        id: 'cli-tool',
        status: 'running',
        label: 'Using local tools',
      });
      const updated = upsertActivity(message, {
        id: 'cli-tool',
        status: 'completed',
        label: 'Using local tools',
        detail: 'note:create',
      });

      expect(updated.activity).toHaveLength(1);
      expect(updated.activity?.[0]?.status).toBe('completed');
      expect(updated.activity?.[0]?.detail).toBe('note:create');
      expect(updated.activity?.[0]?.completedAt).toBeInstanceOf(Date);
    });

    it('marks previous running activity completed when a new running entry starts', () => {
      let message = createTestMessage({ role: 'assistant' });
      message = upsertActivity(message, {
        id: 'cli-think',
        status: 'running',
        label: 'Thinking through the request',
      });
      const updated = upsertActivity(message, {
        id: 'cli-draft',
        status: 'running',
        label: 'Drafting the response',
      });

      expect(updated.activity?.[0]?.status).toBe('completed');
      expect(updated.activity?.[1]?.status).toBe('running');
    });

    it('caps activity history to the latest entries', () => {
      let message = createTestMessage({ role: 'assistant' });
      for (let i = 0; i < 15; i++) {
        message = upsertActivity(message, {
          id: `step-${i}`,
          status: 'completed',
          label: `Step ${i}`,
        });
      }

      expect(message.activity).toHaveLength(12);
      expect(message.activity?.[0]?.id).toBe('step-3');
      expect(message.activity?.[11]?.id).toBe('step-14');
    });

    it('finishes running activity entries', () => {
      const message = upsertActivity(createTestMessage({ role: 'assistant' }), {
        id: 'cli-think',
        status: 'running',
        label: 'Thinking through the request',
      });

      const updated = finishRunningActivity(message, 'failed');
      expect(updated.activity?.[0]?.status).toBe('failed');
      expect(updated.activity?.[0]?.completedAt).toBeInstanceOf(Date);
    });

    it('deserializes persisted activity dates and tolerates old messages without activity', () => {
      expect(deserializeActivityEntries(undefined)).toBeUndefined();

      const entries = deserializeActivityEntries([
        {
          id: 'cli-finish',
          status: 'completed',
          label: 'Finished local agent',
          createdAt: '2026-05-04T13:13:22.000Z',
          updatedAt: '2026-05-04T13:13:23.000Z',
          completedAt: '2026-05-04T13:13:23.000Z',
        },
      ]);

      expect(entries).toHaveLength(1);
      expect(entries?.[0]?.createdAt).toBeInstanceOf(Date);
      expect(entries?.[0]?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('finishStreaming()', () => {
    it('sets isStreaming to false', () => {
      const message = createTestMessage({ isStreaming: true });
      const updated = finishStreaming(message);

      expect(updated.isStreaming).toBe(false);
    });

    it('updates updatedAt timestamp', () => {
      const message = createTestMessage({ isStreaming: true });
      const updated = finishStreaming(message);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.updatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const message = createTestMessage({ isStreaming: true });
      finishStreaming(message);

      expect(message.isStreaming).toBe(true);
    });

    it('preserves all other message properties', () => {
      const message = createTestMessage({
        text: 'Test text',
        role: 'assistant',
        isStreaming: true,
      });
      const updated = finishStreaming(message);

      expect(updated.text).toBe('Test text');
      expect(updated.role).toBe('assistant');
      expect(updated.id).toBe(message.id);
    });
  });

  describe('setMetadata()', () => {
    it('sets metadata on the message', () => {
      const message = createTestMessage();
      const metadata = {
        provider: 'anthropic',
        model: 'claude-3',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
      const updated = setMetadata(message, metadata);

      expect(updated.metadata).toEqual(metadata);
    });

    it('overwrites existing metadata', () => {
      const message = createTestMessage();
      (message as Message).metadata = { provider: 'old', model: 'old' };

      const newMetadata = { provider: 'new', model: 'new' };
      const updated = setMetadata(message, newMetadata);

      expect(updated.metadata).toEqual(newMetadata);
    });

    it('updates updatedAt timestamp', () => {
      const message = createTestMessage();
      const metadata = { provider: 'test', model: 'test' };
      const updated = setMetadata(message, metadata);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.updatedAt.getTime());
    });

    it('does not mutate the original message', () => {
      const message = createTestMessage();
      const metadata = { provider: 'test', model: 'test' };
      setMetadata(message, metadata);

      expect(message.metadata).toBeUndefined();
    });
  });

  describe('getTextContent()', () => {
    it('extracts text from a single text block', () => {
      const message = createTestMessage({
        content: [{ type: 'text', text: 'Hello world' }],
      });

      expect(getTextContent(message)).toBe('Hello world');
    });

    it('joins multiple text blocks with newlines', () => {
      const message = createTestMessage({
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
      });

      expect(getTextContent(message)).toBe('Line 1\nLine 2');
    });

    it('filters out non-text blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        content: [
          { type: 'text', text: 'Before' },
          { type: 'tool_use', toolCall },
          { type: 'text', text: 'After' },
        ],
      });

      expect(getTextContent(message)).toBe('Before\nAfter');
    });

    it('returns empty string when no text blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        content: [{ type: 'tool_use', toolCall }],
      });

      expect(getTextContent(message)).toBe('');
    });

    it('returns empty string for empty content array', () => {
      const message = createTestMessage({ content: [] });

      expect(getTextContent(message)).toBe('');
    });
  });

  describe('getToolCalls()', () => {
    it('extracts tool calls from tool_use blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        content: [{ type: 'tool_use', toolCall }],
      });

      const toolCalls = getToolCalls(message);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual(toolCall);
    });

    it('extracts multiple tool calls', () => {
      const toolCall1 = createTestToolCall({ toolId: 'note:create' as ToolId });
      const toolCall2 = createTestToolCall({ toolId: 'note:update' as ToolId });
      const message = createTestMessage({
        content: [
          { type: 'tool_use', toolCall: toolCall1 },
          { type: 'tool_use', toolCall: toolCall2 },
        ],
      });

      const toolCalls = getToolCalls(message);
      expect(toolCalls).toHaveLength(2);
    });

    it('filters out non-tool_use blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', toolCall },
        ],
      });

      const toolCalls = getToolCalls(message);
      expect(toolCalls).toHaveLength(1);
    });

    it('returns empty array when no tool_use blocks', () => {
      const message = createTestMessage({
        content: [{ type: 'text', text: 'Just text' }],
      });

      expect(getToolCalls(message)).toEqual([]);
    });

    it('returns empty array for empty content', () => {
      const message = createTestMessage({ content: [] });

      expect(getToolCalls(message)).toEqual([]);
    });
  });

  describe('hasPendingInvocations()', () => {
    it('returns true when there are pending invocations', () => {
      const invocation = createTestToolInvocation({ status: 'pending' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasPendingInvocations(message)).toBe(true);
    });

    it('returns true when there are executing invocations', () => {
      const invocation = createTestToolInvocation({ status: 'executing' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasPendingInvocations(message)).toBe(true);
    });

    it('returns false when all invocations are completed', () => {
      const invocation = createTestToolInvocation({ status: 'completed' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasPendingInvocations(message)).toBe(false);
    });

    it('returns false when all invocations are failed', () => {
      const invocation = createTestToolInvocation({ status: 'failed' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasPendingInvocations(message)).toBe(false);
    });

    it('returns false when all invocations are cancelled', () => {
      const invocation = createTestToolInvocation({ status: 'cancelled' });
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasPendingInvocations(message)).toBe(false);
    });

    it('returns false when no invocations', () => {
      const message = createTestMessage({ toolInvocations: [] });

      expect(hasPendingInvocations(message)).toBe(false);
    });

    it('returns true if any invocation is pending among mixed statuses', () => {
      const inv1 = createTestToolInvocation({ status: 'completed' });
      const inv2 = createTestToolInvocation({ status: 'pending' });
      const message = createTestMessage({
        toolInvocations: [inv1, inv2],
      });

      expect(hasPendingInvocations(message)).toBe(true);
    });
  });

  describe('hasToolInvocations()', () => {
    it('returns true when there are tool invocations', () => {
      const invocation = createTestToolInvocation();
      const message = createTestMessage({
        toolInvocations: [invocation],
      });

      expect(hasToolInvocations(message)).toBe(true);
    });

    it('returns false when no tool invocations', () => {
      const message = createTestMessage({ toolInvocations: [] });

      expect(hasToolInvocations(message)).toBe(false);
    });

    it('returns true regardless of invocation status', () => {
      const inv = createTestToolInvocation({ status: 'completed' });
      const message = createTestMessage({
        toolInvocations: [inv],
      });

      expect(hasToolInvocations(message)).toBe(true);
    });
  });

  describe('getPreview()', () => {
    it('returns full text when shorter than maxLength', () => {
      const message = createTestMessage({ text: 'Short text' });

      expect(getPreview(message)).toBe('Short text');
    });

    it('truncates text longer than default maxLength (100)', () => {
      const longText = 'A'.repeat(150);
      const message = createTestMessage({ text: longText });
      const preview = getPreview(message);

      expect(preview.length).toBeLessThanOrEqual(103); // 100 chars + '...'
      expect(preview.endsWith('...')).toBe(true);
    });

    it('uses custom maxLength when provided', () => {
      const message = createTestMessage({ text: 'This is a test message' });
      const preview = getPreview(message, 10);

      expect(preview.length).toBeLessThanOrEqual(13); // 10 chars + '...'
      expect(preview.endsWith('...')).toBe(true);
    });

    it('returns exact text when length equals maxLength', () => {
      const text = 'A'.repeat(100);
      const message = createTestMessage({ text });

      expect(getPreview(message, 100)).toBe(text);
    });

    it('handles empty text', () => {
      const message = createTestMessage({ text: '' });

      expect(getPreview(message)).toBe('');
    });

    it('trims trailing whitespace before adding ellipsis', () => {
      const text = 'A'.repeat(95) + '     ' + 'B'.repeat(50);
      const message = createTestMessage({ text });
      const preview = getPreview(message, 100);

      // Should trim the trailing spaces at the cut point
      expect(preview.endsWith('...')).toBe(true);
    });
  });

  describe('serializeMessage()', () => {
    it('serializes message with required fields', () => {
      const message = createTestMessage({
        id: 'msg_123',
        role: 'user',
        text: 'Hello',
        content: [{ type: 'text', text: 'Hello' }],
      });
      const serialized = serializeMessage(message);

      expect(serialized.id).toBe('msg_123');
      expect(serialized.role).toBe('user');
      expect(serialized.text).toBe('Hello');
      expect(serialized.content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('converts createdAt to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const message = createTestMessage({ createdAt: date });
      const serialized = serializeMessage(message);

      expect(serialized.createdAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('includes metadata when present', () => {
      const message = createTestMessage();
      (message as Message).metadata = {
        provider: 'anthropic',
        model: 'claude-3',
      };
      const serialized = serializeMessage(message);

      expect(serialized.metadata).toEqual({
        provider: 'anthropic',
        model: 'claude-3',
      });
    });

    it('includes undefined metadata when not present', () => {
      const message = createTestMessage();
      const serialized = serializeMessage(message);

      expect(serialized.metadata).toBeUndefined();
    });

    it('excludes toolInvocations from serialization', () => {
      const invocation = createTestToolInvocation();
      const message = createTestMessage({
        toolInvocations: [invocation],
      });
      const serialized = serializeMessage(message);

      expect(serialized.toolInvocations).toBeUndefined();
    });

    it('excludes isStreaming from serialization', () => {
      const message = createTestMessage({ isStreaming: true });
      const serialized = serializeMessage(message);

      expect(serialized.isStreaming).toBeUndefined();
    });

    it('excludes updatedAt from serialization', () => {
      const message = createTestMessage();
      const serialized = serializeMessage(message);

      expect(serialized.updatedAt).toBeUndefined();
    });

    it('serializes complex content blocks', () => {
      const toolCall = createTestToolCall();
      const message = createTestMessage({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', toolCall },
        ],
      });
      const serialized = serializeMessage(message);

      expect(serialized.content).toHaveLength(2);
    });
  });
});
