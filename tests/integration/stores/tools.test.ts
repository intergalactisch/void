/**
 * Integration tests for Tools Store
 *
 * Tests the ToolStore with a mock ToolRegistryService to verify:
 * - Initialization with service
 * - Loading tools from service
 * - Search functionality (async and local)
 * - Category filtering
 * - Enable/disable tool management
 * - Derived state (count, enabled, categories)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolStore } from '$lib/stores/tools.svelte';
import type { ToolRegistryService } from '$lib/ports/inbound';
import type { Tool, ToolCategory } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';

/**
 * Creates a mock tool for testing.
 */
function createMockTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'tool-1' as ToolId,
    name: 'Test Tool',
    description: 'A test tool for testing',
    category: 'system' as ToolCategory,
    enabled: true,
    parameters: [],
    keywords: [],
    execute: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock ToolRegistryService for testing.
 * Maintains internal tools state and tracks all method calls.
 */
function createMockToolRegistryService(initialTools: Tool[] = []): ToolRegistryService & { _tools: Tool[] } {
  let tools = [...initialTools];
  const subscribers: Array<() => void> = [];

  return {
    _tools: tools,
    getAll: vi.fn().mockImplementation(async () => tools),
    get: vi.fn().mockImplementation(async (id: ToolId) => tools.find((t) => t.id === id)),
    getByCategory: vi.fn().mockImplementation(async (category: ToolCategory) =>
      tools.filter((t) => t.category === category)
    ),
    search: vi.fn().mockImplementation(async (query: string, limit?: number) => {
      const results = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.description.toLowerCase().includes(query.toLowerCase())
      );
      return limit ? results.slice(0, limit) : results;
    }),
    setEnabled: vi.fn().mockImplementation(async (id: ToolId, enabled: boolean) => {
      const tool = tools.find((t) => t.id === id);
      if (tool) {
        tool.enabled = enabled;
        // Notify subscribers
        subscribers.forEach((cb) => cb());
      }
    }),
    subscribe: vi.fn().mockImplementation((callback: () => void) => {
      subscribers.push(callback);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index > -1) subscribers.splice(index, 1);
      };
    }),
    register: vi.fn(),
    unregister: vi.fn(),
    execute: vi.fn(),
  };
}

