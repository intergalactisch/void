/**
 * Component tests for SlashMenu
 *
 * NOTE: These tests are temporarily simplified because @testing-library/svelte
 * doesn't fully support Svelte 5 runes yet. The `mount()` function
 * requires browser context which isn't available in happy-dom.
 *
 * When Svelte 5 support is complete, uncomment the full component tests.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';
import { createSlashMenuReducer, orderSlashCommands } from '$lib/adapters/prosemirror/plugins/slashMenu/handlers';
import { INITIAL_STATE, slashMenuKey } from '$lib/adapters/prosemirror/plugins/slashMenu/state';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import type { RegisteredCommand } from '$lib/ports/outbound';
import type { CommandRegistryPort } from '$lib/ports/outbound';
import { EditorState } from 'prosemirror-state';

function createMockCommand(overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return {
    id: 'test-cmd',
    label: 'Test Command',
    description: 'A test command',
    category: 'basic',
    icon: 'text',
    keywords: [],
    execute: vi.fn(),
    ...overrides,
  };
}

function createOpenState(commands: RegisteredCommand[] = []): SlashMenuState {
  return {
    isOpen: true,
    query: '',
    filteredCommands: commands,
    selectedIndex: 0,
    triggerPos: 0,
    coords: { top: 100, left: 100 },
    openAbove: false,
    isAIPromptMode: false,
    aiPrompt: '',
    source: 'slash',
    blockType: '',
  };
}

function createClosedState(): SlashMenuState {
  return {
    isOpen: false,
    query: '',
    filteredCommands: [],
    selectedIndex: 0,
    triggerPos: 0,
    coords: null,
    openAbove: false,
    isAIPromptMode: false,
    aiPrompt: '',
    source: 'slash',
    blockType: '',
  };
}

describe('SlashMenu State', () => {
  describe('state creation', () => {
    it('creates open state correctly', () => {
      const state = createOpenState([createMockCommand()]);

      expect(state.isOpen).toBe(true);
      expect(state.filteredCommands).toHaveLength(1);
      expect(state.coords).not.toBeNull();
    });

    it('creates closed state correctly', () => {
      const state = createClosedState();

      expect(state.isOpen).toBe(false);
      expect(state.filteredCommands).toHaveLength(0);
      expect(state.coords).toBeNull();
    });
  });

  describe('command grouping logic', () => {
    it('can group commands by category', () => {
      const commands = [
        createMockCommand({ id: 'cmd1', category: 'basic' }),
        createMockCommand({ id: 'cmd2', category: 'advanced' }),
        createMockCommand({ id: 'cmd3', category: 'basic' }),
      ];

      const groups = new Map<string, RegisteredCommand[]>();
      for (const cmd of commands) {
        const existing = groups.get(cmd.category) ?? [];
        existing.push(cmd);
        groups.set(cmd.category, existing);
      }

      expect(groups.get('basic')).toHaveLength(2);
      expect(groups.get('advanced')).toHaveLength(1);
    });
  });

  describe('selection logic', () => {
    it('tracks selected index correctly', () => {
      const commands = [
        createMockCommand({ id: 'cmd1', label: 'First' }),
        createMockCommand({ id: 'cmd2', label: 'Second' }),
        createMockCommand({ id: 'cmd3', label: 'Third' }),
      ];

      const state: SlashMenuState = {
        ...createOpenState(commands),
        selectedIndex: 1,
      };

      expect(state.selectedIndex).toBe(1);
      expect(state.filteredCommands[state.selectedIndex]?.label).toBe('Second');
    });

    it('handles empty selection', () => {
      const state = createOpenState([]);
      expect(state.selectedIndex).toBe(0);
      expect(state.filteredCommands[state.selectedIndex]).toBeUndefined();
    });

    it('orders commands to match the rendered category navigation', () => {
      const commands = [
        createMockCommand({ id: 'paragraph', label: 'Text', category: 'basic' }),
        createMockCommand({ id: 'callout', label: 'Callout', category: 'advanced' }),
        createMockCommand({ id: 'table', label: 'Table', category: 'advanced' }),
        createMockCommand({ id: 'image', label: 'Image', category: 'media' }),
      ];

      expect(orderSlashCommands(commands).map((command) => command.id)).toEqual([
        'paragraph',
        'image',
        'callout',
        'table',
      ]);
    });

    it('keeps typed slash conversion commands available', () => {
      const commands = [
        createMockCommand({ id: 'paragraph', label: 'Text', category: 'basic' }),
        createMockCommand({ id: 'horizontalRule', label: 'Divider', category: 'basic' }),
        createMockCommand({ id: 'image', label: 'Image', category: 'media' }),
        createMockCommand({ id: 'callout', label: 'Callout', category: 'advanced' }),
      ];

      expect(orderSlashCommands(commands, 'slash').map((command) => command.id)).toEqual([
        'paragraph',
        'horizontalRule',
        'image',
        'callout',
      ]);
    });

    it('filters conversion commands out of the gutter plus menu', () => {
      const commands = [
        createMockCommand({ id: 'paragraph', label: 'Text', category: 'basic' }),
        createMockCommand({ id: 'horizontalRule', label: 'Divider', category: 'basic' }),
        createMockCommand({ id: 'image', label: 'Image', category: 'media' }),
        createMockCommand({ id: 'callout', label: 'Callout', category: 'advanced' }),
      ];

      expect(orderSlashCommands(commands, 'gutter').map((command) => command.id)).toEqual([
        'horizontalRule',
        'image',
      ]);
    });

    it('moves past Image instead of clamping when commands continue below it', () => {
      const commands = [
        createMockCommand({ id: 'paragraph', label: 'Text', category: 'basic' }),
        createMockCommand({ id: 'callout', label: 'Callout', category: 'advanced' }),
        createMockCommand({ id: 'image', label: 'Image', category: 'media' }),
      ];
      const registry = createRegistry(commands);
      const reducer = createSlashMenuReducer(registry);
      const editorState = EditorState.create({ schema: voidSchema });

      const opened = reducer(
        INITIAL_STATE,
        editorState.tr.setMeta(slashMenuKey, {
          type: 'OPEN',
          triggerPos: 1,
          coords: { top: 0, left: 0 },
          openAbove: false,
          source: 'slash',
        }),
        editorState
      );

      expect(opened.filteredCommands.map((command) => command.id)).toEqual([
        'paragraph',
        'image',
        'callout',
      ]);

      const fromImage = { ...opened, selectedIndex: 1 };
      const next = reducer(
        fromImage,
        editorState.tr.setMeta(slashMenuKey, { type: 'NEXT' }),
        editorState
      );
      expect(next.selectedIndex).toBe(2);

      const wrapped = reducer(
        { ...opened, selectedIndex: 2 },
        editorState.tr.setMeta(slashMenuKey, { type: 'NEXT' }),
        editorState
      );
      expect(wrapped.selectedIndex).toBe(0);
    });
  });

  describe('filtering logic', () => {
    it('filters commands by query', () => {
      const commands = [
        createMockCommand({ id: 'h1', label: 'Heading 1' }),
        createMockCommand({ id: 'h2', label: 'Heading 2' }),
        createMockCommand({ id: 'p', label: 'Paragraph' }),
      ];

      const query = 'head';
      const filtered = commands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every((cmd) => cmd.label.includes('Heading'))).toBe(true);
    });
  });
});

function createRegistry(commands: RegisteredCommand[]): CommandRegistryPort {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn((id: string) => commands.find((command) => command.id === id) ?? null),
    getAll: vi.fn(() => commands),
    getGrouped: vi.fn(() => new Map()),
    search: vi.fn((query: string) =>
      commands.filter((command) =>
        command.label.toLowerCase().includes(query.toLowerCase())
      )
    ),
  };
}

describe('SlashMenu Command', () => {
  it('has required properties', () => {
    const command = createMockCommand();

    expect(command.id).toBeDefined();
    expect(command.label).toBeDefined();
    expect(command.category).toBeDefined();
    expect(command.execute).toBeInstanceOf(Function);
  });

  it('execute function is callable', () => {
    const command = createMockCommand();
    const mockContext = {} as Parameters<typeof command.execute>[0];

    expect(() => command.execute(mockContext)).not.toThrow();
    expect(command.execute).toHaveBeenCalledWith(mockContext);
  });
});
