/**
 * TodoItemView - Custom NodeView for todo checkboxes
 *
 * Handles checkbox click events and toggles the checked attribute
 * via ProseMirror transactions. Without this, checkboxes rendered
 * by toDOM are non-interactive (ProseMirror suppresses native input events).
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export type TodoToggleCallback = (blockId: string, content: string, checked: boolean) => void;

export class TodoItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private checkboxEl: HTMLDivElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private onToggle: TodoToggleCallback | undefined;

  constructor(
    node: PmNode,
    view: EditorView,
    getPos: () => number | undefined,
    onToggle?: TodoToggleCallback
  ) {
    this.view = view;
    this.getPos = getPos;
    this.onToggle = onToggle;

    // Build DOM structure matching the schema's toDOM output
    this.dom = document.createElement('div');
    this.dom.setAttribute('data-type', 'todo');
    this.dom.setAttribute('data-block-type', 'todoItem');
    if (node.attrs.id) {
      this.dom.setAttribute('data-block-id', node.attrs.id as string);
    }
    this.updateCheckedState(node.attrs.checked as boolean);

    this.checkboxEl = document.createElement('div');
    this.checkboxEl.className = 'void-todo-checkbox';
    if (node.attrs.checked) this.checkboxEl.classList.add('is-checked');
    this.checkboxEl.setAttribute('role', 'checkbox');
    this.checkboxEl.setAttribute('aria-checked', String(node.attrs.checked));
    this.checkboxEl.setAttribute('tabindex', '0');
    this.checkboxEl.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent ProseMirror from handling this
      this.toggleChecked();
    });
    this.checkboxEl.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.toggleChecked();
      }
    });

    this.contentDOM = document.createElement('span');
    this.contentDOM.className = 'void-todo-content';

    this.dom.appendChild(this.checkboxEl);
    this.dom.appendChild(this.contentDOM);
  }

  update(node: PmNode): boolean {
    if (node.type.name !== 'todoItem') return false;

    const checked = node.attrs.checked as boolean;
    this.checkboxEl.setAttribute('aria-checked', String(checked));
    if (checked) {
      this.checkboxEl.classList.add('is-checked');
    } else {
      this.checkboxEl.classList.remove('is-checked');
    }
    this.updateCheckedState(checked);
    if (node.attrs.id) {
      this.dom.setAttribute('data-block-id', node.attrs.id as string);
    }
    return true;
  }

  private updateCheckedState(checked: boolean): void {
    this.dom.setAttribute('data-checked', String(checked));
    this.dom.className = `void-todo${checked ? ' void-todo-checked' : ''}`;
  }

  private toggleChecked(): void {
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

    // Fire-and-forget service sync (editor already has correct state)
    const blockId = (node.attrs.id as string) || '';
    const content = node.textContent;
    this.onToggle?.(blockId, content, newChecked);
  }
}

/**
 * Factory function for ProseMirror nodeViews config.
 */
export function createTodoItemView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  onToggle?: TodoToggleCallback
): TodoItemView {
  return new TodoItemView(node, view, getPos, onToggle);
}
