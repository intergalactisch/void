/**
 * Integration tests for Editor Store
 *
 * Tests the EditorStore reactive state management using a mock EditorService.
 * The store uses Svelte 5 runes ($state, $derived) and wraps the EditorService
 * port to provide reactive state to UI components.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { editorStore } from '$lib/stores/editor.svelte';
import type { EditorService, EditorState } from '$lib/ports/inbound';
import type { Document, Block } from '$lib/domain';
import { EMPTY_SELECTION } from '$lib/domain/values';
import { ok, err } from '$lib/core';

/**
 * Creates a mock Document for testing.
 */
function createMockDocument(): Document {
  return {
    meta: {
      id: 'doc-1',
      title: 'Test Document',
      tags: [],
      category: null,
      color: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pinned: false,
      status: 'draft',
      intent: 'general',
      aiTouches: 0,
      custom: {},
    },
    path: 'test.md',
    blocks: [],
    isDirty: false,
  };
}

/**
 * Creates a mock EditorService for testing.
 * Includes internal state and methods to trigger subscriber callbacks.
 */
function createMockEditorService(): EditorService & {
  _state: EditorState;
  _subscribers: Set<(state: EditorState) => void>;
  _triggerSubscribers: () => void;
} {
  const subscribers = new Set<(state: EditorState) => void>();
  const state: EditorState = {
    document: null,
    tabs: [],
    activePath: null,
    activePaneId: null,
    panes: {},
    selection: EMPTY_SELECTION,
    isReady: false,
    isDirty: false,
    isSaving: false,
    conflictState: 'clean',
    aiProcessing: null,
    aiInlineComposers: [],
    activeAIInlineComposerId: null,
  };

  return {
    _state: state,
    _subscribers: subscribers,
    _triggerSubscribers: () => subscribers.forEach((cb) => cb({ ...state })),

    getState: vi.fn().mockImplementation(() => ({ ...state })),

    openDocument: vi.fn().mockImplementation(async () => {
      state.document = createMockDocument();
      state.isReady = true;
      subscribers.forEach((cb) => cb({ ...state }));
      return ok(state.document);
    }),

    saveDocument: vi.fn().mockResolvedValue(ok(undefined)),

    updateDocumentMeta: vi.fn().mockImplementation((updates) => {
      if (!state.document) return err(new Error('No document open'));
      state.document = {
        ...state.document,
        meta: { ...state.document.meta, ...updates },
        isDirty: true,
      };
      state.isDirty = true;
      subscribers.forEach((cb) => cb({ ...state }));
      return ok(state.document);
    }),

    closeDocument: vi.fn().mockImplementation(() => {
      state.document = null;
      state.tabs = [];
      state.activePath = null;
      state.isReady = false;
      state.isDirty = false;
      subscribers.forEach((cb) => cb({ ...state }));
    }),

    switchTab: vi.fn().mockResolvedValue(ok(undefined)),
    closeTab: vi.fn().mockResolvedValue(ok(undefined)),
    resolveConflict: vi.fn().mockResolvedValue(ok(undefined)),

    createDocument: vi.fn().mockImplementation(async (_path: string, title?: string) => {
      const doc = createMockDocument();
      if (title) {
        doc.meta.title = title;
      }
      state.document = doc;
      state.isReady = true;
      subscribers.forEach((cb) => cb({ ...state }));
      return ok(doc);
    }),

    insertBlock: vi.fn(),
    deleteBlock: vi.fn(),
    moveBlock: vi.fn(),
    updateBlock: vi.fn(),

    executeCommand: vi.fn().mockResolvedValue(undefined),

    toggleMark: vi.fn(),
    setBlockType: vi.fn(),

    focus: vi.fn(),
    getSelection: vi.fn().mockReturnValue(EMPTY_SELECTION),

    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: vi.fn().mockReturnValue(false),
    canRedo: vi.fn().mockReturnValue(false),

    subscribe: vi.fn().mockImplementation((cb: (state: EditorState) => void) => {
      subscribers.add(cb);
      cb(state);
      return () => subscribers.delete(cb);
    }),
  };
}

