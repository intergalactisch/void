/**
 * Command Registry Adapter
 *
 * Implements CommandRegistryPort using the internal registry module.
 * Provides a clean interface for the application layer to interact
 * with command registration and search.
 *
 * Part of the commands infrastructure adapter.
 */

import type { CommandRegistryPort, RegisteredCommand } from '$lib/ports/outbound';
import {
  registerCommand,
  unregisterCommand,
  getAllCommands,
  getCommand,
  searchCommands,
  getCommandsGrouped,
} from './registry';
import { registerBuiltinCommands } from './builtinCommands';

/**
 * Adapter implementing CommandRegistryPort.
 *
 * This class provides:
 * - Command registration and unregistration
 * - Command lookup by ID
 * - Fuzzy search across command metadata
 * - Grouped command retrieval by category
 *
 * @example
 * ```typescript
 * const registry = new CommandRegistryAdapter();
 *
 * // Register a custom command
 * registry.register({
 *   id: 'my-command',
 *   label: 'My Command',
 *   keywords: ['custom', 'mine'],
 *   category: 'advanced',
 *   execute: (context) => {
 *     // Command implementation
 *   },
 * });
 *
 * // Search for commands
 * const results = registry.search('custom');
 * ```
 */
export class CommandRegistryAdapter implements CommandRegistryPort {
  private initialized = false;

  /**
   * Create a new CommandRegistryAdapter.
   *
   * @param autoRegisterBuiltins - Whether to auto-register built-in commands (default: true)
   */
  constructor(autoRegisterBuiltins = true) {
    if (autoRegisterBuiltins) {
      this.registerBuiltins();
    }
  }

  /**
   * Register all built-in commands.
   * Safe to call multiple times - will skip if already initialized.
   */
  registerBuiltins(): void {
    if (this.initialized) return;
    registerBuiltinCommands((cmd) => registerCommand(cmd));
    this.initialized = true;
  }

  /**
   * Register a new command.
   * If a command with the same ID exists, it will be overwritten.
   *
   * @param command - The command to register
   */
  register(command: RegisteredCommand): void {
    registerCommand(command);
  }

  /**
   * Unregister a command by ID.
   *
   * @param id - The command ID to unregister
   */
  unregister(id: string): void {
    unregisterCommand(id);
  }

  /**
   * Get all registered commands.
   *
   * @returns Array of all registered commands
   */
  getAll(): RegisteredCommand[] {
    return getAllCommands();
  }

  /**
   * Get command by ID.
   *
   * @param id - The command ID to look up
   * @returns The command or null if not found
   */
  get(id: string): RegisteredCommand | null {
    return getCommand(id);
  }

  /**
   * Search commands by keyword.
   *
   * Performs fuzzy matching against:
   * - Command ID
   * - Command label
   * - Command keywords
   *
   * Results are sorted by relevance.
   *
   * @param query - The search query (case-insensitive)
   * @returns Array of matching commands
   */
  search(query: string): RegisteredCommand[] {
    return searchCommands(query);
  }

  /**
   * Get commands grouped by category.
   *
   * Categories are defined in the SlashCommand interface:
   * - 'basic': Fundamental text blocks (paragraph, headings, lists)
   * - 'media': Media content (images)
   * - 'advanced': Advanced features (callouts)
   * - 'ai': AI-powered commands (rewrite, expand, summarize)
   *
   * @returns Map with category as key and array of commands as value
   */
  getGrouped(): Map<string, RegisteredCommand[]> {
    return getCommandsGrouped();
  }
}

/**
 * Default command registry instance.
 *
 * Use this singleton for application-wide command registration.
 * Created with built-in commands pre-registered.
 */
export const commandRegistry = new CommandRegistryAdapter(true);
