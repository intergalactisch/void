/**
 * Unit tests for AIResponse value object
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEmptyResponse,
  createToolCall,
  hasToolCalls,
  hasChatContent,
  summarizeResponse,
  mergeChunk,
  parseToolCalls,
  extractChatContent,
} from '$lib/domain/values/AIResponse';
import type { AIResponse, AIResponseChunk, ToolCall } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';

describe('AIResponse value object', () => {
  const testToolId = 'note:create' as ToolId;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createEmptyResponse()', () => {
    it('creates an empty response with provider and model', () => {
      const response = createEmptyResponse('anthropic', 'claude-3-opus');

      expect(response.chat).toBe('');
      expect(response.toolCalls).toEqual([]);
      expect(response.meta.provider).toBe('anthropic');
      expect(response.meta.model).toBe('claude-3-opus');
      expect(response.meta.latencyMs).toBe(0);
      expect(response.truncated).toBe(false);
      expect(response.stopReason).toBe('end_turn');
    });

    it('creates response with default values', () => {
      const response = createEmptyResponse('openai', 'gpt-4');

      expect(response.meta.usage).toBeUndefined();
      expect(response.meta.responseId).toBeUndefined();
    });

    it('handles different provider/model combinations', () => {
      const anthropic = createEmptyResponse('anthropic', 'claude-3-sonnet');
      const openai = createEmptyResponse('openai', 'gpt-4-turbo');
      const local = createEmptyResponse('ollama', 'llama2');

      expect(anthropic.meta.provider).toBe('anthropic');
      expect(openai.meta.provider).toBe('openai');
      expect(local.meta.provider).toBe('ollama');
    });
  });

  describe('createToolCall()', () => {
    it('creates a tool call with generated ID', () => {
      const toolCall = createToolCall(testToolId, { title: 'New Note' });

      expect(toolCall.toolId).toBe(testToolId);
      expect(toolCall.args).toEqual({ title: 'New Note' });
      expect(toolCall.id).toMatch(/^tc_\d+_[a-z0-9]+$/);
    });

    it('generates unique IDs for different calls', () => {
      const call1 = createToolCall(testToolId, {});

      // Advance time slightly to ensure different timestamp
      vi.advanceTimersByTime(1);
      const call2 = createToolCall(testToolId, {});

      expect(call1.id).not.toBe(call2.id);
    });

    it('handles empty args', () => {
      const toolCall = createToolCall('navigation:back' as ToolId, {});

      expect(toolCall.args).toEqual({});
    });

    it('handles complex args', () => {
      const args = {
        title: 'Test',
        content: 'Hello World',
        tags: ['a', 'b'],
        meta: { draft: true, priority: 1 },
      };
      const toolCall = createToolCall(testToolId, args);

      expect(toolCall.args).toEqual(args);
    });
  });

  describe('hasToolCalls()', () => {
    it('returns true when response has tool calls', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        toolCalls: [createToolCall(testToolId, {})],
      };

      expect(hasToolCalls(response)).toBe(true);
    });

    it('returns false when response has no tool calls', () => {
      const response = createEmptyResponse('anthropic', 'claude-3');

      expect(hasToolCalls(response)).toBe(false);
    });

    it('returns true for multiple tool calls', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        toolCalls: [
          createToolCall(testToolId, {}),
          createToolCall('editor:format' as ToolId, {}),
        ],
      };

      expect(hasToolCalls(response)).toBe(true);
    });
  });

  describe('hasChatContent()', () => {
    it('returns true when response has chat content', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        chat: 'Hello! I can help you with that.',
      };

      expect(hasChatContent(response)).toBe(true);
    });

    it('returns false when chat is empty', () => {
      const response = createEmptyResponse('anthropic', 'claude-3');

      expect(hasChatContent(response)).toBe(false);
    });

    it('returns false when chat is only whitespace', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        chat: '   \n\t  ',
      };

      expect(hasChatContent(response)).toBe(false);
    });

    it('returns true for chat with leading/trailing whitespace', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        chat: '  content  ',
      };

      expect(hasChatContent(response)).toBe(true);
    });
  });

  describe('summarizeResponse()', () => {
    it('summarizes response with chat only', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3-opus'),
        chat: 'Hello, how can I help you today?',
      };

      const summary = summarizeResponse(response);

      expect(summary).toBe('[anthropic/claude-3-opus] "Hello, how can I help you today?"');
    });

    it('truncates long chat content', () => {
      const longChat = 'A'.repeat(100);
      const response: AIResponse = {
        ...createEmptyResponse('openai', 'gpt-4'),
        chat: longChat,
      };

      const summary = summarizeResponse(response);

      expect(summary).toBe(`[openai/gpt-4] "${'A'.repeat(50)}..."`);
    });

    it('includes tool call count and IDs', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        chat: 'Creating note',
        toolCalls: [
          createToolCall(testToolId, {}),
          createToolCall('editor:format' as ToolId, {}),
        ],
      };

      const summary = summarizeResponse(response);

      expect(summary).toContain('2 tool call(s)');
      expect(summary).toContain('note:create');
      expect(summary).toContain('editor:format');
    });

    it('handles empty chat with tool calls', () => {
      const response: AIResponse = {
        ...createEmptyResponse('anthropic', 'claude-3'),
        chat: '',
        toolCalls: [createToolCall(testToolId, {})],
      };

      const summary = summarizeResponse(response);

      expect(summary).toBe('[anthropic/claude-3] "" + 1 tool call(s): note:create');
    });

    it('handles response with no chat and no tools', () => {
      const response = createEmptyResponse('anthropic', 'claude-3');

      const summary = summarizeResponse(response);

      expect(summary).toBe('[anthropic/claude-3] ""');
    });
  });

  describe('mergeChunk()', () => {
    describe('chat chunks', () => {
      it('appends chat delta to response', () => {
        const response = createEmptyResponse('anthropic', 'claude-3');
        const chunk: AIResponseChunk = {
          type: 'chat',
          chatDelta: 'Hello',
        };

        const updated = mergeChunk(response, chunk);

        expect(updated.chat).toBe('Hello');
      });

      it('accumulates multiple chat chunks', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');

        response = mergeChunk(response, { type: 'chat', chatDelta: 'Hello' });
        response = mergeChunk(response, { type: 'chat', chatDelta: ', ' });
        response = mergeChunk(response, { type: 'chat', chatDelta: 'world!' });

        expect(response.chat).toBe('Hello, world!');
      });

      it('handles undefined chatDelta', () => {
        const response = createEmptyResponse('anthropic', 'claude-3');
        const chunk: AIResponseChunk = {
          type: 'chat',
          chatDelta: undefined,
        };

        const updated = mergeChunk(response, chunk);

        expect(updated.chat).toBe('');
      });
    });

    describe('tool_start chunks', () => {
      it('starts a new tool call', () => {
        const response = createEmptyResponse('anthropic', 'claude-3');
        const chunk: AIResponseChunk = {
          type: 'tool_start',
          toolCall: {
            id: 'tc_123',
            toolId: testToolId,
            args: {},
          },
        };

        const updated = mergeChunk(response, chunk);

        expect(updated.toolCalls).toHaveLength(1);
        expect(updated.toolCalls[0]?.id).toBe('tc_123');
        expect(updated.toolCalls[0]?.toolId).toBe(testToolId);
      });

      it('generates ID if not provided', () => {
        const response = createEmptyResponse('anthropic', 'claude-3');
        const chunk: AIResponseChunk = {
          type: 'tool_start',
          toolCall: {
            toolId: testToolId,
            args: {},
          },
        };

        const updated = mergeChunk(response, chunk);

        expect(updated.toolCalls[0]?.id).toMatch(/^tc_\d+$/);
      });

      it('handles missing toolCall gracefully', () => {
        const response = createEmptyResponse('anthropic', 'claude-3');
        const chunk: AIResponseChunk = {
          type: 'tool_start',
        };

        const updated = mergeChunk(response, chunk);

        expect(updated.toolCalls).toHaveLength(0);
      });
    });

    describe('tool_args chunks', () => {
      it('merges args into existing tool call', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: {} },
        });

        response = mergeChunk(response, {
          type: 'tool_args',
          toolIndex: 0,
          toolCall: { args: { title: 'Note' } },
        });

        expect(response.toolCalls[0]?.args).toEqual({ title: 'Note' });
      });

      it('accumulates multiple arg chunks', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: {} },
        });

        response = mergeChunk(response, {
          type: 'tool_args',
          toolIndex: 0,
          toolCall: { args: { title: 'Note' } },
        });

        response = mergeChunk(response, {
          type: 'tool_args',
          toolIndex: 0,
          toolCall: { args: { content: 'Hello' } },
        });

        expect(response.toolCalls[0]?.args).toEqual({ title: 'Note', content: 'Hello' });
      });

      it('handles invalid toolIndex gracefully', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: {} },
        });

        response = mergeChunk(response, {
          type: 'tool_args',
          toolIndex: 5, // Invalid index
          toolCall: { args: { title: 'Note' } },
        });

        // Should not crash, original args should remain
        expect(response.toolCalls[0]?.args).toEqual({});
      });

      it('handles undefined toolIndex', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: {} },
        });

        response = mergeChunk(response, {
          type: 'tool_args',
          toolCall: { args: { title: 'Note' } },
        });

        // Should not modify without valid index
        expect(response.toolCalls[0]?.args).toEqual({});
      });
    });

    describe('tool_end chunks', () => {
      it('handles tool_end without error', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: { title: 'Note' } },
        });

        response = mergeChunk(response, {
          type: 'tool_end',
        });

        // tool_end is a no-op, tool call should remain intact
        expect(response.toolCalls).toHaveLength(1);
        expect(response.toolCalls[0]?.args).toEqual({ title: 'Note' });
      });
    });

    describe('immutability', () => {
      it('does not mutate the original response', () => {
        const original = createEmptyResponse('anthropic', 'claude-3');
        const updated = mergeChunk(original, {
          type: 'chat',
          chatDelta: 'Hello',
        });

        expect(original.chat).toBe('');
        expect(updated.chat).toBe('Hello');
        expect(original).not.toBe(updated);
      });

      it('does not mutate toolCalls array', () => {
        let response = createEmptyResponse('anthropic', 'claude-3');
        const originalToolCalls = response.toolCalls;

        response = mergeChunk(response, {
          type: 'tool_start',
          toolCall: { id: 'tc_1', toolId: testToolId, args: {} },
        });

        expect(originalToolCalls).toHaveLength(0);
        expect(response.toolCalls).toHaveLength(1);
      });
    });
  });

  describe('parseToolCalls()', () => {
    it('parses single tool call', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{"title": "My Note", "content": "Hello"}</args>
        </tool_call>
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.toolId).toBe('note:create');
      expect(toolCalls[0]?.args).toEqual({ title: 'My Note', content: 'Hello' });
    });

    it('parses multiple tool calls', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{"title": "First"}</args>
        </tool_call>
        <tool_call>
        <tool>editor:format</tool>
        <args>{"style": "bold"}</args>
        </tool_call>
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.toolId).toBe('note:create');
      expect(toolCalls[1]?.toolId).toBe('editor:format');
    });

    it('handles tool calls with chat content', () => {
      const rawOutput = `
        I'll create a note for you.
        <tool_call>
        <tool>note:create</tool>
        <args>{"title": "Test"}</args>
        </tool_call>
        The note has been created!
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.args).toEqual({ title: 'Test' });
    });

    it('generates unique IDs for parsed tool calls', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{}</args>
        </tool_call>
        <tool_call>
        <tool>note:delete</tool>
        <args>{}</args>
        </tool_call>
      `;

      vi.advanceTimersByTime(1);
      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls[0]?.id).toMatch(/^tc_\d+_[a-z0-9]+$/);
      expect(toolCalls[1]?.id).toMatch(/^tc_\d+_[a-z0-9]+$/);
    });

    it('returns empty array for no tool calls', () => {
      const rawOutput = 'Just some regular text without any tools.';

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toEqual([]);
    });

    it('skips invalid JSON in args', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{invalid json}</args>
        </tool_call>
        <tool_call>
        <tool>note:delete</tool>
        <args>{"id": "123"}</args>
        </tool_call>
      `;

      // Mock console.warn to avoid test output noise
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.toolId).toBe('note:delete');

      warnSpy.mockRestore();
    });

    it('handles complex nested args', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{"title": "Note", "meta": {"tags": ["a", "b"], "priority": 1}, "content": "Hello\\nWorld"}</args>
        </tool_call>
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.args).toEqual({
        title: 'Note',
        meta: { tags: ['a', 'b'], priority: 1 },
        content: 'Hello\nWorld',
      });
    });

    it('handles multiline args JSON', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>
        {
          "title": "Note",
          "content": "Hello"
        }
        </args>
        </tool_call>
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.args).toEqual({ title: 'Note', content: 'Hello' });
    });

    it('handles empty args object', () => {
      const rawOutput = `
        <tool_call>
        <tool>navigation:back</tool>
        <args>{}</args>
        </tool_call>
      `;

      const toolCalls = parseToolCalls(rawOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.args).toEqual({});
    });
  });

  describe('extractChatContent()', () => {
    it('extracts chat without tool blocks', () => {
      const rawOutput = `
        Hello! I'll help you.
        <tool_call>
        <tool>note:create</tool>
        <args>{"title": "Test"}</args>
        </tool_call>
        The note was created.
      `;

      const chat = extractChatContent(rawOutput);

      expect(chat).toBe("Hello! I'll help you.\n        \n        The note was created.");
    });

    it('returns original content when no tool blocks', () => {
      const rawOutput = 'Just regular chat content here.';

      const chat = extractChatContent(rawOutput);

      expect(chat).toBe('Just regular chat content here.');
    });

    it('handles multiple tool blocks', () => {
      const rawOutput = `
        First message.
        <tool_call>
        <tool>note:create</tool>
        <args>{}</args>
        </tool_call>
        Second message.
        <tool_call>
        <tool>note:delete</tool>
        <args>{}</args>
        </tool_call>
        Third message.
      `;

      const chat = extractChatContent(rawOutput);

      expect(chat).toContain('First message');
      expect(chat).toContain('Second message');
      expect(chat).toContain('Third message');
      expect(chat).not.toContain('tool_call');
      expect(chat).not.toContain('note:create');
    });

    it('trims result', () => {
      const rawOutput = `
        <tool_call>
        <tool>note:create</tool>
        <args>{}</args>
        </tool_call>
      `;

      const chat = extractChatContent(rawOutput);

      expect(chat).toBe('');
    });

    it('handles adjacent tool blocks', () => {
      const rawOutput = `<tool_call>
        <tool>note:create</tool>
        <args>{}</args>
        </tool_call><tool_call>
        <tool>note:delete</tool>
        <args>{}</args>
        </tool_call>`;

      const chat = extractChatContent(rawOutput);

      expect(chat).toBe('');
    });

    it('preserves whitespace between non-tool content', () => {
      const rawOutput = `Line 1

Line 2

<tool_call>
<tool>note:create</tool>
<args>{}</args>
</tool_call>

Line 3`;

      const chat = extractChatContent(rawOutput);

      expect(chat).toContain('Line 1');
      expect(chat).toContain('Line 2');
      expect(chat).toContain('Line 3');
    });
  });
});
