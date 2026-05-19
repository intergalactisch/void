/**
 * AI Shortcut Keymap
 *
 * Keyboard shortcuts for triggering AI operations on blocks:
 * - Cmd+Shift+R: Rewrite the current block
 * - Cmd+Shift+E: Expand/elaborate the current block
 *
 * These commands resolve the current block context (from block selection
 * or cursor position) and emit events for the AI sidebar/service to handle.
 *
 * Position 10 in the plugin stack (after mark formatting, before generic keymap).
 * Part of the ProseMirror infrastructure adapter.
 */

import { keymap } from 'prosemirror-keymap';
import type { Plugin, Command, EditorState } from 'prosemirror-state';
import { events } from '$lib/events';
import { resolveVisibleBlock, findVisibleBlock } from '../commands/blockUtils';
import { getBlockSelectionState } from './blockSelection';
import { aiBlockKey } from './aiBlock';

/**
 * Resolve the block ID, type name, and text content for AI operations.
 * Checks block selection first, then falls back to cursor position.
 * Returns null if the block is already AI-locked (prevents re-triggering).
 */
function resolveAIBlockContext(state: EditorState): {
  blockId: string;
  blockType: string;
  content: string;
} | null {
  const locks = aiBlockKey.getState(state);

  // Check block selection first
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 1) {
    const blockId = bsState.selectedIds[0];
    if (!blockId) return null;
    if (locks?.has(blockId)) return null;
    const block = findVisibleBlock(state.doc, blockId);
    if (!block) return null;
    const node = state.doc.nodeAt(block.pos);
    if (!node) return null;
    return {
      blockId,
      blockType: node.type.name,
      content: node.textContent,
    };
  }

  // Fall back to cursor position
  const resolved = resolveVisibleBlock(state.selection.$from);
  if (!resolved) return null;

  const blockId = resolved.node.attrs.id as string | undefined;
  if (!blockId) return null;
  if (locks?.has(blockId)) return null;

  return {
    blockId,
    blockType: resolved.node.type.name,
    content: resolved.node.textContent,
  };
}

/**
 * Cmd+Shift+R: Request AI rewrite of the current block.
 */
const rewriteBlock: Command = (state, dispatch) => {
  const ctx = resolveAIBlockContext(state);
  if (!ctx) return false;
  if (!ctx.content.trim()) return false;

  if (!dispatch) return true;

  events.emit('ai:rewrite-request', {
    blockId: ctx.blockId,
    blockType: ctx.blockType,
    content: ctx.content,
  });

  return true;
};

/**
 * Cmd+Shift+E: Request AI expand/elaborate on the current block.
 */
const expandBlock: Command = (state, dispatch) => {
  const ctx = resolveAIBlockContext(state);
  if (!ctx) return false;
  if (!ctx.content.trim()) return false;

  if (!dispatch) return true;

  events.emit('ai:expand-request', {
    blockId: ctx.blockId,
    blockType: ctx.blockType,
    content: ctx.content,
  });

  return true;
};

/**
 * Create the AI shortcut keymap plugin.
 */
export function createAIShortcutKeymap(): Plugin {
  return keymap({
    'Mod-Shift-r': rewriteBlock,
    'Mod-Shift-e': expandBlock,
  });
}
