/**
 * Custom Pointer-Based Drag Manager
 *
 * Replaces HTML5 drag-and-drop, which is unreliable for `<div draggable=true>`
 * inside `contenteditable` regions in WebKit (Tauri's macOS WebView). Built on
 * mousedown / mousemove / mouseup, this gives full control over:
 *   - The visual ghost that follows the cursor
 *   - The "lifted source" state on the original block
 *   - Drop-target calculation (uses the existing `calculateDropPosition`)
 *   - Cancellation (Escape key) and edge cases (drop outside the editor)
 *
 * Public API: `startCustomDrag()` — called from `BlockNodeView` when the grip
 * mousedown crosses a movement threshold.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';
import {
  dragDropKey,
  createDragStartState,
  createDragEndState,
  createDropTargetState,
} from './state';
import { calculateDropPosition } from './handlers';

interface ActiveDrag {
  view: EditorView;
  blockId: string;
  /** Snapshot of the source position at drag start. The doc may not have changed yet. */
  sourcePos: number;
  sourceDom: HTMLElement;
  ghost: HTMLElement;
  ghostOffsetX: number;
  ghostOffsetY: number;
  /** AbortController for our document-level listeners. */
  abort: AbortController;
}

let active: ActiveDrag | null = null;

/**
 * Begin a custom drag. The caller has already detected mousedown + cursor
 * movement past the threshold. We immediately enter the visible drag state.
 */
export function startCustomDrag(
  view: EditorView,
  blockId: string,
  sourcePos: number,
  sourceDom: HTMLElement,
  triggerEvent: MouseEvent
): void {
  // Idempotency: if a previous drag is mid-flight, cancel it cleanly first.
  if (active) finishDrag(active, false);

  const ghost = createGhost(sourceDom);
  document.body.appendChild(ghost);

  // Position the ghost so the cursor lands on the grip's relative position
  // within the cloned content — feels like the cursor is holding the grip.
  const sourceRect = sourceDom.getBoundingClientRect();
  const ghostOffsetX = triggerEvent.clientX - sourceRect.left + 6;
  const ghostOffsetY = triggerEvent.clientY - sourceRect.top - 4;

  const abort = new AbortController();
  active = {
    view,
    blockId,
    sourcePos,
    sourceDom,
    ghost,
    ghostOffsetX,
    ghostOffsetY,
    abort,
  };

  // Visual state: lifted source, grabbing cursor, no text-selection
  sourceDom.classList.add('void-block--source-lifted');
  document.body.classList.add('void-dragging-active');

  // Tell the dragDrop plugin we're dragging, so it renders the indicator
  view.dispatch(view.state.tr.setMeta(dragDropKey, createDragStartState(blockId, sourcePos)));

  // Position the ghost at the cursor for the first frame
  positionGhost(ghost, triggerEvent.clientX, triggerEvent.clientY, ghostOffsetX, ghostOffsetY);
  // Trigger the entrance animation on the next frame
  requestAnimationFrame(() => ghost.classList.add('is-active'));

  // Document-level listeners — captured by AbortController for cleanup
  window.addEventListener('mousemove', onMouseMove, { signal: abort.signal });
  window.addEventListener('mouseup', onMouseUp, { signal: abort.signal });
  window.addEventListener('keydown', onKeyDown, { signal: abort.signal });
  // Defensively cancel if the user starts another drag elsewhere
  window.addEventListener('dragstart', onForeignDragStart, { signal: abort.signal });
}

function createGhost(sourceDom: HTMLElement): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'void-drag-ghost';

  // Clone the type label so the user can see WHAT they're dragging
  const labelEl = sourceDom.querySelector('.void-gutter-label');
  if (labelEl) {
    const labelClone = labelEl.cloneNode(true) as HTMLElement;
    labelClone.removeAttribute('class');
    labelClone.className = 'void-drag-ghost-label';
    ghost.appendChild(labelClone);
  }

  // Clone the visible content of the block
  const contentEl =
    sourceDom.querySelector('.void-block-content') ||
    sourceDom.querySelector('.void-todo-wrapper');
  if (contentEl) {
    const contentClone = contentEl.cloneNode(true) as HTMLElement;
    contentClone.classList.add('void-drag-ghost-content');
    ghost.appendChild(contentClone);
  }

  return ghost;
}