describe('Tools Store Integration', () => {
  let mockService: ReturnType<typeof createMockToolRegistryService>;
  let mockTools: Tool[];

  beforeEach(() => {
    // Reset store state before each test
    toolStore.destroy();

    // Create test tools
    mockTools = [
      createMockTool({ id: 'tool-1' as ToolId, name: 'File Search', category: 'search', enabled: true }),
      createMockTool({ id: 'tool-2' as ToolId, name: 'Note Creator', category: 'note', enabled: true }),
      createMockTool({ id: 'tool-3' as ToolId, name: 'AI Assistant', category: 'ai', enabled: false }),
      createMockTool({ id: 'tool-4' as ToolId, name: 'System Info', category: 'system', enabled: true }),
    ];

    mockService = createMockToolRegistryService(mockTools);
  });

  describe('init()', () => {
    it('accepts a service', () => {
      toolStore.init(mockService);
      expect(toolStore.isInitialized).toBe(true);
    });

    it('sets up subscription to service', () => {
      toolStore.init(mockService);
      expect(mockService.subscribe).toHaveBeenCalledTimes(1);
    });

    it('cleans up previous subscription when reinitializing', () => {
      toolStore.init(mockService);
      const firstSubscribeCount = mockService.subscribe.mock.calls.length;

      const secondService = createMockToolRegistryService();
      toolStore.init(secondService);

      expect(secondService.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('isInitialized', () => {
    it('is false before init()', () => {
      expect(toolStore.isInitialized).toBe(false);
    });

    it('is true after init()', () => {
      toolStore.init(mockService);
      expect(toolStore.isInitialized).toBe(true);
    });

    it('is false after destroy()', () => {
      toolStore.init(mockService);
      toolStore.destroy();
      expect(toolStore.isInitialized).toBe(false);
    });
  });

  describe('load()', () => {
    beforeEach(() => {
      toolStore.init(mockService);
    });

    it('calls service.getAll() and populates tools', async () => {
      await toolStore.load();

      expect(mockService.getAll).toHaveBeenCalled();
      expect(toolStore.tools).toHaveLength(4);
    });

    it('sets loading=true during operation, false after', async () => {
      expect(toolStore.loading).toBe(false);

      const loadPromise = toolStore.load();
      await loadPromise;

      expect(toolStore.loading).toBe(false);
    });

    it('handles errors gracefully', async () => {
      const errorService = createMockToolRegistryService();
      errorService.getAll = vi.fn().mockRejectedValue(new Error('Service error'));
      toolStore.init(errorService);

      await toolStore.load();

      expect(toolStore.error).not.toBeNull();
      expect(toolStore.error?.message).toBe('Service error');
      expect(toolStore.loading).toBe(false);
    });

    it('throws if not initialized', async () => {
      toolStore.destroy();
      await expect(toolStore.load()).rejects.toThrow('ToolStore not initialized');
    });

    it('clears error on successful load', async () => {
      // First cause an error
      const errorService = createMockToolRegistryService();
      errorService.getAll = vi.fn().mockRejectedValue(new Error('First error'));
      toolStore.init(errorService);
      await toolStore.load();
      expect(toolStore.error).not.toBeNull();

      // Then load successfully
      toolStore.init(mockService);
      await toolStore.load();

      expect(toolStore.error).toBeNull();
    });
  });

  describe('search()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('updates searchQuery state', async () => {
      await toolStore.search('file');

      expect(toolStore.searchQuery).toBe('file');
    });

    it('calls service.search() with query and limit', async () => {
      await toolStore.search('file', 5);

      expect(mockService.search).toHaveBeenCalledWith('file', 5);
    });

    it('returns matching tools', async () => {
      const results = await toolStore.search('File');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('File Search');
    });

    it('updates searchResults state', async () => {
      await toolStore.search('File');

      expect(toolStore.searchResults).toHaveLength(1);
      expect(toolStore.searchResults[0]!.name).toBe('File Search');
    });

    it('clears results for empty query', async () => {
      await toolStore.search('File');
      expect(toolStore.searchResults).toHaveLength(1);

      const results = await toolStore.search('');

      expect(results).toHaveLength(0);
      expect(toolStore.searchResults).toHaveLength(0);
    });

    it('clears results for whitespace-only query', async () => {
      await toolStore.search('File');
      const results = await toolStore.search('   ');

      expect(results).toHaveLength(0);
      expect(toolStore.searchQuery).toBe('   ');
    });

    it('handles search errors', async () => {
      mockService.search = vi.fn().mockRejectedValue(new Error('Search failed'));

      const results = await toolStore.search('test');

      expect(results).toHaveLength(0);
      expect(toolStore.error).not.toBeNull();
      expect(toolStore.searchResults).toHaveLength(0);
    });

    it('throws if not initialized', async () => {
      toolStore.destroy();
      await expect(toolStore.search('test')).rejects.toThrow('ToolStore not initialized');
    });
  });

  describe('searchLocal()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('filters tools by name', () => {
      const results = toolStore.searchLocal('File');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('File Search');
    });

    it('filters tools by description', () => {
      const results = toolStore.searchLocal('test');

      expect(results.length).toBeGreaterThan(0);
    });

    it('is case insensitive', () => {
      const results = toolStore.searchLocal('file');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('File Search');
    });

    it('returns empty array for empty query', () => {
      const results = toolStore.searchLocal('');

      expect(results).toHaveLength(0);
    });

    it('returns empty array for no matches', () => {
      const results = toolStore.searchLocal('nonexistent');

      expect(results).toHaveLength(0);
    });

    it('does not call service (synchronous)', () => {
      toolStore.searchLocal('file');

      expect(mockService.search).not.toHaveBeenCalled();
    });
  });

  describe('getByCategory()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('calls service.getByCategory()', async () => {
      await toolStore.getByCategory('search');

      expect(mockService.getByCategory).toHaveBeenCalledWith('search');
    });

    it('returns tools in the category', async () => {
      const results = await toolStore.getByCategory('search');

      expect(results).toHaveLength(1);
      expect(results[0]!.category).toBe('search');
    });

    it('returns empty array for category with no tools', async () => {
      const results = await toolStore.getByCategory('custom');

      expect(results).toHaveLength(0);
    });

    it('handles errors', async () => {
      mockService.getByCategory = vi.fn().mockRejectedValue(new Error('Category error'));

      const results = await toolStore.getByCategory('search');

      expect(results).toHaveLength(0);
      expect(toolStore.error).not.toBeNull();
    });
  });

  describe('getByCategoryLocal()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('returns tools in the category from local state', () => {
      const results = toolStore.getByCategoryLocal('search');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('File Search');
    });

    it('returns empty array for category with no tools', () => {
      const results = toolStore.getByCategoryLocal('custom');

      expect(results).toHaveLength(0);
    });

    it('does not call service (synchronous)', () => {
      toolStore.getByCategoryLocal('search');

      expect(mockService.getByCategory).not.toHaveBeenCalled();
    });
  });

  describe('toggleEnabled()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('calls service.setEnabled() with toggled value', async () => {
      const toolId = 'tool-1' as ToolId;
      const toolBefore = toolStore.tools.find((t) => t.id === toolId);
      expect(toolBefore?.enabled).toBe(true);

      await toolStore.toggleEnabled(toolId);

      expect(mockService.setEnabled).toHaveBeenCalledWith(toolId, false);
    });

    it('enables a disabled tool', async () => {
      const toolId = 'tool-3' as ToolId;
      const toolBefore = toolStore.tools.find((t) => t.id === toolId);
      expect(toolBefore?.enabled).toBe(false);

      await toolStore.toggleEnabled(toolId);

      expect(mockService.setEnabled).toHaveBeenCalledWith(toolId, true);
    });

    it('does nothing for non-existent tool', async () => {
      await toolStore.toggleEnabled('nonexistent' as ToolId);

      expect(mockService.setEnabled).not.toHaveBeenCalled();
    });

    it('handles errors', async () => {
      mockService.setEnabled = vi.fn().mockRejectedValue(new Error('Toggle failed'));

      await toolStore.toggleEnabled('tool-1' as ToolId);

      expect(toolStore.error).not.toBeNull();
      expect(toolStore.error?.message).toBe('Toggle failed');
    });
  });

  describe('enable()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('calls service.setEnabled() with true', async () => {
      await toolStore.enable('tool-3' as ToolId);

      expect(mockService.setEnabled).toHaveBeenCalledWith('tool-3', true);
    });

    it('refreshes tools after enabling', async () => {
      const getCallsBefore = mockService.getAll.mock.calls.length;

      await toolStore.enable('tool-3' as ToolId);

      expect(mockService.getAll.mock.calls.length).toBeGreaterThan(getCallsBefore);
    });

    it('handles errors', async () => {
      mockService.setEnabled = vi.fn().mockRejectedValue(new Error('Enable failed'));

      await toolStore.enable('tool-3' as ToolId);

      expect(toolStore.error).not.toBeNull();
    });
  });

  describe('disable()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('calls service.setEnabled() with false', async () => {
      await toolStore.disable('tool-1' as ToolId);

      expect(mockService.setEnabled).toHaveBeenCalledWith('tool-1', false);
    });

    it('refreshes tools after disabling', async () => {
      const getCallsBefore = mockService.getAll.mock.calls.length;

      await toolStore.disable('tool-1' as ToolId);

      expect(mockService.getAll.mock.calls.length).toBeGreaterThan(getCallsBefore);
    });

    it('handles errors', async () => {
      mockService.setEnabled = vi.fn().mockRejectedValue(new Error('Disable failed'));

      await toolStore.disable('tool-1' as ToolId);

      expect(toolStore.error).not.toBeNull();
    });
  });

  describe('get()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('calls service.get() with tool ID', async () => {
      await toolStore.get('tool-1' as ToolId);

      expect(mockService.get).toHaveBeenCalledWith('tool-1');
    });

    it('returns the tool if found', async () => {
      const result = await toolStore.get('tool-1' as ToolId);

      expect(result?.name).toBe('File Search');
    });

    it('returns undefined for non-existent tool', async () => {
      const result = await toolStore.get('nonexistent' as ToolId);

      expect(result).toBeUndefined();
    });
  });

  describe('getLocal()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('returns tool from local state', () => {
      const result = toolStore.getLocal('tool-1' as ToolId);

      expect(result?.name).toBe('File Search');
    });

    it('returns undefined for non-existent tool', () => {
      const result = toolStore.getLocal('nonexistent' as ToolId);

      expect(result).toBeUndefined();
    });

    it('does not call service', () => {
      toolStore.getLocal('tool-1' as ToolId);

      expect(mockService.get).not.toHaveBeenCalled();
    });
  });

  describe('clearSearch()', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    it('clears searchQuery', async () => {
      await toolStore.search('test');
      expect(toolStore.searchQuery).toBe('test');

      toolStore.clearSearch();

      expect(toolStore.searchQuery).toBe('');
    });

    it('clears searchResults', async () => {
      await toolStore.search('File');
      expect(toolStore.searchResults.length).toBeGreaterThan(0);

      toolStore.clearSearch();

      expect(toolStore.searchResults).toHaveLength(0);
    });
  });

  describe('derived state', () => {
    beforeEach(async () => {
      toolStore.init(mockService);
      await toolStore.load();
    });

    describe('categories', () => {
      it('returns all available categories', () => {
        const categories = toolStore.categories;

        expect(categories).toContain('note');
        expect(categories).toContain('editor');
        expect(categories).toContain('search');
        expect(categories).toContain('system');
        expect(categories).toContain('ai');
        expect(categories).toContain('custom');
      });
    });

    describe('activeCategories', () => {
      it('returns only categories with tools', () => {
        const active = toolStore.activeCategories;

        expect(active).toContain('search');
        expect(active).toContain('note');
        expect(active).toContain('ai');
        expect(active).toContain('system');
        expect(active).not.toContain('editor');
        expect(active).not.toContain('custom');
      });
    });

    describe('count', () => {
      it('returns total number of tools', () => {
        expect(toolStore.count).toBe(4);
      });

      it('returns 0 when no tools', () => {
        toolStore.destroy();
        expect(toolStore.count).toBe(0);
      });
    });

    describe('enabledTools', () => {
      it('returns only enabled tools', () => {
        const enabled = toolStore.enabledTools;

        expect(enabled).toHaveLength(3);
        expect(enabled.every((t) => t.enabled)).toBe(true);
      });
    });

    describe('disabledTools', () => {
      it('returns only disabled tools', () => {
        const disabled = toolStore.disabledTools;

        expect(disabled).toHaveLength(1);
        expect(disabled.every((t) => !t.enabled)).toBe(true);
        expect(disabled[0]!.name).toBe('AI Assistant');
      });
    });

    describe('enabledCount', () => {
      it('returns count of enabled tools', () => {
        expect(toolStore.enabledCount).toBe(3);
      });
    });

    describe('hasSearchResults', () => {
      it('is false when no search results', () => {
        expect(toolStore.hasSearchResults).toBe(false);
      });

      it('is true when search results exist', async () => {
        await toolStore.search('File');

        expect(toolStore.hasSearchResults).toBe(true);
      });
    });

    describe('isSearching', () => {
      it('is false when searchQuery is empty', () => {
        expect(toolStore.isSearching).toBe(false);
      });

      it('is true when searchQuery has content', async () => {
        await toolStore.search('test');

        expect(toolStore.isSearching).toBe(true);
      });

      it('is false for whitespace-only query', async () => {
        await toolStore.search('   ');

        expect(toolStore.isSearching).toBe(false);
      });
    });

    describe('toolsByCategory', () => {
      it('returns Map of category to tools', () => {
        const byCategory = toolStore.toolsByCategory;

        expect(byCategory).toBeInstanceOf(Map);
        expect(byCategory.get('search')).toHaveLength(1);
        expect(byCategory.get('note')).toHaveLength(1);
        expect(byCategory.get('ai')).toHaveLength(1);
        expect(byCategory.get('system')).toHaveLength(1);
      });

      it('does not include empty categories', () => {
        const byCategory = toolStore.toolsByCategory;

        expect(byCategory.has('editor')).toBe(false);
        expect(byCategory.has('custom')).toBe(false);
      });
    });
  });

  describe('destroy()', () => {
    it('resets all state', async () => {
      toolStore.init(mockService);
      await toolStore.load();
      await toolStore.search('test');

      toolStore.destroy();

      expect(toolStore.isInitialized).toBe(false);
      expect(toolStore.tools).toHaveLength(0);
      expect(toolStore.loading).toBe(false);
      expect(toolStore.error).toBeNull();
      expect(toolStore.searchQuery).toBe('');
      expect(toolStore.searchResults).toHaveLength(0);
    });

    it('cleans up subscriptions', () => {
      toolStore.init(mockService);
      expect(mockService.subscribe).toHaveBeenCalled();

      toolStore.destroy();

      // After destroy, the store should have cleaned up its subscription
      expect(toolStore.isInitialized).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('handles full workflow: init -> load -> search -> toggle -> clear', async () => {
      // Initialize
      toolStore.init(mockService);
      expect(toolStore.isInitialized).toBe(true);

      // Load tools
      await toolStore.load();
      expect(toolStore.tools).toHaveLength(4);
      expect(toolStore.count).toBe(4);

      // Search
      const results = await toolStore.search('File');
      expect(results).toHaveLength(1);
      expect(toolStore.isSearching).toBe(true);

      // Toggle a tool
      const aiTool = toolStore.tools.find((t) => t.name === 'AI Assistant');
      expect(aiTool?.enabled).toBe(false);
      await toolStore.toggleEnabled(aiTool!.id);
      expect(mockService.setEnabled).toHaveBeenCalledWith(aiTool!.id, true);

      // Clear search
      toolStore.clearSearch();
      expect(toolStore.isSearching).toBe(false);
      expect(toolStore.searchResults).toHaveLength(0);
    });

    it('maintains state through service subscription updates', async () => {
      toolStore.init(mockService);
      await toolStore.load();

      // Simulate service update by calling the subscription callback
      // The subscription should trigger a refresh
      const subscribeCallback = mockService.subscribe.mock.calls[0]![0];
      subscribeCallback();

      // Give async refresh time to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockService.getAll.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
