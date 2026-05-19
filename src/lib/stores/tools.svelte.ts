/**
 * Tool Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the ToolRegistryService application service.
 *
 * Provides reactive state for the tool registry including:
 * - List of available tools
 * - Tool categories
 * - Search functionality
 * - Tool enable/disable management
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
import type { ToolRegistryService } from '$lib/ports/inbound';
import type { Tool, ToolCategory } from '$lib/domain/entities/Tool';
import { matchTool } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';

/**
 * All available tool categories.
 */
const ALL_CATEGORIES: ToolCategory[] = [
  'note',
  'editor',
  'search',
  'navigation',
  'system',
  'ai',
  'custom',
];

/**
 * Tool Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to the tool registry and methods to
 * search, filter, and manage tools.
 */
class ToolStore {
  #service: ToolRegistryService | null = null;
  #unsubscribe: (() => void) | null = null;

  // Reactive state
  tools = $state<Tool[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);

  // Search state
  searchQuery = $state('');
  searchResults = $state<Tool[]>([]);

  /**
   * Initialize the store with a ToolRegistryService instance.
   * Must be called before using any other methods.
   *
   * @param service - The ToolRegistryService to use
   */
  init(service: ToolRegistryService) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;

    // Subscribe to registry changes
    this.#unsubscribe = service.subscribe(() => {
      void this.#refreshTools();
    });
  }

  /**
   * Load all tools from the registry.
   */
  async load(): Promise<void> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    this.loading = true;
    this.error = null;

    try {
      await this.#refreshTools();
    } catch (e) {
      this.error = toError(e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Search tools by query string.
   * Uses the service's search method for relevance ranking.
   *
   * @param query - Search query
   * @param limit - Maximum results (default 10)
   * @returns Array of matching tools
   */
  async search(query: string, limit = 10): Promise<Tool[]> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    this.searchQuery = query;

    if (!query.trim()) {
      this.searchResults = [];
      return [];
    }

    try {
      const results = await this.#service.search(query, limit);
      this.searchResults = results;
      return results;
    } catch (e) {
      this.error = toError(e);
      this.searchResults = [];
      return [];
    }
  }

  /**
   * Search tools locally (synchronous, client-side filtering).
   * Useful for instant filtering without service call.
   *
   * @param query - Search query
   * @returns Array of matching tools sorted by relevance
   */
  searchLocal(query: string): Tool[] {
    if (!query.trim()) return [];

    return this.tools
      .map((tool) => ({ tool, score: matchTool(tool, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ tool }) => tool);
  }

  /**
   * Get tools by category.
   *
   * @param category - Category to filter by
   * @returns Array of tools in the category
   */
  async getByCategory(category: ToolCategory): Promise<Tool[]> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    try {
      return await this.#service.getByCategory(category);
    } catch (e) {
      this.error = toError(e);
      return [];
    }
  }

  /**
   * Get tools by category from local state (synchronous).
   *
   * @param category - Category to filter by
   * @returns Array of tools in the category
   */
  getByCategoryLocal(category: ToolCategory): Tool[] {
    return this.tools.filter((tool) => tool.category === category);
  }

  /**
   * Toggle a tool's enabled state.
   *
   * @param toolId - ID of the tool to toggle
   */
  async toggleEnabled(toolId: ToolId): Promise<void> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    const tool = this.tools.find((t) => t.id === toolId);
    if (!tool) return;

    try {
      await this.#service.setEnabled(toolId, !tool.enabled);
      await this.#refreshTools();
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Enable a tool.
   *
   * @param toolId - ID of the tool to enable
   */
  async enable(toolId: ToolId): Promise<void> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    try {
      await this.#service.setEnabled(toolId, true);
      await this.#refreshTools();
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Disable a tool.
   *
   * @param toolId - ID of the tool to disable
   */
  async disable(toolId: ToolId): Promise<void> {
    if (!this.#service) throw new Error('ToolStore not initialized');

    try {
      await this.#service.setEnabled(toolId, false);
      await this.#refreshTools();
    } catch (e) {
      this.error = toError(e);
    }
  }

  /**
   * Get a tool by ID.
   *
   * @param toolId - ID of the tool
   * @returns The tool or undefined
   */
  async get(toolId: ToolId): Promise<Tool | undefined> {
    if (!this.#service) throw new Error('ToolStore not initialized');
    return this.#service.get(toolId);
  }

  /**
   * Get a tool by ID from local state (synchronous).
   *
   * @param toolId - ID of the tool
   * @returns The tool or undefined
   */
  getLocal(toolId: ToolId): Tool | undefined {
    return this.tools.find((t) => t.id === toolId);
  }

  /**
   * Clear the search state.
   */
  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  /**
   * Get all available categories.
   */
  get categories(): ToolCategory[] {
    return ALL_CATEGORIES;
  }

  /**
   * Get categories that have tools.
   */
  get activeCategories(): ToolCategory[] {
    const categoriesWithTools = new Set(this.tools.map((t) => t.category));
    return ALL_CATEGORIES.filter((c) => categoriesWithTools.has(c));
  }

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Get the total count of tools.
   */
  get count(): number {
    return this.tools.length;
  }

  /**
   * Get enabled tools only.
   */
  get enabledTools(): Tool[] {
    return this.tools.filter((t) => t.enabled);
  }

  /**
   * Get disabled tools only.
   */
  get disabledTools(): Tool[] {
    return this.tools.filter((t) => !t.enabled);
  }

  /**
   * Get count of enabled tools.
   */
  get enabledCount(): number {
    return this.tools.filter((t) => t.enabled).length;
  }

  /**
   * Check if there are any search results.
   */
  get hasSearchResults(): boolean {
    return this.searchResults.length > 0;
  }

  /**
   * Check if a search is active.
   */
  get isSearching(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  /**
   * Get tools grouped by category.
   */
  get toolsByCategory(): Map<ToolCategory, Tool[]> {
    const grouped = new Map<ToolCategory, Tool[]>();

    for (const category of ALL_CATEGORIES) {
      const categoryTools = this.tools.filter((t) => t.category === category);
      if (categoryTools.length > 0) {
        grouped.set(category, categoryTools);
      }
    }

    return grouped;
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Refresh tools from the service.
   */
  async #refreshTools(): Promise<void> {
    if (!this.#service) return;
    this.tools = await this.#service.getAll();
  }

  /**
   * Cleanup subscriptions.
   */
  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    this.#cleanup();
    this.#service = null;
    this.tools = [];
    this.loading = false;
    this.error = null;
    this.searchQuery = '';
    this.searchResults = [];
  }
}

export const toolStore = new ToolStore();
