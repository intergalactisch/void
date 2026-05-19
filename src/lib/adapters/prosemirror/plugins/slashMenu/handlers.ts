/**
 * Slash Menu Event Handlers
 *
 * Handles text input to detect "/" trigger and keyboard
 * navigation within the slash command menu.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { slashMenuKey, type SlashMenuState, INITIAL_STATE } from './state';
import type { CommandRegistryPort, CommandContext, RegisteredCommand } from '$lib/ports/outbound';
import type { EditorPort } from '$lib/ports/outbound/EditorPort';
import { clampToViewport } from '../positioning';

const CATEGORY_ORDER = ['basic', 'media', 'advanced', 'ai'] as const;
const CATEGORY_RANK = new Map<string, number>(
  CATEGORY_ORDER.map((category, index) => [category, index])
);

const CONVERT_COMMAND_IDS = new Set([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'numberedList',
  'todoItem',
  'blockquote',
  'codeBlock',
  'callout',
]);

/**
 * Keep the plugin's flat keyboard order aligned with the visual menu grouping.
 * Without this, commands can appear below the selected item visually while the
 * reducer thinks they are before it, which made ArrowDown appear to stop at Image.
 */
export function orderSlashCommands(
  commands: RegisteredCommand[],
  source: 'slash' | 'gutter' = 'slash'
): RegisteredCommand[] {
  const availableCommands = source === 'gutter'
    ? commands.filter((command) => !CONVERT_COMMAND_IDS.has(command.id))
    : commands;

  return availableCommands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => {
      const categoryDelta =
        (CATEGORY_RANK.get(a.command.category) ?? CATEGORY_ORDER.length) -
        (CATEGORY_RANK.get(b.command.category) ?? CATEGORY_ORDER.length);
      if (categoryDelta !== 0) return categoryDelta;

      return a.index - b.index;
    })
    .map(({ command }) => command);
}

/**
 * Meta action types for slash menu state updates.
 */
export type SlashMenuAction =
  | { type: 'OPEN'; triggerPos: number; coords: { top: number; left: number }; openAbove: boolean; source?: 'slash' | 'gutter'; blockType?: string }
  | { type: 'CLOSE' }
  | { type: 'UPDATE_QUERY'; query: string }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SELECT'; index: number };

/**
 * Create slash menu event handlers.
 *
 * @param registry - The command registry to search for commands
 * @param getEditorPort - Function to get the EditorPort for command execution
 * @returns Object with handleTextInput and handleKeyDown functions
 */
export function createSlashMenuHandlers(
  registry: CommandRegistryPort,
  getEditorPort?: () => EditorPort | null
) {
  return {
    /**
     * Handle text input - detect "/" trigger.
     *
     * The menu is triggered when:
     * - User types "/"
     * - At the start of a line OR after whitespace
     */
    handleTextInput(
      view: EditorView,
      from: number,
      to: number,
      text: string
    ): boolean {
      // Only trigger on "/"
      if (text !== '/') return false;

      const { state } = view;
      const $from = state.doc.resolve(from);

      // Get text before the cursor in the current parent
      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        null,
        '\ufffc'
      );

      // Check if "/" is at start of line or after whitespace
      if (textBefore.length > 0 && !/\s$/.test(textBefore)) {
        return false;
      }

      // Get coordinates for menu positioning
      const rawCoords = view.coordsAtPos(from);
      const { top, left, openAbove } = clampToViewport(rawCoords, {
        menuWidth: 280,
        menuHeight: 400,
      });

      // Open the menu via transaction meta
      const tr = state.tr.setMeta(slashMenuKey, {
        type: 'OPEN',
        triggerPos: from,
        coords: { top, left },
        openAbove,
      } as SlashMenuAction);

      view.dispatch(tr);

      // Let ProseMirror handle the actual "/" character insertion
      return false;
    },

    /**
     * Handle keyboard navigation within the menu.
     *
     * Handles:
     * - ArrowDown: Select next command
     * - ArrowUp: Select previous command
     * - Enter/Tab: Execute selected command
     * - Escape: Close menu
     * - Backspace: Close if deleting the "/"
     */
    handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
      const menuState = slashMenuKey.getState(view.state);
      if (!menuState?.isOpen) return false;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(slashMenuKey, { type: 'NEXT' } as SlashMenuAction)
          );
          return true;
        }

        case 'ArrowUp': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(slashMenuKey, { type: 'PREV' } as SlashMenuAction)
          );
          return true;
        }

        case 'Enter':
        case 'Tab': {
          event.preventDefault();

          // Handle AI prompt mode - trigger inline generation
          if (menuState.isAIPromptMode && menuState.aiPrompt) {
            const { triggerPos, query } = menuState;
            const deleteEnd = triggerPos + 1 + query.length;

            const tr = view.state.tr
              .delete(triggerPos, deleteEnd)
              .setMeta(slashMenuKey, { type: 'CLOSE' } as SlashMenuAction);

            // Set cursor explicitly after deletion
            const aiMappedPos = tr.mapping.map(triggerPos);
            const $aiPos = tr.doc.resolve(aiMappedPos);
            tr.setSelection(TextSelection.near($aiPos));

            view.dispatch(tr);

            const editorPort = getEditorPort?.();
            if (editorPort) {
              editorPort.execute('aiInlineGenerate', menuState.aiPrompt);
            }
            return true;
          }

          const cmd = menuState.filteredCommands[menuState.selectedIndex];
          if (cmd) {
            // Use the unified execution path (same as click selection)
            const editorPort = getEditorPort?.();
            if (editorPort && 'executeSlashMenuCommand' in editorPort) {
              (editorPort as { executeSlashMenuCommand: (cmd: RegisteredCommand) => void }).executeSlashMenuCommand(cmd);
            }
          }
          return true;
        }

        case 'Escape': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(slashMenuKey, { type: 'CLOSE' } as SlashMenuAction)
          );
          return true;
        }

        case 'Backspace': {
          // Close if we're about to delete the "/"
          if (menuState.query.length === 0) {
            // Let ProseMirror handle the backspace, but close the menu
            view.dispatch(
              view.state.tr.setMeta(slashMenuKey, { type: 'CLOSE' } as SlashMenuAction)
            );
          }
          return false;
        }

        default:
          return false;
      }
    },
  };
}

