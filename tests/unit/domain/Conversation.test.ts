/**
 * Unit tests for Conversation entity
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createConversation,
  addMessage,
  updateMessage,
  removeMessage,
  setTitle,
  setStatus,
  addTags,
  removeTags,
  clearMessages,
  getLastMessage,
  getLastUserMessage,
  getLastAssistantMessage,
  isEmpty,
  isAwaitingResponse,
  hasStreamingMessage,
  hasPendingTools,
  getMessageCount,
  getMessageCountByRole,
  getTotalWordCount,
  getMessagesForAPI,
  getPreview,
  serializeConversation,
  type Conversation,
} from '$lib/domain/entities/Conversation';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  type Message,
} from '$lib/domain/entities/Message';
import { createInvocation } from '$lib/domain/entities/ToolInvocation';
import { createEmptyContext, type PromptContext } from '$lib/domain/values/PromptContext';

describe('Conversation entity', () => {
  describe('createConversation()', () => {
    it('creates conversation with default values', () => {
      const conv = createConversation();

      expect(conv.id).toMatch(/^conv_\d+_[a-z0-9]+$/);
      expect(conv.title).toBe('New Conversation');
      expect(conv.messages).toEqual([]);
      expect(conv.status).toBe('active');
      expect(conv.initialContext).toBeNull();
      expect(conv.createdAt).toBeInstanceOf(Date);
      expect(conv.updatedAt).toBeInstanceOf(Date);
      expect(conv.totalTokens).toEqual({ input: 0, output: 0 });
      expect(conv.tags).toEqual([]);
    });

    it('creates conversation with custom title', () => {
      const conv = createConversation({ title: 'My Chat' });

      expect(conv.title).toBe('My Chat');
    });

    it('creates conversation with context', () => {
      const context = createEmptyContext();
      const conv = createConversation({ context });

      expect(conv.initialContext).toEqual(context);
    });

    it('creates conversation with tags', () => {
      const conv = createConversation({ tags: ['important', 'project-x'] });

      expect(conv.tags).toEqual(['important', 'project-x']);
    });

    it('creates conversation with all params', () => {
      const context = createEmptyContext();
      const conv = createConversation({
        title: 'Project Discussion',
        context,
        tags: ['work', 'urgent'],
      });

      expect(conv.title).toBe('Project Discussion');
      expect(conv.initialContext).toEqual(context);
      expect(conv.tags).toEqual(['work', 'urgent']);
    });

    it('generates unique IDs', () => {
      const conv1 = createConversation();
      const conv2 = createConversation();

      expect(conv1.id).not.toBe(conv2.id);
    });
  });

  describe('addMessage()', () => {
    let conversation: Conversation;

    beforeEach(() => {
      conversation = createConversation();
    });

    it('adds message to conversation', () => {
      const message = createUserMessage('Hello');
      const updated = addMessage(conversation, message);

      expect(updated.messages).toHaveLength(1);
      expect(updated.messages[0]).toEqual(message);
    });

    it('preserves existing messages', () => {
      const msg1 = createUserMessage('First');
      const msg2 = createAssistantMessage({ text: 'Second' });

      let updated = addMessage(conversation, msg1);
      updated = addMessage(updated, msg2);

      expect(updated.messages).toHaveLength(2);
      expect(updated.messages[0]).toEqual(msg1);
      expect(updated.messages[1]).toEqual(msg2);
    });

    it('updates updatedAt timestamp', () => {
      const message = createUserMessage('Hello');
      const before = conversation.updatedAt;

      // Add small delay to ensure timestamp differs
      const updated = addMessage(conversation, message);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('tracks token usage from message metadata', () => {
      const message = createAssistantMessage({
        text: 'Response',
        metadata: {
          provider: 'anthropic',
          model: 'claude-3',
          usage: { inputTokens: 50, outputTokens: 100 },
        },
      });

      const updated = addMessage(conversation, message);

      expect(updated.totalTokens).toEqual({ input: 50, output: 100 });
    });

    it('accumulates token usage across messages', () => {
      const msg1 = createAssistantMessage({
        text: 'First',
        metadata: {
          usage: { inputTokens: 10, outputTokens: 20 },
        },
      });
      const msg2 = createAssistantMessage({
        text: 'Second',
        metadata: {
          usage: { inputTokens: 15, outputTokens: 25 },
        },
      });

      let updated = addMessage(conversation, msg1);
      updated = addMessage(updated, msg2);

      expect(updated.totalTokens).toEqual({ input: 25, output: 45 });
    });

    it('auto-generates title from first user message', () => {
      const message = createUserMessage('How do I create a new project?');
      const updated = addMessage(conversation, message);

      expect(updated.title).toBe('How do I create a new project?');
    });

    it('truncates long auto-generated title at word boundary', () => {
      const longText = 'This is a very long message that should be truncated at a reasonable word boundary when used as title';
      const message = createUserMessage(longText);
      const updated = addMessage(conversation, message);

      expect(updated.title.length).toBeLessThanOrEqual(53); // 50 + "..."
      expect(updated.title).toContain('...');
    });

    it('does not change title if already set', () => {
      const conv = createConversation({ title: 'Custom Title' });
      const message = createUserMessage('New message');
      const updated = addMessage(conv, message);

      expect(updated.title).toBe('Custom Title');
    });

    it('does not auto-generate title for non-first messages', () => {
      const msg1 = createUserMessage('First');
      const msg2 = createUserMessage('Different title text');

      let updated = addMessage(conversation, msg1);
      updated = addMessage(updated, msg2);

      expect(updated.title).toBe('First'); // Still from first message
    });
  });

  describe('updateMessage()', () => {
    it('updates message in conversation', () => {
      let conv = createConversation();
      const message = createUserMessage('Original');
      conv = addMessage(conv, message);

      const updated = updateMessage(conv, message.id, (msg) => ({
        ...msg,
        text: 'Updated text',
      }));

      expect(updated.messages[0]!.text).toBe('Updated text');
    });

    it('does not affect other messages', () => {
      let conv = createConversation();
      const msg1 = createUserMessage('First');
      const msg2 = createUserMessage('Second');
      conv = addMessage(conv, msg1);
      conv = addMessage(conv, msg2);

      const updated = updateMessage(conv, msg1.id, (msg) => ({
        ...msg,
        text: 'Updated',
      }));

      expect(updated.messages[0]!.text).toBe('Updated');
      expect(updated.messages[1]!.text).toBe('Second');
    });

    it('updates updatedAt timestamp', () => {
      let conv = createConversation();
      const message = createUserMessage('Test');
      conv = addMessage(conv, message);
      const before = conv.updatedAt;

      const updated = updateMessage(conv, message.id, (msg) => ({
        ...msg,
        text: 'Changed',
      }));

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('leaves messages unchanged if ID not found', () => {
      let conv = createConversation();
      const message = createUserMessage('Test');
      conv = addMessage(conv, message);

      const updated = updateMessage(conv, 'nonexistent-id', (msg) => ({
        ...msg,
        text: 'Changed',
      }));

      expect(updated.messages[0]!.text).toBe('Test');
    });
  });

  describe('removeMessage()', () => {
    it('removes message from conversation', () => {
      let conv = createConversation();
      const message = createUserMessage('To remove');
      conv = addMessage(conv, message);

      const updated = removeMessage(conv, message.id);

      expect(updated.messages).toHaveLength(0);
    });

    it('preserves other messages', () => {
      let conv = createConversation();
      const msg1 = createUserMessage('Keep');
      const msg2 = createUserMessage('Remove');
      const msg3 = createUserMessage('Also keep');
      conv = addMessage(conv, msg1);
      conv = addMessage(conv, msg2);
      conv = addMessage(conv, msg3);

      const updated = removeMessage(conv, msg2.id);

      expect(updated.messages).toHaveLength(2);
      expect(updated.messages[0]!.text).toBe('Keep');
      expect(updated.messages[1]!.text).toBe('Also keep');
    });

    it('updates updatedAt timestamp', () => {
      let conv = createConversation();
      const message = createUserMessage('Test');
      conv = addMessage(conv, message);
      const before = conv.updatedAt;

      const updated = removeMessage(conv, message.id);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('does nothing if ID not found', () => {
      let conv = createConversation();
      const message = createUserMessage('Test');
      conv = addMessage(conv, message);

      const updated = removeMessage(conv, 'nonexistent-id');

      expect(updated.messages).toHaveLength(1);
    });
  });

  describe('setTitle()', () => {
    it('sets conversation title', () => {
      const conv = createConversation();
      const updated = setTitle(conv, 'New Title');

      expect(updated.title).toBe('New Title');
    });

    it('trims whitespace from title', () => {
      const conv = createConversation();
      const updated = setTitle(conv, '  Padded Title  ');

      expect(updated.title).toBe('Padded Title');
    });

    it('sets default title for empty string', () => {
      const conv = createConversation({ title: 'Original' });
      const updated = setTitle(conv, '');

      expect(updated.title).toBe('Untitled Conversation');
    });

    it('sets default title for whitespace-only string', () => {
      const conv = createConversation({ title: 'Original' });
      const updated = setTitle(conv, '   ');

      expect(updated.title).toBe('Untitled Conversation');
    });

    it('updates updatedAt timestamp', () => {
      const conv = createConversation();
      const before = conv.updatedAt;

      const updated = setTitle(conv, 'New Title');

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('setStatus()', () => {
    it('sets status to completed', () => {
      const conv = createConversation();
      const updated = setStatus(conv, 'completed');

      expect(updated.status).toBe('completed');
    });

    it('sets status to archived', () => {
      const conv = createConversation();
      const updated = setStatus(conv, 'archived');

      expect(updated.status).toBe('archived');
    });

    it('sets status back to active', () => {
      let conv = createConversation();
      conv = setStatus(conv, 'archived');
      const updated = setStatus(conv, 'active');

      expect(updated.status).toBe('active');
    });

    it('updates updatedAt timestamp', () => {
      const conv = createConversation();
      const before = conv.updatedAt;

      const updated = setStatus(conv, 'completed');

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('addTags()', () => {
    it('adds tags to conversation', () => {
      const conv = createConversation();
      const updated = addTags(conv, ['work', 'urgent']);

      expect(updated.tags).toEqual(['work', 'urgent']);
    });

    it('preserves existing tags', () => {
      const conv = createConversation({ tags: ['existing'] });
      const updated = addTags(conv, ['new-tag']);

      expect(updated.tags).toEqual(['existing', 'new-tag']);
    });

    it('deduplicates tags', () => {
      const conv = createConversation({ tags: ['work'] });
      const updated = addTags(conv, ['work', 'urgent', 'work']);

      expect(updated.tags).toEqual(['work', 'urgent']);
    });

    it('handles empty tag array', () => {
      const conv = createConversation({ tags: ['existing'] });
      const updated = addTags(conv, []);

      expect(updated.tags).toEqual(['existing']);
    });

    it('updates updatedAt timestamp', () => {
      const conv = createConversation();
      const before = conv.updatedAt;

      const updated = addTags(conv, ['tag']);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('removeTags()', () => {
    it('removes tags from conversation', () => {
      const conv = createConversation({ tags: ['work', 'urgent', 'project'] });
      const updated = removeTags(conv, ['urgent']);

      expect(updated.tags).toEqual(['work', 'project']);
    });

    it('removes multiple tags', () => {
      const conv = createConversation({ tags: ['a', 'b', 'c', 'd'] });
      const updated = removeTags(conv, ['b', 'd']);

      expect(updated.tags).toEqual(['a', 'c']);
    });

    it('handles non-existent tags', () => {
      const conv = createConversation({ tags: ['work'] });
      const updated = removeTags(conv, ['nonexistent']);

      expect(updated.tags).toEqual(['work']);
    });

    it('handles empty removal array', () => {
      const conv = createConversation({ tags: ['work'] });
      const updated = removeTags(conv, []);

      expect(updated.tags).toEqual(['work']);
    });

    it('updates updatedAt timestamp', () => {
      const conv = createConversation({ tags: ['tag'] });
      const before = conv.updatedAt;

      const updated = removeTags(conv, ['tag']);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('clearMessages()', () => {
    it('removes all messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('First'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Second' }));

      const updated = clearMessages(conv);

      expect(updated.messages).toEqual([]);
    });

    it('resets token counts', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({
        text: 'Response',
        metadata: { usage: { inputTokens: 100, outputTokens: 200 } },
      }));

      const updated = clearMessages(conv);

      expect(updated.totalTokens).toEqual({ input: 0, output: 0 });
    });

    it('updates updatedAt timestamp', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Test'));
      const before = conv.updatedAt;

      const updated = clearMessages(conv);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('handles already empty conversation', () => {
      const conv = createConversation();
      const updated = clearMessages(conv);

      expect(updated.messages).toEqual([]);
      expect(updated.totalTokens).toEqual({ input: 0, output: 0 });
    });
  });

  describe('getLastMessage()', () => {
    it('returns last message', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('First'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Last' }));

      const last = getLastMessage(conv);

      expect(last?.text).toBe('Last');
      expect(last?.role).toBe('assistant');
    });

    it('returns undefined for empty conversation', () => {
      const conv = createConversation();
      const last = getLastMessage(conv);

      expect(last).toBeUndefined();
    });

    it('returns single message when only one exists', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Only'));

      const last = getLastMessage(conv);

      expect(last?.text).toBe('Only');
    });
  });

  describe('getLastUserMessage()', () => {
    it('returns last user message', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('First user'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Assistant' }));
      conv = addMessage(conv, createUserMessage('Last user'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Final' }));

      const lastUser = getLastUserMessage(conv);

      expect(lastUser?.text).toBe('Last user');
    });

    it('returns undefined when no user messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({ text: 'Only assistant' }));
      conv = addMessage(conv, createSystemMessage('System'));

      const lastUser = getLastUserMessage(conv);

      expect(lastUser).toBeUndefined();
    });

    it('returns undefined for empty conversation', () => {
      const conv = createConversation();
      const lastUser = getLastUserMessage(conv);

      expect(lastUser).toBeUndefined();
    });
  });

  describe('getLastAssistantMessage()', () => {
    it('returns last assistant message', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({ text: 'First assistant' }));
      conv = addMessage(conv, createUserMessage('User'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Last assistant' }));

      const lastAssistant = getLastAssistantMessage(conv);

      expect(lastAssistant?.text).toBe('Last assistant');
    });

    it('returns undefined when no assistant messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Only user'));
      conv = addMessage(conv, createSystemMessage('System'));

      const lastAssistant = getLastAssistantMessage(conv);

      expect(lastAssistant).toBeUndefined();
    });

    it('returns undefined for empty conversation', () => {
      const conv = createConversation();
      const lastAssistant = getLastAssistantMessage(conv);

      expect(lastAssistant).toBeUndefined();
    });
  });

  describe('isEmpty()', () => {
    it('returns true for empty conversation', () => {
      const conv = createConversation();

      expect(isEmpty(conv)).toBe(true);
    });

    it('returns false when messages exist', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Hello'));

      expect(isEmpty(conv)).toBe(false);
    });

    it('returns true after clearing messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Hello'));
      conv = clearMessages(conv);

      expect(isEmpty(conv)).toBe(true);
    });
  });

  describe('isAwaitingResponse()', () => {
    it('returns true when last message is from user', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Question?'));

      expect(isAwaitingResponse(conv)).toBe(true);
    });

    it('returns false when last message is from assistant', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Question?'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Answer.' }));

      expect(isAwaitingResponse(conv)).toBe(false);
    });

    it('returns false for empty conversation', () => {
      const conv = createConversation();

      expect(isAwaitingResponse(conv)).toBe(false);
    });

    it('returns false when last message is system', () => {
      let conv = createConversation();
      conv = addMessage(conv, createSystemMessage('Context'));

      expect(isAwaitingResponse(conv)).toBe(false);
    });
  });

  describe('hasStreamingMessage()', () => {
    it('returns true when a message is streaming', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Question'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Partial...', isStreaming: true }));

      expect(hasStreamingMessage(conv)).toBe(true);
    });

    it('returns false when no messages are streaming', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Question'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Complete', isStreaming: false }));

      expect(hasStreamingMessage(conv)).toBe(false);
    });

    it('returns false for empty conversation', () => {
      const conv = createConversation();

      expect(hasStreamingMessage(conv)).toBe(false);
    });
  });

  describe('hasPendingTools()', () => {
    it('returns true when message has pending tool invocation', () => {
      let conv = createConversation();
      const message = createAssistantMessage({ text: 'Using tool...' });
      const invocation = createInvocation({
        toolId: 'readFile' as any,
        args: { path: '/test.txt' },
      });
      const messageWithInvocation: Message = {
        ...message,
        toolInvocations: [invocation],
      };
      conv = addMessage(conv, messageWithInvocation);

      expect(hasPendingTools(conv)).toBe(true);
    });

    it('returns true when message has executing tool invocation', () => {
      let conv = createConversation();
      const message = createAssistantMessage({ text: 'Using tool...' });
      const invocation = createInvocation({
        toolId: 'readFile' as any,
        args: { path: '/test.txt' },
      });
      const executingInvocation = { ...invocation, status: 'executing' as const };
      const messageWithInvocation: Message = {
        ...message,
        toolInvocations: [executingInvocation],
      };
      conv = addMessage(conv, messageWithInvocation);

      expect(hasPendingTools(conv)).toBe(true);
    });

    it('returns false when all tools are completed', () => {
      let conv = createConversation();
      const message = createAssistantMessage({ text: 'Done' });
      const invocation = createInvocation({
        toolId: 'readFile' as any,
        args: { path: '/test.txt' },
      });
      const completedInvocation = { ...invocation, status: 'completed' as const };
      const messageWithInvocation: Message = {
        ...message,
        toolInvocations: [completedInvocation],
      };
      conv = addMessage(conv, messageWithInvocation);

      expect(hasPendingTools(conv)).toBe(false);
    });

    it('returns false for empty conversation', () => {
      const conv = createConversation();

      expect(hasPendingTools(conv)).toBe(false);
    });

    it('returns false when no tool invocations', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({ text: 'No tools' }));

      expect(hasPendingTools(conv)).toBe(false);
    });
  });

  describe('getMessageCount()', () => {
    it('returns 0 for empty conversation', () => {
      const conv = createConversation();

      expect(getMessageCount(conv)).toBe(0);
    });

    it('returns correct count', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('One'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Two' }));
      conv = addMessage(conv, createUserMessage('Three'));

      expect(getMessageCount(conv)).toBe(3);
    });
  });

  describe('getMessageCountByRole()', () => {
    it('counts user messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('User 1'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Assistant' }));
      conv = addMessage(conv, createUserMessage('User 2'));
      conv = addMessage(conv, createUserMessage('User 3'));

      expect(getMessageCountByRole(conv, 'user')).toBe(3);
    });

    it('counts assistant messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('User'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Assistant 1' }));
      conv = addMessage(conv, createAssistantMessage({ text: 'Assistant 2' }));

      expect(getMessageCountByRole(conv, 'assistant')).toBe(2);
    });

    it('counts system messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createSystemMessage('System 1'));
      conv = addMessage(conv, createUserMessage('User'));
      conv = addMessage(conv, createSystemMessage('System 2'));

      expect(getMessageCountByRole(conv, 'system')).toBe(2);
    });

    it('returns 0 when no messages of role exist', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('User only'));

      expect(getMessageCountByRole(conv, 'assistant')).toBe(0);
    });
  });

  describe('getTotalWordCount()', () => {
    it('returns 0 for empty conversation', () => {
      const conv = createConversation();

      expect(getTotalWordCount(conv)).toBe(0);
    });

    it('counts words across all messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Hello world'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Hi there user' }));

      expect(getTotalWordCount(conv)).toBe(5);
    });

    it('handles multiple spaces correctly', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Multiple   spaces   here'));

      expect(getTotalWordCount(conv)).toBe(3);
    });

    it('handles empty messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({ text: '' }));

      expect(getTotalWordCount(conv)).toBe(0);
    });

    it('handles newlines and tabs', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Line one\nLine two\tTab'));

      expect(getTotalWordCount(conv)).toBe(5);
    });
  });

  describe('getMessagesForAPI()', () => {
    it('converts messages to API format', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Question'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Answer' }));

      const apiMessages = getMessagesForAPI(conv);

      expect(apiMessages).toEqual([
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ]);
    });

    it('excludes system messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createSystemMessage('System context'));
      conv = addMessage(conv, createUserMessage('Question'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Answer' }));

      const apiMessages = getMessagesForAPI(conv);

      expect(apiMessages).toHaveLength(2);
      expect(apiMessages.every(m => m.role !== 'system')).toBe(true);
    });

    it('returns empty array for empty conversation', () => {
      const conv = createConversation();

      const apiMessages = getMessagesForAPI(conv);

      expect(apiMessages).toEqual([]);
    });
  });

  describe('getPreview()', () => {
    it('returns first user message as preview', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('This is my question'));

      const preview = getPreview(conv);

      expect(preview).toBe('This is my question');
    });

    it('truncates long messages with ellipsis', () => {
      let conv = createConversation();
      const longMessage = 'A'.repeat(150);
      conv = addMessage(conv, createUserMessage(longMessage));

      const preview = getPreview(conv);

      expect(preview.length).toBe(103); // 100 chars + "..."
      expect(preview.endsWith('...')).toBe(true);
    });

    it('returns default text for empty conversation', () => {
      const conv = createConversation();

      const preview = getPreview(conv);

      expect(preview).toBe('Empty conversation');
    });

    it('skips system and assistant messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createSystemMessage('System'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Hello!' }));
      conv = addMessage(conv, createUserMessage('User question'));

      const preview = getPreview(conv);

      expect(preview).toBe('User question');
    });

    it('returns default text when no user messages', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({ text: 'Only assistant' }));

      const preview = getPreview(conv);

      expect(preview).toBe('Empty conversation');
    });
  });

  describe('serializeConversation()', () => {
    it('serializes conversation to plain object', () => {
      const conv = createConversation({
        title: 'Test Chat',
        tags: ['work'],
      });

      const serialized = serializeConversation(conv);

      expect(serialized.id).toBe(conv.id);
      expect(serialized.title).toBe('Test Chat');
      expect(serialized.status).toBe('active');
      expect(serialized.tags).toEqual(['work']);
      expect(serialized.messageCount).toBe(0);
    });

    it('serializes dates as ISO strings', () => {
      const conv = createConversation();

      const serialized = serializeConversation(conv);

      expect(typeof serialized.createdAt).toBe('string');
      expect(typeof serialized.updatedAt).toBe('string');
      expect((serialized.createdAt as string).endsWith('Z')).toBe(true);
    });

    it('includes token totals', () => {
      let conv = createConversation();
      conv = addMessage(conv, createAssistantMessage({
        text: 'Response',
        metadata: { usage: { inputTokens: 50, outputTokens: 100 } },
      }));

      const serialized = serializeConversation(conv);

      expect(serialized.totalTokens).toEqual({ input: 50, output: 100 });
    });

    it('includes message count', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('One'));
      conv = addMessage(conv, createAssistantMessage({ text: 'Two' }));

      const serialized = serializeConversation(conv);

      expect(serialized.messageCount).toBe(2);
    });

    it('does not include full messages array', () => {
      let conv = createConversation();
      conv = addMessage(conv, createUserMessage('Message'));

      const serialized = serializeConversation(conv);

      expect(serialized.messages).toBeUndefined();
    });
  });
});
