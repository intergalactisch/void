/**
 * ToolRegistryServiceImpl - Implementation of ToolRegistryService
 *
 * This service manages tool registration and retrieval, combining tool
 * definitions from the registry port with handlers from the executor port.
 *
 * It provides the bridge between AI-formatted tool definitions and
 * executable tool handlers.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type {
  ToolRegistryService,
  QuickToolOptions,
  AIToolDefinition,
} from '$lib/ports/inbound/ToolRegistryService';
import type { ToolRegistryPort } from '$lib/ports/outbound/ToolRegistryPort';
import type { ToolExecutorPort, ToolHandler } from '$lib/ports/outbound/ToolExecutorPort';
import type { Tool, ToolCategory, ParameterSchema } from '$lib/domain/entities/Tool';
import { createTool, formatToolForAI } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';
import { createToolId } from '$lib/domain/values/ToolId';

/**
 * Implementation of ToolRegistryService.
 *
 * Handles:
 * - Tool registration (definitions + handlers)
 * - Tool retrieval and search
 * - AI-formatted tool definitions
 * - Tool enable/disable management
 * - Subscription to registry changes
 *
 * @example
 * ```typescript
 * const registryPort = new InMemoryToolRegistryAdapter();
 * const executorPort = new ToolExecutorAdapter();
 * const service = new ToolRegistryServiceImpl(registryPort, executorPort);
 *
 * // Register with full tool definition
 * await service.register(createTool({
 *   id: createToolId('note', 'create'),
 *   name: 'Create Note',
 *   description: 'Create a new note',
 *   category: 'note',
 * }));
 *
 * // Or use quick registration
 * await service.registerQuick({
 *   namespace: 'note',
 *   action: 'delete',
 *   name: 'Delete Note',
 *   description: 'Delete a note by path',
 *   category: 'note',
 *   parameters: {
 *     path: { type: 'string', description: 'Path to the note', required: true },
 *   },
 * });
 *
 * // Get AI-formatted definitions
 * const definitions = await service.getToolDefinitions();
 * const systemPrompt = await service.getToolsSystemPrompt();
 * ```
 */
export class ToolRegistryServiceImpl implements ToolRegistryService {
  private readonly registryPort: ToolRegistryPort;
  private readonly executorPort: ToolExecutorPort;
  private readonly subscribers: Set<() => void> = new Set();

  constructor(registryPort: ToolRegistryPort, executorPort: ToolExecutorPort) {
    this.registryPort = registryPort;
    this.executorPort = executorPort;
  }

  // =========================================================================
  // Registration methods
  // =========================================================================

  async register(tool: Tool): Promise<boolean> {
    const registered = await this.registryPort.register(tool);
    if (registered) {
      this.notifySubscribers();
    }
    return registered;
  }

