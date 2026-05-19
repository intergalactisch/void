/**
 * Page Link Plugin
 *
 * ProseMirror plugin that provides wiki-style [[link]] functionality.
 * Combines state management and event handlers to create the
 * complete page link autocomplete experience.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin } from 'prosemirror-state';
import { pageLinkKey, INITIAL_STATE, type PageLinkState } from './state';
import { createPageLinkHandlers, createPageLinkReducer, type NotesProvider } from './handlers';

/**
 * Configuration options for the page link plugin.
 */
export interface PageLinkPluginOptions {
  /**
   * The notes provider to use for searching notes.
   */
  notesProvider: NotesProvider;

  /**
   * Callback when the menu state changes.
   * Useful for rendering the menu UI in Svelte.
   */
  onStateChange?: ((state: PageLinkState) => void) | undefined;
}

/**
 * Create the page link plugin.
 *
 * This plugin provides:
 * - Detection of "[[" trigger for opening the menu
 * - Keyboard navigation (arrow keys, enter, escape)
 * - State management for menu visibility and query
 * - Integration with notes provider for searching
 *
 * @param options - Plugin configuration options
 * @returns ProseMirror plugin
 *
 * @example
 * ```typescript
 * import { createPageLinkPlugin } from './plugins/pageLink';
 *
 * const plugins = [
 *   createPageLinkPlugin({
 *     notesProvider: {
 *       searchNotes: (query) => notesStore.search(query),
 *       getAllNotes: () => notesStore.allNotes,
 *     },
 *     onStateChange: (state) => {
 *       // Update Svelte component
 *       pageLinkStore.set(state);
 *     },
 *   }),
 *   // ... other plugins
 * ];
 * ```
 */
export function createPageLinkPlugin(options: PageLinkPluginOptions): Plugin {
  const { notesProvider, onStateChange } = options;
  const handlers = createPageLinkHandlers(notesProvider);
  const reducer = createPageLinkReducer(notesProvider);

  return new Plugin<PageLinkState>({
    key: pageLinkKey,

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
export { pageLinkKey, INITIAL_STATE, getPageLinkState } from './state';
export type {
  PageLinkState,
  PageLinkNote,
  PageLinkMode,
  PageLinkMatchKind,
  PageLinkRelationHint,
  PageLinkSelectionRange,
} from './state';
export type { NotesProvider } from './handlers';
