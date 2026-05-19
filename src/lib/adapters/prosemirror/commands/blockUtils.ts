/**
 * Block Utilities
 *
 * Shared utilities for block-level operations. The key function is
 * `getVisibleBlockOrder()` which walks the ProseMirror doc tree
 * depth-first and collects all nodes that have a BlockNodeView
 * (i.e., every node the user sees as a "block" with a gutter).
 *
 * This is needed because the schema is nested (lists use
 * bulletList > listItem > paragraph), but the UI presents a
 * flat list of blocks. Multi-block selection, block movement,
 * and range resolution all need this flattened view.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Node as PmNode, ResolvedPos } from 'prosemirror-model';

/**
 * Metadata for a single visible block in document order.
 */
export interface VisibleBlock {
  /** Block ID (from the `id` attribute on the node) */
  blockId: string;
  /** Absolute position of the node in the document */
  pos: number;
  /** Node size (pos + nodeSize = end of node) */
  nodeSize: number;
  /** Nesting depth (0 = direct child of doc) */
  depth: number;
  /** The ProseMirror node type name */
  typeName: string;
}

/**
 * Node types that receive a BlockNodeView (and therefore a gutter).
 * These are the "visible blocks" from the user's perspective.
 *
 * Container nodes (bulletList, orderedList, toggle, table, tableRow)
 * are NOT included -- they are structural wrappers, not user-visible blocks.
 */
const VISIBLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'todoItem',
  'codeBlock',
  'horizontalRule',
  'image',
  // NOTE: blockquote and callout are NOT included — they have content: 'block+'
  // and act as containers. Their children (paragraphs) are the visible blocks.
]);

/**
 * Walk the document tree depth-first and collect all nodes that
 * the user sees as individual blocks (i.e., nodes with gutters).
 *
 * Returns an ordered array of VisibleBlock entries matching the
 * visual top-to-bottom order the user sees in the editor.
 *
 * @param doc - The ProseMirror document node
 * @returns Ordered list of visible blocks
 */
export function getVisibleBlockOrder(doc: PmNode): VisibleBlock[] {
  const result: VisibleBlock[] = [];

  function walk(node: PmNode, pos: number, depth: number): void {
    if (VISIBLE_BLOCK_TYPES.has(node.type.name)) {
      result.push({
        blockId: node.attrs.id ?? '',
        pos,
        nodeSize: node.nodeSize,
        depth,
        typeName: node.type.name,
      });
    }

    // Recurse into children to find nested visible blocks
    // (e.g., listItem inside bulletList, paragraph inside blockquote)
    node.forEach((child, offset) => {
      walk(child, pos + 1 + offset, depth + 1);
    });
  }

  // Start from doc's children (depth 0 = direct children of doc)
  doc.forEach((child, offset) => {
    walk(child, offset, 0);
  });

  return result;
}

/**
 * Find a visible block by its block ID.
 *
 * @param doc - The ProseMirror document node
 * @param blockId - The block ID to find
 * @returns The VisibleBlock entry, or null if not found
 */
export function findVisibleBlock(doc: PmNode, blockId: string): VisibleBlock | null {
  const blocks = getVisibleBlockOrder(doc);
  return blocks.find(b => b.blockId === blockId) ?? null;
}

/**
 * Get the visible block immediately before the given block in visual order.
 *
 * @param doc - The ProseMirror document node
 * @param blockId - The reference block ID
 * @returns The previous VisibleBlock, or null if at the start
 */
export function getPreviousVisibleBlock(doc: PmNode, blockId: string): VisibleBlock | null {
  const blocks = getVisibleBlockOrder(doc);
  const idx = blocks.findIndex(b => b.blockId === blockId);
  if (idx <= 0) return null;
  return blocks[idx - 1] ?? null;
}

/**
 * Get the visible block immediately after the given block in visual order.
 *
 * @param doc - The ProseMirror document node
 * @param blockId - The reference block ID
 * @returns The next VisibleBlock, or null if at the end
 */
export function getNextVisibleBlock(doc: PmNode, blockId: string): VisibleBlock | null {
  const blocks = getVisibleBlockOrder(doc);
  const idx = blocks.findIndex(b => b.blockId === blockId);
  if (idx === -1 || idx >= blocks.length - 1) return null;
  return blocks[idx + 1] ?? null;
}

/**
 * Resolve a contiguous range of visible blocks between two block IDs
 * (inclusive). Returns them in document order regardless of which ID
 * comes first in the arguments.
 *
 * Used by Shift+click range selection in the block selection plugin.
 *
 * @param doc - The ProseMirror document node
 * @param fromId - One end of the range
 * @param toId - Other end of the range
 * @returns Ordered array of VisibleBlock entries in the range, or empty if either ID not found
 */
export function resolveVisibleBlockRange(
  doc: PmNode,
  fromId: string,
  toId: string
): VisibleBlock[] {
  const blocks = getVisibleBlockOrder(doc);
  const fromIdx = blocks.findIndex(b => b.blockId === fromId);
  const toIdx = blocks.findIndex(b => b.blockId === toId);

  if (fromIdx === -1 || toIdx === -1) return [];

  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  return blocks.slice(start, end + 1);
}

/**
 * Given a resolved cursor position, find the nearest ancestor node
 * that is a visible block (has a BlockNodeView/gutter).
 *
 * Walks up from the cursor's depth to find the first node whose type
 * is in VISIBLE_BLOCK_TYPES. This handles the nested schema where
 * a cursor inside a list item's paragraph is at depth 3
 * (doc > bulletList > listItem > paragraph), and we want the listItem.
 *
 * @param $pos - A resolved position in the document
 * @returns The visible block info, or null if not found
 */
export function resolveVisibleBlock(
  $pos: ResolvedPos
): { pos: number; end: number; depth: number; node: PmNode } | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (VISIBLE_BLOCK_TYPES.has(node.type.name)) {
      return {
        pos: $pos.before(d),
        end: $pos.after(d),
        depth: d,
        node,
      };
    }
  }
  return null;
}
