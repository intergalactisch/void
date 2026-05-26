/**
 * BlockNodeView - Unified NodeView for all block types
 *
 * Replaces BlockView, TodoItemView, and CodeBlockView with a single view that:
 * 1. Renders a gutter with type label (default) / drag handle + slash button (hover)
 * 2. Handles block-specific content rendering (todo checkbox, code header, etc.)
 * 3. Supports CSS-driven hover crossfade, AI lock states, and block selection
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { startCustomDrag } from '../plugins/dragDrop/customDrag';
import { slashMenuKey } from '../plugins/slashMenu';
import { clampToViewport } from '../plugins/positioning';
import { aiBlockKey } from '../plugins/aiBlock';
import {
  buildCodeFence,
  normalizeCodeLanguageLabel,
  parseCodeBlockDisplayOptions,
  parseCodeFenceInfo,
  updateCodeFenceMeta,
} from '$lib/core/codeFence';

// ── Types ──────────────────────────────────────────────────────────────

export type TodoToggleCallback = (blockId: string, content: string, checked: boolean) => void;

export interface BlockNodeViewOptions {
  onMenuClick?: (blockId: string, lineIndex: number, event: MouseEvent) => void;
  onTypeLabelClick?: (
    blockId: string,
    lineIndex: number,
    event: MouseEvent,
    position: { top: number; left: number; openAbove?: boolean; maxHeight?: number },
  ) => void;
  onLineageClick?: (blockId: string, lineIndex: number, event: MouseEvent) => void;
  onDragStart?: (blockId: string, event: DragEvent) => void;
  onTodoToggle?: TodoToggleCallback;
  resolveImageSrc?: (src: string) => string | Promise<string>;
}

export const IMAGE_BLOCK_UI_EVENT = 'void:image-block-ui';

export interface ImageBlockAttrsUpdate {
  src?: string;
  alt?: string | null;
  title?: string | null;
  caption?: string | null;
  width?: number | null;
}

export interface ImageBlockToolbarRequest {
  blockId: string;
  src: string;
  alt: string | null;
  title: string | null;
  caption: string | null;
  width: number | null;
  rect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

// ── SVG Icons ──────────────────────────────────────────────────────────

/** 6-dot grip — drag-handle affordance. Larger dots than usual for clearer hit. */
const GRIP_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="3" r="1.4"/>
  <circle cx="9" cy="3" r="1.4"/>
  <circle cx="5" cy="7" r="1.4"/>
  <circle cx="9" cy="7" r="1.4"/>
  <circle cx="5" cy="11" r="1.4"/>
  <circle cx="9" cy="11" r="1.4"/>
</svg>`;

/** Plus icon — opens the slash menu for insert/media/AI actions. */
const PLUS_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
  <path d="M7 2.5v9M2.5 7h9"/>
</svg>`;

/** 4-pointed sparkle icon for AI gutter indicator */
const SPARKLE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M8 1.5l1.3 4.2L13.5 7l-4.2 1.3L8 12.5l-1.3-4.2L2.5 7l4.2-1.3z"/>
  <path d="M12 0.5l0.5 1.5L14 2.5l-1.5 0.5L12 4.5l-0.5-1.5L10 2.5l1.5-0.5z" opacity="0.5"/>
