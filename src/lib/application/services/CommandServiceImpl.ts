/**
 * CommandServiceImpl - Implementation of CommandService
 *
 * This service wraps the CommandRegistryAdapter and provides a
 * user-facing API for command palette functionality. It handles
 * command search, filtering, and execution with editor context.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { CommandService, CommandPaletteState, CommandSearchResult } from '$lib/ports/inbound';
import type { CommandRegistryPort, RegisteredCommand, CommandContext } from '$lib/ports/outbound';
import type { CommandCategory, CommandGroup } from '$lib/domain/values';
import { ok, err, type Result } from '$lib/core';
import { events } from '$lib/events';

/**
 * Initial state for the command palette.
 */
const INITIAL_STATE: CommandPaletteState = {
  isOpen: false,
  query: '',
  results: [],
  selectedIndex: 0,
  filterCategory: null,
};

/**
 * Display labels for known categories. Falls back to a title-cased category id
 * when an unknown category is registered.
 */
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  basic: 'Basic Blocks',
  media: 'Media',
  advanced: 'Advanced',
  ai: 'AI',
  editor: 'Editor',
  navigation: 'Navigation',
  note: 'Notes',
  view: 'View',
  tasks: 'Tasks',
  tools: 'Tools',
  settings: 'Settings',
  system: 'System',
  search: 'Search',
};

/**
 * Display order for categories. Unknown categories appear after these in
 * insertion order.
 */
const CATEGORY_ORDER: CommandCategory[] = [
  'basic',
  'media',
  'advanced',
  'ai',
  'editor',
  'navigation',
  'note',
  'view',
  'search',
  'tasks',
  'tools',
  'settings',
  'system',
];

/**
 * Implementation of CommandService.
 *
 * Handles:
 * - Opening/closing the command palette
 * - Searching and filtering commands
 * - Keyboard navigation
 * - Command execution
 * - State subscriptions for UI reactivity
 */
export class CommandServiceImpl implements CommandService {
  private state: CommandPaletteState = { ...INITIAL_STATE };
  private subscribers: Set<(state: CommandPaletteState) => void> = new Set();
  private registry: CommandRegistryPort;

  constructor(registry: CommandRegistryPort) {
    this.registry = registry;
  }

  /**
   * Get command palette state.
   */
  getState(): CommandPaletteState {
    return { ...this.state };
  }

  /**
   * Open the command palette.
   */
  open(initialQuery?: string): void {
    const query = initialQuery ?? '';
    const results = this.searchCommands(query, this.state.filterCategory);

    this.updateState({
      isOpen: true,
      query,
      results,
      selectedIndex: 0,
    });
  }

  /**
   * Close the command palette.
   */
  close(): void {
    this.updateState({
      isOpen: false,
      query: '',
      results: [],
      selectedIndex: 0,
      filterCategory: null,
    });
  }

  /**
   * Toggle the command palette.
   */
  toggle(initialQuery?: string): void {
    if (this.state.isOpen) {
      this.close();
    } else {
      this.open(initialQuery);
    }
  }

  /**
   * Update search query.
   */
  search(query: string): void {
    const results = this.searchCommands(query, this.state.filterCategory);

    this.updateState({
      query,
      results,
      selectedIndex: Math.min(this.state.selectedIndex, Math.max(0, results.length - 1)),
    });
  }

  /**
   * Filter by category.
   */
  filterByCategory(category: CommandCategory | null): void {
    const results = this.searchCommands(this.state.query, category);

    this.updateState({
      filterCategory: category,
      results,
      selectedIndex: 0,
    });
  }

  /**
   * Select next command in the list.
   */
  selectNext(): void {
    const { results, selectedIndex } = this.state;
    if (results.length === 0) return;

    const newIndex = (selectedIndex + 1) % results.length;
    this.updateState({ selectedIndex: newIndex });
  }

  /**
   * Select previous command in the list.
   */
  selectPrevious(): void {
    const { results, selectedIndex } = this.state;
    if (results.length === 0) return;

    const newIndex = selectedIndex <= 0 ? results.length - 1 : selectedIndex - 1;
    this.updateState({ selectedIndex: newIndex });
  }

  /**
   * Select command at index.
   */
  selectIndex(index: number): void {
    if (index >= 0 && index < this.state.results.length) {
      this.updateState({ selectedIndex: index });
    }
  }

  /**
   * Execute the currently selected command.
   */
  async executeSelected(context: CommandContext): Promise<Result<void, Error>> {
    const { results, selectedIndex } = this.state;
    if (results.length === 0 || selectedIndex < 0 || selectedIndex >= results.length) {
      return err(new Error('No command selected'));
    }

    const selected = results[selectedIndex];
    if (!selected) return err(new Error('No command selected'));

    return this.executeCommand(selected.command, context);
  }

  /**
   * Execute command by ID.
   */
  async executeById(commandId: string, context: CommandContext): Promise<Result<void, Error>> {
    const command = this.registry.get(commandId);
    if (!command) {
      return err(new Error(`Command not found: ${commandId}`));
    }

    if (command.runWhen && !command.runWhen(context)) {
      return err(new Error(`Command not applicable in current scope: ${commandId}`));
    }

    return this.executeCommand(command, context);
  }

