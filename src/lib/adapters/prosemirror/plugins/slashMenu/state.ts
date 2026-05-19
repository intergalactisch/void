/**
 * Slash Menu Plugin State
 *
 * Manages the state for the slash command menu, including
 * whether it's open, the current query, filtered commands,
 * and positioning information.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { PluginKey } from 'prosemirror-state';
import type { RegisteredCommand } from '$lib/ports/outbound';

/**
 * State shape for the slash menu plugin.
 */
export interface SlashMenuState {
  /** Whether menu is open */
  isOpen: boolean;
  /** Current search query (text after /) */
  query: string;
  /** Position where / was typed */
  triggerPos: number;
  /** Currently selected command index */
  selectedIndex: number;
  /** Filtered commands matching query */
  filteredCommands: RegisteredCommand[];
  /** DOM coordinates for positioning the menu popup */
  coords: { top: number; left: number } | null;
  /** Whether menu opens above the cursor (when near bottom of viewport) */
  openAbove: boolean;
  /** Whether in AI prompt mode (query matches "ai <prompt>") */
  isAIPromptMode: boolean;
  /** The AI prompt text (everything after "ai ") */
  aiPrompt: string;
  /** How the menu was opened: typing "/" or clicking the gutter button */
  source: 'slash' | 'gutter';
  /** The block type name when opened from gutter (e.g. 'paragraph', 'heading') */
  blockType: string;
}

/**
 * Initial state for the slash menu.
 * Menu starts closed with no query or commands.
 */
export const INITIAL_STATE: SlashMenuState = {
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
 * Plugin key for accessing slash menu state.
 * Use this to retrieve the current slash menu state from the editor state.
 *
 * @example
 * ```typescript
 * const menuState = slashMenuKey.getState(editorState);
 * if (menuState?.isOpen) {
 *   // Render the slash menu
 * }
 * ```
 */
export const slashMenuKey = new PluginKey<SlashMenuState>('slashMenu');

/**
 * Helper to safely get slash menu state from editor state.
 *
 * @param state - The ProseMirror editor state
 * @returns The slash menu state or initial state if not found
 */
export function getSlashMenuState(state: unknown): SlashMenuState {
  const pluginState = slashMenuKey.getState(state as Parameters<typeof slashMenuKey.getState>[0]);
  return pluginState || INITIAL_STATE;
}
