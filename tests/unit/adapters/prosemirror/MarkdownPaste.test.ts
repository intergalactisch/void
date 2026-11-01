import { historyPlugin, historyBoundaryPlugin } from '$lib/adapters/prosemirror/plugins/history';
import { undo, redo } from 'prosemirror-history';
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { createMarkdownPastePlugin } from '$lib/adapters/prosemirror/plugins/markdownPaste';

function paste(text: string, plain = false, code = false) {
  const plugin = createMarkdownPastePlugin();
  const view = new EditorView(document.createElement('div'), { state: EditorState.create({
    schema, doc: schema.node('doc', null, schema.node(code ? 'codeBlock' : 'paragraph')), plugins: [plugin],
  }) });
  try {
    if (plain) {
      const slice = plugin.props.clipboardTextParser!.call(plugin, text, view.state.selection.$from, true, view);
      view.dispatch(view.state.tr.replaceSelection(slice));
    } else {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }
    view.state.doc.check();
    return view.state.doc;
  } finally { view.destroy(); }
}

describe('Markdown clipboard', () => {
  it('pastes headings, tasks and fenced code as editable blocks', () => {
    const doc = paste('# Plan\n\n- [ ] First\n\n```ts\nconst n = 1;\n```');
    const types: string[] = [];
    doc.forEach(node => types.push(node.type.name));
    expect(types).toEqual(['heading', 'todoItem', 'codeBlock']);
    expect(doc.lastChild?.attrs.language).toBe('ts');
  });
  it('preserves literal Markdown when explicitly pasting plain text', () => {
    const doc = paste('# Plan\n- [ ] First', true);
    expect(doc.firstChild?.type.name).toBe('paragraph');
    expect(doc.firstChild?.textContent).toBe('# Plan');
    expect(doc.lastChild?.textContent).toBe('- [ ] First');
  });
  it('keeps ordinary multiline text and angle brackets intact', () => {
    const doc = paste('hello\r\n<example>\r\nworld');
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).textContent).toBe('<example>');
  });
  it('keeps pasted Markdown literal inside code', () => {
    const doc = paste('# Plan\r\n- [ ] First', false, true);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe('codeBlock');
    expect(doc.textContent).toBe('# Plan\n- [ ] First');
  });
});


describe('clipboard history', () => {
  function createView(text: string) {
    return new EditorView(document.createElement('div'), { state: EditorState.create({
      schema, doc: schema.node('doc', null, schema.node('paragraph', null, schema.text(text))),
      plugins: [historyPlugin(), historyBoundaryPlugin(), createMarkdownPastePlugin()],
    }) });
  }
  function clipboard(view: EditorView, text: string, html?: string) {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    if (html) clipboardData.setData('text/html', html);
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }
  it('keeps typing before and after a paste in separate undo steps', () => {
    const view = createView('Start');
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)).insertText(' before'));
      clipboard(view, ' pasted');
      view.dispatch(view.state.tr.insertText(' after'));
      expect(view.state.doc.textContent).toBe('Start before pasted after');
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Start before pasted');
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Start before');
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Start');
      for (let i = 0; i < 3; i++) redo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Start before pasted after');
    } finally { view.destroy(); }
  });
  it('restores selected text and selection after undoing a formatted paste', () => {
    const view = createView('Keep DELETE end');
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 12)));
      clipboard(view, '**replacement**');
      expect(view.state.doc.textContent).toBe('Keep replacement end');
      expect(view.state.doc.firstChild?.child(1).marks[0]?.type.name).toBe('bold');
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Keep DELETE end');
      expect([view.state.selection.from, view.state.selection.to]).toEqual([6, 12]);
      redo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Keep replacement end');
    } finally { view.destroy(); }
  });
  it('inherits explicitly enabled formatting for plain clipboard text', () => {
    const view = createView('Start');
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6))
        .addStoredMark(schema.marks.italic!.create()));
      clipboard(view, 'typed style');
      expect(view.state.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe('italic');
    } finally { view.destroy(); }
  });
  it('retains rich HTML clipboard formatting', () => {
    const view = createView('Start');
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
      clipboard(view, 'Bold', '<p><strong>Bold</strong></p>');
      expect(view.state.doc.textContent).toBe('StartBold');
      expect(view.state.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe('bold');
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe('Start');
    } finally { view.destroy(); }
  });
});
