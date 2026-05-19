/**
 * Drag-Drop Event Handlers
 *
 * Handlers for drag events in the block editor.
 * Manages drag start, drag over, drop, and drag end events.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';
import {
  dragDropKey,
  type DragDropState,
  type DropPosition,
  createDragStartState,
  createDropTargetState,
  createDragEndState,
} from './state';
import { aiBlockKey } from '../aiBlock';

/**
 * MIME type for block drag data.
 */
export const BLOCK_DRAG_MIME = 'application/void-block';

/**
 * Data transferred during block drag operations.
 */
export interface BlockDragData {
  blockId: string;
  pos: number;
}

/**
 * Handle the start of a block drag operation.
 *
 * @param view - The editor view
 * @param blockId - ID of the block being dragged
 * @param pos - Position of the block in the document
 * @param event - The drag event
 */
export function handleDragStart(
  view: EditorView,
  blockId: string,
  pos: number,
  event: DragEvent
): void {
  if (!event.dataTransfer) return;
  if (aiBlockKey.getState(view.state)?.has(blockId)) {
    event.preventDefault();
    return;
  }

  // Set drag data
  const dragData: BlockDragData = { blockId, pos };
  event.dataTransfer.setData(BLOCK_DRAG_MIME, JSON.stringify(dragData));
  event.dataTransfer.effectAllowed = 'move';

  // Update plugin state
  const tr = view.state.tr.setMeta(dragDropKey, createDragStartState(blockId, pos));
  view.dispatch(tr);
}

/**
 * Calculate the drop position based on cursor coordinates.
 *
 * @param view - The editor view
 * @param clientX - Mouse X coordinate
 * @param clientY - Mouse Y coordinate
 * @param draggedBlockId - ID of the block being dragged
 * @returns Drop target info or null if invalid
 */
export function calculateDropPosition(
  view: EditorView,
  clientX: number,
  clientY: number,
  draggedBlockId: string | null
): {
  targetIndex: number;
  position: DropPosition;
  indicatorPos: number;
} | null {
  const { doc } = view.state;
  if (doc.childCount === 0) return null;

  // Build an in-order list of (index, pos, node) for top-level blocks.
  type Entry = { index: number; pos: number; node: PmNode };
  const entries: Entry[] = [];
  let i = 0;
  doc.forEach((node, pos) => {
    entries.push({ index: i++, pos, node });
  });
  const droppable = entries.filter(e => e.node.attrs?.id !== draggedBlockId);
  if (droppable.length === 0) return null;

  // ── Edge case 1: cursor ABOVE the first droppable block → drop at very top.
  const firstDom = view.nodeDOM(droppable[0]!.pos);
  if (firstDom instanceof HTMLElement) {
    const firstRect = firstDom.getBoundingClientRect();
    if (clientY < firstRect.top) {
      return {
        targetIndex: droppable[0]!.index,
        position: 'before',
        indicatorPos: droppable[0]!.pos,
      };
    }
  }

  // ── Edge case 2: cursor BELOW the last droppable block → drop at very end.
  const last = droppable[droppable.length - 1]!;
  const lastDom = view.nodeDOM(last.pos);
  if (lastDom instanceof HTMLElement) {
    const lastRect = lastDom.getBoundingClientRect();
    if (clientY > lastRect.bottom) {
      return {
        targetIndex: last.index,
        position: 'after',
        indicatorPos: last.pos + last.node.nodeSize,
      };
    }
  }

  // ── Normal case: ask ProseMirror which position the cursor maps to.
  const posInfo = view.posAtCoords({ left: clientX, top: clientY });
  let target: Entry | null = null;

  if (posInfo) {
    for (const e of entries) {
      const end = e.pos + e.node.nodeSize;
      if (posInfo.pos >= e.pos && posInfo.pos <= end && e.node.attrs?.id !== draggedBlockId) {
        target = e;
        break;
      }
    }
  }

  // ── Fallback: pick the droppable block whose vertical midpoint is closest
  // to the cursor. Covers cases where posAtCoords can't resolve (gutter area,
  // gaps between blocks, etc.) but the cursor is inside the editor body.
  if (!target) {
    let best: { entry: Entry; dist: number } | null = null;
    for (const e of droppable) {
      const dom = view.nodeDOM(e.pos);
      if (!(dom instanceof HTMLElement)) continue;
      const r = dom.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const dist = Math.abs(clientY - mid);
      if (!best || dist < best.dist) best = { entry: e, dist };
    }
    if (!best) return null;
    target = best.entry;
  }

  // Decide before/after based on cursor's vertical position vs. block midpoint.
  const targetDom = view.nodeDOM(target.pos);
  let position: DropPosition;
  if (targetDom instanceof HTMLElement) {
    const r = targetDom.getBoundingClientRect();
    position = clientY < r.top + r.height / 2 ? 'before' : 'after';
  } else if (posInfo) {
    const blockMidpoint = target.pos + target.node.nodeSize / 2;
    position = posInfo.pos < blockMidpoint ? 'before' : 'after';
  } else {
    position = 'after';
  }

  const indicatorPos = position === 'before' ? target.pos : target.pos + target.node.nodeSize;
  return { targetIndex: target.index, position, indicatorPos };
}

