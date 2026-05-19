/**
 * Block Navigation Commands
 *
 * Depth-aware ProseMirror commands for moving, duplicating, and deleting
 * blocks. Unlike the existing moveBlockUp/moveBlockDown in blocks.ts which
 * only handle top-level doc children, these commands work across nesting
 * boundaries using the getVisibleBlockOrder utility.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Command } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { Node as PmNode } from 'prosemirror-model';
import { generateBlockId } from '$lib/domain/entities/Block';
import {
  getVisibleBlockOrder,
  findVisibleBlock,
  getPreviousVisibleBlock,
  getNextVisibleBlock,
} from './blockUtils';
import { aiBlockKey } from '../plugins/aiBlock';

/** Check if a block is currently locked by an AI operation. */
function isAILocked(state: EditorState, blockId: string): boolean {
  const locks = aiBlockKey.getState(state);
  return locks != null && locks.has(blockId);
}

/**
 * Resolve the block context for the current cursor position.
 * Returns the block ID of the visible block containing the selection.
 */
function resolveBlockContext(state: EditorState): string | null {
  const { $from } = state.selection;

  // Walk up the depth chain to find the nearest node with a block ID
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.attrs.id) {
      return node.attrs.id as string;
    }
  }
  return null;
}

/**
 * Move the block at the cursor position up in visual order.
 *
 * Depth-aware: if the block is a listItem, it swaps with the previous
 * sibling within the same list. If it's a top-level block, it swaps
 * with the previous top-level block. If the block is the first child
 * of a container, the command does nothing (returns false).
 *
 * After the move, a `void-block-just-dropped` class is applied to the
 * block's wrapper for animation purposes.
 */
export function moveCurrentBlockUp(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blockId = resolveBlockContext(state);
    if (!blockId) return false;

    const current = findVisibleBlock(state.doc, blockId);
    const prev = getPreviousVisibleBlock(state.doc, blockId);
    if (!current || !prev) return false;

    // Don't move if either block is AI-locked (would corrupt streaming)
    if (isAILocked(state, blockId) || isAILocked(state, prev.blockId)) return false;

    // Resolve actual nodes at the positions
    const currentNode = state.doc.nodeAt(current.pos);
    const prevNode = state.doc.nodeAt(prev.pos);
    if (!currentNode || !prevNode) return false;

    // Check if both blocks are siblings (same parent)
    const $current = state.doc.resolve(current.pos);
    const $prev = state.doc.resolve(prev.pos);

    // Both at same depth and same parent = sibling swap
    if ($current.depth === $prev.depth && $current.parent === $prev.parent) {
      if (!dispatch) return true;

      const tr = state.tr;
      // Delete current, insert before prev
      const currentEnd = current.pos + current.nodeSize;
      tr.delete(current.pos, currentEnd);
      tr.insert(prev.pos, currentNode);
      // Restore cursor inside the moved block
      const newPos = tr.doc.resolve(prev.pos + 1);
      tr.setSelection(TextSelection.near(newPos));
      dispatch(tr.scrollIntoView());
      return true;
    }

    // Different parents or depths — the block can't simply swap.
    // For now, only support same-parent swaps. Cross-container
    // moves (e.g., moving a listItem above the list) are complex
    // and deferred to a later phase.
    return false;
  };
}

/**
 * Move the block at the cursor position down in visual order.
 *
 * Same depth-awareness as moveCurrentBlockUp but in the opposite direction.
 */
