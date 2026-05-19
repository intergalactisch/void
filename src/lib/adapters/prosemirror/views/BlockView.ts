/**
 * BlockView - NodeView with block handle gutter
 *
 * ProseMirror NodeView that wraps block nodes with:
 * 1. "+" button to insert a new block below and open slash menu
 * 2. Grip handle for drag-reorder + click for block menu
 * 3. Hover states and block type data attributes for CSS indicators
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { handleDragStart, BLOCK_DRAG_MIME } from '../plugins/dragDrop';
import { slashMenuKey } from '../plugins/slashMenu';
import { clampToViewport } from '../plugins/positioning';
import { generateBlockId } from '$lib/domain/entities/Block';

/**
 * Options for configuring BlockView behavior.
 */
export interface BlockViewOptions {
  onDragStart?: (blockId: string, event: DragEvent) => void;
  onMenuClick?: (blockId: string, event: MouseEvent) => void;
}

/**
 * SVG icon for the grip handle (6-dot pattern).
 */
const GRIP_ICON = `
<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
  <circle cx="4" cy="3" r="1.5"/>
  <circle cx="10" cy="3" r="1.5"/>
  <circle cx="4" cy="7" r="1.5"/>
  <circle cx="10" cy="7" r="1.5"/>
  <circle cx="4" cy="11" r="1.5"/>
  <circle cx="10" cy="11" r="1.5"/>
</svg>
`;

/**
 * SVG icon for the "+" add button.
 */
const ADD_ICON = `
<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
  <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
</svg>
`;

/**
 * Map node type to the data-block-type CSS attribute value.
 */
function getBlockTypeName(node: ProseMirrorNode): string {
  if (node.type.name === 'heading') {
    return `heading${node.attrs.level}`;
  }
  return node.type.name;
}

export class BlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private addButton: HTMLButtonElement;
  private gripHandle: HTMLButtonElement;
  private gutter: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private options: BlockViewOptions = {}
  ) {
    // Wrapper
    this.dom = document.createElement('div');
    this.dom.className = 'void-block-wrapper';
    this.dom.setAttribute('data-block-id', this.blockId);
    this.dom.setAttribute('data-block-type', getBlockTypeName(this.node));

    // Gutter: "+" button + grip handle
    this.gutter = document.createElement('div');
    this.gutter.className = 'void-block-gutter';

    // "+" add button
    this.addButton = document.createElement('button');
    this.addButton.className = 'void-block-add-btn';
    this.addButton.setAttribute('type', 'button');
    this.addButton.setAttribute('aria-label', 'Add block below');
    this.addButton.innerHTML = ADD_ICON;

    // Grip handle (click = menu, drag = reorder)
    this.gripHandle = document.createElement('button');
    this.gripHandle.className = 'void-block-grip';
    this.gripHandle.setAttribute('draggable', 'true');
    this.gripHandle.setAttribute('type', 'button');
    this.gripHandle.setAttribute('aria-label', 'Drag to move, click for menu');
    this.gripHandle.innerHTML = GRIP_ICON;

    this.gutter.appendChild(this.addButton);
    this.gutter.appendChild(this.gripHandle);

    // Content DOM - where ProseMirror renders the actual node content
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'void-block-content';

    this.dom.appendChild(this.gutter);
    this.dom.appendChild(this.contentDOM);

    this.setupEventListeners();
    this.setupStickyGutter();
  }

  private get blockId(): string {
    return (this.node.attrs.id as string) || '';
  }

  private setupEventListeners(): void {
    // "+" button: insert paragraph below + open slash menu
    this.addButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.insertBlockAndOpenSlashMenu();
    });

    // Grip: drag to reorder
    this.gripHandle.addEventListener('dragstart', (event) => {
      const pos = this.getPos();
      if (pos === undefined) return;

      event.dataTransfer?.setData(
        BLOCK_DRAG_MIME,
        JSON.stringify({ blockId: this.blockId, pos })
      );

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }

      this.dom.classList.add('void-block-dragging');
      handleDragStart(this.view, this.blockId, pos, event);
      this.options.onDragStart?.(this.blockId, event);
    });

    this.gripHandle.addEventListener('dragend', () => {
      this.dom.classList.remove('void-block-dragging');
    });

    // Grip: click to open block menu
    this.gripHandle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onMenuClick?.(this.blockId, event);
    });

    // Hover states
    this.dom.addEventListener('mouseenter', () => {
      this.dom.classList.add('void-block-hover');
    });

    this.dom.addEventListener('mouseleave', () => {
      this.dom.classList.remove('void-block-hover');
    });

    // Prevent gutter buttons from stealing editor focus
    this.addButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.gripHandle.addEventListener('mousedown', (e) => e.preventDefault());
  }

  /**
   * Insert a new empty paragraph after this block and open the slash menu.
   */
  private insertBlockAndOpenSlashMenu(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const blockEnd = pos + this.node.nodeSize;
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return;

    // Insert new empty paragraph
    const newParagraph = paragraphType.create({ id: generateBlockId() });
    let tr = state.tr.insert(blockEnd, newParagraph);

    // Set cursor inside the new paragraph
    const cursorPos = blockEnd + 1; // +1 to be inside the paragraph
    tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos));

    this.view.dispatch(tr);
    this.view.focus();

    // Now open the slash menu at the cursor position
    requestAnimationFrame(() => {
      const rawCoords = this.view.coordsAtPos(cursorPos);
      const { top, left, openAbove } = clampToViewport(rawCoords, {
        menuWidth: 280,
        menuHeight: 400,
      });

      const slashTr = this.view.state.tr.setMeta(slashMenuKey, {
        type: 'OPEN',
        triggerPos: cursorPos,
        coords: { top, left },
        openAbove,
      });
      this.view.dispatch(slashTr);
    });
  }

  private setupStickyGutter(): void {
    const HYSTERESIS = 50;
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        const threshold = window.innerHeight;
        const isSticky = this.gutter.classList.contains('void-gutter-sticky');
        if (!isSticky && h > threshold) {
          this.gutter.classList.add('void-gutter-sticky');
        } else if (isSticky && h < threshold - HYSTERESIS) {
          this.gutter.classList.remove('void-gutter-sticky');
        }
      }
    });
    this.resizeObserver.observe(this.dom);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.dom.setAttribute('data-block-id', this.blockId);
    this.dom.setAttribute('data-block-type', getBlockTypeName(node));

    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;

    if (
      target === this.addButton ||
      target === this.gripHandle ||
      this.addButton.contains(target) ||
      this.gripHandle.contains(target)
    ) {
      return true;
    }

    return false;
  }

  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    const target = mutation.target as HTMLElement;

    if (
      target === this.gutter ||
      target === this.addButton ||
      target === this.gripHandle ||
      this.gutter.contains(target)
    ) {
      return true;
    }

    return false;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}

/**
 * Factory function to create BlockView instances for nodeViews config.
 */
export function createBlockViewFactory(
  options: BlockViewOptions = {}
): (
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined
) => BlockView {
  return (node, view, getPos) => new BlockView(node, view, getPos, options);
}