</svg>`;

// ── Type Labels ────────────────────────────────────────────────────────

function getTypeLabel(node: ProseMirrorNode, parentListType?: string): string {
  switch (node.type.name) {
    case 'paragraph':
      return 'P';
    case 'heading':
      return `H${node.attrs.level}`;
    case 'listItem':
      return parentListType === 'orderedList' ? 'OL' : 'UL';
    case 'todoItem':
      return 'TD';
    case 'blockquote':
      return 'BQ';
    case 'codeBlock':
      return 'CD';
    case 'horizontalRule':
      return 'HR';
    case 'callout':
      return 'CO';
    case 'image':
      return 'IM';
    default:
      return 'P';
  }
}

function getBlockTypeName(node: ProseMirrorNode, parentListType?: string): string {
  if (node.type.name === 'heading') {
    return `heading${node.attrs.level}`;
  }
  if (node.type.name === 'listItem') {
    return parentListType === 'orderedList' ? 'numberedList' : 'bulletList';
  }
  return node.type.name;
}

// ── BlockNodeView ──────────────────────────────────────────────────────

export class BlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null;

  private gutterEl: HTMLElement;
  private labelEl: HTMLButtonElement;
  private dragBtn: HTMLElement;
  private slashBtn: HTMLButtonElement;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private options: BlockNodeViewOptions;
  private parentListType: string | undefined;

  // Code block specific
  private headerEl?: HTMLDivElement;
  private codeInfoEl?: HTMLDivElement;
  private langEl?: HTMLSpanElement;
  private titleEl?: HTMLSpanElement;
  private metaEl?: HTMLSpanElement;
  private copyBtn?: HTMLButtonElement;
  private copyFenceBtn?: HTMLButtonElement;
  private wrapBtn?: HTMLButtonElement;
  private lineNumbersBtn?: HTMLButtonElement;
  private codeShellEl?: HTMLDivElement;
  private preEl?: HTMLPreElement;
  private lineNumberEl?: HTMLDivElement;
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  // Todo specific
  private checkboxEl?: HTMLDivElement;

  // Image specific
  private imageFigureEl?: HTMLElement;
  private imageEl?: HTMLImageElement;
  private imageCaptionEl?: HTMLElement;
  private imagePlaceholderEl?: HTMLElement;

  // Sticky gutter for tall blocks
  private resizeObserver: ResizeObserver | null = null;

  // AI state DOM
  private aiGutterIcon: HTMLDivElement;
  private aiStreamOverlay: HTMLDivElement;
  private aiActionBar: HTMLDivElement;
  private aiAcceptBtn: HTMLButtonElement;
  private aiRejectBtn: HTMLButtonElement;

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: BlockNodeViewOptions = {},
    parentListType?: string
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;
    this.parentListType = parentListType;

    const typeName = node.type.name;

    // ── Outer wrapper ──
    this.dom = document.createElement(typeName === 'listItem' ? 'li' : 'div');
    this.dom.className = 'void-block';
    this.dom.setAttribute('data-block-id', this.blockId);
    this.dom.setAttribute('data-block-type', getBlockTypeName(node, parentListType));

    // Set nesting depth for list items so CSS can indent content (not gutter)
    if (typeName === 'listItem') {
      const pos = getPos();
      if (pos !== undefined) {
        const resolved = view.state.doc.resolve(pos);
        let depth = 0;
        for (let d = resolved.depth; d > 0; d--) {
          const name = resolved.node(d).type.name;
          if (name === 'bulletList' || name === 'orderedList') depth++;
        }
        this.dom.style.setProperty('--indent-level', String(depth));
      }
    }

    // ── Gutter (contenteditable=false so cursor can't enter) ──
    this.gutterEl = document.createElement('div');
    this.gutterEl.className = 'void-gutter';
    this.gutterEl.setAttribute('contenteditable', 'false');

    this.labelEl = document.createElement('button');
    this.labelEl.className = 'void-gutter-label';
    this.labelEl.setAttribute('type', 'button');
    this.labelEl.setAttribute('aria-label', `Change block type from ${getTypeLabel(node, parentListType)}`);
    this.labelEl.setAttribute('title', 'Change block type');
    this.labelEl.textContent = getTypeLabel(node, parentListType);

    // <div> with role="button". We do NOT use HTML5 draggable — drag is
    // handled by our custom pointer-event manager (more reliable in WebKit
    // + contenteditable than the native HTML5 drag API).
    this.dragBtn = document.createElement('div');
    this.dragBtn.className = 'void-gutter-drag';
    this.dragBtn.setAttribute('role', 'button');
    this.dragBtn.setAttribute('tabindex', '0');
    this.dragBtn.setAttribute('aria-label', 'Drag to reorder, click for actions');
    this.dragBtn.setAttribute('title', 'Drag to reorder · Click for actions');
    this.dragBtn.innerHTML = GRIP_ICON;

    this.slashBtn = document.createElement('button');
    this.slashBtn.className = 'void-gutter-slash';
    this.slashBtn.setAttribute('type', 'button');
    this.slashBtn.setAttribute('aria-label', 'Open block insert menu');
    this.slashBtn.setAttribute('title', 'Insert or run action · /');
    this.slashBtn.innerHTML = PLUS_ICON;

    // AI gutter icon (sparkle/error) — hidden by default, shown via CSS
    this.aiGutterIcon = document.createElement('div');
    this.aiGutterIcon.className = 'void-ai-gutter-icon';
    this.aiGutterIcon.innerHTML = SPARKLE_ICON;

    // Layout: [label cell: type-label + AI icon] [controls cell: grip + plus]
    this.gutterEl.appendChild(this.labelEl);
    this.gutterEl.appendChild(this.aiGutterIcon);
    const controls = document.createElement('div');
    controls.className = 'void-gutter-controls';
    controls.appendChild(this.dragBtn);
    controls.appendChild(this.slashBtn);
    this.gutterEl.appendChild(controls);

    // ── AI streaming overlay (hidden by default, shown during streaming) ──
    this.aiStreamOverlay = document.createElement('div');
    this.aiStreamOverlay.className = 'void-ai-stream-overlay';

    // ── AI action bar (hidden by default; retained for legacy controls) ──
    this.aiActionBar = document.createElement('div');
    this.aiActionBar.className = 'void-ai-action-bar';

    this.aiAcceptBtn = document.createElement('button');
    this.aiAcceptBtn.className = 'void-ai-action-accept';
    this.aiAcceptBtn.setAttribute('type', 'button');
    this.aiAcceptBtn.innerHTML = 'Accept <kbd>\u2318\u23CE</kbd>';

    this.aiRejectBtn = document.createElement('button');
    this.aiRejectBtn.className = 'void-ai-action-reject';
    this.aiRejectBtn.setAttribute('type', 'button');
    this.aiRejectBtn.innerHTML = 'Reject <kbd>Esc</kbd>';

    this.aiActionBar.appendChild(this.aiAcceptBtn);
    this.aiActionBar.appendChild(this.aiRejectBtn);

    // ── Content area (type-specific) ──
    this.contentDOM = this.createContentDOM(node);

    this.dom.appendChild(this.gutterEl);

    // For horizontal rules — add visible HR element after gutter
    if (typeName === 'horizontalRule') {
      const hrEl = document.createElement('hr');
      hrEl.className = 'void-block-content void-divider';
      this.dom.appendChild(hrEl);
    }

    // For images — add a visible figure/placeholder after gutter
    if (typeName === 'image') {
      this.imageFigureEl = this.createImageFigure(node);
      this.dom.appendChild(this.imageFigureEl);
    }

    if (this.contentDOM) {
      // For todo items, checkbox goes before content
      if (typeName === 'todoItem' && this.checkboxEl) {
        const todoWrapper = document.createElement('div');
        todoWrapper.className = 'void-block-content void-todo-wrapper';
        todoWrapper.appendChild(this.checkboxEl);
        todoWrapper.appendChild(this.contentDOM);
        this.dom.appendChild(todoWrapper);
      } else if (typeName === 'codeBlock' && this.codeShellEl) {
        this.dom.appendChild(this.codeShellEl);
      } else {
        const contentWrapper = this.contentDOM.parentElement || this.contentDOM;
        if (contentWrapper !== this.contentDOM) {
          this.dom.appendChild(contentWrapper);
        } else {
          this.dom.appendChild(this.contentDOM);
        }
      }
    }

    // Append AI elements (hidden by default via CSS)
    this.dom.appendChild(this.aiStreamOverlay);
    this.dom.appendChild(this.aiActionBar);

    this.setupEventListeners();
    this.setupStickyGutter();
  }

  private get blockId(): string {
    return (this.node.attrs.id as string) || '';
  }

  private getVisibleLineIndex(): number {
    let index = 0;
    let found = -1;
    this.view.state.doc.descendants((node) => {
      if (found >= 0) return false;
      if (!node.attrs?.id) return true;
      if (node.attrs.id === this.blockId) {
        found = index;
        return false;
      }
      index++;
      return false;
    });
    return found >= 0 ? found : 0;
  }

  /**
   * Create the contentDOM element based on block type.
   */
  private createContentDOM(node: ProseMirrorNode): HTMLElement | null {
    const typeName = node.type.name;

    switch (typeName) {
      case 'codeBlock': {
        this.codeShellEl = document.createElement('div');
        this.codeShellEl.className = 'void-code-block-shell void-block-content';

        // Header bar with language/meta controls and copy actions.
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'void-code-block-header';
        this.headerEl.setAttribute('contenteditable', 'false');

        this.codeInfoEl = document.createElement('div');
        this.codeInfoEl.className = 'void-code-block-info';

        this.langEl = document.createElement('span');
        this.langEl.className = 'void-code-block-lang';

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'void-code-block-title';

        this.metaEl = document.createElement('span');
        this.metaEl.className = 'void-code-block-meta';

        this.codeInfoEl.appendChild(this.langEl);
        this.codeInfoEl.appendChild(this.titleEl);
        this.codeInfoEl.appendChild(this.metaEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'void-code-block-actions';

        this.wrapBtn = this.createCodeHeaderButton('Wrap code', 'Wrap');
        this.lineNumbersBtn = this.createCodeHeaderButton('Toggle line numbers', 'Lines');

        this.copyBtn = document.createElement('button');
        this.copyBtn.className = 'void-code-block-copy';
        this.copyBtn.setAttribute('type', 'button');
        this.copyBtn.setAttribute('aria-label', 'Copy code');
        this.copyBtn.textContent = 'Copy';

        this.copyFenceBtn = this.createCodeHeaderButton('Copy fenced Markdown', 'Fence');

        actionsEl.appendChild(this.wrapBtn);
        actionsEl.appendChild(this.lineNumbersBtn);
        actionsEl.appendChild(this.copyFenceBtn);
        actionsEl.appendChild(this.copyBtn);

        this.headerEl.appendChild(this.codeInfoEl);
        this.headerEl.appendChild(actionsEl);

        // pre > code structure — ProseMirror owns the nested code element.
        this.preEl = document.createElement('pre');
        this.preEl.className = 'void-code-block';

        this.lineNumberEl = document.createElement('div');
        this.lineNumberEl.className = 'void-code-line-numbers';
        this.lineNumberEl.setAttribute('contenteditable', 'false');
        this.lineNumberEl.setAttribute('aria-hidden', 'true');

        const codeEl = document.createElement('code');
        this.preEl.appendChild(this.lineNumberEl);
        this.preEl.appendChild(codeEl);
        this.codeShellEl.appendChild(this.headerEl);
        this.codeShellEl.appendChild(this.preEl);
        this.renderCodeBlockState(node);
        return codeEl;
      }

      case 'todoItem': {
        // Checkbox element
        this.checkboxEl = document.createElement('div');
        this.checkboxEl.className = 'void-todo-checkbox';
        if (node.attrs.checked) this.checkboxEl.classList.add('is-checked');
        this.checkboxEl.setAttribute('role', 'checkbox');
        this.checkboxEl.setAttribute('aria-checked', String(node.attrs.checked));
        this.checkboxEl.setAttribute('tabindex', '0');

        const contentEl = document.createElement('span');
        contentEl.className = 'void-todo-content';
        if (node.attrs.checked) {
          this.dom.classList.add('void-todo-checked');
        }
        return contentEl;
      }

      case 'horizontalRule':
        // Leaf node — HR element added after gutter in constructor
        return null;

      case 'image':
        // Leaf node — no editable content
        return null;

      case 'heading': {
        const tag = `h${node.attrs.level}` as keyof HTMLElementTagNameMap;
        const contentEl = document.createElement(tag);
        contentEl.className = `void-block-content void-heading void-h${node.attrs.level}`;
        return contentEl;
      }

      case 'blockquote': {
        const contentEl = document.createElement('blockquote');
        contentEl.className = 'void-block-content void-blockquote';
        return contentEl;
      }

      default: {
        // Paragraph and other textblocks — use <p> for semantic correctness
        const contentEl = document.createElement(
          node.type.name === 'paragraph' ? 'p' : 'div'
        );
        contentEl.className = 'void-block-content void-paragraph';
        return contentEl;
      }
    }
  }

  private createCodeHeaderButton(ariaLabel: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'void-code-block-copy';
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = text;
    return button;
  }

  private renderCodeBlockState(node: ProseMirrorNode): void {
    if (node.type.name !== 'codeBlock') return;

    const language = node.attrs.language as string | null;
    const meta = node.attrs.meta as string | null;
    const code = node.textContent;
    const options = parseCodeBlockDisplayOptions(meta, code);

    if (this.langEl) {
      this.langEl.textContent = normalizeCodeLanguageLabel(language);
      this.langEl.setAttribute('aria-label', 'Edit code fence language and metadata');
    }

    if (this.titleEl) {
      this.titleEl.textContent = options.title ?? '';
      this.titleEl.toggleAttribute('hidden', !options.title);
    }

    if (this.metaEl) {
      const visibleMeta = meta
        ? meta
            .replace(/(?:^|\s)title=(?:"[^"]*"|'[^']*'|\S+)/i, '')
            .trim()
        : '';
      this.metaEl.textContent = visibleMeta;
      this.metaEl.toggleAttribute('hidden', !visibleMeta);
    }

    this.preEl?.classList.toggle('is-wrapped', options.wrap);
    this.preEl?.classList.toggle('has-line-numbers', options.lineNumbers);

    if (this.wrapBtn) {
      this.wrapBtn.classList.toggle('is-active', options.wrap);
      this.wrapBtn.setAttribute('aria-pressed', String(options.wrap));
    }
    if (this.lineNumbersBtn) {
      this.lineNumbersBtn.classList.toggle('is-active', options.lineNumbers);
      this.lineNumbersBtn.setAttribute('aria-pressed', String(options.lineNumbers));
    }

    if (this.lineNumberEl) {
      this.lineNumberEl.hidden = !options.lineNumbers;
      if (options.lineNumbers) {
        this.renderLineNumbers(code, options.highlightLines, options.focusLines);
      } else {
        this.lineNumberEl.textContent = '';
      }
    }
  }

  private renderLineNumbers(
    code: string,
    highlightLines: Set<number>,
    focusLines: Set<number>
  ): void {
    if (!this.lineNumberEl) return;
    const lines = code.split('\n');
    const lineCount = Math.max(1, lines.length);
    this.lineNumberEl.replaceChildren();
    for (let line = 1; line <= lineCount; line++) {
      const span = document.createElement('span');
      span.textContent = String(line);
      if (highlightLines.has(line)) span.classList.add('is-highlighted');
      if (focusLines.has(line)) span.classList.add('is-focused');
      if (/^\+/.test(lines[line - 1] ?? '')) span.classList.add('is-added');
      if (/^-/.test(lines[line - 1] ?? '')) span.classList.add('is-removed');
      this.lineNumberEl.appendChild(span);
    }
  }

  private setupEventListeners(): void {
    this.dom.addEventListener('mousedown', (event) => {
      this.handleEditableWhitespaceDoubleClick(event);
    });
    this.dom.addEventListener('dblclick', (event) => {
      this.handleEditableWhitespaceDoubleClick(event);
    });

    // ── Grip: mousedown decides between drag and click ──
    // - mouseup with no movement above 4px → click → open block-action menu
    // - mousemove > 4px → custom pointer drag (ghost preview, drop indicator)
    // We use document-level listeners so the drag survives the cursor leaving
    // the grip, which is necessary for any meaningful drag distance.
    this.dragBtn.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      event.preventDefault(); // prevent text-selection / focus shift

      const startX = event.clientX;
      const startY = event.clientY;
      let dragStarted = false;

      const onMove = (mv: MouseEvent) => {
        if (dragStarted) return;
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        if (dx * dx + dy * dy > 16) {
          dragStarted = true;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          startCustomDrag(this.view, this.blockId, pos, this.dom, mv);
        }
      };
      const onUp = (up: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!dragStarted) {
          // Treat as click → open block-action menu
          this.options.onMenuClick?.(this.blockId, this.getVisibleLineIndex(), up);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Keyboard activation: <div role="button"> doesn't synthesize click on
    // Enter/Space, so handle it explicitly. Position the menu at the grip's
    // bounding rect since there's no cursor coordinate.
    this.dragBtn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      const rect = this.dragBtn.getBoundingClientRect();
      const synthetic = new MouseEvent('click', {
        bubbles: false,
        clientX: rect.right,
        clientY: rect.bottom,
      });
      this.options.onMenuClick?.(this.blockId, this.getVisibleLineIndex(), synthetic);
    });

    // ── Gutter: "+" / slash button → open slash menu for THIS block ──
    // Shows insertion/media/AI commands; type conversion lives on the label.
    this.slashBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSlashMenuForCurrentBlock();
    });

    // ── Gutter: prevent focus steal (but NOT on drag button — it needs mousedown for drag) ──
    this.slashBtn.addEventListener('mousedown', (e) => e.preventDefault());

    // ── Type label: opens the block type conversion menu for THIS block ──
    this.labelEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const position = this.getMenuPosition(event, this.labelEl);
      this.options.onTypeLabelClick?.(this.blockId, this.getVisibleLineIndex(), event, position);
    });

    // ── Todo: checkbox toggle ──
    if (this.checkboxEl) {
      this.checkboxEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.toggleTodoChecked();
      });
      this.checkboxEl.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          this.toggleTodoChecked();
        }
      });
    }

    // ── Code block: copy button ──
    if (this.copyBtn) {
      this.copyBtn.addEventListener('mousedown', (e) => e.preventDefault());
      this.copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.copyCode();
      });
    }

    if (this.copyFenceBtn) {
      this.copyFenceBtn.addEventListener('mousedown', (e) => e.preventDefault());
      this.copyFenceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.copyFencedCode();
      });
    }

    if (this.wrapBtn) {
      this.wrapBtn.addEventListener('mousedown', (e) => e.preventDefault());
      this.wrapBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleCodeMeta('wrap');
      });
    }

    if (this.lineNumbersBtn) {
      this.lineNumbersBtn.addEventListener('mousedown', (e) => e.preventDefault());
      this.lineNumbersBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleCodeMeta('lineNumbers');
      });
    }

    // ── Code block: editable language label ──
    if (this.langEl) {
      this.langEl.setAttribute('role', 'button');
      this.langEl.setAttribute('tabindex', '0');
      this.langEl.title = 'Edit code fence language and metadata';
      this.langEl.addEventListener('mousedown', (e) => e.preventDefault());
      this.langEl.addEventListener('click', (e) => {
        e.preventDefault();
        this.startEditingLanguage();
      });
      this.langEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.startEditingLanguage();
        }
      });
    }

    // ── AI action bar: accept/reject buttons ──
    this.aiAcceptBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.aiRejectBtn.addEventListener('mousedown', (e) => e.preventDefault());

    this.aiAcceptBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tr = this.view.state.tr.setMeta(aiBlockKey, {
        type: 'ACCEPT',
        blockId: this.blockId,
      });
      this.view.dispatch(tr);
    });

    this.aiRejectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tr = this.view.state.tr.setMeta(aiBlockKey, {
        type: 'REJECT',
        blockId: this.blockId,
      });
      this.view.dispatch(tr);
    });
  }

  private handleEditableWhitespaceDoubleClick(event: MouseEvent): void {
    if (event.button !== 0 || event.detail < 2) return;
    if (!this.isEditableWhitespaceEvent(event)) return;

    event.preventDefault();
    event.stopPropagation();
    this.placeCaretNearWhitespace(event);
  }

  private isEditableWhitespaceEvent(event: MouseEvent): boolean {
    if (!this.contentDOM || !this.node.isTextblock) return false;

    const typeName = this.node.type.name;
    if (typeName !== 'paragraph' && typeName !== 'heading' && typeName !== 'todoItem') {
      return false;
    }

    const target = event.target;
    if (!(target instanceof Node)) return false;

    const targetEl = target instanceof Element ? target : target.parentElement;
    if (
      targetEl?.closest(
        'button,input,textarea,select,a,[contenteditable="false"],.void-gutter,.void-ai-action-bar'
      )
    ) {
      return false;
    }

    if (this.contentDOM === target || this.contentDOM.contains(target)) {
      return !this.isPointInsideContentTextLine(event.clientY);
    }

    return this.dom === target || this.dom.contains(target);
  }

  private isPointInsideContentTextLine(clientY: number): boolean {
    const lineRects = this.getContentTextLineRects();
    if (lineRects.length > 0) {
      return lineRects.some((rect) => clientY >= rect.top - 2 && clientY <= rect.bottom + 2);
    }

    if (!this.contentDOM) return false;
    const rect = this.contentDOM.getBoundingClientRect();
    if (rect.height <= 0) return false;

    const style = window.getComputedStyle(this.contentDOM);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const textTop = rect.top + paddingTop;
    const textBottom = rect.bottom - paddingBottom;

    return clientY >= textTop - 2 && clientY <= textBottom + 2;
  }

  private getContentTextLineRects(): DOMRect[] {
    if (!this.contentDOM || !this.contentDOM.hasChildNodes()) return [];

    const range = document.createRange();
    range.selectNodeContents(this.contentDOM);

    const rects =
      typeof range.getClientRects === 'function'
        ? Array.from(range.getClientRects()).filter((rect) => rect.height > 0)
        : [];
    range.detach?.();

    return rects;
  }

  private placeCaretNearWhitespace(event: MouseEvent): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const doc = this.view.state.doc;
    const start = pos + 1;
    const end = pos + this.node.nodeSize - 1;
    const rect = this.contentDOM?.getBoundingClientRect();
    const midpoint = rect && rect.height > 0 ? rect.top + rect.height / 2 : Number.NEGATIVE_INFINITY;
    const target = event.clientY < midpoint ? start : end;
    const clamped = Math.max(0, Math.min(target, doc.content.size));

    try {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, clamped)));
      this.view.focus();
    } catch {
      // Browser coordinates can land just outside the textblock; keep the
      // editor in charge instead of letting native line selection take over.
      const $pos = doc.resolve(Math.max(0, Math.min(end, doc.content.size)));
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near($pos, -1)));
      this.view.focus();
    }
  }

  /**
   * Set up a ResizeObserver to make the gutter sticky when the block
   * is taller than the viewport. Uses 50px hysteresis to avoid toggling
   * rapidly near the threshold.
   */
  private setupStickyGutter(): void {
    // Leaf nodes (hr, image) are never tall enough to need sticky gutter
    if (!this.contentDOM) return;

    let isSticky = false;
    const HYSTERESIS = 50;

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const blockHeight = entry.contentRect.height;
      const viewportHeight = window.innerHeight;

      if (!isSticky && blockHeight > viewportHeight) {
        isSticky = true;
        this.gutterEl.classList.add('void-gutter--sticky');
      } else if (isSticky && blockHeight < viewportHeight - HYSTERESIS) {
        isSticky = false;
        this.gutterEl.classList.remove('void-gutter--sticky');
      }
    });

    this.resizeObserver.observe(this.dom);
  }

  /**
   * Open the slash menu targeting the CURRENT block.
   *
   * Places the cursor inside this block before opening the menu, so insert
   * and AI commands use the correct context. Type conversion lives on the
   * gutter label menu.
   */
  private openSlashMenuForCurrentBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const blockEnd = pos + this.node.nodeSize;

    // Place cursor inside the block (just before its closing position) so
    // selection-based commands operate on this block. For leaf nodes (hr, image)
    // there is no inside; place cursor adjacent and let the command insert.
    const cursorTarget = this.node.isLeaf ? blockEnd : blockEnd - 1;

    let tr;
    try {
      const $pos = state.doc.resolve(cursorTarget);
      tr = state.tr.setSelection(TextSelection.near($pos));
    } catch {
      return;
    }

    this.view.dispatch(tr);
    this.view.focus();

    requestAnimationFrame(() => {
      const triggerPos = this.view.state.selection.from;
      const rawCoords = this.view.coordsAtPos(triggerPos);
      const { top, left, openAbove } = clampToViewport(rawCoords, {
        menuWidth: 280,
        menuHeight: 400,
      });

      const slashTr = this.view.state.tr.setMeta(slashMenuKey, {
        type: 'OPEN',
        triggerPos,
        coords: { top, left },
        openAbove,
        source: 'gutter' as const,
        blockType: getBlockTypeName(this.node, this.parentListType),
      });
      this.view.dispatch(slashTr);
    });
  }

  private getMenuPosition(event: MouseEvent, anchor: HTMLElement): { top: number; left: number } {
    if (event.clientX !== 0 || event.clientY !== 0) {
      return { top: event.clientY, left: event.clientX };
    }

    const rect = anchor.getBoundingClientRect();
    return { top: rect.bottom, left: rect.right };
  }

  private toggleTodoChecked(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state, dispatch } = this.view;
    const node = state.doc.nodeAt(pos);
    if (!node) return;

    const newChecked = !node.attrs.checked;
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: newChecked,
    });
    dispatch(tr);

    const blockId = (node.attrs.id as string) || '';
    const content = node.textContent;
    this.options.onTodoToggle?.(blockId, content, newChecked);
  }

  private copyCode(): void {
    if (!this.contentDOM) return;
    const text = this.contentDOM.textContent || '';
    this.copyWithFeedback(text, this.copyBtn, 'Copy');
  }

  private copyFencedCode(): void {
    if (!this.contentDOM) return;
    const text = this.contentDOM.textContent || '';
    const fenced = buildCodeFence({
      code: text,
      language: this.node.attrs.language as string | null,
      meta: this.node.attrs.meta as string | null,
    });
    this.copyWithFeedback(fenced, this.copyFenceBtn, 'Fence');
  }

  private copyWithFeedback(
    text: string,
    button: HTMLButtonElement | undefined,
    restoreLabel: string
  ): void {
    navigator.clipboard.writeText(text).then(() => {
      if (!button) return;
      button.textContent = 'Copied';
      if (this.copyTimeout !== null) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => {
        button.textContent = restoreLabel;
        this.copyTimeout = null;
      }, 1600);
    });
  }

  private toggleCodeMeta(kind: 'wrap' | 'lineNumbers'): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') return;

    const options = parseCodeBlockDisplayOptions(node.attrs.meta as string | null, node.textContent);
    const nextMeta = updateCodeFenceMeta(node.attrs.meta as string | null, {
      [kind]: !options[kind],
    });
    const tr = this.view.state.tr.setNodeMarkup(pos, null, {
      ...node.attrs,
      meta: nextMeta,
    });
    this.view.dispatch(tr);
  }

  /**
   * Open an inline editor on the language label so the user can set the
   * full fence info string: language plus optional metadata. Persists via
   * setNodeMarkup so undo restores the previous fence attrs atomically.
   */
  private startEditingLanguage(): void {
    if (!this.langEl || !this.view) return;

    const currentLang = (this.node.attrs.language as string | null) || '';
    const currentMeta = (this.node.attrs.meta as string | null) || '';
    const currentInfo = [currentLang, currentMeta].filter(Boolean).join(' ');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'void-code-block-lang-input';
    input.value = currentInfo;
    input.placeholder = 'ts title="api.ts" lineNumbers';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.setAttribute('list', 'void-code-block-lang-suggestions');

    // Reuse a single datalist for suggestions; create lazily.
    if (!document.getElementById('void-code-block-lang-suggestions')) {
      const datalist = document.createElement('datalist');
      datalist.id = 'void-code-block-lang-suggestions';
      const SUGGESTIONS = [
        'plaintext', 'javascript', 'typescript', 'tsx', 'jsx', 'python', 'rust',
        'go', 'java', 'kotlin', 'swift', 'ruby', 'php', 'c', 'cpp', 'csharp',
        'sql', 'bash', 'shell', 'zsh', 'fish', 'json', 'yaml', 'toml', 'xml',
        'html', 'css', 'scss', 'sass', 'svelte', 'vue', 'markdown', 'mdx',
        'graphql', 'dockerfile', 'makefile', 'lua', 'haskell', 'elixir', 'r',
        'matlab', 'perl', 'scala', 'clojure', 'erlang', 'dart', 'nim', 'zig',
      ];
      for (const lang of SUGGESTIONS) {
        const option = document.createElement('option');
        option.value = lang;
        datalist.appendChild(option);
      }
      document.body.appendChild(datalist);
    }

    const commit = (cancel = false) => {
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);
      const next = cancel ? currentInfo : input.value.trim();
      if (input.parentElement === this.langEl) {
        this.langEl.removeChild(input);
      }
      if (!cancel && next !== currentInfo && this.view) {
        const pos = this.getPos();
        if (typeof pos === 'number') {
          const info = parseCodeFenceInfo(next);
          const tr = this.view.state.tr.setNodeMarkup(pos, null, {
            ...this.node.attrs,
            language: info.language,
            meta: info.meta,
          });
          this.view.dispatch(tr);
        }
      }
      this.renderCodeBlockState(this.node);
    };

    const onBlur = () => commit(false);
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commit(true);
      }
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);

    this.langEl.textContent = '';
    this.langEl.appendChild(input);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  // ── NodeView interface ──

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;

    // Heading level change requires a DOM rebuild (different tag element)
    if (node.type.name === 'heading' && node.attrs.level !== this.node.attrs.level) {
      return false;
    }

    this.node = node;
    this.dom.setAttribute('data-block-id', this.blockId);
    this.dom.setAttribute('data-block-type', getBlockTypeName(node, this.parentListType));
    this.labelEl.textContent = getTypeLabel(node, this.parentListType);
    this.labelEl.setAttribute('aria-label', `Change block type from ${getTypeLabel(node, this.parentListType)}`);

    // Update todo checkbox state
    if (node.type.name === 'todoItem' && this.checkboxEl) {
      const checked = node.attrs.checked as boolean;
      this.checkboxEl.setAttribute('aria-checked', String(checked));
      if (checked) {
        this.checkboxEl.classList.add('is-checked');
        this.dom.classList.add('void-todo-checked');
      } else {
        this.checkboxEl.classList.remove('is-checked');
        this.dom.classList.remove('void-todo-checked');
      }
    }

    // Update code block header and visual line state
    if (node.type.name === 'codeBlock') {
      this.renderCodeBlockState(node);
    }

    // Update image rendering when attrs change
    if (node.type.name === 'image') {
      this.updateImageFigure(node);
    }

    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;

    // Stop events on gutter buttons
    if (
      target === this.dragBtn ||
      target === this.slashBtn ||
      this.dragBtn.contains(target) ||
      this.slashBtn.contains(target)
    ) {
      return true;
    }

    // Stop events on AI action bar buttons
    if (this.aiActionBar.contains(target)) {
      return true;
    }

    // Stop events on todo checkbox
    if (this.checkboxEl && (target === this.checkboxEl || this.checkboxEl.contains(target))) {
      return true;
    }

    // Stop events on code block header
    if (this.headerEl && (target === this.headerEl || this.headerEl.contains(target))) {
      return true;
    }

    if (this.lineNumberEl && (target === this.lineNumberEl || this.lineNumberEl.contains(target))) {
      return true;
    }

    // Stop events on image figure/placeholder
    if (this.imageFigureEl && (target === this.imageFigureEl || this.imageFigureEl.contains(target))) {
      return true;
    }

    return false;
  }

  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    const target = mutation.target as HTMLElement;

    // Ignore mutations in gutter (includes AI gutter icon)
    if (
      target === this.gutterEl ||
      this.gutterEl.contains(target)
    ) {
      return true;
    }

    // Ignore mutations in AI overlay and action bar
    if (
      target === this.aiStreamOverlay ||
      this.aiStreamOverlay.contains(target) ||
      target === this.aiActionBar ||
      this.aiActionBar.contains(target)
    ) {
      return true;
    }

    // Ignore mutations in todo checkbox
    if (this.checkboxEl && (target === this.checkboxEl || this.checkboxEl.contains(target))) {
      return true;
    }

    // Ignore mutations in code header
    if (this.headerEl && (target === this.headerEl || this.headerEl.contains(target))) {
      return true;
    }

    // Ignore generated line-number gutter; editable code remains ProseMirror-owned.
    if (this.lineNumberEl && (target === this.lineNumberEl || this.lineNumberEl.contains(target))) {
      return true;
    }

    // Ignore mutations in rendered image UI
    if (this.imageFigureEl && (target === this.imageFigureEl || this.imageFigureEl.contains(target))) {
      return true;
    }

    return false;
  }

  destroy(): void {
    if (this.copyTimeout !== null) {
      clearTimeout(this.copyTimeout);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private createImageFigure(node: ProseMirrorNode): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'void-block-content void-image';
    figure.setAttribute('contenteditable', 'false');
    figure.setAttribute('role', 'group');
    figure.setAttribute('tabindex', '0');
    figure.setAttribute('aria-label', 'Image block');
    figure.addEventListener('mouseenter', () => this.announceImageToolbar());
    figure.addEventListener('focusin', () => this.announceImageToolbar());
    figure.addEventListener('click', (event) => {
      event.preventDefault();
      this.announceImageToolbar();
    });
    figure.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.announceImageToolbar();
    });
    this.populateImageFigure(figure, node);
    return figure;
  }

  private updateImageFigure(node: ProseMirrorNode): void {
    if (!this.imageFigureEl) {
      this.imageFigureEl = this.createImageFigure(node);
      this.dom.appendChild(this.imageFigureEl);
      return;
    }
    this.populateImageFigure(this.imageFigureEl, node);
  }

  private populateImageFigure(figure: HTMLElement, node: ProseMirrorNode): void {
    figure.replaceChildren();
    delete this.imageEl;
    delete this.imageCaptionEl;
    delete this.imagePlaceholderEl;

    const src = (node.attrs.src as string | null) || '';
    const alt = (node.attrs.alt as string | null) || '';
    const title = (node.attrs.title as string | null) || '';
    const caption = (node.attrs.caption as string | null) || '';
    const width = node.attrs.width as number | null;

    if (!src) {
      const placeholder = document.createElement('div');
      placeholder.className = 'void-image-placeholder';
      placeholder.textContent = 'Image';
      figure.appendChild(placeholder);
      this.imagePlaceholderEl = placeholder;
      return;
    }

    const img = document.createElement('img');
    img.className = 'void-image-img';
    img.src = src;
    img.dataset.assetSrc = src;
    const resolvedSrc = this.options.resolveImageSrc?.(src);
    if (typeof resolvedSrc === 'string') {
      img.src = resolvedSrc;
    } else if (resolvedSrc) {
      resolvedSrc
        .then((value) => {
          if (this.imageEl === img && img.dataset.assetSrc === src) {
            img.src = value;
          }
        })
        .catch(() => {
          // Keep the portable markdown path visible to the browser if
          // resolution fails; the block metadata remains unchanged.
        });
    }
    img.alt = alt;
    if (title) img.title = title;
    if (width) img.width = width;
    figure.appendChild(img);
    this.imageEl = img;

    if (caption) {
      const figcaption = document.createElement('figcaption');
      figcaption.className = 'void-image-caption';
      figcaption.textContent = caption;
      figure.appendChild(figcaption);
      this.imageCaptionEl = figcaption;
    }
  }

  private announceImageToolbar(): void {
    if (!this.imageFigureEl) return;
    const rect = this.imageFigureEl.getBoundingClientRect();
    const src = (this.node.attrs.src as string | null) || '';
    const detail: ImageBlockToolbarRequest = {
      blockId: this.blockId,
      src,
      alt: (this.node.attrs.alt as string | null) ?? null,
      title: (this.node.attrs.title as string | null) ?? null,
      caption: (this.node.attrs.caption as string | null) ?? null,
      width: (this.node.attrs.width as number | null) ?? null,
      rect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    };
    window.dispatchEvent(new CustomEvent<ImageBlockToolbarRequest>(IMAGE_BLOCK_UI_EVENT, {
      detail,
    }));
  }
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Creates a NodeView factory for a specific block type.
 * For listItem, resolves the parent list type (UL vs OL) from the document.
 */
export function createBlockNodeViewFactory(
  options: BlockNodeViewOptions = {}
): (
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined
) => BlockNodeView {
  return (node, view, getPos) => {
    let parentListType: string | undefined;

    // For listItem, determine if parent is bulletList or orderedList
    if (node.type.name === 'listItem') {
      const pos = getPos();
      if (pos !== undefined) {
        const resolved = view.state.doc.resolve(pos);
        if (resolved.parent) {
          parentListType = resolved.parent.type.name;
        }
      }
    }

    return new BlockNodeView(node, view, getPos, options, parentListType);
  };
}

/**
 * Minimal passthrough view for paragraphs inside listItems.
 * No gutter — the parent listItem NodeView provides it.
 */
class ListItemChildView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  constructor(private node: ProseMirrorNode) {
    this.dom = document.createElement('div');
    this.dom.className = 'void-block-content';
    this.contentDOM = this.dom;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }
}

/**
 * Factory that conditionally applies gutter based on parent context.
 * Paragraphs inside listItems get a passthrough view (no gutter).
 * All other paragraphs get the full BlockNodeView with gutter.
 */
export function createContextAwareFactory(
  options: BlockNodeViewOptions = {}
): (
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined
) => NodeView {
  const fullFactory = createBlockNodeViewFactory(options);

  return (node, view, getPos) => {
    // Check if this paragraph is inside a listItem
    if (node.type.name === 'paragraph') {
      const pos = getPos();
      if (pos !== undefined) {
        const resolved = view.state.doc.resolve(pos);
        if (resolved.parent && resolved.parent.type.name === 'listItem') {
          return new ListItemChildView(node);
        }
      }
    }

    return fullFactory(node, view, getPos);
  };
}
