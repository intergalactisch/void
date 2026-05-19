/**
 * Command Registry Implementation
 *
 * Provides storage and search functionality for slash commands.
 * Commands are stored in a Map for O(1) lookup by ID.
 *
 * Part of the commands infrastructure adapter.
 */

import type { RegisteredCommand } from '$lib/ports/outbound';

/**
 * Internal storage for registered commands.
 */
const commandMap = new Map<string, RegisteredCommand>();

/**
 * Register a command.
 * If a command with the same ID exists, it will be overwritten.
 *
 * @param command - The command to register
 */
export function registerCommand(command: RegisteredCommand): void {
  commandMap.set(command.id, command);
}

/**
 * Unregister a command by ID.
 *
 * @param id - The command ID to unregister
 */
export function unregisterCommand(id: string): void {
  commandMap.delete(id);
}

/**
 * Get all registered commands.
 *
 * @returns Array of all registered commands
 */
export function getAllCommands(): RegisteredCommand[] {
  return Array.from(commandMap.values());
}

/**
 * Get a command by ID.
 *
 * @param id - The command ID to look up
 * @returns The command or null if not found
 */
export function getCommand(id: string): RegisteredCommand | null {
  return commandMap.get(id) ?? null;
}

/**
 * Search commands by query string.
 *
 * Uses fuzzy matching against:
 * - Command ID
 * - Command label
 * - Command keywords
 *
 * @param query - The search query (case-insensitive)
 * @returns Array of matching commands, sorted by relevance
 */
export function searchCommands(query: string): RegisteredCommand[] {
  if (!query || query.trim() === '') {
    return getAllCommands();
  }

  const normalizedQuery = query.toLowerCase().trim();
  const results: Array<{ command: RegisteredCommand; score: number }> = [];

  for (const command of commandMap.values()) {
    const score = calculateMatchScore(command, normalizedQuery);
    if (score > 0) {
      results.push({ command, score });
    }
  }

  // Sort by score (highest first) then alphabetically by label
  return results
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.command.label.localeCompare(b.command.label);
    })
    .map((r) => r.command);
}

/**
 * Calculate match score for a command against a query.
 *
 * Scoring:
 * - Exact ID match: 100
 * - ID starts with query: 80
 * - ID contains query: 50
 * - Exact label match: 90
 * - Label starts with query: 70
 * - Label contains query: 40
 * - Exact keyword match: 60
 * - Keyword starts with query: 45
 * - Keyword contains query: 30
 *
 * @param command - The command to score
 * @param query - The normalized (lowercase) query
 * @returns Match score (0 = no match)
 */
function calculateMatchScore(command: RegisteredCommand, query: string): number {
  const id = command.id.toLowerCase();
  const label = command.label.toLowerCase();

  // Check ID matches
  if (id === query) return 100;
  if (id.startsWith(query)) return 80;
  if (id.includes(query)) return 50;

  // Check label matches
  if (label === query) return 90;
  if (label.startsWith(query)) return 70;
  if (label.includes(query)) return 40;

  // Check keyword matches
  for (const keyword of command.keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (normalizedKeyword === query) return 60;
    if (normalizedKeyword.startsWith(query)) return 45;
    if (normalizedKeyword.includes(query)) return 30;
  }

  return 0;
}

/**
 * Get commands grouped by category.
 *
 * @returns Map with category as key and array of commands as value
 */
export function getCommandsGrouped(): Map<string, RegisteredCommand[]> {
  const groups = new Map<string, RegisteredCommand[]>();

  for (const command of commandMap.values()) {
    const category = command.category;
    const existing = groups.get(category) ?? [];
    existing.push(command);
    groups.set(category, existing);
  }

  // Sort commands within each group by label
  for (const [category, commands] of groups) {
    groups.set(
      category,
      commands.sort((a, b) => a.label.localeCompare(b.label))
    );
  }

  return groups;
}

/**
 * Clear all registered commands.
 * Useful for testing or resetting state.
 */
export function clearCommands(): void {
  commandMap.clear();
}

/**
 * Get the count of registered commands.
 *
 * @returns Number of registered commands
 */
export function getCommandCount(): number {
  return commandMap.size;
}
