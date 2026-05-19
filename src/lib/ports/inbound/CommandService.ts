/**
 * CommandService - Inbound port for slash command execution
 *
 * This port defines the application API for slash commands, exposing how
 * the UI layer can register, search, and execute commands. Primary adapters
 * (Svelte components, stores) depend on this interface.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { CommandCategory, CommandGroup } from '$lib/domain/values';
import type { RegisteredCommand, CommandContext } from '$lib/ports/outbound';

/**
 * Command search result with match information.
 */
export interface CommandSearchResult {
  /** The matching command */
  command: RegisteredCommand;
  /** Match score (higher is better) */
  score: number;
  /** Matched terms for highlighting */
  matchedTerms: string[];
}

/**
 * Command palette state exposed to the UI.
 */
export interface CommandPaletteState {
  /** Whether the command palette is open */
  isOpen: boolean;
  /** Current search query */
  query: string;
  /** Filtered command results */
  results: CommandSearchResult[];
  /** Currently selected index */
  selectedIndex: number;
  /** Current filter category (null for all) */
  filterCategory: CommandCategory | null;
}

/**
 * Inbound port - slash command service API.
 *
 * This interface is implemented by application services (CommandServiceImpl)
 * and defines the API available to UI components and stores.
 */
export interface CommandService {
  /**
   * Get command palette state.
   * @returns The current command palette state
   */
  getState(): CommandPaletteState;

  /**
   * Open the command palette.
   * @param initialQuery - Optional initial search query
   */
  open(initialQuery?: string): void;

  /**
   * Close the command palette.
   */
  close(): void;

  /**
   * Toggle the command palette.
   * @param initialQuery - Optional initial search query when opening
   */
  toggle(initialQuery?: string): void;

  /**
   * Update search query.
   * Filters the command list based on the query.
   * @param query - The search query
   */
  search(query: string): void;

  /**
   * Filter by category.
   * @param category - Category to filter by, or null for all
   */
  filterByCategory(category: CommandCategory | null): void;

  /**
   * Select next command in the list.
   */
  selectNext(): void;

  /**
   * Select previous command in the list.
   */
  selectPrevious(): void;

  /**
   * Select command at index.
   * @param index - Index to select
   */
  selectIndex(index: number): void;

  /**
   * Execute the currently selected command.
   * @param context - The command execution context
   * @returns Result indicating whether the command ran successfully.
   */
  executeSelected(context: CommandContext): Promise<Result<void, Error>>;

  /**
   * Execute command by ID.
   * @param commandId - ID of the command to execute
   * @param context - The command execution context
   * @returns Result indicating whether the command ran successfully.
   */
  executeById(commandId: string, context: CommandContext): Promise<Result<void, Error>>;

  /**
   * Get all available commands.
   * @returns Array of all registered commands
   */
  getAllCommands(): RegisteredCommand[];

  /**
   * Get commands grouped by category.
   * @returns Array of command groups
   */
  getGroupedCommands(): CommandGroup[];

  /**
   * Register a custom command.
   * @param command - The command to register
   */
  registerCommand(command: RegisteredCommand): void;

  /**
   * Unregister a command.
   * @param commandId - ID of the command to unregister
   */
  unregisterCommand(commandId: string): void;

  /**
   * Subscribe to state changes.
   * @param callback - Called whenever the command palette state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: CommandPaletteState) => void): () => void;
}
