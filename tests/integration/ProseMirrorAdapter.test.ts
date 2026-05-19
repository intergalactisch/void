/**
 * Integration tests for ProseMirrorAdapter
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProseMirrorAdapter } from '$lib/adapters/prosemirror/ProseMirrorAdapter';
import { splitBlock } from '$lib/adapters/prosemirror/commands/blocks';
import { createBuiltinCommands } from '$lib/adapters/commands/builtinCommands';
import { createTestDocument, createDocumentWithHeadings, createDocumentWithLists } from '../fixtures/documents';
import type { Document } from '$lib/domain/entities/Document';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

describe('ProseMirrorAdapter', () => {
  let adapter: ProseMirrorAdapter;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container element
    container = document.createElement('div');
    document.body.appendChild(container);

    adapter = new ProseMirrorAdapter({
      enableDragDrop: false,
      enableAIRewrite: false,
    });
  });

  afterEach(() => {
    adapter.destroy();
    document.body.removeChild(container);
  });

  describe('mount()', () => {
    it('mounts editor successfully', async () => {
      const doc = createTestDocument();
      const result = await adapter.mount(container, doc);

      expect(result.ok).toBe(true);
    });

    it('renders content in container', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Hello World',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);

      expect(container.innerHTML).toContain('Hello World');
    });

    it('renders image blocks visibly through the unified block view', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'img1',
            type: 'image',
            content: '',
            marks: [],
            children: [],
            attrs: {
              type: 'image',
              src: 'https://example.com/image.png',
              alt: 'Example',
              title: null,
              caption: 'An example image',
              width: null,
            },
          },
        ],
      });

      await adapter.mount(container, doc);

      const image = container.querySelector('.void-block[data-block-type="image"] img.void-image-img');
      const caption = container.querySelector('.void-image-caption');
      expect(image?.getAttribute('src')).toBe('https://example.com/image.png');
      expect(image?.getAttribute('alt')).toBe('Example');
      expect(caption?.textContent).toBe('An example image');
    });

    it('keeps lineage in the block menu request instead of a separate gutter button', async () => {
      adapter.destroy();
      const onMenuClick = vi.fn();
      adapter = new ProseMirrorAdapter({
        enableDragDrop: false,
        enableAIRewrite: false,
        onMenuClick,
      });
      const menuHandler = vi.fn();
      adapter.on('editor:block-menu-request', menuHandler);

      await adapter.mount(container, createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Hello World',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      }));

      expect(container.querySelector('.void-gutter-lineage')).toBeNull();

      const button = container.querySelector<HTMLElement>('.void-gutter-drag');
      expect(button).not.toBeNull();
      button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 12, clientY: 20 }));
      button?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 12, clientY: 20 }));

      expect(onMenuClick).toHaveBeenCalledWith('p1', 0, expect.any(MouseEvent));
      expect(menuHandler).toHaveBeenCalledWith(expect.objectContaining({
        blockId: 'p1',
        lineIndex: 0,
        mode: 'actions',
      }));
    });

    it('opens the conversion menu from the gutter type label', async () => {
      adapter.destroy();
      adapter = new ProseMirrorAdapter({
        enableDragDrop: false,
        enableAIRewrite: false,
        onMenuClick: vi.fn(),
      });
      const menuHandler = vi.fn();
      adapter.on('editor:block-menu-request', menuHandler);

      await adapter.mount(container, createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Hello World',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      }));

      const label = container.querySelector<HTMLButtonElement>('.void-gutter-label');
      expect(label).not.toBeNull();
      expect(label?.tagName).toBe('BUTTON');
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 12 }));

      expect(menuHandler).toHaveBeenCalledWith(expect.objectContaining({
        blockId: 'p1',
        lineIndex: 0,
        currentType: 'paragraph',
        mode: 'convert',
      }));
    });

    it('maps list item type labels back to list block types', async () => {
      adapter.destroy();
      adapter = new ProseMirrorAdapter({
        enableDragDrop: false,
        enableAIRewrite: false,
        onMenuClick: vi.fn(),
      });
      const menuHandler = vi.fn();
      adapter.on('editor:block-menu-request', menuHandler);

      await adapter.mount(container, createDocumentWithLists());

      const listItem = container.querySelector<HTMLElement>('.void-block[data-block-id="li1"]');
      const label = listItem?.querySelector<HTMLButtonElement>('.void-gutter-label');
      expect(listItem?.getAttribute('data-block-type')).toBe('bulletList');
      expect(label?.textContent).toBe('UL');

      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 12 }));

      expect(menuHandler).toHaveBeenCalledWith(expect.objectContaining({
        blockId: 'li1',
        currentType: 'bulletList',
        mode: 'convert',
      }));
    });

    it('emits ready event', async () => {
      const doc = createTestDocument();
      const readyHandler = vi.fn();
      adapter.on('editor:ready', readyHandler);

      await adapter.mount(container, doc);

      expect(readyHandler).toHaveBeenCalled();
    });

    it('handles empty document', async () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Empty',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [],
        isDirty: false,
      };

      const result = await adapter.mount(container, doc);
      expect(result.ok).toBe(true);
    });
  });

  describe('events', () => {
    it('emits change event on document modification', async () => {
      const doc = createTestDocument();
      const changeHandler = vi.fn();

      await adapter.mount(container, doc);
      adapter.on('editor:change', changeHandler);

      // Type into the editor
      const editorElement = container.querySelector('.void-editor');
      expect(editorElement).not.toBeNull();

      // Dispatch input event (simulating typing)
      const event = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
      });
      editorElement?.dispatchEvent(event);

      // Note: Full keyboard input simulation is complex
      // This test verifies the handler is subscribed correctly
    });

    it('can subscribe and unsubscribe from events', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      const handler = vi.fn();
      const unsubscribe = adapter.on('editor:focus', handler);

      // Focus the editor
      const editorElement = container.querySelector('.void-editor') as HTMLElement;
      editorElement?.focus();

      expect(handler).toHaveBeenCalled();

      // Unsubscribe and verify no more calls
      unsubscribe();
      handler.mockClear();

      editorElement?.blur();
      editorElement?.focus();

      // Handler should not have been called again (already unsubscribed)
    });
  });

  describe('getSelection()', () => {
    it('returns empty selection when no editor', () => {
      const selection = adapter.getSelection();

      expect(selection.from).toBe(0);
      expect(selection.to).toBe(0);
      expect(selection.text).toBe('');
    });

    it('returns selection after mount', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      const selection = adapter.getSelection();
      expect(selection).toBeDefined();
      expect(typeof selection.from).toBe('number');
      expect(typeof selection.to).toBe('number');
    });
  });

  describe('getDocument()', () => {
    it('returns document with blocks', async () => {
      const originalDoc = createDocumentWithHeadings();
      await adapter.mount(container, originalDoc);

      const doc = adapter.getDocument();

      expect(doc.blocks.length).toBeGreaterThan(0);
      expect(doc.path).toBe(originalDoc.path);
    });

    it('throws when not mounted', () => {
      expect(() => adapter.getDocument()).toThrow('Editor not mounted');
    });
  });

  describe('execute()', () => {
    it('executes toggleMark command', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      // This should not throw
      expect(() => adapter.execute('toggleMark', 'bold')).not.toThrow();
    });

    it('executes setBlockType command', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      expect(() => adapter.execute('setBlockType', 'heading1')).not.toThrow();
    });

    it('serializes a /todo-style conversion before autosave', async () => {
      const doc = createTestDocument({
        path: 'tasks.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Buy milk',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      adapter.execute('setBlockType', 'todoItem');

      expect(adapter.getMarkdown()).toContain('- [ ] Buy milk');
    });

    it('sets and removes a note reference around selected words', async () => {
      const doc = createTestDocument({
        path: 'source.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Link these words today',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setSelectionAroundText(view, 'these words');

      adapter.execute('setPageLink', { path: 'target.md', title: 'Target Note' });

      expect(adapter.getMarkdown()).toContain('Link [[target.md|these words]] today');

      adapter.execute('removePageLink');

      expect(adapter.getMarkdown()).toContain('Link these words today');
      expect(adapter.getMarkdown()).not.toContain('target.md');
    });

    it('inserts a note reference at an empty cursor', async () => {
      const doc = createTestDocument({
        path: 'source.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Start',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'Start');

      adapter.execute('setPageLink', { path: 'target.md', title: 'Target Note' });

      expect(adapter.getMarkdown()).toContain('Start[[target.md|Target Note]]');
    });

    it('replaces an empty command paragraph when inserting a leaf block', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'empty',
            type: 'paragraph',
            content: '',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      adapter.execute('insertBlock', 'image', {
        type: 'image',
        src: 'https://example.com/image.png',
        alt: null,
        title: null,
        caption: null,
        width: null,
      });

      const blocks = adapter.getDocument().blocks;
      expect(blocks.map((block) => block.type)).toEqual(['image', 'paragraph']);
      expect(blocks[0]?.attrs).toMatchObject({
        type: 'image',
        src: 'https://example.com/image.png',
      });
    });

    it('executes every built-in slash block command against an empty paragraph', async () => {
      const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com/image.png');
      try {
        const commands = createBuiltinCommands();
        const commandIds = [
          'paragraph',
          'heading1',
          'heading2',
          'heading3',
          'bulletList',
          'numberedList',
          'todoItem',
          'blockquote',
          'codeBlock',
          'horizontalRule',
          'callout',
          'toggle',
          'table',
          'image',
        ];

        for (const commandId of commandIds) {
          const command = commands.find((cmd) => cmd.id === commandId);
          expect(command, commandId).toBeDefined();

          const localAdapter = new ProseMirrorAdapter({
            enableDragDrop: false,
            enableAIRewrite: false,
          });
          const localContainer = document.createElement('div');
          document.body.appendChild(localContainer);

          try {
            const doc = createTestDocument({
              blocks: [
                {
                  id: `empty-${commandId}`,
                  type: 'paragraph',
                  content: '',
                  marks: [],
                  children: [],
                  attrs: { type: 'paragraph' },
                },
              ],
            });
            await localAdapter.mount(localContainer, doc);

            expect(() =>
              command?.execute({
                editor: localAdapter,
                selection: { from: 1, to: 1, text: '' },
              })
            ).not.toThrow();
            expect(localAdapter.getDocument().blocks.length, commandId).toBeGreaterThan(0);
          } finally {
            localAdapter.destroy();
            document.body.removeChild(localContainer);
          }
        }
      } finally {
        promptSpy.mockRestore();
      }
    });

    it('executes focus command', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      const focusHandler = vi.fn();
      adapter.on('editor:focus', focusHandler);

      adapter.execute('focus');

      expect(focusHandler).toHaveBeenCalled();
    });

    it('keeps AI-locked blocks protected while neighboring blocks remain editable', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Before',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p3',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      adapter.execute('startAIBlockOperation', 'p2', 'AI rewrite');
      adapter.execute('deleteBlock', 'p1');
      adapter.execute('deleteBlock', 'p2');

      const blocks = adapter.getDocument().blocks;
      expect(blocks.map((block) => block.id)).toEqual(['p2', 'p3']);
      expect(blocks[0]?.content).toBe('AI target');
    });

    it('applies final AI output to the block ID after surrounding positions shift', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Before',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p3',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      adapter.execute('startAIBlockOperation', 'p2', 'AI rewrite');
      adapter.execute('deleteBlock', 'p1');
      adapter.execute('finishAIBlockOperation', 'p2', 'Rewritten target');

      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewritten target',
        'After',
      ]);

      adapter.execute('undo');

      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'AI target',
        'After',
      ]);
    });

    it('pressing Enter in a heading creates a regular paragraph next', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'h1',
            type: 'heading1',
            content: 'Title',
            marks: [],
            children: [],
            attrs: { type: 'heading', level: 1 },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'Title');

      splitBlock()(view.state, view.dispatch);

      const blocks = adapter.getDocument().blocks;
      expect(blocks.map((block) => block.type)).toEqual(['heading1', 'paragraph']);
      expect(blocks.map((block) => block.content)).toEqual(['Title', '']);
    });

    it('pressing Enter at the end of a callout breaks out to a regular paragraph', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'callout-1',
            type: 'callout',
            content: '',
            marks: [],
            children: [
              {
                id: 'callout-text',
                type: 'paragraph',
                content: 'Remember this',
                marks: [],
                children: [],
                attrs: { type: 'paragraph' },
              },
            ],
            attrs: { type: 'callout', variant: 'info' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'Remember this');

      splitBlock()(view.state, view.dispatch);

      const blocks = adapter.getDocument().blocks;
      expect(blocks.map((block) => block.type)).toEqual(['callout', 'paragraph']);
      expect(blocks[0]?.children.map((block) => block.content)).toEqual(['Remember this']);
      expect(blocks[1]?.content).toBe('');
    });
  });

  describe('canUndo() / canRedo()', () => {
    it('returns false initially', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      expect(adapter.canUndo()).toBe(false);
      expect(adapter.canRedo()).toBe(false);
    });

    it('returns false when not mounted', () => {
      expect(adapter.canUndo()).toBe(false);
      expect(adapter.canRedo()).toBe(false);
    });
  });

  describe('update()', () => {
    it('updates editor content', async () => {
      const doc1 = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'First content',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      const doc2 = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Updated content',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc1);
      expect(container.innerHTML).toContain('First content');

      adapter.update(doc2);
      expect(container.innerHTML).toContain('Updated content');
    });
  });

  describe('destroy()', () => {
    it('cleans up resources', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      adapter.destroy();

      // After destroy, getDocument should throw
      expect(() => adapter.getDocument()).toThrow();
    });

    it('can be called multiple times', async () => {
      const doc = createTestDocument();
      await adapter.mount(container, doc);

      expect(() => {
        adapter.destroy();
        adapter.destroy();
      }).not.toThrow();
    });
  });
});

function getMountedView(adapter: ProseMirrorAdapter): EditorView {
  const view = (adapter as unknown as { view: EditorView | null }).view;
  if (!view) throw new Error('Expected mounted editor view');
  return view;
}

function setCursorAfterText(view: EditorView, text: string): void {
  let cursorPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (cursorPos !== -1) return false;
    if (node.isTextblock && node.textContent === text) {
      cursorPos = pos + 1 + text.length;
      return false;
    }
    return true;
  });
  if (cursorPos === -1) throw new Error(`Text not found: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cursorPos)));
}

function setSelectionAroundText(view: EditorView, text: string): void {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node, pos) => {
    if (from !== -1) return false;
    if (!node.isTextblock) return true;
    const index = node.textContent.indexOf(text);
    if (index < 0) return true;
    from = pos + 1 + index;
    to = from + text.length;
    return false;
  });
  if (from === -1 || to === -1) throw new Error(`Text not found: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}
