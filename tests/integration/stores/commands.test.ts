/**
 * Integration tests for Commands Store
 *
 * Tests the CommandsStore reactive state management for the slash command menu.
 * The store uses Svelte 5 runes ($state) and wraps a CommandRegistryPort
 * to provide reactive state for the slash menu UI component.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { commandsStore } from '$lib/stores/commands.svelte';
import type { CommandRegistryPort, RegisteredCommand, CommandContext, EditorPort } from '$lib/ports/outbound';
import { EMPTY_SCOPE } from '$lib/domain/values';

/**
 * Creates a mock RegisteredCommand for testing.
 * @param id - Command ID
 * @param overrides - Optional partial overrides
 * @returns A complete RegisteredCommand object
 */
function createMockCommand(id: string, overrides?: Partial<RegisteredCommand>): RegisteredCommand {
  return {
    id,
    label: `${id} Label`,
    description: `Description for ${id}`,
    keywords: [id],
    category: 'basic',
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Creates a mock CommandRegistryPort for testing.
 * @param commands - Initial commands to populate the registry
 * @returns A mock CommandRegistryPort
 */
function createMockRegistry(commands: RegisteredCommand[] = []): CommandRegistryPort {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn((id) => commands.find((c) => c.id === id) ?? null),
    getAll: vi.fn(() => commands),
    getGrouped: vi.fn(() => {
      const groups = new Map<string, RegisteredCommand[]>();
      commands.forEach((cmd) => {
        const existing = groups.get(cmd.category) ?? [];
        existing.push(cmd);
        groups.set(cmd.category, existing);
      });
      return groups;
    }),
    search: vi.fn((query: string) =>
      commands.filter(
        (c) =>
          c.id.includes(query) ||
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase()))
      )
    ),
  };
}

/**
 * Creates a mock CommandContext for testing.
 * @returns A mock CommandContext
 */
function createMockContext(): CommandContext {
  return {
    editor: {} as EditorPort,
    selection: { from: 0, to: 0, text: '' },
    scope: { ...EMPTY_SCOPE, editorFocused: true },
  };
}

