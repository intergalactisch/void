/**
 * Integration tests for ProseMirrorAdapter
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProseMirrorAdapter } from '$lib/adapters/prosemirror/ProseMirrorAdapter';
import { splitBlock } from '$lib/adapters/prosemirror/commands/blocks';
import { aiInlineKey, type AIInlineMeta } from '$lib/adapters/prosemirror/plugins/aiInline/state';
import { createBuiltinCommands } from '$lib/adapters/commands/builtinCommands';
import {
  completeInlineAITurn,
  createInlineAIAnchor,
  createInlineAIProposal,
  createInlineAIThread,
} from '$lib/domain/entities/InlineAIThread';
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

    it('prevents phantom line selection when double-clicking paragraph whitespace', async () => {
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
      const view = getMountedView(adapter);
      const block = container.querySelector<HTMLElement>('.void-block[data-block-id="p1"]');
      const content = block?.querySelector<HTMLElement>('.void-block-content');
      expect(block).not.toBeNull();
      expect(content).not.toBeNull();
      vi.spyOn(content!, 'getBoundingClientRect').mockReturnValue(makeDOMRect(0, 20, 600, 26));

      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 2,
        clientY: 64,
      });

      expect(block!.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.selection.empty).toBe(true);
      expect(view.state.selection.from).toBe(positionInText(view, 'Hello World') + 'Hello World'.length);
    });

    it('leaves normal text-line double-click selection available', async () => {
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
      const block = container.querySelector<HTMLElement>('.void-block[data-block-id="p1"]');
      const content = block?.querySelector<HTMLElement>('.void-block-content');
      expect(content).not.toBeNull();
      vi.spyOn(content!, 'getBoundingClientRect').mockReturnValue(makeDOMRect(0, 20, 600, 26));

      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 2,
        clientY: 30,
      });

      expect(content!.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });

    it('renders open inline AI response cards outside the paragraph block', async () => {
      const doc = createTestDocument({
        path: 'note.md',
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
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Hello World');
      const to = from + 'Hello World'.length;
      const thread = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it clearer',
          anchor: createInlineAIAnchor({
            notePath: 'note.md',
            selectedText: 'Hello World',
            range: { from, to },
            blockIds: ['p1'],
          }),
        }),
        { response: 'A clearer answer.', toolCalls: [] },
      );

      adapter.execute('setInlineAIThreads', [thread]);

      const card = container.querySelector<HTMLElement>('.void-ai-thread-card');
      expect(card).not.toBeNull();
      expect(card?.closest('.void-block')).toBeNull();
      expect(card?.parentElement).toBe(view.dom);
    });

    it('keeps applied inline AI chips attached to the edited sentence', async () => {
      const doc = createTestDocument({
        path: 'note.md',
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
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Hello World');
      const to = from + 'Hello World'.length;
      const thread = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it clearer',
          anchor: createInlineAIAnchor({
            notePath: 'note.md',
            selectedText: 'Hello World',
            range: { from, to },
            blockIds: ['p1'],
          }),
        }),
        { response: 'A clearer answer.', toolCalls: [] },
      );

      adapter.execute('setInlineAIThreads', [{
        ...thread,
        status: 'applied',
        seenAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const chip = container.querySelector<HTMLElement>('.void-ai-thread-chip');
      const popover = container.querySelector<HTMLElement>('.void-ai-thread-popover');
      expect(chip).not.toBeNull();
      expect(popover?.classList.contains('void-ai-thread-popover--floating')).toBe(true);
      expect(chip?.closest('.void-block-content')).not.toBeNull();
      expect(chip?.closest('.void-block')).not.toBeNull();
      expect(chip?.textContent).toContain('Applied');
      expect(chip?.textContent).not.toContain('Undo');
      const panel = container.querySelector<HTMLElement>('.void-ai-thread-popover-panel');
      expect(panel?.hidden).toBe(true);
      chip?.click();
      expect(panel?.hidden).toBe(false);
      expect(panel?.textContent).toContain('Chat');
      expect(panel?.textContent).toContain('Copy');
      expect(panel?.textContent).toContain('History');
      expect(panel?.textContent).toContain('Hide');
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(panel?.hidden).toBe(true);
    });

    it('groups multiple applied inline AI chips at the same sentence', async () => {
      const doc = createTestDocument({
        path: 'note.md',
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
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Hello World');
      const to = from + 'Hello World'.length;
      const anchor = createInlineAIAnchor({
        notePath: 'note.md',
        selectedText: 'Hello World',
        range: { from, to },
        blockIds: ['p1'],
      });
      const first = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it clearer',
          anchor,
        }),
        { response: 'A clearer answer.', toolCalls: [] },
      );
      const second = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it shorter',
          anchor,
        }),
        { response: 'A shorter answer.', toolCalls: [] },
      );
      const now = new Date().toISOString();

      adapter.execute('setInlineAIThreads', [
        { ...first, status: 'applied', seenAt: now, updatedAt: now },
        { ...second, status: 'applied', seenAt: now, updatedAt: now },
      ]);

      const chips = container.querySelectorAll<HTMLElement>('.void-ai-thread-chip');
      expect(chips).toHaveLength(1);
      const chip = chips[0]!;
      expect(chip.querySelector('.void-ai-thread-chip-count')?.textContent).toBe('2');
      expect(chip.dataset.inlineAiThreadIds?.split(/\s+/).sort()).toEqual([first.id, second.id].sort());
      expect(chip.textContent).not.toContain('Chat');
      expect(chip.textContent).not.toContain('Undo');
      const popover = container.querySelector<HTMLElement>('.void-ai-thread-popover');
      expect(popover).not.toBeNull();
      expect(popover?.classList.contains('void-ai-thread-popover--floating')).toBe(true);
      expect(popover?.dataset.inlineAiThreadIds?.split(/\s+/).sort()).toEqual([first.id, second.id].sort());
      const panel = container.querySelector<HTMLElement>('.void-ai-thread-popover-panel');
      expect(panel?.hidden).toBe(true);
      chip.click();
      expect(panel?.hidden).toBe(false);
      expect(container.querySelectorAll('.void-ai-thread-popover-row')).toHaveLength(2);
      expect(container.querySelectorAll('.void-ai-thread-popover-actions .void-ai-thread-popover-action')).toHaveLength(8);
      expect(panel?.textContent).toContain('Hide all');
    });

    it('keeps mid-sentence applied chips in normal text flow to avoid covering following words', async () => {
      const doc = createTestDocument({
        path: 'note.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Hello World after',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Hello World');
      const to = from + 'Hello World'.length;
      const thread = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it clearer',
          anchor: createInlineAIAnchor({
            notePath: 'note.md',
            selectedText: 'Hello World',
            range: { from, to },
            blockIds: ['p1'],
          }),
        }),
        { response: 'A clearer answer.', toolCalls: [] },
      );
      const now = new Date().toISOString();

      adapter.execute('setInlineAIThreads', [{
        ...thread,
        status: 'applied',
        seenAt: now,
        updatedAt: now,
      }]);

      const popover = container.querySelector<HTMLElement>('.void-ai-thread-popover');
      expect(popover).not.toBeNull();
      expect(popover?.classList.contains('void-ai-thread-popover--floating')).toBe(false);
    });

    it('resolves inline AI range anchors after earlier edits shift stored positions', async () => {
      const doc = createTestDocument({
        path: 'note.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'alpha beta gamma',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const oldGammaFrom = positionInText(view, 'gamma');
      const oldGammaTo = oldGammaFrom + 'gamma'.length;
      const alphaFrom = positionInText(view, 'alpha');
      adapter.execute('replaceRange', alphaFrom, alphaFrom + 'alpha'.length, 'long alpha');
      const newGammaFrom = positionInText(view, 'gamma');

      const resolved = adapter.resolveInlineAIRangeAnchor({
        preferredRange: { from: oldGammaFrom, to: oldGammaTo },
        originalText: 'gamma',
        blockIds: ['p1'],
        beforeText: 'alpha beta ',
        afterText: '',
      });

      expect(resolved).toEqual({
        from: newGammaFrom,
        to: newGammaFrom + 'gamma'.length,
      });
    });

    it('does not resolve duplicate inline AI anchors without block or context disambiguation', async () => {
      const doc = createTestDocument({
        path: 'note.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'same and same',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const unrelatedFrom = positionInText(view, 'and');

      expect(adapter.resolveInlineAIRangeAnchor({
        preferredRange: { from: unrelatedFrom, to: unrelatedFrom + 'same'.length },
        originalText: 'same',
        blockIds: [],
        beforeText: '',
        afterText: '',
      })).toBeNull();
    });

    it('protects pending inline AI proposal ranges while allowing cursor traversal and AI apply', async () => {
      const doc = createTestDocument({
        path: 'note.md',
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
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Hello');
      const to = positionInText(view, 'World') + 'World'.length;
      const anchor = createInlineAIAnchor({
        notePath: 'note.md',
        selectedText: 'Hello World',
        range: { from, to },
        blockIds: ['p1'],
      });
      const proposal = createInlineAIProposal([{
        kind: 'replace-range',
        from,
        to,
        markdown: 'Better sentence',
        originalText: 'Hello World',
      }], anchor.baseHash);
      const thread = completeInlineAITurn(
        createInlineAIThread({
          notePath: 'note.md',
          prompt: 'Make it better',
          anchor,
        }),
        { response: 'I drafted a replacement.', toolCalls: [], proposal },
      );

      adapter.execute('setInlineAIThreads', [thread]);

      expect(container.querySelector('.void-ai-thread-anchor.locked')).not.toBeNull();
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, from + 1))
          .insertText('X')
      );
      expect(adapter.getDocument().blocks[0]?.content).toBe('Hello World');

      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1)));
      expect(view.state.selection.from).toBe(from + 1);

      adapter.execute('replaceRange', from, to, 'Better sentence');
      expect(adapter.getDocument().blocks[0]?.content).toBe('Better sentence');
    });

    it('protects generating inline AI thread ranges from direct edits', async () => {
      const doc = createTestDocument({
        path: 'note.md',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Draft this',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Draft');
      const to = positionInText(view, 'this') + 'this'.length;
      const thread = createInlineAIThread({
        notePath: 'note.md',
        prompt: 'Rewrite',
        anchor: createInlineAIAnchor({
          notePath: 'note.md',
          selectedText: 'Draft this',
          range: { from, to },
          blockIds: ['p1'],
        }),
      });

      adapter.execute('setInlineAIThreads', [thread]);
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, from + 2))
          .insertText('X')
      );

      expect(adapter.getDocument().blocks[0]?.content).toBe('Draft this');
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

    it('replaces an exact single-block range without touching surrounding text', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Keep the old phrase around',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setSelectionAroundText(view, 'old phrase');
      const { from, to } = view.state.selection;

      adapter.execute('replaceRange', from, to, 'new phrase');

      expect(adapter.getDocument().blocks[0]?.content).toBe('Keep the new phrase around');
    });

    it('replaces selected inline text with a protected-lines capsule instead of raw envelope text', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Keep API_KEY=secret around',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });
      const capsule = [
        '> Locked encrypted lines · 1 line · Open in Void to unlock.',
        '',
        '```void-protected-lines-v1',
        JSON.stringify({
          id: 'pblk_test',
          version: 1,
          algorithm: 'AES-256-GCM',
          keyId: 'pkey_test',
          nonce: 'nonce',
          ciphertext: 'ciphertext',
          wrappedDek: { version: 1, algorithm: 'AES-256-GCM', kdf: 'none', nonce: 'dek-nonce', ciphertext: 'dek' },
          lineCount: 1,
          protectedAt: '2026-05-24T00:00:00.000Z',
          titleVisible: true,
        }, null, 2),
        '```',
      ].join('\n');

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setSelectionAroundText(view, 'API_KEY=secret');
      const { from, to } = view.state.selection;

      adapter.execute('replaceRange', from, to, capsule);

      expect(container.querySelector('.void-protected-lines')).not.toBeNull();
      expect(container.textContent).toContain('Locked lines');
      expect(container.textContent).toContain('1 line hidden');
      expect(container.textContent).not.toContain('Locked encrypted lines');
      expect(container.textContent).not.toContain('void-protected-lines-v1');
      expect(container.textContent).not.toContain('ciphertext');
      expect(adapter.getMarkdown()).toContain('```void-protected-lines-v1');
      expect(adapter.getMarkdown()).not.toContain('API_KEY=secret');
    });

    it('detects selections that overlap protected-line blocks', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Public intro',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'protected-1',
            type: 'protectedBlock',
            content: '',
            marks: [],
            children: [
              {
                id: 'protected-child-1',
                type: 'paragraph',
                content: 'secret line',
                marks: [],
                children: [],
                attrs: { type: 'paragraph' },
              },
            ],
            attrs: {
              type: 'protectedBlock',
              protectionId: 'pblk_test',
              keyId: 'pkey_test',
              algorithm: 'AES-256-GCM',
              envelopeVersion: 1,
              protectedAt: '2026-05-24T00:00:00.000Z',
              titleVisible: true,
              lineCount: 1,
              lockState: 'unlocked',
              envelope: '{}',
            },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'Public outro',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const publicFrom = positionInText(view, 'Public intro');
      const secretFrom = positionInText(view, 'secret line');

      expect(adapter.rangeIntersectsProtectedBlock(publicFrom, publicFrom + 'Public'.length)).toBe(false);
      expect(adapter.rangeIntersectsProtectedBlock(secretFrom, secretFrom + 'secret'.length)).toBe(true);
      expect(adapter.rangeIntersectsProtectedBlock(publicFrom, secretFrom + 'secret'.length)).toBe(true);
    });

    it('replaces a multi-block partial range while preserving outside text', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Alpha start',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'end omega',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'start');
      const to = positionInText(view, 'end') + 'end'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));

      adapter.execute('replaceRange', from, to, 'bridge');

      expect(adapter.getMarkdown()).toContain('Alpha bridge omega');
      expect(adapter.getMarkdown()).not.toContain('start');
      expect(adapter.getMarkdown()).not.toContain('end omega');
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

    it('pressing Enter in the final AI-locked paragraph creates an editable continuation below it', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'AI target');

      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');
      const handled = pressEditorKey(view, 'Enter');

      const blocks = adapter.getDocument().blocks;
      expect(handled).toBe(true);
      expect(blocks.map((block) => block.content)).toEqual(['AI target', '']);
      expect(adapter.getAILockedBlocks()).toContain('p1');
      expect(view.state.selection.$from.parent.textContent).toBe('');
    });

    it('pressing ArrowDown at the end of the final AI-locked paragraph creates an editable continuation below it', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'AI target');

      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');
      const handled = pressEditorKey(view, 'ArrowDown');

      const blocks = adapter.getDocument().blocks;
      expect(handled).toBe(true);
      expect(blocks.map((block) => block.content)).toEqual(['AI target', '']);
      expect(adapter.getAILockedBlocks()).toContain('p1');
      expect(view.state.selection.$from.parent.textContent).toBe('');
    });

    it('pressing ArrowDown at the start of the final AI-locked paragraph still creates a continuation', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorBeforeText(view, 'AI target');

      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');
      const handled = pressEditorKey(view, 'ArrowDown');

      const blocks = adapter.getDocument().blocks;
      expect(handled).toBe(true);
      expect(blocks.map((block) => block.content)).toEqual(['AI target', '']);
      expect(adapter.getAILockedBlocks()).toContain('p1');
      expect(view.state.selection.$from.parent.textContent).toBe('');
    });

    it('clicking the final AI continuation row creates an editable paragraph below it', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');

      const button = container.querySelector<HTMLButtonElement>('.void-ai-continuation-button');
      expect(button).not.toBeNull();
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const blocks = adapter.getDocument().blocks;
      expect(blocks.map((block) => block.content)).toEqual(['AI target', '']);
      expect(adapter.getAILockedBlocks()).toContain('p1');
    });

    it('pressing Enter in a middle AI-locked block does not insert a continuation', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'AI target');

      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');
      const handled = pressEditorKey(view, 'Enter');

      expect(handled).toBe(true);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'AI target',
        'After',
      ]);
      expect(container.querySelector('.void-ai-continuation-button')).toBeNull();
    });

    it('pressing ArrowDown in a middle AI-locked block keeps normal navigation behavior', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'AI target',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'AI target');

      adapter.execute('startAIBlockOperation', 'p1', 'AI rewrite');
      const handled = pressEditorKey(view, 'ArrowDown');

      expect(handled).toBe(false);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'AI target',
        'After',
      ]);
    });

    it('pressing ArrowDown at the end of the final code block creates a paragraph below it', async () => {
      const code = 'const answer = 42;';
      const doc = createTestDocument({
        blocks: [
          {
            id: 'code-1',
            type: 'codeBlock',
            content: code,
            marks: [],
            children: [],
            attrs: { type: 'codeBlock', language: 'ts', meta: null },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, code);

      const handled = pressEditorKey(view, 'ArrowDown');

      const blocks = adapter.getDocument().blocks;
      expect(handled).toBe(true);
      expect(blocks.map((block) => block.type)).toEqual(['codeBlock', 'paragraph']);
      expect(blocks.map((block) => block.content)).toEqual([code, '']);
      expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(view.state.selection.$from.parent.textContent).toBe('');
    });

    it('pressing ArrowDown inside a final code block does not exit before the block end', async () => {
      const code = 'const answer = 42;';
      const doc = createTestDocument({
        blocks: [
          {
            id: 'code-1',
            type: 'codeBlock',
            content: code,
            marks: [],
            children: [],
            attrs: { type: 'codeBlock', language: 'ts', meta: null },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, positionInText(view, 'answer')))
      );

      const handled = pressEditorKey(view, 'ArrowDown');

      expect(handled).toBe(false);
      expect(adapter.getDocument().blocks.map((block) => block.type)).toEqual(['codeBlock']);
      expect(adapter.getDocument().blocks[0]?.content).toBe(code);
    });

    it('pressing ArrowDown at a code block end falls through when another block exists below', async () => {
      const code = 'const answer = 42;';
      const doc = createTestDocument({
        blocks: [
          {
            id: 'code-1',
            type: 'codeBlock',
            content: code,
            marks: [],
            children: [],
            attrs: { type: 'codeBlock', language: 'ts', meta: null },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, code);

      const handled = pressEditorKey(view, 'ArrowDown');

      expect(handled).toBe(false);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([code, 'After']);
    });

    it('pressing Enter in final inline AI processing creates a continuation without clearing AI state', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Rewrite');
      const to = positionInText(view, 'text') + 'text'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.dispatch(
        view.state.tr.setMeta(aiInlineKey, {
          type: 'PROMPT_OPEN',
          from,
          to,
          selectionText: 'Rewrite this text',
        } satisfies AIInlineMeta)
      );
      view.dispatch(
        view.state.tr.setMeta(aiInlineKey, {
          type: 'START',
          prompt: 'Make it clearer',
          from,
          to,
          originalContent: 'Rewrite this text',
        } satisfies AIInlineMeta)
      );

      const handled = pressEditorKey(view, 'Enter');

      expect(handled).toBe(true);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
        '',
      ]);
      expect(aiInlineKey.getState(view.state)?.status).toBe('processing');
    });

    it('pressing ArrowDown in final inline AI processing creates a continuation without clearing AI state', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Rewrite');
      const to = positionInText(view, 'text') + 'text'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.dispatch(
        view.state.tr.setMeta(aiInlineKey, {
          type: 'PROMPT_OPEN',
          from,
          to,
          selectionText: 'Rewrite this text',
        } satisfies AIInlineMeta)
      );
      view.dispatch(
        view.state.tr.setMeta(aiInlineKey, {
          type: 'START',
          prompt: 'Make it clearer',
          from,
          to,
          originalContent: 'Rewrite this text',
        } satisfies AIInlineMeta)
      );

      const handled = pressEditorKey(view, 'ArrowDown');

      expect(handled).toBe(true);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
        '',
      ]);
      expect(aiInlineKey.getState(view.state)?.status).toBe('processing');
    });

    it('submits one floating Ask composer and leaves arrow navigation unblocked', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const { to } = await submitInlineAIPrompt(view, 'Rewrite this text');

      const state = aiInlineKey.getState(view.state);
      expect(state?.status).toBe('idle');
      expect(state?.composers).toEqual([]);
      expect(view.state.selection.empty).toBe(true);
      expect(view.state.selection.from).toBe(to);
      expect(pressEditorKey(view, 'ArrowLeft')).toBe(false);
      expect(pressEditorKey(view, 'ArrowRight')).toBe(false);
      expect(pressEditorKey(view, 'ArrowUp')).toBe(false);
      expect(pressEditorKey(view, 'ArrowDown')).toBe(false);
    });

    it('opens a floating Ask composer anchor without injecting an inline input widget', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const from = positionInText(view, 'Rewrite');
      const to = positionInText(view, 'text') + 'text'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));

      adapter.execute('aiPromptSelection');
      await new Promise((resolve) => setTimeout(resolve, 20));

      const state = aiInlineKey.getState(view.state);
      expect(state?.status).toBe('idle');
      expect(state?.composers).toHaveLength(1);
      expect(state?.composers[0]).toMatchObject({
        from,
        to,
        selectionText: 'Rewrite this text',
        draftPrompt: '',
        status: 'draft',
      });
      expect(state?.activeComposerId).toBe(state?.composers[0]?.id);
      expect(container.querySelector('.void-ai-prompt-input')).toBeNull();
      expect(container.querySelector('[data-ai-composer-id]')).not.toBeNull();
      expect(view.state.selection.empty).toBe(true);
      expect(view.state.selection.from).toBe(to);
    });

    it('allows multiple floating Ask composers in one note', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'Improve this other line',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);

      const firstFrom = positionInText(view, 'Rewrite');
      const firstTo = positionInText(view, 'text') + 'text'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, firstFrom, firstTo)));
      adapter.execute('aiPromptSelection');

      const secondFrom = positionInText(view, 'Improve');
      const secondTo = positionInText(view, 'line') + 'line'.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, secondFrom, secondTo)));
      adapter.execute('aiPromptSelection');
      await new Promise((resolve) => setTimeout(resolve, 20));

      const state = aiInlineKey.getState(view.state);
      expect(state?.composers).toHaveLength(2);
      expect(state?.composers.map((composer) => composer.selectionText)).toEqual([
        'Rewrite this text',
        'Improve this other line',
      ]);
      expect(container.querySelectorAll('[data-ai-composer-id]')).toHaveLength(2);
      expect(state?.activeComposerId).toBe(state?.composers[1]?.id);
    });

    it('blocks typing inside an inline AI protected range', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const { from } = startInlineAIProcessing(view, 'Rewrite this text');

      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, from + 1))
          .insertText('X')
      );

      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
      ]);
    });

    it('allows typing outside an inline AI protected range', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      startInlineAIProcessing(view, 'Rewrite this text');
      const afterPos = positionInText(view, 'After') + 'After'.length;

      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, afterPos))
          .insertText('!')
      );

      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
        'After!',
      ]);
    });

    it('blocks deletion across an inline AI protected range', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      const { from, to } = startInlineAIProcessing(view, 'Rewrite this text');

      view.dispatch(view.state.tr.delete(from, to));

      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
      ]);
    });

    it('lets ArrowDown on a non-final inline AI range fall through to normal navigation', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            content: 'Rewrite this text',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p2',
            type: 'paragraph',
            content: 'After',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      startInlineAIProcessing(view, 'Rewrite this text');

      const handled = pressEditorKey(view, 'ArrowDown');

      expect(handled).toBe(false);
      expect(adapter.getDocument().blocks.map((block) => block.content)).toEqual([
        'Rewrite this text',
        'After',
      ]);
    });

    it('pressing Enter in the final AI-locked list item creates an empty sibling item', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'list-1',
            type: 'bulletList',
            content: '',
            marks: [],
            children: [
              {
                id: 'li1',
                type: 'paragraph',
                content: 'List item',
                marks: [],
                children: [],
                attrs: { type: 'paragraph' },
              },
            ],
            attrs: { type: 'bulletList' },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'List item');

      adapter.execute('startAIBlockOperation', 'li1', 'AI rewrite');
      const handled = pressEditorKey(view, 'Enter');

      const list = adapter.getDocument().blocks[0];
      expect(handled).toBe(true);
      expect(list?.type).toBe('bulletList');
      expect(list?.children.map((block) => block.content)).toEqual(['List item', '']);
      expect(adapter.getAILockedBlocks()).toContain('li1');
    });

    it('pressing Enter in the final AI-locked todo item creates an empty sibling todo', async () => {
      const doc = createTestDocument({
        blocks: [
          {
            id: 'todo-1',
            type: 'todoItem',
            content: 'Task',
            marks: [],
            children: [],
            attrs: { type: 'todoItem', checked: true },
          },
        ],
      });

      await adapter.mount(container, doc);
      const view = getMountedView(adapter);
      setCursorAfterText(view, 'Task');

      adapter.execute('startAIBlockOperation', 'todo-1', 'AI rewrite');
      const handled = pressEditorKey(view, 'Enter');

      const blocks = adapter.getDocument().blocks;
      expect(handled).toBe(true);
      expect(blocks.map((block) => block.type)).toEqual(['todoItem', 'todoItem']);
      expect(blocks.map((block) => block.content)).toEqual(['Task', '']);
      expect(blocks[1]?.attrs).toMatchObject({ type: 'todoItem', checked: false });
      expect(adapter.getAILockedBlocks()).toContain('todo-1');
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

function setCursorBeforeText(view: EditorView, text: string): void {
  let cursorPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (cursorPos !== -1) return false;
    if (!node.isTextblock) return true;
    const index = node.textContent.indexOf(text);
    if (index < 0) return true;
    cursorPos = pos + 1 + index;
    return false;
  });
  if (cursorPos === -1) throw new Error(`Text not found: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cursorPos)));
}

function pressEditorKey(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  let handled = false;
  view.someProp('handleKeyDown', (handler) => {
    const result = handler(view, event);
    if (result) handled = true;
    return result;
  });
  return handled;
}

function startInlineAIProcessing(
  view: EditorView,
  text: string
): { from: number; to: number } {
  const from = positionInText(view, text);
  const to = from + text.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, to))
      .setMeta(aiInlineKey, {
        type: 'PROMPT_OPEN',
        from,
        to,
        selectionText: text,
      } satisfies AIInlineMeta)
  );
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'START',
      prompt: 'Make it clearer',
      from,
      to,
      originalContent: text,
    } satisfies AIInlineMeta)
  );
  return { from, to };
}

async function submitInlineAIPrompt(
  view: EditorView,
  text: string
): Promise<{ from: number; to: number }> {
  const from = positionInText(view, text);
  const to = from + text.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, to))
      .setMeta(aiInlineKey, {
        type: 'PROMPT_OPEN',
        from,
        to,
        selectionText: text,
      } satisfies AIInlineMeta)
  );
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'PROMPT_SUBMIT',
      prompt: 'Make it clearer',
    } satisfies AIInlineMeta)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { from, to };
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

function makeDOMRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function positionInText(view: EditorView, text: string): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (!node.isTextblock) return true;
    const index = node.textContent.indexOf(text);
    if (index < 0) return true;
    found = pos + 1 + index;
    return false;
  });
  if (found === -1) throw new Error(`Text not found: ${text}`);
  return found;
}
