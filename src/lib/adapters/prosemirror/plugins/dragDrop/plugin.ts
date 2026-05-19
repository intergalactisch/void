/**
 * Drag-Drop Plugin
 *
 * ProseMirror plugin for block-level drag-and-drop functionality.
 * Enables Notion-style block reordering with visual drop indicators.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  dragDropKey,
  INITIAL_STATE,
  type DragDropState,
  createDragEndState,
} from './state';
import {
  handleDragOver,
  handleDragLeave,
  handleDrop,
} from './handlers';
import { createDropIndicatorDecorations } from './dropIndicator';

/**
 * Configuration options for the drag-drop plugin.
 */
export interface DragDropPluginOptions {
  /**
   * Whether to enable drag-drop functionality.
   * @default true
   */
  enabled?: boolean;

  /**
   * Callback when a block drag starts.
   */
  onDragStart?: (blockId: string) => void;

  /**
   * Callback when a block is dropped.
   */
  onDrop?: (blockId: string, fromIndex: number, toIndex: number) => void;
}

/**
 * Default configuration for the drag-drop plugin.
 */
const defaultOptions: Required<DragDropPluginOptions> = {
  enabled: true,
  onDragStart: () => {},
  onDrop: () => {},
};

/**
 * Create the drag-drop plugin for the editor.
 *
 * This plugin enables Notion-style block reordering:
 * - Shows drag handles on hover
 * - Displays drop indicator while dragging
 * - Moves blocks on drop
 *
 * @param options - Configuration options
 * @returns ProseMirror plugin
 *
 * @example
 * ```typescript
 * import { createDragDropPlugin } from './plugins/dragDrop';
 *
 * const plugins = [
 *   createDragDropPlugin({
 *     onDrop: (blockId, from, to) => {
 *       console.log(`Moved ${blockId} from ${from} to ${to}`);
 *     },
 *   }),
 * ];
 * ```
 */
export function createDragDropPlugin(options: DragDropPluginOptions = {}): Plugin {
  const mergedOptions: Required<DragDropPluginOptions> = {
    ...defaultOptions,
    ...options,
  };

  return new Plugin<DragDropState>({
    key: dragDropKey,

    state: {
      init(): DragDropState {
        return { ...INITIAL_STATE };
      },

      apply(tr, state): DragDropState {
        const meta = tr.getMeta(dragDropKey);

        if (meta) {
          // Handle state updates from meta
          const newState = { ...state, ...meta };

          // Check for full reset
          if (meta.isDragging === false && meta.draggedBlockId === null) {
            return createDragEndState();
          }

          return newState;
        }

        // If document changed during drag, we might need to update positions
        // For now, just keep the state as-is since positions are recalculated on dragover
        return state;
      },
    },

    props: {
      /**
       * Create decorations for drop indicator.
       */
      decorations: createDropIndicatorDecorations,

      /**
       * Handle DOM events for drag-drop.
       */
      handleDOMEvents: {
        /**
         * Handle dragover to update drop position.
         */
        dragover(view: EditorView, event: DragEvent): boolean {
          if (!mergedOptions.enabled) return false;
          return handleDragOver(view, event);
        },

        /**
         * Handle dragleave to clear indicator when leaving editor.
         */
        dragleave(view: EditorView, event: DragEvent): boolean {
          if (!mergedOptions.enabled) return false;
          return handleDragLeave(view, event);
        },

        /**
         * Handle drop to move the block.
         */
        drop(view: EditorView, event: DragEvent): boolean {
          if (!mergedOptions.enabled) return false;

          const result = handleDrop(view, event);

          if (result) {
            // Call the onDrop callback
            // Note: We'd need to track from/to indices for a complete implementation
            // For now, just signal that a drop occurred
            const state = dragDropKey.getState(view.state);
            if (state?.draggedBlockId) {
              mergedOptions.onDrop(
                state.draggedBlockId,
                -1, // Would need to track original index
                state.dropTargetIndex ?? -1
              );
            }
          }

          return result;
        },

        /**
         * Handle dragend to cleanup state.
         */
        dragend(view: EditorView): boolean {
          if (!mergedOptions.enabled) return false;

          const tr = view.state.tr.setMeta(dragDropKey, createDragEndState());
          view.dispatch(tr);

          return false;
        },
      },
    },
  });
}

// Re-export types and utilities
export { dragDropKey, type DragDropState } from './state';
export { handleDragStart, BLOCK_DRAG_MIME, type BlockDragData } from './handlers';
export { dropIndicatorStyles, DROP_INDICATOR_CLASS, BLOCK_DRAGGING_CLASS } from './dropIndicator';
