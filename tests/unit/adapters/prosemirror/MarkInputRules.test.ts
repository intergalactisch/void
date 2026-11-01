import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { createMarkInputRules } from '$lib/adapters/prosemirror/plugins/markInputRules';

function typeText(text: string) {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, plugins: [createMarkInputRules(schema)] }),
  });
  try {
    for (const character of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', handler => handler(view, from, to, character, () => view.state.tr.insertText(character)));
      if (!handled) view.dispatch(view.state.tr.insertText(character));
    }
    return view.state.doc;
  } finally { view.destroy(); }
}

describe('inline Markdown typing', () => {
  it.each([['**bold**', 'bold'], ['*italic*', 'italic'], ['`code`', 'code'], ['~~strike~~', 'strikethrough']])('formats %s without deleting preceding text', (input, mark) => {
    for (const prefix of ['', 'Before ']) {
      const doc = typeText(prefix + input + ' after');
      const plain = input.replace(/[*`~]/g, '');
      expect(doc.textContent).toBe(prefix + plain + ' after');
      const formatted = doc.firstChild!.content.content.find(node => node.marks.some(item => item.type.name === mark));
      expect(formatted?.textContent).toBe(plain);
      expect(doc.firstChild!.lastChild?.marks).toEqual([]);
    }
  });

  it('leaves a code fence intact until Enter', () => {
    const doc = typeText('```ts title="example.ts"');
    expect(doc.textContent).toBe('```ts title="example.ts"');
    expect(doc.firstChild?.firstChild?.marks).toEqual([]);
  });
});
