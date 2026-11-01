import { describe, expect, it } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { history, undo } from 'prosemirror-history';
import {
  createFindReplacePlugin, setFindQuery, getFindReplaceState,
  replaceCurrent, replaceAll, findNext,
} from '$lib/adapters/prosemirror/plugins/findReplace/plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline' },
  },
  marks: { strong: {} },
});

function editor(children = [schema.text('hello hello')]) {
  let state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph', null, children)]),
    plugins: [createFindReplacePlugin(), history()],
  });
  return {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); },
  } as EditorView;
}

describe('find and replace', () => {
  it('deletes matches with an empty replacement and undoes replace-all atomically', () => {
    const view = editor();
    setFindQuery(view, 'hello');
    expect(replaceAll(view, '')).toBe(2);
    expect(view.state.doc.textContent).toBe(' ');
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.textContent).toBe('hello hello');
  });

  it('deletes the current match without constructing an empty text node', () => {
    const view = editor();
    setFindQuery(view, 'hello');
    replaceCurrent(view, '');
    expect(view.state.doc.textContent).toBe(' hello');
  });

  it('finds text across marks with correct replacement offsets', () => {
    const view = editor([
      schema.text('hel'), schema.text('lo', [schema.mark('strong')]), schema.text(' world'),
    ]);
    setFindQuery(view, 'hello');
    expect(getFindReplaceState(view.state)?.matches).toEqual([{ from: 1, to: 6 }]);
    replaceCurrent(view, 'Hi');
    expect(view.state.doc.textContent).toBe('Hi world');
  });

  it('does not match across inline atoms', () => {
    const view = editor([schema.text('hel'), schema.node('hard_break'), schema.text('lo')]);
    setFindQuery(view, 'hello');
    expect(getFindReplaceState(view.state)?.matches).toEqual([]);
  });

  it('selects the next match for scrolling and wraps around', () => {
    const view = editor();
    setFindQuery(view, 'hello');
    findNext(view);
    expect(view.state.selection.from).toBe(7);
    expect(view.state.selection.to).toBe(12);
    findNext(view);
    expect(view.state.selection.from).toBe(1);
  });

  it('ignores zero-width regex matches and tolerates invalid expressions', () => {
    const view = editor();
    setFindQuery(view, '^', { regex: true });
    expect(replaceAll(view, 'x')).toBe(0);
    setFindQuery(view, '[', { regex: true });
    expect(getFindReplaceState(view.state)?.matches).toEqual([]);
  });
});