function positionGhost(
  ghost: HTMLElement,
  cursorX: number,
  cursorY: number,
  offsetX: number,
  offsetY: number
): void {
  // Use translate3d for compositor-accelerated movement (smooth at 60fps)
  ghost.style.transform = `translate3d(${cursorX - offsetX}px, ${cursorY - offsetY}px, 0) rotate(1.2deg)`;
}

function onMouseMove(e: MouseEvent): void {
  if (!active) return;
  e.preventDefault();

  positionGhost(active.ghost, e.clientX, e.clientY, active.ghostOffsetX, active.ghostOffsetY);

  // Recompute drop target on every move
  const dropInfo = calculateDropPosition(active.view, e.clientX, e.clientY, active.blockId);
  if (dropInfo) {
    active.view.dispatch(
      active.view.state.tr.setMeta(
        dragDropKey,
        createDropTargetState(dropInfo.targetIndex, dropInfo.position, dropInfo.indicatorPos)
      )
    );
  } else {
    // Cursor is outside any droppable region — clear the indicator
    active.view.dispatch(
      active.view.state.tr.setMeta(dragDropKey, {
        dropTargetIndex: null,
        dropPosition: null,
        dropIndicatorPos: null,
      })
    );
  }
}

function onMouseUp(e: MouseEvent): void {
  if (!active) return;
  finishDrag(active, true, e);
  active = null;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !active) return;
  e.preventDefault();
  finishDrag(active, false);
  active = null;
}

function onForeignDragStart(): void {
  if (!active) return;
  finishDrag(active, false);
  active = null;
}

/**
 * Tear down the active drag. If `commit` is true, execute the move;
 * otherwise just clean up state (used for Escape / abort).
 */
function finishDrag(drag: ActiveDrag, commit: boolean, mouseEvent?: MouseEvent): void {
  drag.abort.abort();

  drag.sourceDom.classList.remove('void-block--source-lifted');
  document.body.classList.remove('void-dragging-active');

  // Animate the ghost out, then remove
  drag.ghost.classList.remove('is-active');
  drag.ghost.classList.add('is-leaving');
  setTimeout(() => drag.ghost.remove(), 140);

  if (commit && mouseEvent) {
    executeDrop(drag, mouseEvent);
  }

  // Clear plugin state regardless
  drag.view.dispatch(drag.view.state.tr.setMeta(dragDropKey, createDragEndState()));
}

function executeDrop(drag: ActiveDrag, e: MouseEvent): void {
  const dropInfo = calculateDropPosition(drag.view, e.clientX, e.clientY, drag.blockId);
  if (!dropInfo) return;

  // Re-resolve the source by ID (the document may have shifted between
  // drag start and drop, e.g., due to streaming AI edits).
  const { doc } = drag.view.state;
  let sourcePos = -1;
  let srcNode: PmNode | null = null;
  doc.descendants((node, pos) => {
    if (sourcePos !== -1) return false;
    if (node.attrs?.id === drag.blockId) {
      sourcePos = pos;
      srcNode = node;
      return false;
    }
    return true;
  });
  if (sourcePos === -1 || !srcNode) return;

  const srcSize = (srcNode as PmNode).nodeSize;
  const sourceEnd = sourcePos + srcSize;
  const targetPosRaw = dropInfo.indicatorPos;

  // No-op: dropping at the start or end of self
  if (targetPosRaw === sourcePos || targetPosRaw === sourceEnd) return;

  let targetPos = targetPosRaw;
  if (targetPos >= sourceEnd) {
    targetPos -= srcSize;
  }

  const tr = drag.view.state.tr
    .delete(sourcePos, sourceEnd)
    .insert(targetPos, srcNode as PmNode);

  drag.view.dispatch(tr.scrollIntoView());
}

/**
 * Whether a custom drag is currently in progress. Useful for callers
 * to skip side-effects (focus changes, etc.) while dragging.
 */
export function isCustomDragActive(): boolean {
  return active !== null;
}
