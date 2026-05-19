/**
 * History Plugin
 *
 * Configures undo/redo functionality for the editor.
 * Wraps prosemirror-history with project-specific configuration.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { history, undo, redo } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

/**
 * Configuration options for the history plugin.
 */
export interface HistoryPluginOptions {
  /**
   * Maximum number of history events to store.
   * @default 100
   */
  depth?: number;

  /**
   * Time (in ms) within which adjacent changes are grouped together.
   * Changes made within this time window will be undone together.
   * @default 500
   */
  newGroupDelay?: number;
}

/**
 * Default configuration for the history plugin.
 */
const defaultOptions: Required<HistoryPluginOptions> = {
  depth: 100,
  newGroupDelay: 500,
};

/**
 * Create a history plugin for the editor.
 *
 * The history plugin tracks changes to the document and allows
 * users to undo and redo changes. Changes made within the
 * newGroupDelay time window are grouped together.
 *
 * @param options - Configuration options for the history
 * @returns ProseMirror history plugin
 *
 * @example
 * ```typescript
 * import { historyPlugin } from './plugins/history';
 *
 * const plugins = [
 *   historyPlugin({ depth: 200, newGroupDelay: 300 }),
 *   // ... other plugins
 * ];
 * ```
 */
export function historyPlugin(options: HistoryPluginOptions = {}): Plugin {
  const mergedOptions: Required<HistoryPluginOptions> = {
    ...defaultOptions,
    ...options,
  };

  return history({
    depth: mergedOptions.depth,
    newGroupDelay: mergedOptions.newGroupDelay,
  });
}

/**
 * Create a keymap plugin for history shortcuts.
 *
 * Default shortcuts:
 * - Mod-z: Undo
 * - Mod-y / Mod-Shift-z: Redo
 *
 * @returns ProseMirror keymap plugin
 */
export function historyKeymap(): Plugin {
  return keymap({
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  });
}

/**
 * Undo command.
 * Reverts the last change in the history.
 */
export const undoCommand: Command = undo;

/**
 * Redo command.
 * Reapplies the last undone change.
 */
export const redoCommand: Command = redo;

/**
 * Check if the editor can undo.
 *
 * @param state - The editor state
 * @returns True if there are changes to undo
 */
export function canUndo(state: Parameters<typeof undo>[0]): boolean {
  return undo(state);
}

/**
 * Check if the editor can redo.
 *
 * @param state - The editor state
 * @returns True if there are undone changes to redo
 */
export function canRedo(state: Parameters<typeof redo>[0]): boolean {
  return redo(state);
}
