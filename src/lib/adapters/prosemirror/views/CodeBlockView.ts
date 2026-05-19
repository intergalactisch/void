/**
 * CodeBlockView - Custom NodeView for code blocks
 *
 * Renders code blocks with a header bar showing the language label
 * and a copy-to-clipboard button. The header is isolated from
 * ProseMirror's event handling so buttons remain interactive.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private headerEl: HTMLDivElement;
  private langEl: HTMLSpanElement;
  private copyBtn: HTMLButtonElement;
  private codeEl: HTMLElement;
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private node: PmNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    // Wrapper
    this.dom = document.createElement('div');
    this.dom.className = 'void-code-block-wrapper';
    this.dom.setAttribute('data-block-type', 'codeBlock');
    if (node.attrs.id) {
      this.dom.setAttribute('data-block-id', node.attrs.id as string);
    }

    // Header bar
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'void-code-block-header';

    this.langEl = document.createElement('span');
    this.langEl.className = 'void-code-block-lang';
    this.langEl.textContent = this.languageLabel(node);

    this.copyBtn = document.createElement('button');
    this.copyBtn.className = 'void-code-block-copy';
    this.copyBtn.setAttribute('type', 'button');
    this.copyBtn.setAttribute('aria-label', 'Copy code');
    this.copyBtn.textContent = 'Copy';
    this.copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent ProseMirror focus changes
    });
    this.copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.copyCode();
    });

    this.headerEl.appendChild(this.langEl);
    this.headerEl.appendChild(this.copyBtn);

    // Pre > code structure
    const preEl = document.createElement('pre');
    preEl.className = 'void-code-block';

    this.codeEl = document.createElement('code');
    this.contentDOM = this.codeEl;

    preEl.appendChild(this.codeEl);

    this.dom.appendChild(this.headerEl);
    this.dom.appendChild(preEl);
  }

  update(node: PmNode): boolean {
    if (node.type.name !== 'codeBlock') return false;

    this.node = node;
    this.langEl.textContent = this.languageLabel(node);
    if (node.attrs.id) {
      this.dom.setAttribute('data-block-id', node.attrs.id as string);
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;
    if (
      target === this.headerEl ||
      target === this.langEl ||
      target === this.copyBtn ||
      this.headerEl.contains(target)
    ) {
      return true;
    }
    return false;
  }

  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    const target = mutation.target as HTMLElement;
    if (
      target === this.headerEl ||
      target === this.langEl ||
      target === this.copyBtn ||
      this.headerEl.contains(target)
    ) {
      return true;
    }
    return false;
  }

  destroy(): void {
    if (this.copyTimeout !== null) {
      clearTimeout(this.copyTimeout);
    }
  }

  private languageLabel(node: PmNode): string {
    const lang = node.attrs.language as string | null;
    return lang || 'plain text';
  }

  private copyCode(): void {
    const text = this.codeEl.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      this.copyBtn.textContent = 'Copied!';
      if (this.copyTimeout !== null) {
        clearTimeout(this.copyTimeout);
      }
      this.copyTimeout = setTimeout(() => {
        this.copyBtn.textContent = 'Copy';
        this.copyTimeout = null;
      }, 2000);
    });
  }
}

/**
 * Factory function for ProseMirror nodeViews config.
 */
export function createCodeBlockViewFactory(): (
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined
) => CodeBlockView {
  return (node, view, getPos) => new CodeBlockView(node, view, getPos);
}
