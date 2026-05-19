/**
 * Drag-Drop Plugin barrel export
 *
 * Block-level drag-and-drop functionality for the editor.
 */

// Main plugin
export {
  createDragDropPlugin,
  type DragDropPluginOptions,
} from './plugin';

// State types and utilities
export {
  dragDropKey,
  type DragDropState,
  type DropPosition,
  INITIAL_STATE,
  getDragDropState,
  createDragStartState,
  createDropTargetState,
  createDragEndState,
} from './state';

// Event handlers
export {
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  calculateDropPosition,
  BLOCK_DRAG_MIME,
  type BlockDragData,
} from './handlers';

// Drop indicator decorations and styles
export {
  createDropIndicatorDecorations,
  dropIndicatorStyles,
  DROP_INDICATOR_CLASS,
  BLOCK_DRAGGING_CLASS,
} from './dropIndicator';