describe('Editor Store Integration', () => {
  let mockService: ReturnType<typeof createMockEditorService>;

  beforeEach(() => {
    mockService = createMockEditorService();
    // Ensure store is reset
    editorStore.destroy();
  });

  afterEach(() => {
    editorStore.destroy();
    vi.clearAllMocks();
  });

  describe('init()', () => {
    it('accepts service and subscribes to state', () => {
      editorStore.init(mockService);

      expect(editorStore.isInitialized).toBe(true);
      expect(mockService.subscribe).toHaveBeenCalled();
      expect(mockService.getState).toHaveBeenCalled();
    });

    it('subscribes to state updates', () => {
      editorStore.init(mockService);

      // Verify subscription was set up
      expect(mockService._subscribers.size).toBe(1);
    });

    it('updates store state when service state changes', () => {
      editorStore.init(mockService);

      const doc = createMockDocument();
      mockService._state.document = doc;
      mockService._state.isReady = true;
      mockService._state.isDirty = true;
      mockService._state.isSaving = true;
      mockService._state.selection = {
        from: 0,
        to: 5,
        text: 'hello',
        anchorBlockId: 'block-1',
        headBlockId: 'block-1',
      };
      mockService._state.aiProcessing = { blockId: 'block-1', operation: 'expand' };

      // Trigger subscriber callback
      mockService._triggerSubscribers();

      expect(editorStore.document).toEqual(doc);
      expect(editorStore.isReady).toBe(true);
      expect(editorStore.isDirty).toBe(true);
      expect(editorStore.isSaving).toBe(true);
      expect(editorStore.selection.text).toBe('hello');
      expect(editorStore.aiProcessing).toEqual({ blockId: 'block-1', operation: 'expand' });
    });

    it('cleans up previous subscription when re-initialized', () => {
      editorStore.init(mockService);
      expect(mockService._subscribers.size).toBe(1);

      // Re-initialize with new service
      const newMockService = createMockEditorService();
      editorStore.init(newMockService);

      // Old subscription should be removed
      expect(mockService._subscribers.size).toBe(0);
      expect(newMockService._subscribers.size).toBe(1);
    });
  });

  describe('loadDocument()', () => {
    it('calls service.openDocument() and returns result', async () => {
      editorStore.init(mockService);

      const result = await editorStore.loadDocument('test.md');

      expect(mockService.openDocument).toHaveBeenCalledWith('test.md');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.path).toBe('test.md');
      }
    });

    it('sets error state on failure', async () => {
      editorStore.init(mockService);

      const testError = new Error('Failed to load document');
      mockService.openDocument = vi.fn().mockResolvedValue(err(testError));

      const result = await editorStore.loadDocument('nonexistent.md');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(testError);
      }
      expect(editorStore.error).toEqual(testError);
    });

    it('clears error on new load attempt', async () => {
      editorStore.init(mockService);

      // First load fails
      mockService.openDocument = vi.fn().mockResolvedValue(err(new Error('Failed')));
      await editorStore.loadDocument('bad.md');
      expect(editorStore.error).not.toBeNull();

      // Second load succeeds
      mockService.openDocument = vi.fn().mockResolvedValue(ok(createMockDocument()));
      await editorStore.loadDocument('good.md');
      expect(editorStore.error).toBeNull();
    });

    it('throws if not initialized', async () => {
      await expect(editorStore.loadDocument('test.md')).rejects.toThrow(
        'EditorStore not initialized'
      );
    });
  });

  describe('saveDocument()', () => {
    it('calls service.saveDocument() and returns result', async () => {
      editorStore.init(mockService);

      const result = await editorStore.saveDocument();

      expect(mockService.saveDocument).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('sets error state on failure', async () => {
      editorStore.init(mockService);

      const testError = new Error('Failed to save');
      mockService.saveDocument = vi.fn().mockResolvedValue(err(testError));

      const result = await editorStore.saveDocument();

      expect(result.ok).toBe(false);
      expect(editorStore.error).toEqual(testError);
    });

    it('clears error on successful save', async () => {
      editorStore.init(mockService);

      // Set an error first
      mockService.saveDocument = vi.fn().mockResolvedValue(err(new Error('Failed')));
      await editorStore.saveDocument();
      expect(editorStore.error).not.toBeNull();

      // Successful save clears error
      mockService.saveDocument = vi.fn().mockResolvedValue(ok(undefined));
      await editorStore.saveDocument();
      expect(editorStore.error).toBeNull();
    });

    it('throws if not initialized', async () => {
      await expect(editorStore.saveDocument()).rejects.toThrow('EditorStore not initialized');
    });
  });

  describe('closeDocument()', () => {
    it('calls service.closeDocument()', () => {
      editorStore.init(mockService);

      editorStore.closeDocument();

      expect(mockService.closeDocument).toHaveBeenCalled();
    });

    it('clears error state', async () => {
      editorStore.init(mockService);

      // Set an error first
      mockService.openDocument = vi.fn().mockResolvedValue(err(new Error('Failed')));
      await editorStore.loadDocument('bad.md');
      expect(editorStore.error).not.toBeNull();

      // Close clears error
      editorStore.closeDocument();
      expect(editorStore.error).toBeNull();
    });

    it('throws if not initialized', () => {
      expect(() => editorStore.closeDocument()).toThrow('EditorStore not initialized');
    });
  });

  describe('createDocument()', () => {
    it('calls service.createDocument() and returns result', async () => {
      editorStore.init(mockService);

      const result = await editorStore.createDocument('new.md', 'New Document');

      expect(mockService.createDocument).toHaveBeenCalledWith('new.md', 'New Document');
      expect(result.ok).toBe(true);
    });

    it('works without optional title', async () => {
      editorStore.init(mockService);

      await editorStore.createDocument('untitled.md');

      expect(mockService.createDocument).toHaveBeenCalledWith('untitled.md', undefined);
    });

    it('sets error state on failure', async () => {
      editorStore.init(mockService);

      const testError = new Error('Failed to create');
      mockService.createDocument = vi.fn().mockResolvedValue(err(testError));

      const result = await editorStore.createDocument('new.md');

      expect(result.ok).toBe(false);
      expect(editorStore.error).toEqual(testError);
    });

    it('throws if not initialized', async () => {
      await expect(editorStore.createDocument('new.md')).rejects.toThrow(
        'EditorStore not initialized'
      );
    });
  });

  describe('block operations', () => {
    describe('insertBlock()', () => {
      it('delegates to service.insertBlock()', () => {
        editorStore.init(mockService);

        editorStore.insertBlock('paragraph', 'block-1');

        expect(mockService.insertBlock).toHaveBeenCalledWith('paragraph', 'block-1');
      });

      it('works without afterBlockId', () => {
        editorStore.init(mockService);

        editorStore.insertBlock('heading-1');

        expect(mockService.insertBlock).toHaveBeenCalledWith('heading-1', undefined);
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.insertBlock('paragraph')).toThrow('EditorStore not initialized');
      });
    });

    describe('deleteBlock()', () => {
      it('delegates to service.deleteBlock()', () => {
        editorStore.init(mockService);

        editorStore.deleteBlock('block-1');

        expect(mockService.deleteBlock).toHaveBeenCalledWith('block-1');
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.deleteBlock('block-1')).toThrow('EditorStore not initialized');
      });
    });

    describe('moveBlock()', () => {
      it('delegates to service.moveBlock()', () => {
        editorStore.init(mockService);

        editorStore.moveBlock('block-1', 3);

        expect(mockService.moveBlock).toHaveBeenCalledWith('block-1', 3);
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.moveBlock('block-1', 0)).toThrow('EditorStore not initialized');
      });
    });

    describe('updateBlock()', () => {
      it('delegates to service.updateBlock()', () => {
        editorStore.init(mockService);

        const updates: Partial<Block> = { content: 'Updated content' };
        editorStore.updateBlock('block-1', updates);

        expect(mockService.updateBlock).toHaveBeenCalledWith('block-1', updates);
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.updateBlock('block-1', {})).toThrow(
          'EditorStore not initialized'
        );
      });
    });
  });

  describe('executeCommand()', () => {
    it('calls service.executeCommand()', async () => {
      editorStore.init(mockService);

      await editorStore.executeCommand('bold');

      expect(mockService.executeCommand).toHaveBeenCalledWith('bold');
    });

    it('throws if not initialized', async () => {
      await expect(editorStore.executeCommand('bold')).rejects.toThrow(
        'EditorStore not initialized'
      );
    });
  });

  describe('formatting operations', () => {
    describe('toggleMark()', () => {
      it('delegates to service.toggleMark()', () => {
        editorStore.init(mockService);

        editorStore.toggleMark('bold');

        expect(mockService.toggleMark).toHaveBeenCalledWith('bold');
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.toggleMark('bold')).toThrow('EditorStore not initialized');
      });
    });

    describe('setBlockType()', () => {
      it('delegates to service.setBlockType()', () => {
        editorStore.init(mockService);

        editorStore.setBlockType('heading-1');

        expect(mockService.setBlockType).toHaveBeenCalledWith('heading-1');
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.setBlockType('heading-1')).toThrow(
          'EditorStore not initialized'
        );
      });
    });
  });

  describe('focus and selection', () => {
    describe('focus()', () => {
      it('delegates to service.focus()', () => {
        editorStore.init(mockService);

        editorStore.focus();

        expect(mockService.focus).toHaveBeenCalled();
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.focus()).toThrow('EditorStore not initialized');
      });
    });

    describe('getSelection()', () => {
      it('delegates to service.getSelection()', () => {
        editorStore.init(mockService);

        const selection = editorStore.getSelection();

        expect(mockService.getSelection).toHaveBeenCalled();
        expect(selection).toEqual(EMPTY_SELECTION);
      });

      it('returns EMPTY_SELECTION if not initialized', () => {
        const selection = editorStore.getSelection();

        expect(selection).toEqual(EMPTY_SELECTION);
      });
    });
  });

  describe('undo/redo', () => {
    describe('undo()', () => {
      it('delegates to service.undo()', () => {
        editorStore.init(mockService);

        editorStore.undo();

        expect(mockService.undo).toHaveBeenCalled();
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.undo()).toThrow('EditorStore not initialized');
      });
    });

    describe('redo()', () => {
      it('delegates to service.redo()', () => {
        editorStore.init(mockService);

        editorStore.redo();

        expect(mockService.redo).toHaveBeenCalled();
      });

      it('throws if not initialized', () => {
        expect(() => editorStore.redo()).toThrow('EditorStore not initialized');
      });
    });

    describe('canUndo()', () => {
      it('delegates to service.canUndo()', () => {
        editorStore.init(mockService);

        mockService.canUndo = vi.fn().mockReturnValue(true);
        const result = editorStore.canUndo();

        expect(mockService.canUndo).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('returns false if not initialized', () => {
        const result = editorStore.canUndo();

        expect(result).toBe(false);
      });
    });

    describe('canRedo()', () => {
      it('delegates to service.canRedo()', () => {
        editorStore.init(mockService);

        mockService.canRedo = vi.fn().mockReturnValue(true);
        const result = editorStore.canRedo();

        expect(mockService.canRedo).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('returns false if not initialized', () => {
        const result = editorStore.canRedo();

        expect(result).toBe(false);
      });
    });
  });

  describe('hasDocument', () => {
    it('returns false when no document is loaded', () => {
      editorStore.init(mockService);

      expect(editorStore.hasDocument).toBe(false);
    });

    it('returns true when document is loaded', async () => {
      editorStore.init(mockService);

      await editorStore.loadDocument('test.md');

      expect(editorStore.hasDocument).toBe(true);
    });

    it('returns false after document is closed', async () => {
      editorStore.init(mockService);

      await editorStore.loadDocument('test.md');
      expect(editorStore.hasDocument).toBe(true);

      editorStore.closeDocument();
      expect(editorStore.hasDocument).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('resets all state', async () => {
      editorStore.init(mockService);

      // Set up some state
      await editorStore.loadDocument('test.md');
      mockService._state.isDirty = true;
      mockService._state.isSaving = true;
      mockService._state.aiProcessing = { blockId: 'b1', operation: 'expand' };
      mockService._triggerSubscribers();

      editorStore.destroy();

      expect(editorStore.isInitialized).toBe(false);
      expect(editorStore.document).toBeNull();
      expect(editorStore.selection).toEqual(EMPTY_SELECTION);
      expect(editorStore.isReady).toBe(false);
      expect(editorStore.isDirty).toBe(false);
      expect(editorStore.isSaving).toBe(false);
      expect(editorStore.aiProcessing).toBeNull();
      expect(editorStore.error).toBeNull();
    });

    it('unsubscribes from service', () => {
      editorStore.init(mockService);

      expect(mockService._subscribers.size).toBe(1);

      editorStore.destroy();

      expect(mockService._subscribers.size).toBe(0);
    });
  });
});