/**
 * Create the state reducer for slash menu.
 *
 * This reducer handles:
 * - Meta actions (OPEN, CLOSE, UPDATE_QUERY, NEXT, PREV, SELECT)
 * - Document changes (to update query as user types)
 *
 * @param registry - The command registry for searching commands
 * @returns Reducer function for processing transactions
 */
export function createSlashMenuReducer(registry: CommandRegistryPort) {
  return function reducer(
    state: SlashMenuState,
    tr: Transaction,
    editorState: EditorState
  ): SlashMenuState {
    const meta = tr.getMeta(slashMenuKey) as SlashMenuAction | undefined;

    if (meta) {
      switch (meta.type) {
        case 'OPEN':
          return {
            ...INITIAL_STATE,
            isOpen: true,
            triggerPos: meta.triggerPos,
            coords: meta.coords,
            openAbove: meta.openAbove,
            filteredCommands: orderSlashCommands(registry.getAll(), meta.source ?? 'slash'),
            source: meta.source ?? 'slash',
            blockType: meta.blockType ?? '',
          };

        case 'CLOSE':
          return INITIAL_STATE;

        case 'UPDATE_QUERY': {
          const filtered = orderSlashCommands(registry.search(meta.query), state.source);
          return {
            ...state,
            query: meta.query,
            filteredCommands: filtered,
            selectedIndex: Math.min(
              state.selectedIndex,
              Math.max(0, filtered.length - 1)
            ),
          };
        }

        case 'NEXT':
          if (state.filteredCommands.length === 0) return state;
          return {
            ...state,
            selectedIndex: (state.selectedIndex + 1) % state.filteredCommands.length,
          };

        case 'PREV':
          if (state.filteredCommands.length === 0) return state;
          return {
            ...state,
            selectedIndex:
              (state.selectedIndex - 1 + state.filteredCommands.length) %
              state.filteredCommands.length,
          };

        case 'SELECT':
          return {
            ...state,
            selectedIndex: Math.min(
              Math.max(0, meta.index),
              state.filteredCommands.length - 1
            ),
          };
      }
    }

    // Update query based on document changes when menu is open
    if (state.isOpen && tr.docChanged) {
      try {
        // Resolve the position after the slash
        const doc = tr.doc;
        const mappedTriggerPos = tr.mapping.map(state.triggerPos, -1);
        const $pos = doc.resolve(mappedTriggerPos);

        // Calculate positions relative to parent
        const startOffset = mappedTriggerPos - $pos.start();
        const currentOffset = $pos.parentOffset;

        // Get text after the slash up to cursor
        if (startOffset >= 0 && currentOffset >= startOffset) {
          const textAfterSlash = $pos.parent.textBetween(
            startOffset + 1, // +1 to skip the "/"
            $pos.parent.content.size,
            null,
            '\ufffc'
          );

          // Check for AI prompt mode: "ai " + at least one non-space char
          const aiPromptMatch = textAfterSlash.match(/^ai\s+(\S.*)/);

          if (aiPromptMatch) {
            return {
              ...state,
              triggerPos: mappedTriggerPos,
              query: textAfterSlash,
              aiPrompt: aiPromptMatch[1] ?? '',
              isAIPromptMode: true,
              filteredCommands: [],
              selectedIndex: 0,
            };
          }

          // Extract query (text after / until space or end)
          const match = textAfterSlash.match(/^(\S*)/);
          const query = match?.[1] ?? '';

          // Only update if query changed
          if (query !== state.query) {
            const filtered = orderSlashCommands(registry.search(query), state.source);
            return {
              ...state,
              triggerPos: mappedTriggerPos,
              query,
              filteredCommands: filtered,
              selectedIndex: 0,
              isAIPromptMode: false,
              aiPrompt: '',
            };
          }

          // Update trigger position even if query unchanged
          return {
            ...state,
            triggerPos: mappedTriggerPos,
          };
        }
      } catch {
        // Position resolution failed, close menu
        return INITIAL_STATE;
      }
    }

    return state;
  };
}
