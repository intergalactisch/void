/**
 * ToolRegistryPort - Outbound port for tool storage and retrieval
 *
 * This port defines how the application stores and retrieves tool definitions.
 * Tools are capabilities that can be invoked by the AI or other parts of the system.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Tool, ToolCategory } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';

/**
 * Filter options for searching tools.
 */
export interface ToolSearchOptions {
  /** Filter by category */
  category?: ToolCategory;
  /** Only return enabled tools */
  enabledOnly?: boolean;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Outbound port for tool registry operations.
 *
 * Implemented by adapters that store tool definitions (e.g., in-memory, database).
 */
export interface ToolRegistryPort {
  /**
   * Register a new tool.
   * @param tool - Tool definition to register
   * @returns True if registered, false if tool with same ID already exists
   */
  register(tool: Tool): Promise<boolean>;

  /**
   * Unregister a tool by ID.
   * @param toolId - ID of tool to unregister
   * @returns True if unregistered, false if tool didn't exist
   */
  unregister(toolId: ToolId): Promise<boolean>;

  /**
   * Get a tool by ID.
   * @param toolId - ID of tool to retrieve
   * @returns Tool definition or undefined if not found
   */
  get(toolId: ToolId): Promise<Tool | undefined>;

  /**
   * Get all registered tools.
   * @param options - Optional filter options
   * @returns Array of tool definitions
   */
  getAll(options?: ToolSearchOptions): Promise<Tool[]>;

  /**
   * Search tools by query string.
   * Matches against tool name, description, and keywords.
   * @param query - Search query
   * @param options - Optional filter options
   * @returns Array of matching tools sorted by relevance
   */
  search(query: string, options?: ToolSearchOptions): Promise<Tool[]>;

  /**
   * Check if a tool is registered.
   * @param toolId - ID of tool to check
   * @returns True if tool exists
   */
  has(toolId: ToolId): Promise<boolean>;

  /**
   * Get tools by category.
   * @param category - Category to filter by
   * @returns Array of tools in the category
   */
  getByCategory(category: ToolCategory): Promise<Tool[]>;

  /**
   * Enable or disable a tool.
   * @param toolId - ID of tool to update
   * @param enabled - Whether tool should be enabled
   * @returns True if updated, false if tool not found
   */
  setEnabled(toolId: ToolId, enabled: boolean): Promise<boolean>;

  /**
   * Get count of registered tools.
   * @param enabledOnly - If true, only count enabled tools
   * @returns Number of tools
   */
  count(enabledOnly?: boolean): Promise<number>;

  /**
   * Clear all registered tools.
   * Mainly useful for testing.
   */
  clear(): Promise<void>;
}
