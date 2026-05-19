/**
 * Unit tests for CommandServiceImpl
 *
 * Tests for the command service implementation, verifying:
 * - Command palette state management (open, close, toggle)
 * - Search and filtering functionality with scoring
 * - Keyboard navigation (selectNext, selectPrevious, selectIndex)
 * - Command execution (executeSelected, executeById)
 * - Command registration and unregistration
 * - State subscriptions and notifications
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandServiceImpl } from '$lib/application/services';
import type {
  CommandRegistryPort,
  RegisteredCommand,
  CommandContext,
} from '$lib/ports/outbound';
import type { SlashCommand } from '$lib/domain/values';
import { EMPTY_SCOPE } from '$lib/domain/values';

/**
 * Creates a mock CommandRegistryPort for testing.
 */
function createMockRegistry(): CommandRegistryPort & {
  commands: Map<string, RegisteredCommand>;
} {
  const commands: Map<string, RegisteredCommand> = new Map();

  return {
    commands,
    register: vi.fn((cmd: RegisteredCommand) => {
      commands.set(cmd.id, cmd);
    }),
    unregister: vi.fn((id: string) => {
      commands.delete(id);
    }),
    get: vi.fn((id: string) => commands.get(id) ?? null),
    getAll: vi.fn(() => Array.from(commands.values())),
    search: vi.fn((query: string) => {
      const normalizedQuery = query.toLowerCase();
      return Array.from(commands.values()).filter(
        (cmd) =>
          cmd.id.toLowerCase().includes(normalizedQuery) ||
          cmd.label.toLowerCase().includes(normalizedQuery) ||
          cmd.keywords.some((k) => k.toLowerCase().includes(normalizedQuery))
      );
    }),
    getGrouped: vi.fn(() => {
      const grouped = new Map<string, RegisteredCommand[]>();
      for (const cmd of commands.values()) {
        const existing = grouped.get(cmd.category) || [];
        existing.push(cmd);
        grouped.set(cmd.category, existing);
      }
      return grouped;
    }),
  };
}

/**
 * Creates a mock RegisteredCommand for testing.
 */