  /**
   * Get all available commands.
   */
  getAllCommands(): RegisteredCommand[] {
    return this.registry.getAll();
  }

  /**
   * Get commands grouped by category.
   */
  getGroupedCommands(): CommandGroup[] {
    const grouped = this.registry.getGrouped();
    const groups: CommandGroup[] = [];
    const seen = new Set<string>();

    for (const category of CATEGORY_ORDER) {
      if (grouped.has(category)) {
        groups.push({
          category,
          label: this.getCategoryLabel(category),
          commands: grouped.get(category)!,
        });
        seen.add(category);
      }
    }

    // Append any unknown / custom categories in insertion order.
    for (const [category, commands] of grouped) {
      if (!seen.has(category)) {
        groups.push({
          category: category as CommandCategory,
          label: this.getCategoryLabel(category as CommandCategory),
          commands,
        });
      }
    }

    return groups;
  }

  /**
   * Register a custom command.
   */
  registerCommand(command: RegisteredCommand): void {
    this.registry.register(command);

    // Refresh results if palette is open
    if (this.state.isOpen) {
      const results = this.searchCommands(this.state.query, this.state.filterCategory);
      this.updateState({ results });
    }
  }

  /**
   * Unregister a command.
   */
  unregisterCommand(commandId: string): void {
    this.registry.unregister(commandId);

    // Refresh results if palette is open
    if (this.state.isOpen) {
      const results = this.searchCommands(this.state.query, this.state.filterCategory);
      this.updateState({
        results,
        selectedIndex: Math.min(this.state.selectedIndex, Math.max(0, results.length - 1)),
      });
    }
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: (state: CommandPaletteState) => void): () => void {
    this.subscribers.add(callback);

    // Immediately call with current state
    callback(this.getState());

    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ========== Private methods ==========

  /**
   * Execute a command with context and close the palette.
   */
  private async executeCommand(
    command: RegisteredCommand,
    context: CommandContext
  ): Promise<Result<void, Error>> {
    // Close the palette first for better UX
    this.close();

    try {
      await command.execute(context);
      events.emit('command:executed', { commandId: command.id });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Search commands and return scored results.
   */
  private searchCommands(
    query: string,
    category: CommandCategory | null
  ): CommandSearchResult[] {
    let commands = this.registry.getAll();

    // Filter by category if specified
    if (category) {
      commands = commands.filter((cmd) => cmd.category === category);
    }

    // If no query, return all commands with default score
    if (!query.trim()) {
      return commands.map((command) => ({
        command,
        score: 1,
        matchedTerms: [],
      }));
    }

    // Score and filter commands based on query
    const normalizedQuery = query.toLowerCase().trim();
    const queryTerms = normalizedQuery.split(/\s+/);

    const results: CommandSearchResult[] = [];

    for (const command of commands) {
      const { score, matchedTerms } = this.scoreCommand(command, queryTerms);

      if (score > 0) {
        results.push({
          command,
          score,
          matchedTerms,
        });
      }
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Score a command against search terms.
   */
  private scoreCommand(
    command: RegisteredCommand,
    queryTerms: string[]
  ): { score: number; matchedTerms: string[] } {
    let score = 0;
    const matchedTerms: string[] = [];

    const commandId = command.id.toLowerCase();
    const commandLabel = command.label.toLowerCase();
    const keywords = command.keywords.map((k) => k.toLowerCase());

    for (const term of queryTerms) {
      // Exact match on ID (highest score)
      if (commandId === term) {
        score += 100;
        matchedTerms.push(term);
        continue;
      }

      // Prefix match on ID
      if (commandId.startsWith(term)) {
        score += 50;
        matchedTerms.push(term);
        continue;
      }

      // ID contains term
      if (commandId.includes(term)) {
        score += 30;
        matchedTerms.push(term);
        continue;
      }

      // Exact match on label
      if (commandLabel === term) {
        score += 80;
        matchedTerms.push(term);
        continue;
      }

      // Prefix match on label
      if (commandLabel.startsWith(term)) {
        score += 40;
        matchedTerms.push(term);
        continue;
      }

      // Label contains term
      if (commandLabel.includes(term)) {
        score += 25;
        matchedTerms.push(term);
        continue;
      }

      // Keyword match
      for (const keyword of keywords) {
        if (keyword === term) {
          score += 60;
          matchedTerms.push(term);
          break;
        }
        if (keyword.startsWith(term)) {
          score += 35;
          matchedTerms.push(term);
          break;
        }
        if (keyword.includes(term)) {
          score += 20;
          matchedTerms.push(term);
          break;
        }
      }
    }

    return { score, matchedTerms };
  }

  /**
   * Get display label for a category.
   */
  private getCategoryLabel(category: CommandCategory): string {
    const known = CATEGORY_LABELS[category];
    if (known) return known;
    // Fallback: title-case the category id
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  /**
   * Update state and notify subscribers.
   */
  private updateState(partial: Partial<CommandPaletteState>): void {
    this.state = { ...this.state, ...partial };
    this.notifySubscribers();
  }

  /**
   * Notify all subscribers of state change.
   */
  private notifySubscribers(): void {
    const state = this.getState();
    this.subscribers.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in CommandService subscriber:', error);
      }
    });
  }
}
