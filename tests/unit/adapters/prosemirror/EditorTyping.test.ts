import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { toggleList } from '$lib/adapters/prosemirror/commands/lists';
import { indentCode } from '$lib/adapters/prosemirror/commands/codeEditing';
import { createCodeBlockFromFence } from '$lib/adapters/prosemirror/commands/codeFence';
import { splitBlock } from '$lib/adapters/prosemirror/commands/blocks';
import { splitTodo, unwrapTodo } from '$lib/adapters/prosemirror/commands/todos';

const task = (text: string, checked = false) => schema.node('todoItem', { id: 'original', checked }, text ? schema.text(text) : null);
function editor(nodes: ReturnType<typeof task>[], from: number, to = from) {
  const doc = schema.node('doc', null, nodes);
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to), plugins: [history()] });
  return {
    get state() { return state; },
    run(command: Command) { return command(state, tr => { state = state.apply(tr); state.doc.check(); }); },
  };
}

describe('task typing', () => {
  it('inserts before a completed task without moving its completion or identity', () => {
    const view = editor([task('Finished task', true)], 1);
    const before = view.state.doc;
    expect(view.run(splitTodo)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe('');
    expect(view.state.doc.child(0).attrs.checked).toBe(false);
    expect(view.state.doc.child(0).attrs.id).not.toBe('original');
    expect(view.state.doc.child(1).eq(before.firstChild!)).toBe(true);
    expect(view.state.selection.from).toBe(3);
    view.run(undo);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('Enter replaces selected text, starts an unchecked task, and undoes in one step', () => {
    const view = editor([task('alpha DELETE omega', true)], 7, 13);
    const before = view.state.doc;
    expect(view.run(splitTodo)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe('alpha ');
    expect(view.state.doc.child(0).attrs.checked).toBe(true);
    expect(view.state.doc.child(1).textContent).toBe(' omega');
    expect(view.state.doc.child(1).attrs.checked).toBe(false);
    expect(view.state.doc.child(1).attrs.id).not.toBe('original');
    expect(view.run(undo)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('Enter deletes a selection spanning tasks', () => {
    const view = editor([task('first'), task('second')], 3, 11);
    expect(view.run(splitTodo)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe('fi');
    expect(view.state.doc.child(1).textContent).toBe('ond');
  });

  it('preserves active formatting when continuing a task', () => {
    const boldTask = schema.node('todoItem', null, schema.text('Bold', [schema.marks.bold!.create()]));
    const view = editor([boldTask], 5);
    view.run(splitTodo);
    expect(view.state.storedMarks?.map(mark => mark.type.name)).toContain('bold');
  });

  it.each(['', 'Keep this text'])('Backspace unwraps %s without losing text or identity', text => {
    const view = editor([task(text)], 1);
    expect(view.run(unwrapTodo)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.firstChild?.textContent).toBe(text);
    expect(view.state.doc.firstChild?.attrs.id).toBe('original');
  });

  it('Enter replaces a selection starting in an empty task', () => {
    const view = editor([task(''), task('second')], 1, 6);
    expect(view.run(splitTodo)).toBe(true);
    expect(view.state.doc.textContent).toBe('ond');
    expect(view.state.doc.lastChild?.type.name).toBe('todoItem');
    view.run(undo);
    expect(view.state.doc.textContent).toBe('second');
  });

  it('Enter exits an empty task', () => {
    const view = editor([task('')], 1);
    expect(view.run(splitTodo)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  });
});

describe('changing list types', () => {
  it('converts the nearest nested list without flattening its ancestors', () => {
    const paragraph = (text: string) => schema.node('paragraph', null, schema.text(text));
    const nested = schema.node('orderedList', { order: 3 }, schema.node('listItem', null, paragraph('Child')));
    const outer = schema.node('bulletList', null, schema.node('listItem', null, [paragraph('Parent'), nested]));
    const view = editor([outer], 13);
    const before = view.state.doc;
    expect(view.run(toggleList(schema, 'bulletList'))).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(view.state.doc.firstChild?.firstChild?.child(1).type.name).toBe('bulletList');
    expect(view.state.doc.textContent).toBe('ParentChild');
    view.run(undo);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it.each([['bulletList', 'orderedList'], ['orderedList', 'bulletList']])('converts %s to %s atomically', (source, target) => {
    const item = (text: string) => schema.node('listItem', null, schema.node('paragraph', null, schema.text(text)));
    const view = editor([schema.node(source, null, [item('First'), item('Second')])], 3);
    const before = view.state.doc;
    expect(view.run(toggleList(schema, target))).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe(target);
    expect(view.state.doc.textContent).toBe('FirstSecond');
    expect(view.run(undo)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
});


describe('paragraph and code typing', () => {
  it('Enter inserts a newline inside a code block, including over selected text', () => {
    const view = editor([schema.node('codeBlock', { language: 'js' }, schema.text('one DELETE two'))], 5, 11);
    expect(view.run(splitBlock())).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.textContent).toBe('one \n two');
    expect(view.state.doc.firstChild?.attrs.language).toBe('js');
  });

  it('Enter preserves bold formatting in a new paragraph', () => {
    const paragraph = schema.node('paragraph', null, schema.text('Bold', [schema.marks.bold!.create()]));
    const view = editor([paragraph], 5);
    expect(view.run(splitBlock())).toBe(true);
    expect(view.state.storedMarks?.map(mark => mark.type.name)).toContain('bold');
  });
});

describe('Markdown code fences', () => {
  it.each(['```', '```typescript', '```typescript title=example.ts'])('converts %s on Enter and undoes atomically', fence => {
    const view = editor([schema.node('paragraph', null, schema.text(fence))], fence.length + 1);
    const before = view.state.doc;
    expect(view.run(createCodeBlockFromFence)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(view.state.doc.firstChild?.textContent).toBe('');
    if (fence.includes('typescript')) expect(view.state.doc.firstChild?.attrs.language).toBe('typescript');
    expect(view.run(undo)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
});


describe('predictable paragraph boundaries', () => {
  it('Enter replaces selected text in a paragraph and is undoable', () => {
    const view = editor([schema.node('paragraph', null, schema.text('first DELETE last'))], 7, 13);
    const before = view.state.doc;
    expect(view.run(splitBlock())).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe('first ');
    expect(view.state.doc.child(1).textContent).toBe(' last');
    expect(view.run(undo)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
  it('splits a heading in the middle without turning the remaining title into body text', () => {
    const view = editor([schema.node('heading', { level: 2 }, schema.text('FirstSecond'))], 6);
    view.run(splitBlock());
    expect(view.state.doc.child(0).textContent).toBe('First');
    expect(view.state.doc.child(1).type.name).toBe('heading');
    expect(view.state.doc.child(1).attrs.level).toBe(2);
  });
  it('continues a quote on Enter and exits on an empty trailing line', () => {
    const paragraph = schema.node('paragraph', null, schema.text('Quote'));
    const view = editor([schema.node('blockquote', null, paragraph)], 7);
    expect(view.run(splitBlock())).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.childCount).toBe(2);
    expect(view.run(splitBlock())).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(view.state.doc.firstChild?.textContent).toBe('Quote');
  });
});


describe('code indentation', () => {
  it('inserts spaces at the caret and undoes atomically', () => {
    const view = editor([schema.node('codeBlock', null, schema.text('abc'))], 2);
    view.run(indentCode());
    expect(view.state.doc.textContent).toBe('a  bc');
    expect(view.state.selection.from).toBe(4);
    view.run(undo);
    expect(view.state.doc.textContent).toBe('abc');
  });
  it('indents selected lines without changing a line starting at the selection end', () => {
    const view = editor([schema.node('codeBlock', null, schema.text('one\ntwo\nthree'))], 1, 9);
    view.run(indentCode());
    expect(view.state.doc.textContent).toBe('  one\n  two\nthree');
    view.run(indentCode(true));
    expect(view.state.doc.textContent).toBe('one\ntwo\nthree');
  });
  it('removes a leading tab without removing code', () => {
    const view = editor([schema.node('codeBlock', null, schema.text('\tcode'))], 6);
    view.run(indentCode(true));
    expect(view.state.doc.textContent).toBe('code');
  });
  it('does not intercept Tab in ordinary text', () => {
    const view = editor([schema.node('paragraph')], 1);
    expect(view.run(indentCode())).toBe(false);
  });
});
