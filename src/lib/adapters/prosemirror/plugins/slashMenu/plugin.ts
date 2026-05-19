/**
 * Slash Menu Plugin
 *
 * ProseMirror plugin that provides slash command functionality.
 * Combines state management and event handlers to create the
 * complete slash menu experience.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin } from 'prosemirror-state';
import { slashMenuKey, INITIAL_STATE, type SlashMenuState } from './state';
import { createSlashMenuHandlers, createSlashMenuReducer } from './handlers';
import type { CommandRegistryPort } from '$lib/ports/outbound';
import type { EditorPort } from '$lib/ports/outbound/EditorPort';

/**
 * Configuration options for the slash menu plugin.
 */
export interface SlashMenuPluginOptions {
  /**
   * The command registry to use for searching commands.
   */
  registry: CommandRegistryPort;

  /**
   * Optional function to get the EditorPort for command execution.
   * If not provided, commands that need editor access may not work.
   */
  getEditorPort?: () => EditorPort | null;

  /**
   * Callback when the menu state changes.
   * Useful for rendering the menu UI in Svelte.
   */
  onStateChange?: ((state: SlashMenuState) => void) | undefined;
}

/**
 * Create the slash menu plugin.
 *
 * This plugin provides:
 * - Detection of "/" trigger for opening the menu
 * - Keyboard navigation (arrow keys, enter, escape)
 * - State management for menu visibility and query
 * - Integration with command registry for searching
 *
 * @param options - Plugin configuration options
 * @returns ProseMirror plugin
 *
 * @example
 * ```typescript
 * import { createSlashMenuPlugin } from './plugins/slashMenu';
 * import { commandRegistry } from '$lib/adapters/commands';
 *
 * const plugins = [
 *   createSlashMenuPlugin({
 *     registry: commandRegistry,
 *     onStateChange: (state) => {
 *       // Update Svelte component
 *       slashMenuStore.set(state);
 *     },
 *   }),
 *   // ... other plugins
 * ];
 * ```
 */
export function createSlashMenuPlugin(options: SlashMenuPluginOptions): Plugin {
  const { registry, getEditorPort, onStateChange } = options;
  const handlers = createSlashMenuHandlers(registry, getEditorPort);
  const reducer = createSlashMenuReducer(registry);

  return new Plugin<SlashMenuState>({
    key: slashMenuKey,

    state: {
      init: () => INITIAL_STATE,
      apply(tr, pluginState, _oldState, newState) {
        const newPluginState = reducer(pluginState, tr, newState);

        // Notify state change if callback provided
        if (onStateChange && newPluginState !== pluginState) {
          // Use setTimeout to avoid dispatching during apply
          setTimeout(() => onStateChange(newPluginState), 0);
        }

        return newPluginState;
      },
    },

    props: {
      handleTextInput: handlers.handleTextInput,
      handleKeyDown: handlers.handleKeyDown,
    },
  });
}

// Re-export state types and helpers
export { slashMenuKey, INITIAL_STATE, getSlashMenuState } from './state';
export type { SlashMenuState } from './state';
