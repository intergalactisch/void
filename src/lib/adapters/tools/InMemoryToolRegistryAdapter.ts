/**
 * InMemoryToolRegistryAdapter - In-memory implementation of ToolRegistryPort
 *
 * Stores tool definitions in memory using a Map for fast lookup.
 * Implements search with relevance scoring using the matchTool function.
 *
 * Part of the Hexagonal Architecture - implements the ToolRegistryPort interface.
 *
 * Use Cases:
 * - Application tool registry
 * - Unit testing services that depend on ToolRegistryPort
 * - Browser-only development mode
 */

import type { Tool, ToolCategory } from '$lib/domain/entities/Tool';
import { matchTool } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolRegistryPort, ToolSearchOptions } from '$lib/ports/outbound/ToolRegistryPort';

/**
 * In-memory implementation of the tool registry port.
 *
 * @example
 * ```typescript
 * const registry = new InMemoryToolRegistryAdapter();
 *
 * await registry.register(createTool({
 *   id: createToolId('note', 'create'),
 *   name: 'Create Note',
 *   description: 'Create a new note',
 *   category: 'note',
 * }));
 *
 * const tool = await registry.get(createToolId('note', 'create'));
 * const searchResults = await registry.search('create');
 * ```
 */
export class InMemoryToolRegistryAdapter implements ToolRegistryPort {
  private readonly tools: Map<ToolId, Tool> = new Map();

  /**
   * Create a new InMemoryToolRegistryAdapter.
   *
   * @param initialTools - Optional array of tools to register on construction
   */
  constructor(initialTools?: Tool[]) {
    if (initialTools) {
      for (const tool of initialTools) {
        this.tools.set(tool.id, tool);
      }
    }
  }

  async register(tool: Tool): Promise<boolean> {
    if (this.tools.has(tool.id)) {
      return false;
    }
    this.tools.set(tool.id, { ...tool });
    return true;
  }

  async unregister(toolId: ToolId): Promise<boolean> {
    return this.tools.delete(toolId);
  }

  async get(toolId: ToolId): Promise<Tool | undefined> {
    const tool = this.tools.get(toolId);
    return tool ? { ...tool } : undefined;
  }

  async getAll(options?: ToolSearchOptions): Promise<Tool[]> {
    let tools = Array.from(this.tools.values());

    if (options?.category) {
      tools = tools.filter((t) => t.category === options.category);
    }

    if (options?.enabledOnly) {
      tools = tools.filter((t) => t.enabled);
    }

    if (options?.limit && options.limit > 0) {
      tools = tools.slice(0, options.limit);
    }

    // Return copies to prevent external mutation
    return tools.map((t) => ({ ...t }));
  }

  async search(query: string, options?: ToolSearchOptions): Promise<Tool[]> {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return this.getAll(options);
    }

    let tools = Array.from(this.tools.values());

    // Apply filters
    if (options?.category) {
      tools = tools.filter((t) => t.category === options.category);
    }

    if (options?.enabledOnly) {
      tools = tools.filter((t) => t.enabled);
    }

    // Score and sort by relevance
    const scored = tools
      .map((tool) => ({
        tool,
        score: matchTool(tool, normalizedQuery),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    // Apply limit
    let results = scored.map(({ tool }) => ({ ...tool }));
    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async has(toolId: ToolId): Promise<boolean> {
    return this.tools.has(toolId);
  }

  async getByCategory(category: ToolCategory): Promise<Tool[]> {
    return this.getAll({ category });
  }

  async setEnabled(toolId: ToolId, enabled: boolean): Promise<boolean> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return false;
    }

    this.tools.set(toolId, { ...tool, enabled });
    return true;
  }

  async count(enabledOnly?: boolean): Promise<number> {
    if (enabledOnly) {
      return Array.from(this.tools.values()).filter((t) => t.enabled).length;
    }
    return this.tools.size;
  }

  async clear(): Promise<void> {
    this.tools.clear();
  }

  // --- Testing utilities ---

  /**
   * Get the internal tools map size (for testing assertions).
   */
  getSize(): number {
    return this.tools.size;
  }

  /**
   * Seed multiple tools at once (for testing setup).
   */
  async seed(tools: Tool[]): Promise<void> {
    for (const tool of tools) {
      this.tools.set(tool.id, { ...tool });
    }
  }
}
