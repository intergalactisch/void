import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
const { tokenize } = vi.hoisted(() => ({ tokenize: vi.fn((_code: string) => []) }));
vi.mock('shiki/core', () => ({ createBundledHighlighter: () => async () => ({ getLoadedLanguages: () => ['typescript'], codeToTokensWithThemes: tokenize }) }));
import { createCodeHighlightPlugin } from '$lib/adapters/prosemirror/plugins/codeHighlight';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; vi.unstubAllGlobals(); tokenize.mockClear(); });

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function setup() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const doc = schema.node('doc', null, schema.node('codeBlock', { language: 'ts' }, schema.text('const n = 0;')));
  view = new EditorView(document.createElement('div'), { state: EditorState.create({ doc, plugins: [createCodeHighlightPlugin()] }) });
  return { editor: view, async frame() { const pending = frames.splice(0); for (const callback of pending) callback(0); await settle(); } };
}

describe('code highlighting under rapid edits', () => {
  it('highlights only the latest content of a burst, reuses current tokens, and evicts old revisions', async () => {
    const { editor, frame } = setup();
    await frame(); await frame();
    expect(tokenize).toHaveBeenCalledTimes(1);
    const original = editor.state.doc;
    for (let i = 0; i < 100; i++) editor.dispatch(editor.state.tr.insertText('x', 1));
    expect(tokenize).toHaveBeenCalledTimes(1);
    await frame(); await frame();
    expect(tokenize).toHaveBeenCalledTimes(2);
    expect(tokenize.mock.calls[1]?.[0]).toBe('x'.repeat(100) + 'const n = 0;');
    editor.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, original.content));
    await frame(); await frame();
    expect(tokenize).toHaveBeenCalledTimes(3);
  });
  it('does no delayed highlighting after the editor is destroyed', async () => {
    const { editor, frame } = setup();
    editor.destroy(); view = null;
    await frame();
    expect(tokenize).not.toHaveBeenCalled();
  });
});
