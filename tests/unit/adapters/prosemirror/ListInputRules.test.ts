import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undoInputRule } from 'prosemirror-inputrules';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { createBlockInputRules } from '$lib/adapters/prosemirror/plugins/blockInputRules';
import { createListInputRules } from '$lib/adapters/prosemirror/plugins/listInputRules';

function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', handler => handler(view, from, to, character, () => view.state.tr.insertText(character)));
    if (!handled) view.dispatch(view.state.tr.insertText(character));
  }
}

describe('Markdown task input', () => {
  it.each(['- [ ] ', '* [x] ', '- [X] '])('converts %s while typing and supports undo', marker => {
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ schema, plugins: [createListInputRules(schema)] }),
    });
    try {
      type(view, marker);
      expect(view.state.doc.firstChild?.type.name).toBe('todoItem');
      expect(view.state.doc.firstChild?.attrs.checked).toBe(!marker.includes('[ ]'));
      expect(undoInputRule(view.state, view.dispatch)).toBe(true);
      expect(view.state.doc.firstChild?.type.name).toBe('bulletList');
      expect(view.state.doc.textContent).toBe(marker.slice(2));
    } finally { view.destroy(); }
  });

  it('preserves adjacent list items when converting an item in the middle', () => {
    const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : null);
    const item = (text: string) => schema.node('listItem', null, paragraph(text));
    const doc = schema.node('doc', null, schema.node('bulletList', null, [item('Before'), item(''), item('After')]));
    let cursor = 0;
    doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && !node.textContent) cursor = pos + 1; });
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ schema, doc, selection: TextSelection.create(doc, cursor), plugins: [createListInputRules(schema)] }),
    });
    try {
      type(view, '[ ] Task');
      expect(view.state.doc.childCount).toBe(3);
      expect(view.state.doc.child(0).textContent).toBe('Before');
      expect(view.state.doc.child(1).type.name).toBe('todoItem');
      expect(view.state.doc.child(1).textContent).toBe('Task');
      expect(view.state.doc.child(2).textContent).toBe('After');
      view.state.doc.check();
    } finally { view.destroy(); }
  });
});


it('typing a horizontal rule before existing text does not delete that text', () => {
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('Keep this')));
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1), plugins: [createBlockInputRules(schema)] }),
  });
  try {
    type(view, '---');
    expect(view.state.doc.textContent).toBe('---Keep this');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  } finally { view.destroy(); }
});
