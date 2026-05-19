/**
 * Drop Indicator Decorations
 *
 * Creates ProseMirror decorations to show where a block will be dropped.
 * Renders a visual line indicator at the drop position.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import { dragDropKey, type DragDropState } from './state';

/**
 * CSS class for the drop indicator element.
 */
export const DROP_INDICATOR_CLASS = 'void-drop-indicator';

/**
 * CSS class for when a block is being dragged.
 */
export const BLOCK_DRAGGING_CLASS = 'void-block-dragging';

/**
 * Create a drop indicator decoration at the specified position.
 *
 * @param pos - Document position for the indicator
 * @returns A ProseMirror decoration widget
 */
function createDropIndicatorDecoration(pos: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const indicator = document.createElement('div');
      indicator.className = DROP_INDICATOR_CLASS;
      indicator.setAttribute('aria-hidden', 'true');
      return indicator;
    },
    {
      key: `drop-indicator-${pos}`,
      side: -1, // Render before content at this position
    }
  );
}

/**
 * Create a decoration to dim the block being dragged.
 *
 * @param from - Start position of the block
 * @param to - End position of the block
 * @returns A ProseMirror node decoration
 */
function createDraggedBlockDecoration(from: number, to: number): Decoration {
  return Decoration.node(from, to, {
    class: BLOCK_DRAGGING_CLASS,
  });
}

/**
 * Find the position and size of a block by its ID.
 *
 * @param state - The editor state
 * @param blockId - The block ID to find
 * @returns Position info or null if not found
 */
function findBlockById(
  state: EditorState,
  blockId: string
): { pos: number; size: number } | null {
  let result: { pos: number; size: number } | null = null;

  state.doc.descendants((node, pos) => {
    if (result) return false;
    if (node.attrs.id === blockId) {
      result = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });

  return result;
}

/**
 * Create decorations for the drop indicator based on plugin state.
 *
 * @param state - The editor state
 * @returns A DecorationSet with the drop indicator (if dropping)
 */
export function createDropIndicatorDecorations(state: EditorState): DecorationSet {
  const pluginState: DragDropState | undefined = dragDropKey.getState(state);

  if (!pluginState?.isDragging) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  // Add drop indicator if we have a target
  if (pluginState.dropIndicatorPos !== null) {
    decorations.push(createDropIndicatorDecoration(pluginState.dropIndicatorPos));
  }

  // Add dimming decoration to the dragged block
  if (pluginState.draggedBlockId) {
    const blockInfo = findBlockById(state, pluginState.draggedBlockId);
    if (blockInfo) {
      decorations.push(
        createDraggedBlockDecoration(blockInfo.pos, blockInfo.pos + blockInfo.size)
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * CSS styles for the drop indicator.
 * Add these to your stylesheet or use Tailwind equivalents.
 *
 * The drop indicator is a horizontal line showing where the block will be inserted.
 */
export const dropIndicatorStyles = `
/* Drop indicator line */
.${DROP_INDICATOR_CLASS} {
  position: relative;
  height: 2px;
  margin: -1px 0;
  pointer-events: none;
}

.${DROP_INDICATOR_CLASS}::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-primary, #3b82f6);
  border-radius: 1px;
  box-shadow: 0 0 0 2px var(--color-primary-alpha, rgba(59, 130, 246, 0.2));
}

/* Circle indicator at the start of the line */
.${DROP_INDICATOR_CLASS}::after {
  content: '';
  position: absolute;
  top: -3px;
  left: -4px;
  width: 8px;
  height: 8px;
  background: var(--color-primary, #3b82f6);
  border-radius: 50%;
}

/* Dimmed state for the block being dragged */
.${BLOCK_DRAGGING_CLASS} {
  opacity: 0.4;
  pointer-events: none;
}

/* Wrapper styles for blocks with drag handles */
.void-block-wrapper {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.void-block-wrapper:hover .void-block-gutter {
  opacity: 1;
}

.void-block-gutter {
  position: absolute;
  left: -32px;
  top: 2px;
  display: flex;
  flex-direction: row;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.void-block-hover .void-block-gutter {
  opacity: 1;
}

.void-block-content {
  flex: 1;
  min-width: 0;
}

.void-block-inner {
  width: 100%;
}

/* Drag handle button */
.void-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-muted, #9ca3af);
  cursor: grab;
  border-radius: 4px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.void-drag-handle:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.05));
  color: var(--color-text-secondary, #6b7280);
}

.void-drag-handle:active {
  cursor: grabbing;
}

/* Menu trigger button */
.void-block-menu-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-muted, #9ca3af);
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.void-block-menu-trigger:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.05));
  color: var(--color-text-secondary, #6b7280);
}
`;
