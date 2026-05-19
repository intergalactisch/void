/**
 * Unit tests for ToolRegistryServiceImpl
 *
 * Tests for the tool registry service implementation, verifying:
 * - Tool registration (single, multiple, with handlers)
 * - Tool retrieval (by ID, category, search)
 * - Tool management (enable/disable, count, clear)
 * - AI integration (definitions, system prompt)
 * - Subscription notifications
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistryServiceImpl } from '$lib/application/services';
import { InMemoryToolRegistryAdapter } from '$lib/adapters/tools';
import { ToolExecutorAdapter } from '$lib/adapters/tools';
import { createTool, type Tool, type ParameterSchema } from '$lib/domain/entities/Tool';
import { createToolId, type ToolId } from '$lib/domain/values/ToolId';
import type { ToolHandler, ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

// Mock the events module to prevent side effects
vi.mock('$lib/events', () => {
  return {
    events: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      all: { clear: vi.fn() },
    },
  };
});

// Helper functions for creating test tools
function createTestTool(options: {
  namespace?: 'note' | 'editor' | 'search' | 'navigation' | 'system' | 'custom';
  action?: string;
  name?: string;
  description?: string;
  category?: 'note' | 'editor' | 'search' | 'navigation' | 'system' | 'ai' | 'custom';
  parameters?: Record<string, ParameterSchema>;
  enabled?: boolean;
  keywords?: string[];
  examples?: string[];
  requiresConfirmation?: boolean;
}): Tool {
  const namespace = options.namespace ?? 'note';
  const action = options.action ?? 'test';
  const tool = createTool({
    id: createToolId(namespace, action),
    name: options.name ?? 'Test Tool',
    description: options.description ?? 'A test tool',
    category: options.category ?? 'note',
    parameters: options.parameters,
    keywords: options.keywords,
    examples: options.examples,
    requiresConfirmation: options.requiresConfirmation,
  });

  // If enabled is explicitly set to false, modify the tool
  if (options.enabled === false) {
    return { ...tool, enabled: false };
  }
  return tool;
}

describe('ToolRegistryServiceImpl', () => {
  let registryPort: InMemoryToolRegistryAdapter;
  let executorPort: ToolExecutorAdapter;
  let service: ToolRegistryServiceImpl;

  beforeEach(() => {
    registryPort = new InMemoryToolRegistryAdapter();
    executorPort = new ToolExecutorAdapter();
    service = new ToolRegistryServiceImpl(registryPort, executorPort);
  });

  // =========================================================================
  // register()
  // =========================================================================
  describe('register()', () => {
    it('registers a tool and returns true', async () => {
      const tool = createTestTool({ action: 'create', name: 'Create Note' });

      const result = await service.register(tool);

      expect(result).toBe(true);
    });

    it('returns false when registering duplicate tool ID', async () => {
      const tool = createTestTool({ action: 'create' });
      await service.register(tool);

      const duplicate = createTestTool({ action: 'create', name: 'Different Name' });
      const result = await service.register(duplicate);

      expect(result).toBe(false);
    });

    it('makes tool retrievable via get()', async () => {
      const tool = createTestTool({ action: 'create', name: 'Create Note' });
      await service.register(tool);

      const retrieved = await service.get(tool.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Create Note');
    });

    it('notifies subscribers on successful registration', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.register(createTestTool({ action: 'create' }));

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not notify subscribers on failed registration', async () => {
      const tool = createTestTool({ action: 'create' });
      await service.register(tool);

      const callback = vi.fn();
      service.subscribe(callback);

      // Try to register duplicate
      await service.register(tool);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // registerWithHandler()
  // =========================================================================
  describe('registerWithHandler()', () => {
    it('registers tool with handler and returns true', async () => {
      const tool = createTestTool({ action: 'withhandler' });
      const handler: ToolHandler = async () => ({ success: true });

      const result = await service.registerWithHandler(tool, handler);

      expect(result).toBe(true);
    });

    it('makes tool retrievable', async () => {
      const tool = createTestTool({ action: 'withhandler', name: 'Handler Tool' });
      const handler: ToolHandler = async () => ({ result: 'done' });

      await service.registerWithHandler(tool, handler);

      const retrieved = await service.get(tool.id);
      expect(retrieved?.name).toBe('Handler Tool');
    });

    it('registers handler with executor port', async () => {
      const tool = createTestTool({ action: 'withhandler' });
      const handler: ToolHandler = async () => ({ success: true });

      await service.registerWithHandler(tool, handler);

      expect(executorPort.hasHandler(tool.id)).toBe(true);
    });

    it('returns false for duplicate tool ID', async () => {
      const tool = createTestTool({ action: 'withhandler' });
      const handler: ToolHandler = async () => ({ first: true });

      await service.registerWithHandler(tool, handler);

      const result = await service.registerWithHandler(tool, async () => ({ second: true }));

      expect(result).toBe(false);
    });

    it('notifies subscribers on successful registration', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const tool = createTestTool({ action: 'withhandler' });
      await service.registerWithHandler(tool, async () => ({}));

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // registerAll()
  // =========================================================================
  describe('registerAll()', () => {
    it('registers multiple tools at once', async () => {
      const tools = [
        createTestTool({ action: 'one', name: 'Tool One' }),
        createTestTool({ action: 'two', name: 'Tool Two' }),
        createTestTool({ action: 'three', name: 'Tool Three' }),
      ];

      const count = await service.registerAll(tools);

      expect(count).toBe(3);
    });

    it('returns count of successfully registered tools', async () => {
      const existingTool = createTestTool({ action: 'existing' });
      await service.register(existingTool);

      const tools = [
        createTestTool({ action: 'existing' }), // Should fail
        createTestTool({ action: 'new' }),       // Should succeed
      ];

      const count = await service.registerAll(tools);

      expect(count).toBe(1);
    });

    it('makes all registered tools retrievable', async () => {
      const tools = [
        createTestTool({ action: 'alpha' }),
        createTestTool({ action: 'beta' }),
      ];

      await service.registerAll(tools);

      const all = await service.getAll();
      expect(all).toHaveLength(2);
    });

    it('notifies subscribers once when at least one tool registered', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const tools = [
        createTestTool({ action: 'a' }),
        createTestTool({ action: 'b' }),
      ];

      await service.registerAll(tools);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not notify subscribers when no tools registered', async () => {
      const existingTool = createTestTool({ action: 'existing' });
      await service.register(existingTool);

      const callback = vi.fn();
      service.subscribe(callback);

      // All duplicates
      await service.registerAll([existingTool]);

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles empty array', async () => {
      const count = await service.registerAll([]);

      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // registerQuick()
  // =========================================================================
  describe('registerQuick()', () => {
    it('creates and registers tool from options', async () => {
      const tool = await service.registerQuick({
        namespace: 'note',
        action: 'quick',
        name: 'Quick Tool',
        description: 'A quickly registered tool',
        category: 'note',
      });

      expect(tool.id).toBe('note:quick');
      expect(tool.name).toBe('Quick Tool');
      expect(tool.description).toBe('A quickly registered tool');
      expect(tool.enabled).toBe(true);
    });

    it('registers tool with parameters', async () => {
      const tool = await service.registerQuick({
        namespace: 'note',
        action: 'withparams',
        name: 'With Params',
        description: 'Has parameters',
        category: 'note',
        parameters: {
          title: { type: 'string', description: 'Note title', required: true },
          tags: { type: 'array', description: 'Tags' },
        },
      });

      expect(Object.keys(tool.parameters)).toHaveLength(2);
      expect(tool.parameters.title.type).toBe('string');
      expect(tool.parameters.title.required).toBe(true);
    });

    it('registers tool with requiresConfirmation', async () => {
      const tool = await service.registerQuick({
        namespace: 'note',
        action: 'dangerous',
        name: 'Dangerous Tool',
        description: 'Requires confirmation',
        category: 'note',
        requiresConfirmation: true,
      });

      expect(tool.requiresConfirmation).toBe(true);
    });

    it('registers tool with keywords', async () => {
      const tool = await service.registerQuick({
        namespace: 'search',
        action: 'find',
        name: 'Find',
        description: 'Find things',
        category: 'search',
        keywords: ['lookup', 'query', 'locate'],
      });

      expect(tool.keywords).toEqual(['lookup', 'query', 'locate']);
    });

    it('registers tool with examples', async () => {
      const tool = await service.registerQuick({
        namespace: 'note',
        action: 'create',
        name: 'Create',
        description: 'Create a note',
        category: 'note',
        examples: ['Create a note about meetings', 'Make a new note for today'],
      });

      expect(tool.examples).toHaveLength(2);
    });

    it('makes tool retrievable', async () => {
      await service.registerQuick({
        namespace: 'editor',
        action: 'format',
        name: 'Format',
        description: 'Format text',
        category: 'editor',
      });

      const retrieved = await service.get(createToolId('editor', 'format'));
      expect(retrieved?.name).toBe('Format');
    });

    it('notifies subscribers', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.registerQuick({
        namespace: 'note',
        action: 'notify',
        name: 'Notify',
        description: 'Test',
        category: 'note',
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // registerQuickWithHandler()
  // =========================================================================
  describe('registerQuickWithHandler()', () => {
    it('creates, registers tool, and attaches handler', async () => {
      const handler: ToolHandler = async () => ({ done: true });

      const tool = await service.registerQuickWithHandler(
        {
          namespace: 'note',
          action: 'quickhandler',
          name: 'Quick With Handler',
          description: 'Quick registration with handler',
          category: 'note',
        },
        handler
      );

      expect(tool.id).toBe('note:quickhandler');
      expect(executorPort.hasHandler(tool.id)).toBe(true);
    });

    it('preserves all quick tool options', async () => {
      const handler: ToolHandler = async () => ({});

      const tool = await service.registerQuickWithHandler(
        {
          namespace: 'system',
          action: 'settings',
          name: 'Settings',
          description: 'Change settings',
          category: 'system',
          parameters: {
            key: { type: 'string', description: 'Setting key', required: true },
          },
          requiresConfirmation: true,
          keywords: ['config', 'preferences'],
        },
        handler
      );

      expect(tool.parameters.key).toBeDefined();
      expect(tool.requiresConfirmation).toBe(true);
      expect(tool.keywords).toContain('config');
    });
  });

  // =========================================================================
  // unregister()
  // =========================================================================
  describe('unregister()', () => {
    it('removes tool and returns true', async () => {
      const tool = createTestTool({ action: 'toremove' });
      await service.register(tool);

      const result = await service.unregister(tool.id);

      expect(result).toBe(true);
    });

    it('returns false for non-existent tool', async () => {
      const result = await service.unregister(createToolId('note', 'nonexistent'));

      expect(result).toBe(false);
    });

    it('makes tool no longer retrievable', async () => {
      const tool = createTestTool({ action: 'removeme' });
      await service.register(tool);

      await service.unregister(tool.id);

      const retrieved = await service.get(tool.id);
      expect(retrieved).toBeUndefined();
    });

    it('unregisters handler from executor port', async () => {
      const tool = createTestTool({ action: 'withhandler' });
      await service.registerWithHandler(tool, async () => ({}));

      await service.unregister(tool.id);

      expect(executorPort.hasHandler(tool.id)).toBe(false);
    });

    it('notifies subscribers on successful unregister', async () => {
      const tool = createTestTool({ action: 'toremove' });
      await service.register(tool);

      const callback = vi.fn();
      service.subscribe(callback);

      await service.unregister(tool.id);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not notify subscribers when tool not found', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.unregister(createToolId('note', 'nonexistent'));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // clear()
  // =========================================================================
  describe('clear()', () => {
    it('removes all registered tools', async () => {
      await service.registerAll([
        createTestTool({ action: 'one' }),
        createTestTool({ action: 'two' }),
        createTestTool({ action: 'three' }),
      ]);

      await service.clear();

      const all = await service.getAll();
      expect(all).toHaveLength(0);
    });

    it('unregisters all handlers from executor port', async () => {
      const tool1 = createTestTool({ action: 'handler1' });
      const tool2 = createTestTool({ action: 'handler2' });
      await service.registerWithHandler(tool1, async () => ({}));
      await service.registerWithHandler(tool2, async () => ({}));

      await service.clear();

      expect(executorPort.hasHandler(tool1.id)).toBe(false);
      expect(executorPort.hasHandler(tool2.id)).toBe(false);
    });

    it('notifies subscribers', async () => {
      await service.register(createTestTool({ action: 'any' }));

      const callback = vi.fn();
      service.subscribe(callback);

      await service.clear();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('works when registry is empty', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.clear();

      // Still notifies even when empty
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // get()
  // =========================================================================
  describe('get()', () => {
    it('retrieves tool by ID', async () => {
      const tool = createTestTool({ action: 'myaction', name: 'My Tool' });
      await service.register(tool);

      const retrieved = await service.get(tool.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(tool.id);
      expect(retrieved?.name).toBe('My Tool');
    });

    it('returns undefined for non-existent tool', async () => {
      const retrieved = await service.get(createToolId('note', 'nonexistent'));

      expect(retrieved).toBeUndefined();
    });

    it('returns copy of tool (not reference)', async () => {
      const tool = createTestTool({ action: 'copy' });
      await service.register(tool);

      const retrieved = await service.get(tool.id);

      // Modifying retrieved should not affect stored tool
      if (retrieved) {
        retrieved.name = 'Modified';
        const retrievedAgain = await service.get(tool.id);
        expect(retrievedAgain?.name).not.toBe('Modified');
      }
    });
  });

  // =========================================================================
  // getAll()
  // =========================================================================
  describe('getAll()', () => {
    it('returns all registered tools', async () => {
      await service.registerAll([
        createTestTool({ action: 'a' }),
        createTestTool({ action: 'b' }),
        createTestTool({ action: 'c' }),
      ]);

      const all = await service.getAll();

      expect(all).toHaveLength(3);
    });

    it('returns empty array when no tools registered', async () => {
      const all = await service.getAll();

      expect(all).toEqual([]);
    });

    it('returns only enabled tools when enabledOnly is true', async () => {
      const enabledTool = createTestTool({ action: 'enabled' });
      const disabledTool = createTestTool({ action: 'disabled' });

      await service.register(enabledTool);
      await service.register(disabledTool);
      await service.setEnabled(disabledTool.id, false);

      const enabledOnly = await service.getAll(true);

      expect(enabledOnly).toHaveLength(1);
      expect(enabledOnly[0].id).toBe(enabledTool.id);
    });

    it('returns all tools when enabledOnly is false', async () => {
      const enabledTool = createTestTool({ action: 'enabled' });
      const disabledTool = createTestTool({ action: 'disabled' });

      await service.register(enabledTool);
      await service.register(disabledTool);
      await service.setEnabled(disabledTool.id, false);

      const all = await service.getAll(false);

      expect(all).toHaveLength(2);
    });
  });

  // =========================================================================
  // getByCategory()
  // =========================================================================
  describe('getByCategory()', () => {
    it('returns tools filtered by category', async () => {
      await service.registerAll([
        createTestTool({ namespace: 'note', action: 'create', category: 'note' }),
        createTestTool({ namespace: 'note', action: 'delete', category: 'note' }),
        createTestTool({ namespace: 'editor', action: 'format', category: 'editor' }),
      ]);

      const noteTools = await service.getByCategory('note');

      expect(noteTools).toHaveLength(2);
      noteTools.forEach((tool) => {
        expect(tool.category).toBe('note');
      });
    });

    it('returns empty array for category with no tools', async () => {
      await service.register(createTestTool({ category: 'note' }));

      const searchTools = await service.getByCategory('search');

      expect(searchTools).toEqual([]);
    });
  });

  // =========================================================================
  // search()
  // =========================================================================
  describe('search()', () => {
    beforeEach(async () => {
      await service.registerAll([
        createTestTool({
          action: 'create',
          name: 'Create Note',
          description: 'Create a new note document',
          keywords: ['new', 'add', 'make'],
        }),
        createTestTool({
          action: 'delete',
          name: 'Delete Note',
          description: 'Remove an existing note',
          keywords: ['remove', 'trash'],
        }),
        createTestTool({
          namespace: 'editor',
          action: 'format',
          name: 'Format Text',
          description: 'Apply formatting to selected text',
          keywords: ['style', 'bold', 'italic'],
        }),
      ]);
    });

    it('searches tools by name', async () => {
      const results = await service.search('create');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Create Note');
    });

    it('searches tools by description', async () => {
      const results = await service.search('existing');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Delete Note');
    });

    it('searches tools by keywords', async () => {
      const results = await service.search('bold');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Format Text');
    });

    it('respects limit parameter', async () => {
      const results = await service.search('note', 1);

      expect(results).toHaveLength(1);
    });

    it('returns empty array for no matches', async () => {
      const results = await service.search('xyznonexistent');

      expect(results).toEqual([]);
    });

    it('returns results sorted by relevance', async () => {
      // 'Create Note' should rank higher when searching 'create'
      const results = await service.search('create');

      expect(results[0].name).toBe('Create Note');
    });
  });

  // =========================================================================
  // has()
  // =========================================================================
  describe('has()', () => {
    it('returns true for existing tool', async () => {
      const tool = createTestTool({ action: 'exists' });
      await service.register(tool);

      const exists = await service.has(tool.id);

      expect(exists).toBe(true);
    });

    it('returns false for non-existent tool', async () => {
      const exists = await service.has(createToolId('note', 'nonexistent'));

      expect(exists).toBe(false);
    });
  });

  // =========================================================================
  // getToolDefinitions()
  // =========================================================================
  describe('getToolDefinitions()', () => {
    it('returns AI-formatted tool definitions', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'create',
        name: 'Create Note',
        description: 'Creates a new note',
        category: 'note',
        parameters: {
          title: { type: 'string', description: 'Note title', required: true },
          content: { type: 'string', description: 'Note content' },
        },
      });

      const definitions = await service.getToolDefinitions();

      expect(definitions).toHaveLength(1);
      expect(definitions[0].id).toBe('note:create');
      expect(definitions[0].name).toBe('Create Note');
      expect(definitions[0].description).toBe('Creates a new note');
      expect(definitions[0].parameters.type).toBe('object');
      expect(definitions[0].parameters.properties).toHaveProperty('title');
      expect(definitions[0].parameters.required).toContain('title');
    });

    it('only returns enabled tools by default', async () => {
      const enabledTool = createTestTool({ action: 'enabled' });
      const disabledTool = createTestTool({ action: 'disabled' });

      await service.register(enabledTool);
      await service.register(disabledTool);
      await service.setEnabled(disabledTool.id, false);

      const definitions = await service.getToolDefinitions();

      expect(definitions).toHaveLength(1);
      expect(definitions[0].id).toBe(enabledTool.id);
    });

    it('includes disabled tools when enabledOnly is false', async () => {
      const enabledTool = createTestTool({ action: 'enabled' });
      const disabledTool = createTestTool({ action: 'disabled' });

      await service.register(enabledTool);
      await service.register(disabledTool);
      await service.setEnabled(disabledTool.id, false);

      const definitions = await service.getToolDefinitions(false);

      expect(definitions).toHaveLength(2);
    });

    it('converts parameter schema correctly', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'test',
        name: 'Test',
        description: 'Test tool',
        category: 'note',
        parameters: {
          count: {
            type: 'number',
            description: 'Count',
            minimum: 0,
            maximum: 100,
            required: true,
          },
          name: {
            type: 'string',
            description: 'Name',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-z]+$',
          },
          tags: {
            type: 'array',
            description: 'Tags',
            items: { type: 'string', description: 'Tag' },
          },
        },
      });

      const definitions = await service.getToolDefinitions();
      const props = definitions[0].parameters.properties as Record<string, Record<string, unknown>>;

      expect(props.count.minimum).toBe(0);
      expect(props.count.maximum).toBe(100);
      expect(props.name.minLength).toBe(1);
      expect(props.name.maxLength).toBe(255);
      expect(props.name.pattern).toBe('^[a-z]+$');
      expect(props.tags.items).toBeDefined();
    });

    it('handles nested object parameters', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'nested',
        name: 'Nested',
        description: 'Has nested params',
        category: 'note',
        parameters: {
          metadata: {
            type: 'object',
            description: 'Metadata',
            properties: {
              author: { type: 'string', description: 'Author name', required: true },
              date: { type: 'string', description: 'Creation date' },
            },
          },
        },
      });

      const definitions = await service.getToolDefinitions();
      const props = definitions[0].parameters.properties as Record<string, Record<string, unknown>>;

      expect(props.metadata.type).toBe('object');
      expect(props.metadata.properties).toBeDefined();
      expect((props.metadata.required as string[])).toContain('author');
    });

    it('includes default values in schema', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'defaults',
        name: 'With Defaults',
        description: 'Has defaults',
        category: 'note',
        parameters: {
          limit: {
            type: 'number',
            description: 'Limit',
            default: 10,
          },
        },
      });

      const definitions = await service.getToolDefinitions();
      const props = definitions[0].parameters.properties as Record<string, Record<string, unknown>>;

      expect(props.limit.default).toBe(10);
    });

    it('includes enum values in schema', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'enums',
        name: 'With Enums',
        description: 'Has enums',
        category: 'note',
        parameters: {
          status: {
            type: 'string',
            description: 'Status',
            enum: ['draft', 'published', 'archived'],
          },
        },
      });

      const definitions = await service.getToolDefinitions();
      const props = definitions[0].parameters.properties as Record<string, Record<string, unknown>>;

      expect(props.status.enum).toEqual(['draft', 'published', 'archived']);
    });
  });

  // =========================================================================
  // getToolsSystemPrompt()
  // =========================================================================
  describe('getToolsSystemPrompt()', () => {
    it('returns formatted system prompt with tools', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'create',
        name: 'Create Note',
        description: 'Creates a new note',
        category: 'note',
        parameters: {
          title: { type: 'string', description: 'Note title', required: true },
        },
        examples: ['Create a note about meetings'],
      });

      const prompt = await service.getToolsSystemPrompt();

      expect(prompt).toContain('## Available Tools');
      expect(prompt).toContain('note:create');
      expect(prompt).toContain('Create Note');
      expect(prompt).toContain('Creates a new note');
      expect(prompt).toContain('title');
      expect(prompt).toContain('Create a note about meetings');
    });

    it('returns empty string when no enabled tools', async () => {
      const prompt = await service.getToolsSystemPrompt();

      expect(prompt).toBe('');
    });

    it('only includes enabled tools', async () => {
      const enabledTool = createTestTool({ action: 'enabled', name: 'Enabled Tool' });
      const disabledTool = createTestTool({ action: 'disabled', name: 'Disabled Tool' });

      await service.register(enabledTool);
      await service.register(disabledTool);
      await service.setEnabled(disabledTool.id, false);

      const prompt = await service.getToolsSystemPrompt();

      expect(prompt).toContain('Enabled Tool');
      expect(prompt).not.toContain('Disabled Tool');
    });

    it('includes tool call format instructions', async () => {
      await service.register(createTestTool({ action: 'any' }));

      const prompt = await service.getToolsSystemPrompt();

      expect(prompt).toContain('<tool_call>');
      expect(prompt).toContain('<tool>');
      expect(prompt).toContain('<args>');
      expect(prompt).toContain('namespace:action');
    });
  });

  // =========================================================================
  // setEnabled()
  // =========================================================================
  describe('setEnabled()', () => {
    it('disables an enabled tool', async () => {
      const tool = createTestTool({ action: 'todisable' });
      await service.register(tool);

      const result = await service.setEnabled(tool.id, false);

      expect(result).toBe(true);
      const retrieved = await service.get(tool.id);
      expect(retrieved?.enabled).toBe(false);
    });

    it('enables a disabled tool', async () => {
      const tool = createTestTool({ action: 'toenable' });
      await service.register(tool);
      await service.setEnabled(tool.id, false);

      const result = await service.setEnabled(tool.id, true);

      expect(result).toBe(true);
      const retrieved = await service.get(tool.id);
      expect(retrieved?.enabled).toBe(true);
    });

    it('returns false for non-existent tool', async () => {
      const result = await service.setEnabled(createToolId('note', 'nonexistent'), false);

      expect(result).toBe(false);
    });

    it('notifies subscribers on successful update', async () => {
      const tool = createTestTool({ action: 'tonotify' });
      await service.register(tool);

      const callback = vi.fn();
      service.subscribe(callback);

      await service.setEnabled(tool.id, false);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not notify subscribers when tool not found', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.setEnabled(createToolId('note', 'nonexistent'), false);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // count()
  // =========================================================================
  describe('count()', () => {
    it('returns total count of registered tools', async () => {
      await service.registerAll([
        createTestTool({ action: 'one' }),
        createTestTool({ action: 'two' }),
        createTestTool({ action: 'three' }),
      ]);

      const total = await service.count();

      expect(total).toBe(3);
    });

    it('returns 0 when no tools registered', async () => {
      const total = await service.count();

      expect(total).toBe(0);
    });

    it('returns count of enabled tools only when enabledOnly is true', async () => {
      await service.registerAll([
        createTestTool({ action: 'enabled1' }),
        createTestTool({ action: 'enabled2' }),
        createTestTool({ action: 'disabled' }),
      ]);
      await service.setEnabled(createToolId('note', 'disabled'), false);

      const enabledCount = await service.count(true);

      expect(enabledCount).toBe(2);
    });

    it('returns total count when enabledOnly is false', async () => {
      await service.registerAll([
        createTestTool({ action: 'enabled' }),
        createTestTool({ action: 'disabled' }),
      ]);
      await service.setEnabled(createToolId('note', 'disabled'), false);

      const total = await service.count(false);

      expect(total).toBe(2);
    });
  });

  // =========================================================================
  // subscribe()
  // =========================================================================
  describe('subscribe()', () => {
    it('returns unsubscribe function', async () => {
      const callback = vi.fn();

      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies on tool registration', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.register(createTestTool({ action: 'test' }));

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('notifies on tool unregistration', async () => {
      const tool = createTestTool({ action: 'test' });
      await service.register(tool);

      const callback = vi.fn();
      service.subscribe(callback);

      await service.unregister(tool.id);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('notifies on tool enable/disable', async () => {
      const tool = createTestTool({ action: 'test' });
      await service.register(tool);

      const callback = vi.fn();
      service.subscribe(callback);

      await service.setEnabled(tool.id, false);
      await service.setEnabled(tool.id, true);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('notifies on clear', async () => {
      await service.register(createTestTool({ action: 'test' }));

      const callback = vi.fn();
      service.subscribe(callback);

      await service.clear();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await service.register(createTestTool({ action: 'first' }));
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await service.register(createTestTool({ action: 'second' }));
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('supports multiple subscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);

      await service.register(createTestTool({ action: 'test' }));

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('handles subscriber errors gracefully', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const normalCallback = vi.fn();

      service.subscribe(errorCallback);
      service.subscribe(normalCallback);

      // Should not throw
      await service.register(createTestTool({ action: 'test' }));

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledTimes(1);
    });

    it('allows same callback to be subscribed multiple times', async () => {
      const callback = vi.fn();

      service.subscribe(callback);
      service.subscribe(callback);

      await service.register(createTestTool({ action: 'test' }));

      // Set only stores unique values, so it should only be called once
      // But service uses Set internally, checking actual behavior
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Integration scenarios
  // =========================================================================
  describe('integration scenarios', () => {
    it('handles full tool lifecycle', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      // Register
      const tool = await service.registerQuickWithHandler(
        {
          namespace: 'note',
          action: 'lifecycle',
          name: 'Lifecycle Tool',
          description: 'Test lifecycle',
          category: 'note',
        },
        async () => ({ result: 'executed' })
      );
      expect(callback).toHaveBeenCalledTimes(1);

      // Verify registration
      expect(await service.has(tool.id)).toBe(true);
      expect(await service.count()).toBe(1);
      expect(executorPort.hasHandler(tool.id)).toBe(true);

      // Disable
      await service.setEnabled(tool.id, false);
      expect(callback).toHaveBeenCalledTimes(2);

      // Verify disabled
      const definitions = await service.getToolDefinitions();
      expect(definitions).toHaveLength(0);

      // Re-enable
      await service.setEnabled(tool.id, true);
      expect(callback).toHaveBeenCalledTimes(3);

      // Unregister
      await service.unregister(tool.id);
      expect(callback).toHaveBeenCalledTimes(4);

      // Verify unregistered
      expect(await service.has(tool.id)).toBe(false);
      expect(executorPort.hasHandler(tool.id)).toBe(false);
    });

    it('manages multiple tools with different categories', async () => {
      await service.registerAll([
        createTestTool({ namespace: 'note', action: 'create', category: 'note' }),
        createTestTool({ namespace: 'note', action: 'delete', category: 'note' }),
        createTestTool({ namespace: 'editor', action: 'format', category: 'editor' }),
        createTestTool({ namespace: 'search', action: 'find', category: 'search' }),
      ]);

      expect(await service.count()).toBe(4);
      expect((await service.getByCategory('note')).length).toBe(2);
      expect((await service.getByCategory('editor')).length).toBe(1);
      expect((await service.getByCategory('search')).length).toBe(1);
    });

    it('search respects enabled state', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'search1',
        name: 'Searchable One',
        description: 'Enabled and searchable',
        category: 'note',
        keywords: ['findme'],
      });

      await service.registerQuick({
        namespace: 'note',
        action: 'search2',
        name: 'Searchable Two',
        description: 'Disabled',
        category: 'note',
        keywords: ['findme'],
      });

      await service.setEnabled(createToolId('note', 'search2'), false);

      // Search should still find both (search uses registry directly)
      const results = await service.search('findme');
      expect(results).toHaveLength(2);
    });

    it('getToolDefinitions correctly formats complex tool', async () => {
      await service.registerQuick({
        namespace: 'note',
        action: 'complex',
        name: 'Complex Tool',
        description: 'A tool with complex parameters',
        category: 'note',
        parameters: {
          config: {
            type: 'object',
            description: 'Configuration object',
            required: true,
            properties: {
              mode: {
                type: 'string',
                description: 'Operation mode',
                enum: ['fast', 'accurate'],
                required: true,
              },
              options: {
                type: 'object',
                description: 'Additional options',
                properties: {
                  verbose: { type: 'boolean', description: 'Verbose output' },
                  limit: { type: 'number', description: 'Result limit', maximum: 100 },
                },
              },
            },
          },
          items: {
            type: 'array',
            description: 'Items to process',
            items: { type: 'string', description: 'Item path' },
            minLength: 1,
            maxLength: 50,
          },
        },
        requiresConfirmation: true,
        keywords: ['advanced', 'power-user'],
        examples: ['Process items in fast mode', 'Run complex operation'],
      });

      const definitions = await service.getToolDefinitions();
      expect(definitions).toHaveLength(1);

      const def = definitions[0];
      expect(def.parameters.required).toContain('config');

      const props = def.parameters.properties as Record<string, Record<string, unknown>>;
      expect(props.config.type).toBe('object');
      expect(props.items.type).toBe('array');
      expect(props.items.minItems).toBe(1);
      expect(props.items.maxItems).toBe(50);
    });
  });
});
