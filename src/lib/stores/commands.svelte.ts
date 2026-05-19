/**
 * Commands Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that manages
 * the slash command menu state for the editor.
 *
 * Tracks menu visibility, search query, selected index, and filtered commands.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import type { RegisteredCommand, CommandRegistryPort, CommandContext } from '$lib/ports/outbound';
import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';

/**
 * Initial slash menu state.
 */
const INITIAL_STATE: SlashMenuState = {
  isOpen: false,
  query: '',
  triggerPos: 0,
  selectedIndex: 0,
  filteredCommands: [],
  coords: null,
  openAbove: false,
  isAIPromptMode: false,
  aiPrompt: '',
  source: 'slash',
  blockType: '',
};

/**
 * Commands Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to slash command menu state and methods
 * to interact with the command registry.
 */
class CommandsStore {
  #registry: CommandRegistryPort | null = null;
  #allCommands: RegisteredCommand[] = [];

  // Reactive state
  isOpen = $state(false);
  query = $state('');
  triggerPos = $state(0);
  selectedIndex = $state(0);
  filteredCommands = $state<RegisteredCommand[]>([]);
  coords = $state<{ top: number; left: number } | null>(null);
  openAbove = $state(false);

  /**
   * Initialize the store with a CommandRegistryPort instance.
   * Must be called before using any other methods.
   *
   * @param registry - The CommandRegistryPort to use
   */
  init(registry: CommandRegistryPort) {
    this.#registry = registry;
    this.#allCommands = registry.getAll();
    this.filteredCommands = this.#allCommands;
  }

  /**
   * Open the slash menu at the specified position.
   *
   * @param triggerPos - Document position where "/" was typed
   * @param coords - DOM coordinates for positioning the menu popup
   */
  open(triggerPos: number, coords: { top: number; left: number }, openAbove = false) {
    this.isOpen = true;
    this.query = '';
    this.triggerPos = triggerPos;
    this.selectedIndex = 0;
    this.coords = coords;
    this.openAbove = openAbove;
    this.filteredCommands = this.#allCommands;
  }

  /**
   * Close the slash menu and reset state.
   */
  close() {
    this.isOpen = false;
    this.query = '';
    this.triggerPos = 0;
    this.selectedIndex = 0;
    this.coords = null;
    this.openAbove = false;
    this.filteredCommands = this.#allCommands;
  }

  /**
   * Update the search query and filter commands.
   *
   * @param query - The new search query
   */
  search(query: string) {
    this.query = query;
    this.selectedIndex = 0;

    if (!this.#registry) {
      this.filteredCommands = [];
      return;
    }

    if (query.trim() === '') {
      this.filteredCommands = this.#allCommands;
    } else {
      this.filteredCommands = this.#registry.search(query);
    }
  }

  /**
   * Select the next command in the list.
   */
  selectNext() {
    if (this.filteredCommands.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
  }

  /**
   * Select the previous command in the list.
   */
  selectPrev() {
    if (this.filteredCommands.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
  }

  /**
   * Get the currently selected command.
   *
   * @returns The selected command or null if none selected
   */
  getSelectedCommand(): RegisteredCommand | null {
    if (this.filteredCommands.length === 0) return null;
    return this.filteredCommands[this.selectedIndex] ?? null;
  }

  /**
   * Execute a command.
   *
   * @param command - The command to execute
   * @param context - The command execution context
   * @returns Promise that resolves when command completes
   */
  async execute(command: RegisteredCommand, context: CommandContext): Promise<void> {
    await command.execute(context);
    this.close();
  }

  /**
   * Execute the currently selected command.
   *
   * @param context - The command execution context
   * @returns Promise that resolves when command completes
   */
  async executeSelected(context: CommandContext): Promise<void> {
    const command = this.getSelectedCommand();
    if (command) {
      await this.execute(command, context);
    }
  }

  /**
   * Set the selected index directly.
   *
   * @param index - The index to select
   */
  setSelectedIndex(index: number) {
    if (index >= 0 && index < this.filteredCommands.length) {
      this.selectedIndex = index;
    }
  }

  /**
   * Update state from external slash menu state (e.g., from ProseMirror plugin).
   *
   * @param state - The slash menu state from the plugin
   */
  updateFromPluginState(state: SlashMenuState) {
    this.isOpen = state.isOpen;
    this.query = state.query;
    this.triggerPos = state.triggerPos;
    this.selectedIndex = state.selectedIndex;
    this.filteredCommands = state.filteredCommands;
    this.coords = state.coords;
    this.openAbove = state.openAbove;
  }

  /**
   * Get commands grouped by category.
   *
   * @returns Map with category as key and commands as value
   */
  getGroupedCommands(): Map<string, RegisteredCommand[]> {
    if (!this.#registry) return new Map();
    return this.#registry.getGrouped();
  }

  /**
   * Get commands from the filtered list grouped by category.
   *
   * @returns Map with category as key and filtered commands as value
   */
  getFilteredGrouped(): Map<string, RegisteredCommand[]> {
    const groups = new Map<string, RegisteredCommand[]>();

    for (const cmd of this.filteredCommands) {
      const category = cmd.category;
      const existing = groups.get(category) ?? [];
      existing.push(cmd);
      groups.set(category, existing);
    }

    return groups;
  }

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#registry !== null;
  }

  /**
   * Check if there are any filtered commands.
   */
  get hasCommands(): boolean {
    return this.filteredCommands.length > 0;
  }

  /**
   * Get the current state as SlashMenuState object.
   */
  get state(): SlashMenuState {
    return {
      isOpen: this.isOpen,
      query: this.query,
      triggerPos: this.triggerPos,
      selectedIndex: this.selectedIndex,
      filteredCommands: this.filteredCommands,
      coords: this.coords,
      openAbove: this.openAbove,
      isAIPromptMode: false,
      aiPrompt: '',
      source: 'slash',
      blockType: '',
    };
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    this.#registry = null;
    this.#allCommands = [];
    this.isOpen = false;
    this.query = '';
    this.triggerPos = 0;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    this.coords = null;
  }
}

export const commandsStore = new CommandsStore();