/**
 * Handle drag over event to update drop indicator.
 *
 * @param view - The editor view
 * @param event - The drag event
 * @returns Whether the event was handled
 */
export function handleDragOver(view: EditorView, event: DragEvent): boolean {
  event.preventDefault();

  // Check if this is a block drag
  if (!event.dataTransfer?.types.includes(BLOCK_DRAG_MIME)) {
    return false;
  }

  const state = dragDropKey.getState(view.state);
  const dropInfo = calculateDropPosition(
    view,
    event.clientX,
    event.clientY,
    state?.draggedBlockId ?? null
  );

  if (dropInfo) {
    const tr = view.state.tr.setMeta(
      dragDropKey,
      createDropTargetState(dropInfo.targetIndex, dropInfo.position, dropInfo.indicatorPos)
    );
    view.dispatch(tr);
  }

  return true;
}

/**
 * Handle drag leave event to clear drop indicator when leaving editor.
 *
 * @param view - The editor view
 * @param event - The drag event
 * @returns Whether the event was handled
 */
export function handleDragLeave(view: EditorView, event: DragEvent): boolean {
  // Only clear if leaving the editor entirely
  const relatedTarget = event.relatedTarget as HTMLElement | null;
  if (relatedTarget && view.dom.contains(relatedTarget)) {
    return false;
  }

  const tr = view.state.tr.setMeta(dragDropKey, {
    dropTargetIndex: null,
    dropPosition: null,
    dropIndicatorPos: null,
  });
  view.dispatch(tr);

  return false;
}

/**
 * Handle the drop event to move the block.
 *
 * @param view - The editor view
 * @param event - The drop event
 * @returns Whether the event was handled
 */
export function handleDrop(view: EditorView, event: DragEvent): boolean {
  event.preventDefault();

  // Get drag data
  const dataStr = event.dataTransfer?.getData(BLOCK_DRAG_MIME);
  if (!dataStr) return false;

  let dragData: BlockDragData;
  try {
    dragData = JSON.parse(dataStr) as BlockDragData;
  } catch {
    return false;
  }

  const pluginState = dragDropKey.getState(view.state);
  if (!pluginState || pluginState.dropIndicatorPos == null) return false;
  if (aiBlockKey.getState(view.state)?.has(dragData.blockId)) return false;

  const { doc } = view.state;

  // Find the source block
  let sourcePos = -1;
  let sourceNode: PmNode | null = null;

  doc.descendants((node: PmNode, pos: number) => {
    if (node.attrs.id === dragData.blockId) {
      sourcePos = pos;
      sourceNode = node;
      return false;
    }
    return true;
  });

  if (sourcePos === -1 || !sourceNode) return false;

  // Cast to non-null since we've checked above
  const srcNode = sourceNode as PmNode;
  const sourceEnd = sourcePos + srcNode.nodeSize;
  const targetPosRaw = pluginState.dropIndicatorPos;

  // No-op: dropped at the same position (right before or right after self).
  // Without this guard, delete+insert still runs and dirties history.
  if (targetPosRaw === sourcePos || targetPosRaw === sourceEnd) {
    const noop = view.state.tr.setMeta(dragDropKey, createDragEndState());
    view.dispatch(noop);
    return true;
  }

  // Adjust target position to account for the upcoming delete.
  // After delete(sourcePos, sourceEnd), any position >= sourceEnd shifts down by nodeSize.
  let targetPos = targetPosRaw;
  if (targetPos >= sourceEnd) {
    targetPos -= srcNode.nodeSize;
  }

  const tr = view.state.tr
    .delete(sourcePos, sourceEnd)
    .insert(targetPos, srcNode)
    .setMeta(dragDropKey, createDragEndState());

  view.dispatch(tr.scrollIntoView());

  return true;
}

/**
 * Handle the end of a drag operation (cleanup).
 *
 * @param view - The editor view
 */
export function handleDragEnd(view: EditorView): void {
  const tr = view.state.tr.setMeta(dragDropKey, createDragEndState());
  view.dispatch(tr);
}
