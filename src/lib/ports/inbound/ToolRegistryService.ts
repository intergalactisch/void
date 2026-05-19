/**
 * ToolRegistryService - Inbound port for tool management
 *
 * This service manages the registration and retrieval of application tools.
 * Tools are capabilities that can be invoked by the AI.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Tool, ToolCategory, ParameterSchema } from '$lib/domain/entities/Tool';
import type { ToolId, ToolNamespace } from '$lib/domain/values/ToolId';
import type { ToolHandler } from '$lib/ports/outbound/ToolExecutorPort';

/**
 * Options for creating a tool quickly.
 */
export interface QuickToolOptions {
  /** Tool namespace */
  namespace: ToolNamespace;
  /** Tool action name */
  action: string;
  /** Human-readable name */
  name: string;
  /** Description for AI */
  description: string;
  /** Category */
  category: ToolCategory;
  /** Parameter definitions */
  parameters?: Record<string, ParameterSchema>;
  /** Whether to require user confirmation */
  requiresConfirmation?: boolean;
  /** Search keywords */
  keywords?: string[];
  /** Example usage phrases */
  examples?: string[];
}

/**
 * Tool definition formatted for AI consumption.
 */
export interface AIToolDefinition {
  /** Tool ID */
  id: ToolId;
  /** Tool name */
  name: string;
  /** Description */
  description: string;
  /** Parameter schema in JSON Schema format */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Inbound port for tool registry operations.
 *
 * This is the service interface that the application uses to manage tools.
 */
export interface ToolRegistryService {
  // =========================================================================
  // Registration methods
  // =========================================================================

  /**
   * Register a tool.
   * @param tool - Tool definition
   * @returns True if registered, false if tool with same ID exists
   */
  register(tool: Tool): Promise<boolean>;

  /**
   * Register multiple tools at once.
   * @param tools - Array of tool definitions
   * @returns Number of tools successfully registered
   */
  registerAll(tools: Tool[]): Promise<number>;

  /**
   * Quick registration with minimal options.
   * Creates and registers a tool from simplified options.
   * @param options - Quick tool options
   * @returns The created tool
   */
  registerQuick(options: QuickToolOptions): Promise<Tool>;

  /**
   * Register a tool with its handler in one call.
   * This is a convenience method that combines registry and executor registration.
   * @param tool - Tool definition
   * @param handler - Tool execution handler
   * @returns True if registered, false if tool with same ID exists
   */
  registerWithHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    tool: Tool,
    handler: ToolHandler<TArgs, TResult>
  ): Promise<boolean>;

  /**
   * Unregister a tool.
   * @param toolId - ID of tool to remove
   * @returns True if removed, false if not found
   */
  unregister(toolId: ToolId): Promise<boolean>;

  /**
   * Clear all registered tools.
   */
  clear(): Promise<void>;

  // =========================================================================
  // Retrieval methods
  // =========================================================================

  /**
   * Get a tool by ID.
   * @param toolId - Tool ID
   * @returns Tool or undefined if not found
   */
  get(toolId: ToolId): Promise<Tool | undefined>;

  /**
   * Get all registered tools.
   * @param enabledOnly - If true, only return enabled tools
   * @returns Array of tools
   */
  getAll(enabledOnly?: boolean): Promise<Tool[]>;

  /**
   * Get tools by category.
   * @param category - Category to filter by
   * @returns Array of tools in category
   */
  getByCategory(category: ToolCategory): Promise<Tool[]>;

  /**
   * Search tools by query.
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Array of matching tools sorted by relevance
   */
  search(query: string, limit?: number): Promise<Tool[]>;

  /**
   * Check if a tool exists.
   * @param toolId - Tool ID
   * @returns True if tool exists
   */
  has(toolId: ToolId): Promise<boolean>;

  // =========================================================================
  // AI integration methods
  // =========================================================================

  /**
   * Get tool definitions formatted for AI.
   * This returns tools in a format suitable for including in AI prompts.
   * @param enabledOnly - If true, only return enabled tools
   * @returns Array of AI-formatted tool definitions
   */
  getToolDefinitions(enabledOnly?: boolean): Promise<AIToolDefinition[]>;

  /**
   * Get a formatted string of all tools for the system prompt.
   * @returns Formatted tool documentation
   */
  getToolsSystemPrompt(): Promise<string>;

  // =========================================================================
  // Management methods
  // =========================================================================

  /**
   * Enable or disable a tool.
   * @param toolId - Tool ID
   * @param enabled - Whether to enable or disable
   * @returns True if updated, false if not found
   */
  setEnabled(toolId: ToolId, enabled: boolean): Promise<boolean>;

  /**
   * Get count of registered tools.
   * @param enabledOnly - If true, only count enabled
   * @returns Tool count
   */
  count(enabledOnly?: boolean): Promise<number>;

  /**
   * Subscribe to registry changes.
   * @param callback - Called when tools are added/removed
   * @returns Unsubscribe function
   */
  subscribe(callback: () => void): () => void;
}
