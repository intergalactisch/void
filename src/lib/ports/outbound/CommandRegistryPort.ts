/**
 * CommandRegistryPort - Outbound port for command registration
 *
 * This port defines the contract between the application and the command
 * registry infrastructure. The application layer depends on this interface,
 * never on concrete implementations.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { SlashCommand } from '$lib/domain/values';
import type { ScopeSnapshot } from '$lib/domain/values/ScopeSnapshot';
import type { EditorPort } from './EditorPort';

/**
 * Context provided to command execution handlers.
 *
 * `editor` and `selection` are optional because not every command runs against
 * the editor — global view toggles, navigation, AI panel commands all execute
 * with no active editor. Slash-menu commands check `editor` and bail when absent.
 */
export interface CommandContext {
  /** Editor port for executing editor commands. May be undefined for global commands. */
  editor?: EditorPort;
  /** Current selection. Undefined when no editor or no selection. */
  selection?: {
    /** Start position */
    from: number;
    /** End position */
    to: number;
    /** Selected text content */
    text: string;
  };
  /** Snapshot of UI state when the command was invoked. */
  scope: ScopeSnapshot;
}

/**
 * A registered command with its execution handler.
 * Extends SlashCommand with the execute function and optional runtime guard.
 */
export interface RegisteredCommand extends SlashCommand {
  /**
   * Execute the command.
   * @param context - The command execution context
   * @returns void or a Promise for async operations
   */
  execute: (context: CommandContext) => void | Promise<void>;
  /**
   * Optional predicate. When false the command is hidden from palette listings
   * and skipped by keymap dispatch. Use for context-specific commands like
   * editor.findNext (only valid when find bar is open).
   */
  runWhen?: (context: CommandContext) => boolean;
}

/**
 * Outbound port for command registry.
 *
 * This interface is implemented by secondary adapters (e.g., CommandRegistryAdapter)
 * and defines how the application manages slash commands.
 */
export interface CommandRegistryPort {
  /**
   * Register a new command.
   * If a command with the same ID exists, it will be overwritten.
   * @param command - The command to register
   */
  register(command: RegisteredCommand): void;

  /**
   * Unregister a command by ID.
   * @param id - The command ID to unregister
   */
  unregister(id: string): void;

  /**
   * Get all registered commands.
   * @returns Array of all registered commands
   */
  getAll(): RegisteredCommand[];

  /**
   * Get command by ID.
   * @param id - The command ID to look up
   * @returns The command or null if not found
   */
  get(id: string): RegisteredCommand | null;

  /**
   * Search commands by keyword.
   * Matches against command ID, label, and keywords.
   * @param query - The search query
   * @returns Array of matching commands
   */
  search(query: string): RegisteredCommand[];

  /**
   * Get commands grouped by category.
   * @returns Map with category as key and array of commands as value
   */
  getGrouped(): Map<string, RegisteredCommand[]>;
}