function createMockCommand(
  overrides?: Partial<RegisteredCommand>
): RegisteredCommand {
  return {
    id: 'test-command',
    label: 'Test Command',
    description: 'A test command',
    keywords: ['test'],
    category: 'basic',
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Creates a mock CommandContext for testing.
 */
function createMockContext(): CommandContext {
  return {
    editor: {
      getContent: vi.fn(),
      setContent: vi.fn(),
      getSelection: vi.fn(),
      replaceSelection: vi.fn(),
      insertAtCursor: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      scrollToCursor: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      isActive: vi.fn(),
      isEditable: vi.fn(),
      isEmpty: vi.fn(),
      getCommands: vi.fn(),
      getState: vi.fn(),
    },
    selection: {
      from: 0,
      to: 0,
      text: '',
    },
    scope: { ...EMPTY_SCOPE, editorFocused: true },
  };
}

describe('CommandServiceImpl', () => {
  let registry: ReturnType<typeof createMockRegistry>;
  let service: CommandServiceImpl;

  beforeEach(() => {
    registry = createMockRegistry();
    service = new CommandServiceImpl(registry);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getState()', () => {
    it('returns initial state with isOpen false and empty results', () => {
      const state = service.getState();

      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.results).toEqual([]);
      expect(state.selectedIndex).toBe(0);
      expect(state.filterCategory).toBeNull();
    });

    it('returns a copy of the state, not the internal reference', () => {
      const state1 = service.getState();
      const state2 = service.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('open()', () => {
    it('opens the command palette', () => {
      service.open();

      const state = service.getState();
      expect(state.isOpen).toBe(true);
    });

    it('resets query to empty string when no initialQuery provided', () => {
      service.open();

      const state = service.getState();
      expect(state.query).toBe('');
    });

    it('resets selectedIndex to 0', () => {
      service.open();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('populates results with all commands when no query', () => {
      const cmd1 = createMockCommand({ id: 'cmd1', label: 'Command 1' });
      const cmd2 = createMockCommand({ id: 'cmd2', label: 'Command 2' });
      registry.register(cmd1);
      registry.register(cmd2);

      service.open();

      const state = service.getState();
      expect(state.results).toHaveLength(2);
      expect(state.results[0].command.id).toBe('cmd1');
      expect(state.results[1].command.id).toBe('cmd2');
    });
  });

  describe('open(initialQuery)', () => {
    it('opens palette with initial query set', () => {
      const cmd = createMockCommand({ id: 'heading', label: 'Heading' });
      registry.register(cmd);

      service.open('head');

      const state = service.getState();
      expect(state.isOpen).toBe(true);
      expect(state.query).toBe('head');
    });

    it('populates results based on initial query', () => {
      const heading = createMockCommand({ id: 'heading', label: 'Heading' });
      const paragraph = createMockCommand({
        id: 'paragraph',
        label: 'Paragraph',
      });
      registry.register(heading);
      registry.register(paragraph);

      service.open('head');

      const state = service.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0].command.id).toBe('heading');
    });
  });

  describe('close()', () => {
    it('closes the command palette', () => {
      service.open();
      service.close();

      const state = service.getState();
      expect(state.isOpen).toBe(false);
    });

    it('resets query to empty string', () => {
      service.open('test');
      service.close();

      const state = service.getState();
      expect(state.query).toBe('');
    });

    it('clears results', () => {
      const cmd = createMockCommand();
      registry.register(cmd);
      service.open();
      service.close();

      const state = service.getState();
      expect(state.results).toEqual([]);
    });

    it('resets selectedIndex to 0', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      service.selectNext();
      service.close();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('resets filterCategory to null', () => {
      const cmd = createMockCommand({ category: 'basic' });
      registry.register(cmd);
      service.open();
      service.filterByCategory('basic');
      service.close();

      const state = service.getState();
      expect(state.filterCategory).toBeNull();
    });
  });

  describe('toggle()', () => {
    it('opens palette when closed', () => {
      service.toggle();

      const state = service.getState();
      expect(state.isOpen).toBe(true);
    });

    it('closes palette when open', () => {
      service.open();
      service.toggle();

      const state = service.getState();
      expect(state.isOpen).toBe(false);
    });

    it('accepts initialQuery when opening', () => {
      const cmd = createMockCommand({ id: 'test', label: 'Test' });
      registry.register(cmd);

      service.toggle('test');

      const state = service.getState();
      expect(state.isOpen).toBe(true);
      expect(state.query).toBe('test');
    });

    it('ignores initialQuery when closing', () => {
      service.open('initial');
      service.toggle('ignored');

      const state = service.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
    });
  });

  describe('search()', () => {
    it('updates query in state', () => {
      const cmd = createMockCommand({ id: 'test', label: 'Test' });
      registry.register(cmd);
      service.open();

      service.search('new query');

      const state = service.getState();
      expect(state.query).toBe('new query');
    });

    it('updates results based on query', () => {
      const heading = createMockCommand({
        id: 'heading',
        label: 'Heading',
        keywords: ['h1'],
      });
      const paragraph = createMockCommand({
        id: 'paragraph',
        label: 'Paragraph',
        keywords: ['p'],
      });
      registry.register(heading);
      registry.register(paragraph);
      service.open();

      service.search('heading');

      const state = service.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0].command.id).toBe('heading');
    });

    it('returns all commands when query is empty', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open('something');

      service.search('');

      const state = service.getState();
      expect(state.results).toHaveLength(2);
    });

    it('returns all commands when query is whitespace', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open('something');

      service.search('   ');

      const state = service.getState();
      expect(state.results).toHaveLength(2);
    });

    it('clamps selectedIndex if results shrink', () => {
      const cmd1 = createMockCommand({ id: 'aaa', label: 'AAA' });
      const cmd2 = createMockCommand({ id: 'bbb', label: 'BBB' });
      const cmd3 = createMockCommand({ id: 'ccc', label: 'CCC' });
      const cmd4 = createMockCommand({ id: 'test', label: 'Test' });
      registry.register(cmd1);
      registry.register(cmd2);
      registry.register(cmd3);
      registry.register(cmd4);
      service.open();
      service.selectIndex(3); // Select fourth item (test)

      service.search('aaa'); // Only 1 result (aaa)

      const state = service.getState();
      expect(state.selectedIndex).toBe(0); // Clamped to 0 (only valid index)
    });
  });

  describe('search() - scoring', () => {
    it('exact ID match scores highest', () => {
      const exactId = createMockCommand({
        id: 'test',
        label: 'Something Else',
      });
      const containsId = createMockCommand({
        id: 'testing',
        label: 'Testing',
      });
      registry.register(exactId);
      registry.register(containsId);
      service.open();

      service.search('test');

      const state = service.getState();
      expect(state.results[0].command.id).toBe('test');
      expect(state.results[0].score).toBeGreaterThan(state.results[1].score);
    });

    it('prefix match on ID scores higher than contains', () => {
      const prefixId = createMockCommand({ id: 'testcommand', label: 'A' });
      const containsId = createMockCommand({ id: 'mytest', label: 'B' });
      registry.register(prefixId);
      registry.register(containsId);
      service.open();

      service.search('test');

      const state = service.getState();
      expect(state.results[0].command.id).toBe('testcommand');
    });

    it('ID contains term scores higher than label contains', () => {
      const idContains = createMockCommand({
        id: 'mytest',
        label: 'Something',
      });
      const labelContains = createMockCommand({
        id: 'other',
        label: 'my test label',
      });
      registry.register(idContains);
      registry.register(labelContains);
      service.open();

      service.search('test');

      const state = service.getState();
      expect(state.results[0].command.id).toBe('mytest');
    });

    it('keyword exact match scores high', () => {
      const withKeyword = createMockCommand({
        id: 'heading',
        label: 'Heading',
        keywords: ['h1', 'title'],
      });
      const withoutKeyword = createMockCommand({
        id: 'paragraph',
        label: 'Paragraph title block',
        keywords: ['p'],
      });
      registry.register(withKeyword);
      registry.register(withoutKeyword);
      service.open();

      service.search('title');

      const state = service.getState();
      expect(state.results[0].command.id).toBe('heading');
    });

    it('includes matchedTerms in results', () => {
      const cmd = createMockCommand({
        id: 'heading',
        label: 'Heading',
        keywords: ['h1'],
      });
      registry.register(cmd);
      service.open();

      service.search('head');

      const state = service.getState();
      expect(state.results[0].matchedTerms).toContain('head');
    });

    it('search is case insensitive', () => {
      const cmd = createMockCommand({ id: 'Heading', label: 'HEADING' });
      registry.register(cmd);
      service.open();

      service.search('HEADING');

      const state = service.getState();
      expect(state.results).toHaveLength(1);
    });

    it('handles multiple search terms', () => {
      const cmd = createMockCommand({
        id: 'bulletlist',
        label: 'Bullet List',
        keywords: ['list', 'bullet'],
      });
      registry.register(cmd);
      service.open();

      service.search('bullet list');

      const state = service.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0].score).toBeGreaterThan(0);
    });
  });

  describe('filterByCategory()', () => {
    it('filters results by category', () => {
      const basic = createMockCommand({ id: 'basic1', category: 'basic' });
      const media = createMockCommand({ id: 'media1', category: 'media' });
      const advanced = createMockCommand({
        id: 'advanced1',
        category: 'advanced',
      });
      registry.register(basic);
      registry.register(media);
      registry.register(advanced);
      service.open();

      service.filterByCategory('basic');

      const state = service.getState();
      expect(state.filterCategory).toBe('basic');
      expect(state.results).toHaveLength(1);
      expect(state.results[0].command.category).toBe('basic');
    });

    it('resets selectedIndex to 0', () => {
      const cmd1 = createMockCommand({ id: 'cmd1', category: 'basic' });
      const cmd2 = createMockCommand({ id: 'cmd2', category: 'basic' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      service.selectNext();

      service.filterByCategory('basic');

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('null category shows all commands', () => {
      const basic = createMockCommand({ id: 'basic1', category: 'basic' });
      const media = createMockCommand({ id: 'media1', category: 'media' });
      registry.register(basic);
      registry.register(media);
      service.open();
      service.filterByCategory('basic');

      service.filterByCategory(null);

      const state = service.getState();
      expect(state.filterCategory).toBeNull();
      expect(state.results).toHaveLength(2);
    });

    it('combines with current search query', () => {
      const basicTest = createMockCommand({
        id: 'unique-target',
        label: 'Unique Target',
        category: 'basic',
      });
      const mediaMatch = createMockCommand({
        id: 'unique-media',
        label: 'Unique Media',
        category: 'media',
      });
      const basicOther = createMockCommand({
        id: 'other',
        label: 'Other',
        category: 'basic',
      });
      registry.register(basicTest);
      registry.register(mediaMatch);
      registry.register(basicOther);
      service.open();
      service.search('unique');

      // Before filter: 2 results (unique-target, unique-media)
      expect(service.getState().results).toHaveLength(2);

      service.filterByCategory('basic');

      // After filter: only unique-target (basic category with "unique" in name)
      const state = service.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0].command.id).toBe('unique-target');
    });
  });

  describe('selectNext()', () => {
    it('increments selectedIndex', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();

      service.selectNext();

      const state = service.getState();
      expect(state.selectedIndex).toBe(1);
    });

    it('wraps around to 0 when at last item', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      service.selectIndex(1);

      service.selectNext();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('does nothing when results are empty', () => {
      service.open();

      service.selectNext();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe('selectPrevious()', () => {
    it('decrements selectedIndex', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      service.selectIndex(1);

      service.selectPrevious();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('wraps around to last item when at 0', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      const cmd3 = createMockCommand({ id: 'cmd3' });
      registry.register(cmd1);
      registry.register(cmd2);
      registry.register(cmd3);
      service.open();

      service.selectPrevious();

      const state = service.getState();
      expect(state.selectedIndex).toBe(2);
    });

    it('does nothing when results are empty', () => {
      service.open();

      service.selectPrevious();

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe('selectIndex()', () => {
    it('selects specific index', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      const cmd3 = createMockCommand({ id: 'cmd3' });
      registry.register(cmd1);
      registry.register(cmd2);
      registry.register(cmd3);
      service.open();

      service.selectIndex(2);

      const state = service.getState();
      expect(state.selectedIndex).toBe(2);
    });

    it('ignores negative index', () => {
      const cmd = createMockCommand({ id: 'cmd' });
      registry.register(cmd);
      service.open();

      service.selectIndex(-1);

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });

    it('ignores index >= results length', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();

      service.selectIndex(5);

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe('executeSelected()', () => {
    it('executes the selected command', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const cmd = createMockCommand({ id: 'cmd', execute });
      registry.register(cmd);
      service.open();
      const context = createMockContext();

      await service.executeSelected(context);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(context);
    });

    it('closes the palette after execution', async () => {
      const cmd = createMockCommand({ id: 'cmd' });
      registry.register(cmd);
      service.open();
      const context = createMockContext();

      await service.executeSelected(context);

      const state = service.getState();
      expect(state.isOpen).toBe(false);
    });

    it('does nothing when results are empty (does not execute any command)', async () => {
      // Create a command but don't register it - palette will have no results
      const cmd = createMockCommand({ id: 'not-registered' });
      service.open();
      const context = createMockContext();

      // Execute with empty results should not throw
      await service.executeSelected(context);

      // Command was never executed because there are no results
      expect(cmd.execute).not.toHaveBeenCalled();
    });

    it('handles async command execution', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const cmd = createMockCommand({ id: 'cmd', execute });
      registry.register(cmd);
      service.open();
      const context = createMockContext();

      await service.executeSelected(context);

      expect(execute).toHaveBeenCalled();
    });

    it('closes palette even if command throws', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('Command failed'));
      const cmd = createMockCommand({ id: 'cmd', execute });
      registry.register(cmd);
      service.open();
      const context = createMockContext();

      const result = await service.executeSelected(context);

      const state = service.getState();
      expect(state.isOpen).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Command failed');
      }
    });
  });

  describe('executeById()', () => {
    it('executes command by ID', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const cmd = createMockCommand({ id: 'my-command', execute });
      registry.register(cmd);
      const context = createMockContext();

      await service.executeById('my-command', context);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(context);
    });

    it('closes the palette after execution', async () => {
      const cmd = createMockCommand({ id: 'my-command' });
      registry.register(cmd);
      service.open();
      const context = createMockContext();

      await service.executeById('my-command', context);

      const state = service.getState();
      expect(state.isOpen).toBe(false);
    });

    it('returns an error result for non-existent command ID', async () => {
      const context = createMockContext();

      const result = await service.executeById('non-existent', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('non-existent');
      }
    });

    it('handles async command execution', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const cmd = createMockCommand({ id: 'async-cmd', execute });
      registry.register(cmd);
      const context = createMockContext();

      await service.executeById('async-cmd', context);

      expect(execute).toHaveBeenCalled();
    });
  });

  describe('getAllCommands()', () => {
    it('returns all registered commands', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);

      const commands = service.getAllCommands();

      expect(commands).toHaveLength(2);
      expect(registry.getAll).toHaveBeenCalled();
    });

    it('returns empty array when no commands registered', () => {
      const commands = service.getAllCommands();

      expect(commands).toEqual([]);
    });
  });

  describe('getGroupedCommands()', () => {
    it('returns commands grouped by category', () => {
      const basic1 = createMockCommand({ id: 'basic1', category: 'basic' });
      const basic2 = createMockCommand({ id: 'basic2', category: 'basic' });
      const media1 = createMockCommand({ id: 'media1', category: 'media' });
      registry.register(basic1);
      registry.register(basic2);
      registry.register(media1);

      const grouped = service.getGroupedCommands();

      expect(registry.getGrouped).toHaveBeenCalled();
      const basicGroup = grouped.find((g) => g.category === 'basic');
      const mediaGroup = grouped.find((g) => g.category === 'media');
      expect(basicGroup).toBeDefined();
      expect(basicGroup!.commands).toHaveLength(2);
      expect(mediaGroup).toBeDefined();
      expect(mediaGroup!.commands).toHaveLength(1);
    });

    it('returns groups in category order: basic, media, advanced, ai', () => {
      const ai = createMockCommand({ id: 'ai1', category: 'ai' });
      const basic = createMockCommand({ id: 'basic1', category: 'basic' });
      const advanced = createMockCommand({
        id: 'advanced1',
        category: 'advanced',
      });
      const media = createMockCommand({ id: 'media1', category: 'media' });
      registry.register(ai);
      registry.register(basic);
      registry.register(advanced);
      registry.register(media);

      const grouped = service.getGroupedCommands();

      expect(grouped[0].category).toBe('basic');
      expect(grouped[1].category).toBe('media');
      expect(grouped[2].category).toBe('advanced');
      expect(grouped[3].category).toBe('ai');
    });

    it('includes category labels', () => {
      const basic = createMockCommand({ id: 'basic1', category: 'basic' });
      const media = createMockCommand({ id: 'media1', category: 'media' });
      const advanced = createMockCommand({
        id: 'advanced1',
        category: 'advanced',
      });
      const ai = createMockCommand({ id: 'ai1', category: 'ai' });
      registry.register(basic);
      registry.register(media);
      registry.register(advanced);
      registry.register(ai);

      const grouped = service.getGroupedCommands();

      expect(grouped.find((g) => g.category === 'basic')!.label).toBe(
        'Basic Blocks'
      );
      expect(grouped.find((g) => g.category === 'media')!.label).toBe('Media');
      expect(grouped.find((g) => g.category === 'advanced')!.label).toBe(
        'Advanced'
      );
      expect(grouped.find((g) => g.category === 'ai')!.label).toBe('AI');
    });
  });

  describe('registerCommand()', () => {
    it('registers command in registry', () => {
      const cmd = createMockCommand({ id: 'new-cmd' });

      service.registerCommand(cmd);

      expect(registry.register).toHaveBeenCalledWith(cmd);
    });

    it('refreshes results if palette is open', () => {
      const existing = createMockCommand({ id: 'existing' });
      registry.register(existing);
      service.open();
      const newCmd = createMockCommand({ id: 'new-cmd' });

      service.registerCommand(newCmd);

      const state = service.getState();
      expect(state.results).toHaveLength(2);
    });

    it('does not refresh results if palette is closed', () => {
      const cmd = createMockCommand({ id: 'cmd' });

      service.registerCommand(cmd);

      const state = service.getState();
      expect(state.results).toEqual([]);
    });
  });

  describe('unregisterCommand()', () => {
    it('unregisters command from registry', () => {
      const cmd = createMockCommand({ id: 'to-remove' });
      registry.register(cmd);

      service.unregisterCommand('to-remove');

      expect(registry.unregister).toHaveBeenCalledWith('to-remove');
    });

    it('refreshes results if palette is open', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();

      service.unregisterCommand('cmd1');

      const state = service.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0].command.id).toBe('cmd2');
    });

    it('clamps selectedIndex if needed', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      service.selectIndex(1);

      service.unregisterCommand('cmd2');

      const state = service.getState();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe('subscribe()', () => {
    it('calls callback immediately with current state', () => {
      const callback = vi.fn();

      service.subscribe(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(service.getState());
    });

    it('returns unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe stops notifications', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      callback.mockClear();

      unsubscribe();
      service.open();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('subscribe() - notifications', () => {
    it('notifies on open()', () => {
      const callback = vi.fn();
      service.subscribe(callback);
      callback.mockClear();

      service.open();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true })
      );
    });

    it('notifies on close()', () => {
      service.open();
      const callback = vi.fn();
      service.subscribe(callback);
      callback.mockClear();

      service.close();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: false })
      );
    });

    it('notifies on search()', () => {
      const cmd = createMockCommand({ id: 'test' });
      registry.register(cmd);
      service.open();
      const callback = vi.fn();
      service.subscribe(callback);
      callback.mockClear();

      service.search('test');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'test' })
      );
    });

    it('notifies on selectNext()', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      registry.register(cmd1);
      registry.register(cmd2);
      service.open();
      const callback = vi.fn();
      service.subscribe(callback);
      callback.mockClear();

      service.selectNext();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ selectedIndex: 1 })
      );
    });

    it('notifies on filterByCategory()', () => {
      const cmd = createMockCommand({ id: 'cmd', category: 'basic' });
      registry.register(cmd);
      service.open();
      const callback = vi.fn();
      service.subscribe(callback);
      callback.mockClear();

      service.filterByCategory('basic');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ filterCategory: 'basic' })
      );
    });

    it('notifies multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      service.subscribe(callback1);
      service.subscribe(callback2);
      callback1.mockClear();
      callback2.mockClear();

      service.open();

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('continues notifying other subscribers if one throws during state update', () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // First subscribe normally to avoid error during initial callback
      const normalCallback = vi.fn();
      service.subscribe(normalCallback);

      // Subscribe with a callback that will throw ONLY on subsequent calls
      let callCount = 0;
      const errorCallback = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Subscriber error');
        }
      });
      service.subscribe(errorCallback);

      // Clear mocks after initial subscribe calls
      normalCallback.mockClear();
      errorCallback.mockClear();

      // Trigger a state update - errorCallback will throw now
      service.open();

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('integration scenarios', () => {
    it('handles full command palette workflow', async () => {
      // Register commands
      const heading = createMockCommand({
        id: 'heading',
        label: 'Heading',
        keywords: ['h1'],
        category: 'basic',
        execute: vi.fn().mockResolvedValue(undefined),
      });
      const paragraph = createMockCommand({
        id: 'paragraph',
        label: 'Paragraph',
        keywords: ['p'],
        category: 'basic',
      });
      const image = createMockCommand({
        id: 'image',
        label: 'Image',
        keywords: ['img'],
        category: 'media',
      });
      registry.register(heading);
      registry.register(paragraph);
      registry.register(image);

      // Subscribe to state changes
      const stateChanges: ReturnType<typeof service.getState>[] = [];
      service.subscribe((state) => stateChanges.push(state));

      // Open palette
      service.open();
      expect(service.getState().isOpen).toBe(true);
      expect(service.getState().results).toHaveLength(3);

      // Search for heading
      service.search('head');
      expect(service.getState().results).toHaveLength(1);
      expect(service.getState().results[0].command.id).toBe('heading');

      // Execute the command
      const context = createMockContext();
      await service.executeSelected(context);

      expect(heading.execute).toHaveBeenCalledWith(context);
      expect(service.getState().isOpen).toBe(false);

      // Verify all state changes were notified
      expect(stateChanges.length).toBeGreaterThan(3);
    });

    it('handles navigation with keyboard', () => {
      const cmd1 = createMockCommand({ id: 'cmd1' });
      const cmd2 = createMockCommand({ id: 'cmd2' });
      const cmd3 = createMockCommand({ id: 'cmd3' });
      registry.register(cmd1);
      registry.register(cmd2);
      registry.register(cmd3);
      service.open();

      // Navigate down
      service.selectNext();
      expect(service.getState().selectedIndex).toBe(1);

      service.selectNext();
      expect(service.getState().selectedIndex).toBe(2);

      // Wrap around
      service.selectNext();
      expect(service.getState().selectedIndex).toBe(0);

      // Navigate up (wraps to end)
      service.selectPrevious();
      expect(service.getState().selectedIndex).toBe(2);
    });
  });
});
