/**
 * Drag-Drop Plugin State
 *
 * Defines the state interface and initial values for block drag-and-drop.
 * Tracks dragging state, drop position, and visual indicators.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { PluginKey, type EditorState } from 'prosemirror-state';

/**
 * Position where a block can be dropped relative to another block.
 */
export type DropPosition = 'before' | 'after';

/**
 * State for the drag-drop plugin.
 */
export interface DragDropState {
  /** Whether a drag operation is in progress */
  isDragging: boolean;
  /** ID of the block being dragged */
  draggedBlockId: string | null;
  /** Position of the block being dragged (for calculation) */
  draggedBlockPos: number | null;
  /** Index of the target block for dropping */
  dropTargetIndex: number | null;
  /** Position relative to target block (before/after) */
  dropPosition: DropPosition | null;
  /** Document position for the drop indicator */
  dropIndicatorPos: number | null;
}

/**
 * Initial state for drag-drop plugin.
 */
export const INITIAL_STATE: DragDropState = {
  isDragging: false,
  draggedBlockId: null,
  draggedBlockPos: null,
  dropTargetIndex: null,
  dropPosition: null,
  dropIndicatorPos: null,
};

/**
 * Plugin key for accessing drag-drop state.
 */
export const dragDropKey = new PluginKey<DragDropState>('dragDrop');

/**
 * Get the current drag-drop state from editor state.
 *
 * @param state - The editor state
 * @returns The drag-drop plugin state
 */
export function getDragDropState(state: EditorState): DragDropState {
  return dragDropKey.getState(state) || INITIAL_STATE;
}

/**
 * Create a state update for starting a drag operation.
 */
export function createDragStartState(blockId: string, blockPos: number): Partial<DragDropState> {
  return {
    isDragging: true,
    draggedBlockId: blockId,
    draggedBlockPos: blockPos,
    dropTargetIndex: null,
    dropPosition: null,
    dropIndicatorPos: null,
  };
}

/**
 * Create a state update for updating the drop target.
 */
export function createDropTargetState(
  targetIndex: number,
  position: DropPosition,
  indicatorPos: number
): Partial<DragDropState> {
  return {
    dropTargetIndex: targetIndex,
    dropPosition: position,
    dropIndicatorPos: indicatorPos,
  };
}

/**
 * Create a state update for ending a drag operation.
 */
export function createDragEndState(): DragDropState {
  return { ...INITIAL_STATE };
}
