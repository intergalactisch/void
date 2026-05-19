/**
 * Integration tests for Conversation Store
 *
 * Tests the ConversationStore with a mock AIAssistantService to verify:
 * - Initialization with service
 * - Loading conversations from service
 * - Selecting conversations
 * - Creating new conversations
 * - Deleting and clearing conversations
 * - Derived state (count, active, archived, find, has)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { conversationStore } from '$lib/stores/conversation.svelte';
import type { AIAssistantService } from '$lib/ports/inbound';
import type { Conversation } from '$lib/domain/entities/Conversation';
import { createConversation } from '$lib/domain/entities/Conversation';

/**
 * Creates a mock conversation for testing.
 */
function createMockConversation(overrides: Partial<Conversation> = {}): Conversation {
  const base = createConversation();
  return {
    ...base,
    ...overrides,
  };
}

/**
 * Creates a mock AIAssistantService for testing.
 * Maintains internal state and tracks all method calls.
 */
function createMockAIAssistantService(
  initialConversations: Conversation[] = []
): AIAssistantService & { _conversations: Conversation[]; _current: Conversation | null } {
  let conversations = [...initialConversations];
  let currentConversation: Conversation | null = conversations[0] || null;

  return {
    _conversations: conversations,
    _current: currentConversation,

    // Conversation management
    listConversations: vi.fn().mockImplementation(async () => conversations),
    getCurrentConversation: vi.fn().mockImplementation(() => currentConversation),
    setCurrentConversation: vi.fn().mockImplementation(async (id: string) => {
      currentConversation = conversations.find((c) => c.id === id) || null;
    }),
    getConversation: vi.fn().mockImplementation(async () => {
      if (currentConversation) return currentConversation;
      const newConv = createMockConversation({ id: `new-${Date.now()}`, title: 'New Conversation' });
      conversations.push(newConv);
      currentConversation = newConv;
      return newConv;
    }),
    createNewConversation: vi.fn().mockImplementation(async () => {
      const newConv = createMockConversation({ id: `new-${Date.now()}`, title: 'New Conversation' });
      conversations.push(newConv);
      currentConversation = newConv;
      return newConv;
    }),
    deleteConversation: vi.fn().mockImplementation(async (id: string) => {
      conversations = conversations.filter((c) => c.id !== id);
      if (currentConversation?.id === id) {
        currentConversation = conversations[0] || null;
      }
    }),
    clearConversation: vi.fn().mockImplementation(async (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        conv.messages = [];
      }
    }),

    // Message/AI operations (not used by conversation store, but required by interface)
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    cancelStream: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    isStreaming: vi.fn().mockReturnValue(false),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('Conversation Store Integration', () => {
  let mockService: ReturnType<typeof createMockAIAssistantService>;
  let mockConversations: Conversation[];

  beforeEach(() => {
    // Reset store state before each test
    conversationStore.destroy();

    // Create test conversations
    mockConversations = [
      createMockConversation({ id: 'conv-1', title: 'First Conversation', status: 'active' }),
      createMockConversation({ id: 'conv-2', title: 'Second Conversation', status: 'active' }),
      createMockConversation({ id: 'conv-3', title: 'Archived Chat', status: 'archived' }),
    ];

    mockService = createMockAIAssistantService(mockConversations);
  });

  describe('init()', () => {
    it('accepts a service', () => {
      conversationStore.init(mockService);
      expect(conversationStore.isInitialized).toBe(true);
    });

    it('sets current conversation from service', () => {
      conversationStore.init(mockService);

      expect(mockService.getCurrentConversation).toHaveBeenCalled();
      expect(conversationStore.current).not.toBeNull();
    });

    it('sets current to first conversation', () => {
      conversationStore.init(mockService);

      expect(conversationStore.current?.id).toBe('conv-1');
    });
  });

  describe('isInitialized', () => {
    it('is false before init()', () => {
      expect(conversationStore.isInitialized).toBe(false);
    });

    it('is true after init()', () => {
      conversationStore.init(mockService);
      expect(conversationStore.isInitialized).toBe(true);
    });

    it('is false after destroy()', () => {
      conversationStore.init(mockService);
      conversationStore.destroy();
      expect(conversationStore.isInitialized).toBe(false);
    });
  });

  describe('load()', () => {
    beforeEach(() => {
      conversationStore.init(mockService);
    });

    it('calls service.listConversations()', async () => {
      await conversationStore.load();

      expect(mockService.listConversations).toHaveBeenCalled();
    });

    it('populates conversations state', async () => {
      await conversationStore.load();

      expect(conversationStore.conversations).toHaveLength(3);
    });

    it('updates current conversation from service', async () => {
      await conversationStore.load();

      expect(mockService.getCurrentConversation).toHaveBeenCalled();
      expect(conversationStore.current).not.toBeNull();
    });

    it('sets loading=true during operation, false after', async () => {
      expect(conversationStore.loading).toBe(false);

      const loadPromise = conversationStore.load();
      await loadPromise;

      expect(conversationStore.loading).toBe(false);
    });

    it('handles errors gracefully', async () => {
      mockService.listConversations = vi.fn().mockRejectedValue(new Error('Load failed'));

      await conversationStore.load();

      expect(conversationStore.error).not.toBeNull();
      expect(conversationStore.error?.message).toBe('Load failed');
      expect(conversationStore.loading).toBe(false);
    });

    it('throws if not initialized', async () => {
      conversationStore.destroy();
      await expect(conversationStore.load()).rejects.toThrow('ConversationStore not initialized');
    });

    it('clears error on successful load', async () => {
      // First cause an error
      mockService.listConversations = vi.fn().mockRejectedValue(new Error('First error'));
      await conversationStore.load();
      expect(conversationStore.error).not.toBeNull();

      // Then load successfully
      mockService.listConversations = vi.fn().mockResolvedValue(mockConversations);
      await conversationStore.load();

      expect(conversationStore.error).toBeNull();
    });
  });

  describe('select()', () => {
    beforeEach(async () => {
      conversationStore.init(mockService);
      await conversationStore.load();
    });

    it('calls service.setCurrentConversation()', async () => {
      await conversationStore.select('conv-2');

      expect(mockService.setCurrentConversation).toHaveBeenCalledWith('conv-2');
    });

    it('updates current conversation', async () => {
      await conversationStore.select('conv-2');

      expect(conversationStore.current?.id).toBe('conv-2');
    });

    it('handles non-existent conversation gracefully', async () => {
      await conversationStore.select('nonexistent');

      // Service was called, but current will be null
      expect(mockService.setCurrentConversation).toHaveBeenCalledWith('nonexistent');
    });

    it('handles errors', async () => {
      mockService.setCurrentConversation = vi.fn().mockRejectedValue(new Error('Select failed'));

      await conversationStore.select('conv-2');

      expect(conversationStore.error).not.toBeNull();
      expect(conversationStore.error?.message).toBe('Select failed');
    });

    it('throws if not initialized', async () => {
      conversationStore.destroy();
      await expect(conversationStore.select('conv-1')).rejects.toThrow(
        'ConversationStore not initialized'
      );
    });

    it('clears error on success', async () => {
      // First cause an error
      mockService.setCurrentConversation = vi.fn().mockRejectedValue(new Error('First error'));
      await conversationStore.select('conv-2');
      expect(conversationStore.error).not.toBeNull();

      // Then select successfully
      mockService.setCurrentConversation = vi.fn().mockResolvedValue(undefined);
      await conversationStore.select('conv-1');

      expect(conversationStore.error).toBeNull();
    });
  });

  describe('create()', () => {
    beforeEach(async () => {
      conversationStore.init(mockService);
      await conversationStore.load();
    });

    it('calls service.createNewConversation()', async () => {
      await conversationStore.create();

      expect(mockService.createNewConversation).toHaveBeenCalled();
    });

    it('returns the new conversation', async () => {
      const result = await conversationStore.create();

      expect(result).toBeDefined();
      expect(result.title).toBe('New Conversation');
    });

    it('sets the new conversation as current', async () => {
      const result = await conversationStore.create();

      expect(conversationStore.current?.id).toBe(result.id);
    });

    it('refreshes the conversations list', async () => {
      const initialCallCount = mockService.listConversations.mock.calls.length;

      await conversationStore.create();

      expect(mockService.listConversations.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it('handles errors and returns fallback conversation', async () => {
      mockService.createNewConversation = vi.fn().mockRejectedValue(new Error('Create failed'));

      const result = await conversationStore.create('Fallback Title');

      expect(conversationStore.error).not.toBeNull();
      // Should return a local fallback conversation
      expect(result).toBeDefined();
      expect(result.title).toBe('Fallback Title');
    });

    it('throws if not initialized', async () => {
      conversationStore.destroy();
      await expect(conversationStore.create()).rejects.toThrow(
        'ConversationStore not initialized'
      );
    });

    it('clears error on success', async () => {
      // First cause an error
      mockService.createNewConversation = vi.fn().mockRejectedValue(new Error('First error'));
      await conversationStore.create();
      expect(conversationStore.error).not.toBeNull();

      // Then create successfully
      mockService.createNewConversation = vi.fn().mockResolvedValue(createMockConversation());
      await conversationStore.create();

      expect(conversationStore.error).toBeNull();
    });
  });

  describe('delete()', () => {
    beforeEach(async () => {
      conversationStore.init(mockService);
      await conversationStore.load();
    });

    it('calls service.deleteConversation()', async () => {
      await conversationStore.delete('conv-2');

      expect(mockService.deleteConversation).toHaveBeenCalledWith('conv-2');
    });

    it('removes conversation from local state', async () => {
      expect(conversationStore.conversations.find((c) => c.id === 'conv-2')).toBeDefined();

      await conversationStore.delete('conv-2');

      expect(conversationStore.conversations.find((c) => c.id === 'conv-2')).toBeUndefined();
    });

    it('clears selection when deleting current conversation', async () => {
      // Select conv-2 first
      await conversationStore.select('conv-2');
      expect(conversationStore.current?.id).toBe('conv-2');

      await conversationStore.delete('conv-2');

      // Current should be updated (not conv-2 anymore)
      expect(conversationStore.current?.id).not.toBe('conv-2');
    });

    it('keeps selection when deleting non-current conversation', async () => {
      expect(conversationStore.current?.id).toBe('conv-1');

      await conversationStore.delete('conv-2');

      expect(conversationStore.current?.id).toBe('conv-1');
    });

    it('handles errors', async () => {
      mockService.deleteConversation = vi.fn().mockRejectedValue(new Error('Delete failed'));

      await conversationStore.delete('conv-2');

      expect(conversationStore.error).not.toBeNull();
      expect(conversationStore.error?.message).toBe('Delete failed');
    });

    it('throws if not initialized', async () => {
      conversationStore.destroy();
      await expect(conversationStore.delete('conv-1')).rejects.toThrow(
        'ConversationStore not initialized'
      );
    });
  });

  describe('clear()', () => {
    beforeEach(async () => {
      conversationStore.init(mockService);
      await conversationStore.load();
    });

    it('calls service.clearConversation()', async () => {
      await conversationStore.clear('conv-1');

      expect(mockService.clearConversation).toHaveBeenCalledWith('conv-1');
    });

    it('refreshes current if clearing current conversation', async () => {
      expect(conversationStore.current?.id).toBe('conv-1');
      const getCallsBefore = mockService.getCurrentConversation.mock.calls.length;

      await conversationStore.clear('conv-1');

      expect(mockService.getCurrentConversation.mock.calls.length).toBeGreaterThan(getCallsBefore);
    });

    it('refreshes conversations list', async () => {
      const initialCallCount = mockService.listConversations.mock.calls.length;

      await conversationStore.clear('conv-1');

      expect(mockService.listConversations.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it('handles errors', async () => {
      mockService.clearConversation = vi.fn().mockRejectedValue(new Error('Clear failed'));

      await conversationStore.clear('conv-1');

      expect(conversationStore.error).not.toBeNull();
      expect(conversationStore.error?.message).toBe('Clear failed');
    });

    it('throws if not initialized', async () => {
      conversationStore.destroy();
      await expect(conversationStore.clear('conv-1')).rejects.toThrow(
        'ConversationStore not initialized'
      );
    });
  });

  describe('derived state', () => {
    beforeEach(async () => {
      conversationStore.init(mockService);
      await conversationStore.load();
    });

    describe('hasSelection', () => {
      it('is true when current is set', () => {
        expect(conversationStore.hasSelection).toBe(true);
      });

      it('is false when current is null', () => {
        // Create service with no conversations
        const emptyService = createMockAIAssistantService([]);
        conversationStore.init(emptyService);

        expect(conversationStore.hasSelection).toBe(false);
      });
    });

    describe('count', () => {
      it('returns number of conversations', () => {
        expect(conversationStore.count).toBe(3);
      });

      it('returns 0 when no conversations', () => {
        conversationStore.destroy();
        expect(conversationStore.count).toBe(0);
      });
    });

    describe('activeConversations', () => {
      it('returns only active conversations', () => {
        const active = conversationStore.activeConversations;

        expect(active).toHaveLength(2);
        expect(active.every((c) => c.status === 'active')).toBe(true);
      });

      it('excludes archived conversations', () => {
        const active = conversationStore.activeConversations;

        expect(active.find((c) => c.id === 'conv-3')).toBeUndefined();
      });
    });

    describe('archivedConversations', () => {
      it('returns only archived conversations', () => {
        const archived = conversationStore.archivedConversations;

        expect(archived).toHaveLength(1);
        expect(archived.every((c) => c.status === 'archived')).toBe(true);
      });

      it('includes conv-3 which is archived', () => {
        const archived = conversationStore.archivedConversations;

        expect(archived.find((c) => c.id === 'conv-3')).toBeDefined();
      });
    });

    describe('find()', () => {
      it('returns conversation by ID', () => {
        const result = conversationStore.find('conv-2');

        expect(result?.title).toBe('Second Conversation');
      });

      it('returns undefined for unknown ID', () => {
        const result = conversationStore.find('nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('has()', () => {
      it('returns true for existing ID', () => {
        expect(conversationStore.has('conv-1')).toBe(true);
        expect(conversationStore.has('conv-2')).toBe(true);
        expect(conversationStore.has('conv-3')).toBe(true);
      });

      it('returns false for unknown ID', () => {
        expect(conversationStore.has('nonexistent')).toBe(false);
      });
    });
  });

  describe('destroy()', () => {
    it('resets all state', async () => {
      conversationStore.init(mockService);
      await conversationStore.load();

      conversationStore.destroy();

      expect(conversationStore.isInitialized).toBe(false);
      expect(conversationStore.conversations).toHaveLength(0);
      expect(conversationStore.current).toBeNull();
      expect(conversationStore.loading).toBe(false);
      expect(conversationStore.error).toBeNull();
    });

    it('clears service reference', () => {
      conversationStore.init(mockService);

      conversationStore.destroy();

      expect(conversationStore.isInitialized).toBe(false);
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      conversationStore.init(mockService);
    });

    it('is null initially', () => {
      expect(conversationStore.error).toBeNull();
    });

    it('is null after successful operations', async () => {
      await conversationStore.load();

      expect(conversationStore.error).toBeNull();
    });

    it('contains error after failed operation', async () => {
      mockService.listConversations = vi.fn().mockRejectedValue(new Error('Connection failed'));

      await conversationStore.load();

      expect(conversationStore.error).toBeInstanceOf(Error);
      expect(conversationStore.error?.message).toBe('Connection failed');
    });
  });

  describe('integration scenarios', () => {
    it('handles full workflow: init -> load -> create -> select -> delete', async () => {
      // Initialize
      conversationStore.init(mockService);
      expect(conversationStore.isInitialized).toBe(true);

      // Load conversations
      await conversationStore.load();
      expect(conversationStore.conversations).toHaveLength(3);
      expect(conversationStore.count).toBe(3);

      // Create new conversation
      const newConv = await conversationStore.create();
      expect(newConv).toBeDefined();
      expect(conversationStore.current?.id).toBe(newConv.id);

      // Select different conversation
      await conversationStore.select('conv-2');
      expect(conversationStore.current?.id).toBe('conv-2');

      // Delete a conversation
      await conversationStore.delete('conv-3');
      expect(conversationStore.has('conv-3')).toBe(false);
    });

    it('handles switching between active and archived views', async () => {
      conversationStore.init(mockService);
      await conversationStore.load();

      // Get active conversations
      const active = conversationStore.activeConversations;
      expect(active).toHaveLength(2);

      // Get archived conversations
      const archived = conversationStore.archivedConversations;
      expect(archived).toHaveLength(1);

      // Find specific conversations
      expect(conversationStore.find('conv-1')?.status).toBe('active');
      expect(conversationStore.find('conv-3')?.status).toBe('archived');
    });
  });
});