describe('Commands Store Integration', () => {
  let mockCommands: RegisteredCommand[];
  let mockRegistry: CommandRegistryPort;

  beforeEach(() => {
    // Reset store state
    commandsStore.destroy();

    // Create sample commands
    mockCommands = [
      createMockCommand('heading1', { category: 'basic', keywords: ['h1', 'heading', 'title'] }),
      createMockCommand('heading2', { category: 'basic', keywords: ['h2', 'heading'] }),
      createMockCommand('bulletList', { category: 'basic', keywords: ['list', 'bullet'] }),
      createMockCommand('codeBlock', { category: 'advanced', keywords: ['code', 'pre'] }),
    ];
    mockRegistry = createMockRegistry(mockCommands);
  });

  afterEach(() => {
    commandsStore.destroy();
    vi.clearAllMocks();
  });

  describe('init()', () => {
    it('accepts registry and loads all commands', () => {
      commandsStore.init(mockRegistry);

      expect(commandsStore.isInitialized).toBe(true);
      expect(mockRegistry.getAll).toHaveBeenCalled();
      expect(commandsStore.filteredCommands).toEqual(mockCommands);
    });

    it('sets isInitialized to true', () => {
      expect(commandsStore.isInitialized).toBe(false);

      commandsStore.init(mockRegistry);

      expect(commandsStore.isInitialized).toBe(true);
    });

    it('populates filteredCommands with all commands initially', () => {
      commandsStore.init(mockRegistry);

      expect(commandsStore.filteredCommands.length).toBe(4);
      expect(commandsStore.hasCommands).toBe(true);
    });

    it('handles empty registry', () => {
      const emptyRegistry = createMockRegistry([]);
      commandsStore.init(emptyRegistry);

      expect(commandsStore.isInitialized).toBe(true);
      expect(commandsStore.filteredCommands).toEqual([]);
      expect(commandsStore.hasCommands).toBe(false);
    });
  });

  describe('open()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('sets isOpen to true', () => {
      expect(commandsStore.isOpen).toBe(false);

      commandsStore.open(10, { top: 100, left: 200 });

      expect(commandsStore.isOpen).toBe(true);
    });

    it('sets triggerPos', () => {
      commandsStore.open(42, { top: 100, left: 200 });

      expect(commandsStore.triggerPos).toBe(42);
    });

    it('sets coords', () => {
      commandsStore.open(10, { top: 150, left: 250 });

      expect(commandsStore.coords).toEqual({ top: 150, left: 250 });
    });

    it('resets query to empty string', () => {
      // First, set some query
      commandsStore.search('test');
      expect(commandsStore.query).toBe('test');

      commandsStore.open(10, { top: 100, left: 200 });

      expect(commandsStore.query).toBe('');
    });

    it('resets selectedIndex to 0', () => {
      // First, select a different index
      commandsStore.selectNext();
      commandsStore.selectNext();
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.open(10, { top: 100, left: 200 });

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('resets filteredCommands to all commands', () => {
      // First, filter commands
      commandsStore.search('code');
      expect(commandsStore.filteredCommands.length).toBe(1);

      commandsStore.open(10, { top: 100, left: 200 });

      expect(commandsStore.filteredCommands).toEqual(mockCommands);
    });
  });

  describe('close()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
      commandsStore.open(10, { top: 100, left: 200 });
    });

    it('sets isOpen to false', () => {
      expect(commandsStore.isOpen).toBe(true);

      commandsStore.close();

      expect(commandsStore.isOpen).toBe(false);
    });

    it('resets query', () => {
      commandsStore.search('heading');
      expect(commandsStore.query).toBe('heading');

      commandsStore.close();

      expect(commandsStore.query).toBe('');
    });

    it('resets triggerPos to 0', () => {
      expect(commandsStore.triggerPos).toBe(10);

      commandsStore.close();

      expect(commandsStore.triggerPos).toBe(0);
    });

    it('resets selectedIndex to 0', () => {
      commandsStore.selectNext();
      commandsStore.selectNext();
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.close();

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('resets coords to null', () => {
      expect(commandsStore.coords).toEqual({ top: 100, left: 200 });

      commandsStore.close();

      expect(commandsStore.coords).toBeNull();
    });

    it('resets filteredCommands to all commands', () => {
      commandsStore.search('code');
      expect(commandsStore.filteredCommands.length).toBe(1);

      commandsStore.close();

      expect(commandsStore.filteredCommands).toEqual(mockCommands);
    });
  });

  describe('search()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('filters commands by query', () => {
      commandsStore.search('heading');

      expect(mockRegistry.search).toHaveBeenCalledWith('heading');
      expect(commandsStore.filteredCommands.length).toBe(2); // heading1 and heading2
    });

    it('updates query state', () => {
      commandsStore.search('code');

      expect(commandsStore.query).toBe('code');
    });

    it('resets selectedIndex to 0', () => {
      commandsStore.selectNext();
      commandsStore.selectNext();
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.search('test');

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('shows all commands for empty query', () => {
      commandsStore.search('heading');
      expect(commandsStore.filteredCommands.length).toBe(2);

      commandsStore.search('');

      expect(commandsStore.filteredCommands).toEqual(mockCommands);
      expect(commandsStore.filteredCommands.length).toBe(4);
    });

    it('shows all commands for whitespace-only query', () => {
      commandsStore.search('heading');
      expect(commandsStore.filteredCommands.length).toBe(2);

      commandsStore.search('   ');

      expect(commandsStore.filteredCommands).toEqual(mockCommands);
    });

    it('returns empty array when no registry is initialized', () => {
      commandsStore.destroy();

      commandsStore.search('test');

      expect(commandsStore.filteredCommands).toEqual([]);
    });

    it('matches by keyword', () => {
      commandsStore.search('bullet');

      expect(commandsStore.filteredCommands.length).toBe(1);
      expect(commandsStore.filteredCommands[0].id).toBe('bulletList');
    });

    it('matches by label (case insensitive)', () => {
      commandsStore.search('HEADING1');

      expect(commandsStore.filteredCommands.length).toBe(1);
      expect(commandsStore.filteredCommands[0].id).toBe('heading1');
    });
  });

  describe('selectNext()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('increments selectedIndex', () => {
      expect(commandsStore.selectedIndex).toBe(0);

      commandsStore.selectNext();

      expect(commandsStore.selectedIndex).toBe(1);
    });

    it('cycles back to 0 at end of list', () => {
      // Move to last item
      for (let i = 0; i < 3; i++) {
        commandsStore.selectNext();
      }
      expect(commandsStore.selectedIndex).toBe(3);

      commandsStore.selectNext();

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('does nothing when no commands are available', () => {
      commandsStore.search('nonexistent');
      expect(commandsStore.filteredCommands.length).toBe(0);

      commandsStore.selectNext();

      expect(commandsStore.selectedIndex).toBe(0);
    });
  });

  describe('selectPrev()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('decrements selectedIndex', () => {
      commandsStore.selectNext();
      commandsStore.selectNext();
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.selectPrev();

      expect(commandsStore.selectedIndex).toBe(1);
    });

    it('cycles to last item when at index 0', () => {
      expect(commandsStore.selectedIndex).toBe(0);

      commandsStore.selectPrev();

      expect(commandsStore.selectedIndex).toBe(3); // Last item
    });

    it('does nothing when no commands are available', () => {
      commandsStore.search('nonexistent');
      expect(commandsStore.filteredCommands.length).toBe(0);

      commandsStore.selectPrev();

      expect(commandsStore.selectedIndex).toBe(0);
    });
  });

  describe('setSelectedIndex()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('sets selectedIndex to specified value', () => {
      commandsStore.setSelectedIndex(3);

      expect(commandsStore.selectedIndex).toBe(3);
    });

    it('ignores negative index', () => {
      commandsStore.setSelectedIndex(2);
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.setSelectedIndex(-1);

      expect(commandsStore.selectedIndex).toBe(2);
    });

    it('ignores index beyond array length', () => {
      commandsStore.setSelectedIndex(2);
      expect(commandsStore.selectedIndex).toBe(2);

      commandsStore.setSelectedIndex(100);

      expect(commandsStore.selectedIndex).toBe(2);
    });

    it('sets index to 0', () => {
      commandsStore.setSelectedIndex(3);
      expect(commandsStore.selectedIndex).toBe(3);

      commandsStore.setSelectedIndex(0);

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('sets index to last valid index', () => {
      commandsStore.setSelectedIndex(3); // Last item (4 commands, 0-indexed)

      expect(commandsStore.selectedIndex).toBe(3);
    });
  });

  describe('getSelectedCommand()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('returns the command at selectedIndex', () => {
      const command = commandsStore.getSelectedCommand();

      expect(command).toEqual(mockCommands[0]);
    });

    it('returns correct command after navigation', () => {
      commandsStore.selectNext();
      commandsStore.selectNext();

      const command = commandsStore.getSelectedCommand();

      expect(command).toEqual(mockCommands[2]);
    });

    it('returns null when no commands are available', () => {
      commandsStore.search('nonexistent');

      const command = commandsStore.getSelectedCommand();

      expect(command).toBeNull();
    });

    it('returns first filtered command after search', () => {
      commandsStore.search('code');

      const command = commandsStore.getSelectedCommand();

      expect(command?.id).toBe('codeBlock');
    });
  });

  describe('execute()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
      commandsStore.open(10, { top: 100, left: 200 });
    });

    it('calls command.execute() with context', async () => {
      const command = mockCommands[0];
      const context = createMockContext();

      await commandsStore.execute(command, context);

      expect(command.execute).toHaveBeenCalledWith(context);
    });

    it('closes menu after execution', async () => {
      const command = mockCommands[0];
      const context = createMockContext();

      expect(commandsStore.isOpen).toBe(true);

      await commandsStore.execute(command, context);

      expect(commandsStore.isOpen).toBe(false);
    });

    it('handles async execution', async () => {
      let executed = false;
      const asyncCommand = createMockCommand('async', {
        execute: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          executed = true;
        }),
      });
      const context = createMockContext();

      await commandsStore.execute(asyncCommand, context);

      expect(executed).toBe(true);
      expect(asyncCommand.execute).toHaveBeenCalledWith(context);
    });
  });

  describe('executeSelected()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
      commandsStore.open(10, { top: 100, left: 200 });
    });

    it('executes the currently selected command', async () => {
      const context = createMockContext();

      await commandsStore.executeSelected(context);

      expect(mockCommands[0].execute).toHaveBeenCalledWith(context);
    });

    it('executes command at current selectedIndex', async () => {
      commandsStore.selectNext();
      commandsStore.selectNext();
      const context = createMockContext();

      await commandsStore.executeSelected(context);

      expect(mockCommands[2].execute).toHaveBeenCalledWith(context);
    });

    it('does nothing when no command is selected', async () => {
      commandsStore.search('nonexistent');
      const context = createMockContext();

      await commandsStore.executeSelected(context);

      // No command should be executed
      mockCommands.forEach((cmd) => {
        expect(cmd.execute).not.toHaveBeenCalled();
      });
    });

    it('closes menu after execution', async () => {
      const context = createMockContext();

      expect(commandsStore.isOpen).toBe(true);

      await commandsStore.executeSelected(context);

      expect(commandsStore.isOpen).toBe(false);
    });
  });

  describe('updateFromPluginState()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('syncs all state fields from plugin state', () => {
      const pluginState = {
        isOpen: true,
        query: 'test query',
        triggerPos: 25,
        selectedIndex: 2,
        filteredCommands: mockCommands.slice(0, 2),
        coords: { top: 150, left: 250 },
        openAbove: false,
        isAIPromptMode: false,
        aiPrompt: '',
        source: 'slash' as const,
        blockType: '',
      };

      commandsStore.updateFromPluginState(pluginState);

      expect(commandsStore.isOpen).toBe(true);
      expect(commandsStore.query).toBe('test query');
      expect(commandsStore.triggerPos).toBe(25);
      expect(commandsStore.selectedIndex).toBe(2);
      expect(commandsStore.filteredCommands).toEqual(mockCommands.slice(0, 2));
      expect(commandsStore.coords).toEqual({ top: 150, left: 250 });
    });

    it('handles closed state', () => {
      commandsStore.open(10, { top: 100, left: 200 });
      expect(commandsStore.isOpen).toBe(true);

      const closedState = {
        isOpen: false,
        query: '',
        triggerPos: 0,
        selectedIndex: 0,
        filteredCommands: [],
        coords: null,
        openAbove: false,
        isAIPromptMode: false,
        aiPrompt: '',
        source: 'slash' as const,
        blockType: '',
      };

      commandsStore.updateFromPluginState(closedState);

      expect(commandsStore.isOpen).toBe(false);
      expect(commandsStore.coords).toBeNull();
    });

    it('syncs filteredCommands array', () => {
      const customFiltered = [mockCommands[2]!, mockCommands[4]!];
      const pluginState = {
        isOpen: true,
        query: 'custom',
        triggerPos: 5,
        selectedIndex: 0,
        filteredCommands: customFiltered,
        coords: { top: 100, left: 200 },
        openAbove: false,
        isAIPromptMode: false,
        aiPrompt: '',
        source: 'slash' as const,
        blockType: '',
      };

      commandsStore.updateFromPluginState(pluginState);

      expect(commandsStore.filteredCommands).toEqual(customFiltered);
      expect(commandsStore.filteredCommands.length).toBe(2);
    });
  });

  describe('getGroupedCommands()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('delegates to registry.getGrouped()', () => {
      const result = commandsStore.getGroupedCommands();

      expect(mockRegistry.getGrouped).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Map);
    });

    it('returns grouped commands by category', () => {
      const result = commandsStore.getGroupedCommands();

      expect(result.get('basic')?.length).toBe(3); // heading1, heading2, bulletList
      expect(result.get('advanced')?.length).toBe(1); // codeBlock
      expect(result.has('ai')).toBe(false);
    });

    it('returns empty Map when not initialized', () => {
      commandsStore.destroy();

      const result = commandsStore.getGroupedCommands();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('getFilteredGrouped()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('groups filtered commands by category', () => {
      const result = commandsStore.getFilteredGrouped();

      expect(result).toBeInstanceOf(Map);
      expect(result.get('basic')?.length).toBe(3);
      expect(result.get('advanced')?.length).toBe(1);
      expect(result.has('ai')).toBe(false);
    });

    it('only includes filtered commands after search', () => {
      commandsStore.search('heading');

      const result = commandsStore.getFilteredGrouped();

      expect(result.get('basic')?.length).toBe(2); // heading1, heading2
      expect(result.has('advanced')).toBe(false);
      expect(result.has('ai')).toBe(false);
    });

    it('returns empty Map when no matches', () => {
      commandsStore.search('nonexistent');

      const result = commandsStore.getFilteredGrouped();

      expect(result.size).toBe(0);
    });

    it('preserves command order within category', () => {
      const result = commandsStore.getFilteredGrouped();
      const basicCommands = result.get('basic');

      expect(basicCommands?.[0].id).toBe('heading1');
      expect(basicCommands?.[1].id).toBe('heading2');
      expect(basicCommands?.[2].id).toBe('bulletList');
    });
  });

  describe('destroy()', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
      commandsStore.open(10, { top: 100, left: 200 });
      commandsStore.search('heading');
      commandsStore.selectNext();
    });

    it('resets isInitialized to false', () => {
      expect(commandsStore.isInitialized).toBe(true);

      commandsStore.destroy();

      expect(commandsStore.isInitialized).toBe(false);
    });

    it('resets isOpen to false', () => {
      expect(commandsStore.isOpen).toBe(true);

      commandsStore.destroy();

      expect(commandsStore.isOpen).toBe(false);
    });

    it('resets query to empty string', () => {
      expect(commandsStore.query).toBe('heading');

      commandsStore.destroy();

      expect(commandsStore.query).toBe('');
    });

    it('resets triggerPos to 0', () => {
      expect(commandsStore.triggerPos).toBe(10);

      commandsStore.destroy();

      expect(commandsStore.triggerPos).toBe(0);
    });

    it('resets selectedIndex to 0', () => {
      expect(commandsStore.selectedIndex).toBe(1);

      commandsStore.destroy();

      expect(commandsStore.selectedIndex).toBe(0);
    });

    it('clears filteredCommands', () => {
      expect(commandsStore.filteredCommands.length).toBeGreaterThan(0);

      commandsStore.destroy();

      expect(commandsStore.filteredCommands).toEqual([]);
    });

    it('resets coords to null', () => {
      expect(commandsStore.coords).not.toBeNull();

      commandsStore.destroy();

      expect(commandsStore.coords).toBeNull();
    });

    it('sets hasCommands to false', () => {
      expect(commandsStore.hasCommands).toBe(true);

      commandsStore.destroy();

      expect(commandsStore.hasCommands).toBe(false);
    });
  });

  describe('state getter', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('returns complete state object', () => {
      commandsStore.open(15, { top: 120, left: 220 });
      commandsStore.search('heading'); // Returns 2 results: heading1, heading2
      commandsStore.selectNext(); // Move to index 1

      const state = commandsStore.state;

      expect(state).toEqual({
        isOpen: true,
        query: 'heading',
        triggerPos: 15,
        selectedIndex: 1,
        filteredCommands: commandsStore.filteredCommands,
        coords: { top: 120, left: 220 },
        openAbove: false,
        isAIPromptMode: false,
        aiPrompt: '',
        blockType: '',
        source: 'slash',
      });
    });

    it('returns initial state when closed', () => {
      const state = commandsStore.state;

      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.triggerPos).toBe(0);
      expect(state.selectedIndex).toBe(0);
      expect(state.coords).toBeNull();
    });
  });

  describe('hasCommands getter', () => {
    beforeEach(() => {
      commandsStore.init(mockRegistry);
    });

    it('returns true when filteredCommands is not empty', () => {
      expect(commandsStore.hasCommands).toBe(true);
    });

    it('returns false when filteredCommands is empty', () => {
      commandsStore.search('nonexistent');

      expect(commandsStore.hasCommands).toBe(false);
    });

    it('returns false after destroy', () => {
      expect(commandsStore.hasCommands).toBe(true);

      commandsStore.destroy();

      expect(commandsStore.hasCommands).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('handles full workflow: init -> open -> search -> navigate -> execute', async () => {
      // Initialize
      commandsStore.init(mockRegistry);
      expect(commandsStore.isInitialized).toBe(true);

      // Open menu
      commandsStore.open(10, { top: 100, left: 200 });
      expect(commandsStore.isOpen).toBe(true);

      // Search
      commandsStore.search('heading');
      expect(commandsStore.filteredCommands.length).toBe(2);

      // Navigate
      commandsStore.selectNext();
      expect(commandsStore.selectedIndex).toBe(1);

      const selected = commandsStore.getSelectedCommand();
      expect(selected?.id).toBe('heading2');

      // Execute
      const context = createMockContext();
      await commandsStore.executeSelected(context);

      expect(mockCommands[1].execute).toHaveBeenCalledWith(context);
      expect(commandsStore.isOpen).toBe(false);
    });

    it('handles reopening menu after close', () => {
      commandsStore.init(mockRegistry);

      // First open
      commandsStore.open(10, { top: 100, left: 200 });
      commandsStore.search('code');
      commandsStore.selectNext();

      // Close
      commandsStore.close();
      expect(commandsStore.isOpen).toBe(false);

      // Reopen
      commandsStore.open(20, { top: 150, left: 250 });

      expect(commandsStore.isOpen).toBe(true);
      expect(commandsStore.triggerPos).toBe(20);
      expect(commandsStore.query).toBe('');
      expect(commandsStore.selectedIndex).toBe(0);
      expect(commandsStore.filteredCommands).toEqual(mockCommands);
    });

    it('handles re-initialization with different registry', () => {
      commandsStore.init(mockRegistry);
      commandsStore.open(10, { top: 100, left: 200 });

      const newCommands = [createMockCommand('newCommand')];
      const newRegistry = createMockRegistry(newCommands);

      commandsStore.init(newRegistry);

      expect(commandsStore.isInitialized).toBe(true);
      expect(commandsStore.filteredCommands).toEqual(newCommands);
    });
  });
});