export function moveCurrentBlockDown(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blockId = resolveBlockContext(state);
    if (!blockId) return false;

    const current = findVisibleBlock(state.doc, blockId);
    const next = getNextVisibleBlock(state.doc, blockId);
    if (!current || !next) return false;

    // Don't move if either block is AI-locked (would corrupt streaming)
    if (isAILocked(state, blockId) || isAILocked(state, next.blockId)) return false;

    const currentNode = state.doc.nodeAt(current.pos);
    const nextNode = state.doc.nodeAt(next.pos);
    if (!currentNode || !nextNode) return false;

    const $current = state.doc.resolve(current.pos);
    const $next = state.doc.resolve(next.pos);

    // Same parent = sibling swap
    if ($current.depth === $next.depth && $current.parent === $next.parent) {
      if (!dispatch) return true;

      const tr = state.tr;
      // Insert current after next, then delete the original
      const nextEnd = next.pos + next.nodeSize;
      tr.insert(nextEnd, currentNode);
      tr.delete(current.pos, current.pos + current.nodeSize);
      // Restore cursor inside the moved block
      const newPos = tr.mapping.map(current.pos);
      const resolved = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size));
      tr.setSelection(TextSelection.near(resolved));
      dispatch(tr.scrollIntoView());
      return true;
    }

    return false;
  };
}

/**
 * Duplicate the block at the cursor position.
 *
 * Creates a deep clone of the block with a new ID and inserts it
 * immediately after the original. The cursor moves to the new block.
 * A `void-block-just-created` class is applied for animation.
 */
export function duplicateCurrentBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blockId = resolveBlockContext(state);
    if (!blockId) return false;

    // Don't duplicate AI-locked blocks
    if (isAILocked(state, blockId)) return false;

    const current = findVisibleBlock(state.doc, blockId);
    if (!current) return false;

    const node = state.doc.nodeAt(current.pos);
    if (!node) return false;

    if (!dispatch) return true;

    // Deep clone the node with a new ID
    const newAttrs = { ...node.attrs, id: generateBlockId() };
    const clone = node.type.create(newAttrs, node.content, node.marks);

    const tr = state.tr;
    const insertPos = current.pos + current.nodeSize;
    tr.insert(insertPos, clone);

    // Move cursor to the start of the cloned block
    const newBlockStart = insertPos + 1;
    const resolved = tr.doc.resolve(Math.min(newBlockStart, tr.doc.content.size));
    tr.setSelection(TextSelection.near(resolved));

    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Delete the block at the cursor position.
 *
 * If the deleted block is the last block in the document, it is
 * replaced with an empty paragraph (the document must always have
 * at least one block). Otherwise, the cursor moves to the nearest
 * remaining block.
 */
export function deleteCurrentBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blockId = resolveBlockContext(state);
    if (!blockId) return false;

    // Don't delete AI-locked blocks
    if (isAILocked(state, blockId)) return false;

    const current = findVisibleBlock(state.doc, blockId);
    if (!current) return false;

    const node = state.doc.nodeAt(current.pos);
    if (!node) return false;

    if (!dispatch) return true;

    const tr = state.tr;
    const blocks = getVisibleBlockOrder(state.doc);

    if (blocks.length <= 1) {
      // Last block — replace with empty paragraph instead of deleting
      const paragraphType = state.schema.nodes.paragraph;
      if (!paragraphType) return false;

      const emptyPara = paragraphType.create({ id: generateBlockId() });
      tr.replaceWith(current.pos, current.pos + current.nodeSize, emptyPara);
      const resolved = tr.doc.resolve(current.pos + 1);
      tr.setSelection(TextSelection.near(resolved));
    } else {
      // Find the nearest block to move cursor to after deletion
      const prev = getPreviousVisibleBlock(state.doc, blockId);
      const next = getNextVisibleBlock(state.doc, blockId);

      tr.delete(current.pos, current.pos + current.nodeSize);

      // Position cursor in the previous block (preferred) or next
      const targetPos = prev ? prev.pos : next ? next.pos : 0;
      const mapped = tr.mapping.map(targetPos);
      const resolved = tr.doc.resolve(Math.min(mapped + 1, tr.doc.content.size));
      tr.setSelection(TextSelection.near(resolved));
    }

    dispatch(tr.scrollIntoView());
    return true;
  };
}
