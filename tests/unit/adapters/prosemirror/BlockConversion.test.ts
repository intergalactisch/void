import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { convertBlock } from '$lib/adapters/prosemirror/commands/convertBlock';
import { setBlockTypeFromDomain } from '$lib/adapters/prosemirror/commands/blocks';
import { historyPlugin, historyBoundaryPlugin } from '$lib/adapters/prosemirror/plugins/history';
import type { BlockType } from '$lib/domain/values/BlockType';

function editor() {
  const paragraph = schema.node('paragraph', { id: 'original' }, [
    schema.text('First', [schema.marks.bold!.create()]),
    schema.node('hardBreak'),
    schema.text('Second'),
  ]);
  const doc = schema.node('doc', null, paragraph);
  let state = EditorState.create({ schema, doc, plugins: [historyPlugin(), historyBoundaryPlugin()],
    selection: TextSelection.create(doc, 3) });
  return {
    get state() { return state; },
    run(command: NonNullable<ReturnType<typeof setBlockTypeFromDomain>>) {
      return command(state, tr => { state = state.applyTransaction(tr).state; state.doc.check(); });
    },
  };
}

describe('safe block conversion', () => {
  it.each<BlockType>(['heading2', 'todoItem', 'bulletList', 'numberedList', 'blockquote', 'callout'])(
    'converts text to %s with content and marks intact, then undoes and redoes', type => {
      const view = editor();
      const before = view.state.doc;
      expect(view.run(convertBlock('original', type))).toBe(true);
      expect(view.state.doc.textContent).toBe('FirstSecond');
      expect(view.state.doc.firstChild?.attrs.id).toBe('original');
      let bold = false;
      view.state.doc.descendants(node => { if (node.isText && node.text === 'First') bold = node.marks.some(mark => mark.type.name === 'bold'); });
      expect(bold).toBe(true);
      const converted = view.state.doc;
      view.run(undo);
      expect(view.state.doc.eq(before)).toBe(true);
      view.run(redo);
      expect(view.state.doc.eq(converted)).toBe(true);
    },
  );

  it.each<BlockType>(['image', 'horizontalRule', 'table'])('refuses destructive conversion to %s', type => {
    const view = editor();
    const before = view.state.doc;
    expect(view.run(convertBlock('original', type))).toBe(false);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('preserves hard breaks through code conversion and back', () => {
    const view = editor();
    view.run(convertBlock('original', 'codeBlock'));
    expect(view.state.doc.textContent).toBe('First\nSecond');
    expect(view.state.doc.firstChild?.attrs.id).toBe('original');
    view.run(convertBlock('original', 'paragraph'));
    expect(view.state.doc.firstChild?.child(1).type.name).toBe('hardBreak');
    expect(view.state.doc.textContent).toBe('FirstSecond');
  });

  it('retains code newlines when converting code to a list', () => {
    const view = editor();
    view.run(convertBlock('original', 'codeBlock'));
    view.run(convertBlock('original', 'bulletList'));
    expect(view.state.doc.firstChild?.firstChild?.firstChild?.child(1).type.name).toBe('hardBreak');
  });

  it('preserves IDs and selection when changing the current text block', () => {
    const view = editor();
    view.run(setBlockTypeFromDomain(schema, 'heading2')!);
    expect(view.state.doc.firstChild?.attrs.id).toBe('original');
    expect(view.state.selection.from).toBe(3);
    view.run(undo);
    expect(view.state.doc.firstChild?.attrs.id).toBe('original');
    expect(view.state.selection.from).toBe(3);
  });
});