  /**
   * Register a tool with its handler in one call.
   * This is a convenience method that combines registry and executor registration.
   */
  async registerWithHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    tool: Tool,
    handler: ToolHandler<TArgs, TResult>
  ): Promise<boolean> {
    const registered = await this.registryPort.register(tool);
    if (registered) {
      this.executorPort.registerHandler(tool.id, handler);
      this.notifySubscribers();
    }
    return registered;
  }

  async registerAll(tools: Tool[]): Promise<number> {
    let count = 0;
    for (const tool of tools) {
      const registered = await this.registryPort.register(tool);
      if (registered) {
        count++;
      }
    }
    if (count > 0) {
      this.notifySubscribers();
    }
    return count;
  }

  async registerQuick(options: QuickToolOptions): Promise<Tool> {
    const toolId = createToolId(options.namespace, options.action);

    const toolParams: Parameters<typeof createTool>[0] = {
      id: toolId,
      name: options.name,
      description: options.description,
      category: options.category,
    };

    if (options.parameters !== undefined) {
      toolParams.parameters = options.parameters;
    }
    if (options.requiresConfirmation !== undefined) {
      toolParams.requiresConfirmation = options.requiresConfirmation;
    }
    if (options.keywords !== undefined) {
      toolParams.keywords = options.keywords;
    }
    if (options.examples !== undefined) {
      toolParams.examples = options.examples;
    }

    const tool = createTool(toolParams);

    await this.registryPort.register(tool);
    this.notifySubscribers();

    return tool;
  }

  /**
   * Quick registration with handler.
   * Creates a tool from simplified options and registers its handler.
   */
  async registerQuickWithHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    options: QuickToolOptions,
    handler: ToolHandler<TArgs, TResult>
  ): Promise<Tool> {
    const tool = await this.registerQuick(options);
    this.executorPort.registerHandler(tool.id, handler);
    return tool;
  }

  async unregister(toolId: ToolId): Promise<boolean> {
    const unregistered = await this.registryPort.unregister(toolId);
    if (unregistered) {
      this.executorPort.unregisterHandler(toolId);
      this.notifySubscribers();
    }
    return unregistered;
  }

  async clear(): Promise<void> {
    // Get all tools first to unregister their handlers
    const tools = await this.registryPort.getAll();
    for (const tool of tools) {
      this.executorPort.unregisterHandler(tool.id);
    }
    await this.registryPort.clear();
    this.notifySubscribers();
  }

  // =========================================================================
  // Retrieval methods
  // =========================================================================

  async get(toolId: ToolId): Promise<Tool | undefined> {
    return this.registryPort.get(toolId);
  }

  async getAll(enabledOnly = false): Promise<Tool[]> {
    return this.registryPort.getAll({ enabledOnly });
  }

  async getByCategory(category: ToolCategory): Promise<Tool[]> {
    return this.registryPort.getByCategory(category);
  }

  async search(query: string, limit?: number): Promise<Tool[]> {
    if (limit !== undefined) {
      return this.registryPort.search(query, { limit });
    }
    return this.registryPort.search(query);
  }

  async has(toolId: ToolId): Promise<boolean> {
    return this.registryPort.has(toolId);
  }

  // =========================================================================
  // AI integration methods
  // =========================================================================

  async getToolDefinitions(enabledOnly = true): Promise<AIToolDefinition[]> {
    const tools = await this.registryPort.getAll({ enabledOnly });

    return tools.map((tool) => this.toAIToolDefinition(tool));
  }

  async getToolsSystemPrompt(): Promise<string> {
    const tools = await this.registryPort.getAll({ enabledOnly: true });

    if (tools.length === 0) {
      return '';
    }

    const lines: string[] = [
      '## Available Tools',
      '',
      'You have access to the following tools. To use a tool, include a tool call in your response using this format:',
      '',
      '<tool_call>',
      '<tool>namespace:action</tool>',
      '<args>{"param": "value"}</args>',
      '</tool_call>',
      '',
      'You can make multiple tool calls in a single response.',
      '',
      '---',
      '',
    ];

    for (const tool of tools) {
      lines.push(formatToolForAI(tool));
      lines.push('');
    }

    return lines.join('\n');
  }

  // =========================================================================
  // Management methods
  // =========================================================================

  async setEnabled(toolId: ToolId, enabled: boolean): Promise<boolean> {
    const updated = await this.registryPort.setEnabled(toolId, enabled);
    if (updated) {
      this.notifySubscribers();
    }
    return updated;
  }

  async count(enabledOnly = false): Promise<number> {
    return this.registryPort.count(enabledOnly);
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Convert a Tool to an AIToolDefinition for API consumption.
   */
  private toAIToolDefinition(tool: Tool): AIToolDefinition {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, schema] of Object.entries(tool.parameters)) {
      properties[name] = this.parameterSchemaToJsonSchema(schema);
      if (schema.required) {
        required.push(name);
      }
    }

    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    };
  }

  /**
   * Convert a ParameterSchema to JSON Schema format.
   */
  private parameterSchemaToJsonSchema(schema: ParameterSchema): Record<string, unknown> {
    const jsonSchema: Record<string, unknown> = {
      type: schema.type,
      description: schema.description,
    };

    if (schema.default !== undefined) {
      jsonSchema.default = schema.default;
    }

    if (schema.enum !== undefined) {
      jsonSchema.enum = schema.enum;
    }

    if (schema.type === 'number') {
      if (schema.minimum !== undefined) jsonSchema.minimum = schema.minimum;
      if (schema.maximum !== undefined) jsonSchema.maximum = schema.maximum;
    }

    if (schema.type === 'string') {
      if (schema.minLength !== undefined) jsonSchema.minLength = schema.minLength;
      if (schema.maxLength !== undefined) jsonSchema.maxLength = schema.maxLength;
      if (schema.pattern !== undefined) jsonSchema.pattern = schema.pattern;
    }

    if (schema.type === 'array') {
      if (schema.minLength !== undefined) jsonSchema.minItems = schema.minLength;
      if (schema.maxLength !== undefined) jsonSchema.maxItems = schema.maxLength;
      if (schema.items) {
        jsonSchema.items = this.parameterSchemaToJsonSchema(schema.items);
      }
    }

    if (schema.type === 'object' && schema.properties) {
      const objProperties: Record<string, unknown> = {};
      const objRequired: string[] = [];

      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        objProperties[propName] = this.parameterSchemaToJsonSchema(propSchema);
        if (propSchema.required) {
          objRequired.push(propName);
        }
      }

      jsonSchema.properties = objProperties;
      if (objRequired.length > 0) {
        jsonSchema.required = objRequired;
      }
    }

    return jsonSchema;
  }

  /**
   * Notify all subscribers of a registry change.
   */
  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      try {
        callback();
      } catch (error) {
        console.error('Error in ToolRegistryService subscriber:', error);
      }
    }
  }
}
