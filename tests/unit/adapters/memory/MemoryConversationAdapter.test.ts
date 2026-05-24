/**
 * Unit tests for MemoryConversationAdapter
 *
 * Tests the in-memory conversation storage adapter including:
 * - Save and load operations
 * - Delete operations
 * - Listing with filtering and pagination
 * - Count and exists checks
 * - Clear all functionality
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryConversationAdapter } from '$lib/adapters/memory/MemoryConversationAdapter';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { createConversation, addMessage } from '$lib/domain/entities/Conversation';
import { createUserMessage } from '$lib/domain/entities/Message';

/**
 * Creates a test conversation with optional overrides.
 */
function createTestConversation(overrides: Partial<Conversation> = {}): Conversation {
  const base = createConversation({ title: 'Test Conversation' });
  return {
    ...base,
    ...overrides,
  };
}

describe('MemoryConversationAdapter', () => {
  let adapter: MemoryConversationAdapter;

  beforeEach(() => {
    adapter = new MemoryConversationAdapter();
  });

  describe('save()', () => {
    it('saves a conversation successfully', async () => {
      const conversation = createTestConversation();

      const result = await adapter.save(conversation);

      expect(result.ok).toBe(true);
    });

    it('can retrieve saved conversation', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      const result = await adapter.load(conversation.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe(conversation.id);
        expect(result.value?.title).toBe(conversation.title);
      }
    });

    it('updates existing conversation', async () => {
      const conversation = createTestConversation({ title: 'Original' });
      await adapter.save(conversation);

      const updated = { ...conversation, title: 'Updated' };
      await adapter.save(updated);

      const result = await adapter.load(conversation.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.title).toBe('Updated');
      }
    });

    it('stores a deep clone (prevents mutation)', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      // Mutate original
      conversation.title = 'Mutated';

      const result = await adapter.load(conversation.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.title).toBe('Test Conversation');
      }
    });

    it('preserves Date objects', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      const result = await adapter.load(conversation.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.createdAt).toBeInstanceOf(Date);
        expect(result.value?.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('preserves message timestamps', async () => {
      let conversation = createTestConversation();
      const message = createUserMessage('Hello');
      conversation = addMessage(conversation, message);
      await adapter.save(conversation);

      const result = await adapter.load(conversation.id);
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.messages[0]?.createdAt).toBeInstanceOf(Date);
        expect(result.value.messages[0]?.updatedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('load()', () => {
    it('returns null for non-existent conversation', async () => {
      const result = await adapter.load('non-existent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns a deep clone (prevents mutation)', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      const result1 = await adapter.load(conversation.id);
      const result2 = await adapter.load(conversation.id);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value).not.toBe(result2.value);
        expect(result1.value).toEqual(result2.value);
      }
    });
  });

  describe('delete()', () => {
    it('deletes an existing conversation', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      const deleteResult = await adapter.delete(conversation.id);
      expect(deleteResult.ok).toBe(true);

      const loadResult = await adapter.load(conversation.id);
      expect(loadResult.ok).toBe(true);
      if (loadResult.ok) {
        expect(loadResult.value).toBeNull();
      }
    });

    it('succeeds for non-existent conversation', async () => {
      const result = await adapter.delete('non-existent-id');
      expect(result.ok).toBe(true);
    });

    it('reduces count after delete', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      expect(await adapter.count()).toBe(1);

      await adapter.delete(conversation.id);

      expect(await adapter.count()).toBe(0);
    });
  });

  describe('list()', () => {
    beforeEach(async () => {
      // Create conversations with different timestamps and statuses
      const conv1 = createTestConversation({
        id: 'conv-1',
        title: 'First',
        status: 'active',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-10'),
      });
      const conv2 = createTestConversation({
        id: 'conv-2',
        title: 'Second',
        status: 'active',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-05'),
      });
      const conv3 = createTestConversation({
        id: 'conv-3',
        title: 'Third',
        status: 'archived',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-03'),
      });

      await adapter.save(conv1);
      await adapter.save(conv2);
      await adapter.save(conv3);
    });

    it('lists all conversations', async () => {
      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('filters by status', async () => {
      const result = await adapter.list({ status: 'active' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((s) => s.status === 'active')).toBe(true);
      }
    });

    it('filters by archived status', async () => {
      const result = await adapter.list({ status: 'archived' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.id).toBe('conv-3');
      }
    });

    it('sorts by updatedAt descending by default', async () => {
      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // conv-1 has latest updatedAt (2024-01-10)
        expect(result.value[0]?.id).toBe('conv-1');
      }
    });

    it('sorts by createdAt when specified', async () => {
      const result = await adapter.list({ sortBy: 'createdAt', sortOrder: 'asc' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.id).toBe('conv-1');
        expect(result.value[2]?.id).toBe('conv-3');
      }
    });

    it('sorts by updatedAt ascending', async () => {
      const result = await adapter.list({ sortBy: 'updatedAt', sortOrder: 'asc' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.id).toBe('conv-3');
        expect(result.value[2]?.id).toBe('conv-1');
      }
    });

    it('limits results', async () => {
      const result = await adapter.list({ limit: 2 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('applies offset', async () => {
      const result = await adapter.list({ offset: 1 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('combines limit and offset', async () => {
      const result = await adapter.list({ limit: 1, offset: 1 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });

    it('returns conversation summaries with correct fields', async () => {
      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const summary = result.value[0];
        expect(summary).toHaveProperty('id');
        expect(summary).toHaveProperty('title');
        expect(summary).toHaveProperty('messageCount');
        expect(summary).toHaveProperty('status');
        expect(summary).toHaveProperty('createdAt');
        expect(summary).toHaveProperty('updatedAt');
        expect(summary).toHaveProperty('preview');
      }
    });

    it('summary dates are Date objects', async () => {
      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.createdAt).toBeInstanceOf(Date);
        expect(result.value[0]?.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('lists paged summaries with search and date filters', async () => {
      let research = createTestConversation({
        id: 'conv-research',
        title: 'Research Command',
        status: 'active',
        createdAt: new Date('2024-01-08T00:00:00Z'),
        updatedAt: new Date('2024-01-12T12:00:00Z'),
      });
      research = addMessage(research, createUserMessage('Find source-backed notes about agents'));
      research = { ...research, updatedAt: new Date('2024-01-12T12:00:00Z') };
      await adapter.save(research);

      const firstPage = await adapter.listSummaries({
        query: 'source-backed',
        dateFrom: '2024-01-12T00:00:00Z',
        dateTo: '2024-01-12T23:59:59Z',
        limit: 1,
      });

      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) return;
      expect(firstPage.value.items.map((summary) => summary.id)).toEqual(['conv-research']);
      expect(firstPage.value.nextCursor).toBeNull();
      expect(firstPage.value.total).toBe(1);
    });

    it('pages summary results without returning hydrated messages', async () => {
      const firstPage = await adapter.listSummaries({ limit: 2 });

      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) return;
      expect(firstPage.value.items).toHaveLength(2);
      expect(firstPage.value.nextCursor).toBe('2');
      expect(firstPage.value.items[0]).not.toHaveProperty('messages');

      const secondPage = await adapter.listSummaries({ limit: 2, cursor: firstPage.value.nextCursor });
      expect(secondPage.ok).toBe(true);
      if (!secondPage.ok) return;
      expect(secondPage.value.items.map((summary) => summary.id)).toEqual(['conv-3']);
      expect(secondPage.value.nextCursor).toBeNull();
    });
  });

  describe('exists()', () => {
    it('returns true for existing conversation', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);

      expect(await adapter.exists(conversation.id)).toBe(true);
    });

    it('returns false for non-existent conversation', async () => {
      expect(await adapter.exists('non-existent-id')).toBe(false);
    });

    it('returns false after delete', async () => {
      const conversation = createTestConversation();
      await adapter.save(conversation);
      await adapter.delete(conversation.id);

      expect(await adapter.exists(conversation.id)).toBe(false);
    });
  });

  describe('count()', () => {
    it('returns 0 for empty storage', async () => {
      expect(await adapter.count()).toBe(0);
    });

    it('returns correct count', async () => {
      await adapter.save(createTestConversation({ id: '1' }));
      await adapter.save(createTestConversation({ id: '2' }));
      await adapter.save(createTestConversation({ id: '3' }));

      expect(await adapter.count()).toBe(3);
    });

    it('filters count by status', async () => {
      await adapter.save(createTestConversation({ id: '1', status: 'active' }));
      await adapter.save(createTestConversation({ id: '2', status: 'active' }));
      await adapter.save(createTestConversation({ id: '3', status: 'archived' }));

      expect(await adapter.count('active')).toBe(2);
      expect(await adapter.count('archived')).toBe(1);
    });

    it('returns 0 for status with no matches', async () => {
      await adapter.save(createTestConversation({ id: '1', status: 'active' }));

      expect(await adapter.count('archived')).toBe(0);
    });
  });

  describe('clearAll()', () => {
    it('removes all conversations', async () => {
      await adapter.save(createTestConversation({ id: '1' }));
      await adapter.save(createTestConversation({ id: '2' }));

      const result = await adapter.clearAll();

      expect(result.ok).toBe(true);
      expect(await adapter.count()).toBe(0);
    });

    it('returns count of deleted conversations', async () => {
      await adapter.save(createTestConversation({ id: '1' }));
      await adapter.save(createTestConversation({ id: '2' }));
      await adapter.save(createTestConversation({ id: '3' }));

      const result = await adapter.clearAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(3);
      }
    });

    it('returns 0 when storage is empty', async () => {
      const result = await adapter.clearAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('test helpers', () => {
    describe('_getInternalMap()', () => {
      it('returns the internal map', async () => {
        await adapter.save(createTestConversation({ id: 'test' }));

        const map = adapter._getInternalMap();

        expect(map).toBeInstanceOf(Map);
        expect(map.size).toBe(1);
        expect(map.has('test')).toBe(true);
      });
    });

    describe('_setConversations()', () => {
      it('sets conversations directly', () => {
        const conversations = [
          createTestConversation({ id: '1' }),
          createTestConversation({ id: '2' }),
        ];

        adapter._setConversations(conversations);

        expect(adapter._getInternalMap().size).toBe(2);
      });

      it('clears existing conversations', async () => {
        await adapter.save(createTestConversation({ id: 'old' }));

        adapter._setConversations([createTestConversation({ id: 'new' })]);

        expect(adapter._getInternalMap().has('old')).toBe(false);
        expect(adapter._getInternalMap().has('new')).toBe(true);
      });
    });
  });
});
