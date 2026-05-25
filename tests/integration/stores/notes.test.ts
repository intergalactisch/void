/**
 * Integration tests for Notes Store
 *
 * Tests the NotesStore reactive state management using a mock NotesService.
 * The store uses Svelte 5 runes ($state, $derived) and wraps the NotesService
 * port to provide reactive state to UI components.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SidebarPreferencesServiceImpl } from '$lib/application/services/SidebarPreferencesServiceImpl';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { notesStore } from '$lib/stores/notes.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { NotesService, NotesListItem, NotesState } from '$lib/ports/inbound';
import type { FrecencyService, FrecencyEntry, FrecencyKind } from '$lib/ports/inbound/FrecencyService';
import type { Document } from '$lib/domain';
import { DEFAULT_SETTINGS } from '$lib/domain/entities/Settings';
import { ok, err } from '$lib/core';

/**
 * Creates a mock NotesService for testing.
 * Includes internal state and a method to trigger subscriber callbacks.
 */
function createMockNotesService(): NotesService & {
  _state: NotesState;
  _triggerSubscribers: () => void;
  _subscribers: Set<(state: NotesState) => void>;
} {
  const subscribers = new Set<(state: NotesState) => void>();
  const state: NotesState = {
    items: [],
    tagGroups: [],
    selectedPath: null,
    isLoading: false,
    searchQuery: '',
    expandedFolders: new Set<string>(),
  };

  return {
    _state: state,
    _subscribers: subscribers,
    _triggerSubscribers: () => subscribers.forEach((cb) => cb({ ...state })),

    // State access
    getState: vi.fn().mockImplementation(() => ({ ...state })),

    // List operations
    loadFolderTree: vi.fn().mockResolvedValue(ok([])),
    refresh: vi.fn().mockResolvedValue(ok([])),

    // Note operations
    createNote: vi.fn().mockImplementation(async (_folder: string, title: string) => {
      const doc: Document = {
        meta: {
          id: `doc-${Date.now()}`,
          title,
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
        path: `${title.toLowerCase().replace(/\s+/g, '-')}.md`,
        blocks: [],
        isDirty: false,
      };
      return ok(doc);
    }),
    createQuickNote: vi.fn().mockImplementation(async () => {
      const doc: Document = {
        meta: {
          id: `doc-${Date.now()}`,
          title: 'Quick Note',
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
        path: 'quick-note.md',
        blocks: [],
        isDirty: false,
      };
      return ok(doc);
    }),
    loadDocument: vi.fn().mockImplementation(async (path: string) => {
      const doc: Document = {
        meta: {
          id: `doc-${Date.now()}`,
          title: 'Loaded Note',
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
        path,
        blocks: [],
        isDirty: false,
      };
      return ok(doc);
    }),
    saveDocument: vi.fn().mockResolvedValue(ok(undefined)),
    deleteNote: vi.fn().mockResolvedValue(ok(undefined)),
    deleteNotePermanently: vi.fn().mockResolvedValue(ok(undefined)),
    listTrashedNotes: vi.fn().mockResolvedValue(ok([])),
    restoreNoteFromTrash: vi.fn().mockImplementation(async (trashId: string) => ok({
      meta: {
        id: `restored-${trashId}`,
        title: 'Restored Note',
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
      path: 'restored-note.md',
      blocks: [],
      isDirty: false,
    })),
    deleteTrashedNote: vi.fn().mockResolvedValue(ok(undefined)),
    renameNote: vi.fn().mockImplementation(async (_path: string, newTitle: string) => {
      return ok(`${newTitle.toLowerCase().replace(/\s+/g, '-')}.md`);
    }),

    // Search
    searchNotes: vi.fn().mockResolvedValue(ok([])),

    // Selection
    selectNote: vi.fn(),
    getSelectedPath: vi.fn().mockReturnValue(null),

    // Folder operations
    createFolder: vi.fn().mockImplementation(async (parentPath: string | null, name: string) => {
      return ok(parentPath ? `${parentPath}/${name}` : name);
    }),
    deleteFolder: vi.fn().mockResolvedValue(ok(undefined)),
    renameFolder: vi.fn().mockImplementation(async (path: string, newName: string) => {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      return ok(parent ? `${parent}/${newName}` : newName);
    }),
    countFolderContents: vi.fn().mockReturnValue({ notes: 0, folders: 0 }),
    toggleFolder: vi.fn(),
    expandFolder: vi.fn(),
    collapseFolder: vi.fn(),
    isFolderExpanded: vi.fn().mockReturnValue(false),

    // Subscriptions
    subscribe: vi.fn().mockImplementation((cb: (state: NotesState) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }),
  };
}

/**
 * Creates sample notes list items for testing.
 */
function createSampleItems(): NotesListItem[] {
  return [
    {
      path: 'note-1.md',
      title: 'Note 1',
      isFolder: false,
      modifiedAt: new Date(),
      tags: [],
    },
    {
      path: 'note-2.md',
      title: 'Note 2',
      isFolder: false,
      modifiedAt: new Date(),
      tags: [],
    },
    {
      path: 'folder-1',
      title: 'Folder 1',
      isFolder: true,
      modifiedAt: new Date(),
      tags: [],
      children: [
        {
          path: 'folder-1/nested-note.md',
          title: 'Nested Note',
          isFolder: false,
          modifiedAt: new Date(),
          tags: [],
        },
      ],
    },
  ];
}

function createNestedResearchItems(): NotesListItem[] {
  const older = new Date('2026-05-10T09:00:00Z');
  const latest = new Date('2026-05-11T12:30:00Z');
  return [
    {
      path: 'Research',
      title: 'Research',
      isFolder: true,
      modifiedAt: latest,
      tags: [],
      children: [
        {
          path: 'Research/topic',
          title: 'topic',
          isFolder: true,
          modifiedAt: latest,
          tags: [],
          children: [
            {
              path: 'Research/topic/overview.md',
              title: 'Overview',
              isFolder: false,
              modifiedAt: older,
              tags: [],
            },
            {
              path: 'Research/topic/deep',
              title: 'deep',
              isFolder: true,
              modifiedAt: latest,
              tags: [],
              children: [
                {
                  path: 'Research/topic/deep/deep-note.md',
                  title: 'Deep Note',
                  isFolder: false,
                  modifiedAt: latest,
                  tags: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function createNestedFolderReorderItems(): NotesListItem[] {
  const modifiedAt = new Date('2026-05-12T10:00:00Z');
  return [
    {
      path: 'Research',
      title: 'Research',
      isFolder: true,
      modifiedAt,
      tags: [],
      children: [
        {
          path: 'Research/topic',
          title: 'topic',
          isFolder: true,
          modifiedAt,
          tags: [],
          children: [
            {
              path: 'Research/topic/Alpha',
              title: 'Alpha',
              isFolder: true,
              modifiedAt,
              tags: [],
              children: [],
            },
            {
              path: 'Research/topic/Zeta',
              title: 'Zeta',
              isFolder: true,
              modifiedAt,
              tags: [],
              children: [],
            },
          ],
        },
        {
          path: 'Research/other',
          title: 'other',
          isFolder: true,
          modifiedAt,
          tags: [],
          children: [],
        },
      ],
    },
  ];
}

function createMockFrecency(entries: FrecencyEntry[] = []): FrecencyService {
  const records = new Map<string, FrecencyEntry>();
  const key = (kind: FrecencyKind, id: string) => `${kind}::${id}`;
  for (const entry of entries) {
    records.set(key(entry.kind, entry.id), { ...entry });
  }

  return {
    load: vi.fn().mockResolvedValue(ok(undefined)),
    record: vi.fn().mockImplementation((kind: FrecencyKind, id: string) => {
      const k = key(kind, id);
      const existing = records.get(k);
      const now = Date.now();
      records.set(k, {
        kind,
        id,
        count: (existing?.count ?? 0) + 1,
        lastAt: now,
      });
    }),
    score: vi.fn().mockReturnValue(0),
    topRecent: vi.fn().mockReturnValue([]),
    lastAccessed: vi.fn().mockImplementation((kind: FrecencyKind, limit: number) =>
      Array.from(records.values())
        .filter((entry) => entry.kind === kind)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, limit)
        .map((entry) => ({ ...entry }))
    ),
    compare: vi.fn().mockReturnValue(0),
    forget: vi.fn().mockImplementation((kind: FrecencyKind, id: string) => {
      records.delete(key(kind, id));
    }),
    move: vi.fn().mockImplementation((kind: FrecencyKind, oldId: string, newId: string) => {
      const oldKey = key(kind, oldId);
      const oldEntry = records.get(oldKey);
      if (!oldEntry) return;
      records.delete(oldKey);
      records.set(key(kind, newId), { ...oldEntry, id: newId });
    }),
    clear: vi.fn().mockImplementation((kind: FrecencyKind) => {
      const keysToRemove: string[] = [];
      for (const entry of records.values()) {
        if (entry.kind === kind) {
          keysToRemove.push(key(entry.kind, entry.id));
        }
      }
      for (const k of keysToRemove) {
        records.delete(k);
      }
    }),
  };
}

async function createSidebarPreferences() {
  const service = new SidebarPreferencesServiceImpl(new MemoryVoidStorageAdapter(), '/notes');
  await service.load();
  return service;
}

describe('Notes Store Integration', () => {
  let mockService: ReturnType<typeof createMockNotesService>;

  beforeEach(() => {
    mockService = createMockNotesService();
    // Ensure store is reset
    notesStore.destroy();
  });

  afterEach(() => {
    notesStore.destroy();
    settingsStore.settings = null;
    vi.clearAllMocks();
  });

  describe('init()', () => {
    it('accepts service and initializes state', () => {
      notesStore.init(mockService);

      expect(notesStore.isInitialized).toBe(true);
      expect(mockService.subscribe).toHaveBeenCalled();
      expect(mockService.getState).toHaveBeenCalled();
    });

    it('subscribes to state updates', () => {
      notesStore.init(mockService);

      // Verify subscription was set up
      expect(mockService._subscribers.size).toBe(1);
    });

    it('updates store state when service state changes', () => {
      notesStore.init(mockService);

      const items = createSampleItems();
      mockService._state.items = items;
      mockService._state.selectedPath = 'note-1.md';
      mockService._state.isLoading = true;
      mockService._state.expandedFolders = new Set(['folder-1']);

      // Trigger subscriber callback
      mockService._triggerSubscribers();

      expect(notesStore.items).toEqual(items);
      expect(notesStore.selectedPath).toBe('note-1.md');
      expect(notesStore.isLoading).toBe(true);
      expect(notesStore.expandedFolders).toEqual(new Set(['folder-1']));
    });

    it('cleans up previous subscription when re-initialized', () => {
      notesStore.init(mockService);
      expect(mockService._subscribers.size).toBe(1);

      // Re-initialize with same service
      const newMockService = createMockNotesService();
      notesStore.init(newMockService);

      // Old subscription should be removed
      expect(mockService._subscribers.size).toBe(0);
      expect(newMockService._subscribers.size).toBe(1);
    });
  });

  describe('load()', () => {
    it('calls service.loadFolderTree()', async () => {
      notesStore.init(mockService);

      await notesStore.load();

      expect(mockService.loadFolderTree).toHaveBeenCalled();
    });

    it('hydrates sidebar recents from persisted note access history', async () => {
      const items = createSampleItems();
      mockService._state.items = items;
      mockService.loadFolderTree = vi.fn().mockImplementation(async () => {
        mockService._triggerSubscribers();
        return ok(items);
      });
      const frecency = createMockFrecency([
        { kind: 'note', id: 'note-1.md', count: 1, lastAt: new Date('2026-05-07T12:00:00Z').getTime() },
        { kind: 'note', id: 'folder-1/nested-note.md', count: 1, lastAt: new Date('2026-05-08T12:00:00Z').getTime() },
        { kind: 'note', id: 'missing.md', count: 1, lastAt: new Date('2026-05-09T12:00:00Z').getTime() },
      ]);
      notesStore.init(mockService, { frecency });

      await notesStore.load();

      expect(notesStore.recentNotes.map((note) => note.path)).toEqual([
        'folder-1/nested-note.md',
        'note-1.md',
      ]);
      expect(notesStore.recentNotes[0]?.title).toBe('Nested Note');
    });

    it('sets isLoading state during load', async () => {
      notesStore.init(mockService);

      // Make loadFolderTree take some time
      mockService.loadFolderTree = vi.fn().mockImplementation(async () => {
        // Check loading state is true during operation
        expect(notesStore.isLoading).toBe(true);
        return ok([]);
      });

      await notesStore.load();

      // After completion, isLoading should be false
      expect(notesStore.isLoading).toBe(false);
    });

    it('sets error state on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Failed to load');
      mockService.loadFolderTree = vi.fn().mockResolvedValue(err(testError));

      await notesStore.load();

      expect(notesStore.error).toEqual(testError);
      expect(notesStore.isLoading).toBe(false);
    });

    it('clears error state on new load', async () => {
      notesStore.init(mockService);

      // First load fails
      mockService.loadFolderTree = vi.fn().mockResolvedValue(err(new Error('Failed')));
      await notesStore.load();
      expect(notesStore.error).not.toBeNull();

      // Second load succeeds
      mockService.loadFolderTree = vi.fn().mockResolvedValue(ok([]));
      await notesStore.load();
      expect(notesStore.error).toBeNull();
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.load()).rejects.toThrow('NotesStore not initialized');
    });
  });

  describe('refresh()', () => {
    it('calls service.refresh()', async () => {
      notesStore.init(mockService);

      await notesStore.refresh();

      expect(mockService.refresh).toHaveBeenCalled();
    });

    it('sets error state on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Refresh failed');
      mockService.refresh = vi.fn().mockResolvedValue(err(testError));

      await notesStore.refresh();

      expect(notesStore.error).toEqual(testError);
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.refresh()).rejects.toThrow('NotesStore not initialized');
    });
  });

  describe('createNote()', () => {
    it('calls service.createNote() and returns document', async () => {
      notesStore.init(mockService);

      const result = await notesStore.createNote('Test Note', 'folder');

      expect(mockService.createNote).toHaveBeenCalledWith('folder', 'Test Note');
      expect(result).not.toBeNull();
      expect(result?.meta.title).toBe('Test Note');
    });

    it('returns null and sets error on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Create failed');
      mockService.createNote = vi.fn().mockResolvedValue(err(testError));

      const result = await notesStore.createNote('Test', '');

      expect(result).toBeNull();
      expect(notesStore.error).toEqual(testError);
    });

    it('uses empty string as default folder', async () => {
      notesStore.init(mockService);

      await notesStore.createNote('Test Note');

      expect(mockService.createNote).toHaveBeenCalledWith('', 'Test Note');
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.createNote('Test')).rejects.toThrow(
        'NotesStore not initialized'
      );
    });
  });

  describe('createQuickNote()', () => {
    it('calls service.createQuickNote()', async () => {
      notesStore.init(mockService);

      const result = await notesStore.createQuickNote('folder');

      expect(mockService.createQuickNote).toHaveBeenCalledWith('folder');
      expect(result).not.toBeNull();
    });

    it('uses empty string as default folder', async () => {
      notesStore.init(mockService);

      await notesStore.createQuickNote();

      expect(mockService.createQuickNote).toHaveBeenCalledWith('');
    });

    it('returns null and sets error on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Quick note failed');
      mockService.createQuickNote = vi.fn().mockResolvedValue(err(testError));

      const result = await notesStore.createQuickNote();

      expect(result).toBeNull();
      expect(notesStore.error).toEqual(testError);
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.createQuickNote()).rejects.toThrow(
        'NotesStore not initialized'
      );
    });

    it('updates selectedPath when service notifies of selection', async () => {
      notesStore.init(mockService);

      // Simulate the real service behavior: createQuickNote triggers selection
      const createdPath = 'quick-note.md';
      mockService.createQuickNote = vi.fn().mockImplementation(async () => {
        // Simulate service behavior: update state and notify subscribers
        mockService._state.selectedPath = createdPath;
        mockService._triggerSubscribers();
        return ok({
          meta: {
            id: 'doc-1',
            title: 'Quick Note',
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
          path: createdPath,
          blocks: [],
          isDirty: false,
        });
      });

      await notesStore.createQuickNote();

      // Store should reflect the selection from service
      expect(notesStore.selectedPath).toBe(createdPath);
    });

    it('creates a quick note with normalized frontmatter tags', async () => {
      notesStore.init(mockService);

      const createdAt = new Date('2026-05-04T10:00:00.000Z');
      const createdItem: NotesListItem = {
        path: 'quick-note.md',
        title: 'Quick Note',
        isFolder: false,
        modifiedAt: createdAt,
        tags: ['project'],
      };

      mockService.createQuickNote = vi.fn().mockResolvedValue(
        ok({
          meta: {
            id: 'doc-1',
            title: 'Quick Note',
            tags: [],
            category: null,
            color: null,
            createdAt,
            updatedAt: createdAt,
            pinned: false,
            status: 'draft',
            intent: 'general',
            aiTouches: 0,
            custom: {},
          },
          path: 'quick-note.md',
          blocks: [],
          isDirty: false,
        })
      );
      mockService.refresh = vi.fn().mockImplementation(async () => {
        mockService._state.items = [createdItem];
        mockService._state.tagGroups = [
          {
            id: 'project',
            tag: 'project',
            title: '#project',
            notes: [createdItem],
            count: 1,
            isUntagged: false,
          },
        ];
        mockService._triggerSubscribers();
        return ok([createdItem]);
      });

      const result = await notesStore.createQuickNoteWithTags(['#Project', 'project']);

      expect(result?.meta.tags).toEqual(['project']);
      expect(mockService.saveDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            tags: ['project'],
          }),
        })
      );
      expect(mockService.refresh).toHaveBeenCalled();
      expect(mockService.selectNote).toHaveBeenCalledWith('quick-note.md');
      expect(notesStore.isTagGroupExpanded('project')).toBe(true);
    });
  });

  describe('tag groups', () => {
    it('keeps tag groups collapsed when notes load', () => {
      notesStore.init(mockService);

      const item: NotesListItem = {
        path: 'project.md',
        title: 'Project',
        isFolder: false,
        modifiedAt: new Date(),
        tags: ['project'],
      };
      mockService._state.tagGroups = [
        {
          id: 'project',
          tag: 'project',
          title: '#project',
          notes: [item],
          count: 1,
          isUntagged: false,
        },
      ];
      mockService._triggerSubscribers();

      expect(notesStore.isTagGroupExpanded('project')).toBe(false);
    });

    it('preserves explicit tag expansion across service updates', () => {
      notesStore.init(mockService);

      const item: NotesListItem = {
        path: 'project.md',
        title: 'Project',
        isFolder: false,
        modifiedAt: new Date(),
        tags: ['project'],
      };
      mockService._state.tagGroups = [
        {
          id: 'project',
          tag: 'project',
          title: '#project',
          notes: [item],
          count: 1,
          isUntagged: false,
        },
      ];
      mockService._triggerSubscribers();

      notesStore.toggleTagGroup('project');
      mockService._triggerSubscribers();

      expect(notesStore.isTagGroupExpanded('project')).toBe(true);
    });
  });

  describe('note selection flow', () => {
    it('selection state propagates from service to store', () => {
      notesStore.init(mockService);

      expect(notesStore.selectedPath).toBeNull();

      // Simulate service selecting a note
      mockService._state.selectedPath = 'new-selection.md';
      mockService._triggerSubscribers();

      expect(notesStore.selectedPath).toBe('new-selection.md');
    });

    it('handles rapid selection changes from service', () => {
      notesStore.init(mockService);

      // Simulate rapid selections
      const paths = ['note1.md', 'note2.md', 'note3.md', null, 'note4.md'];
      for (const path of paths) {
        mockService._state.selectedPath = path;
        mockService._triggerSubscribers();
      }

      // Final state should be the last selection
      expect(notesStore.selectedPath).toBe('note4.md');
    });

    it('store selectNote delegates to service which updates state', () => {
      notesStore.init(mockService);

      // Mock service selectNote to update state like real implementation
      mockService.selectNote = vi.fn().mockImplementation((path: string | null) => {
        mockService._state.selectedPath = path;
        mockService._triggerSubscribers();
      });

      notesStore.selectNote('selected-note.md');

      expect(mockService.selectNote).toHaveBeenCalledWith('selected-note.md');
      expect(notesStore.selectedPath).toBe('selected-note.md');
    });

    it('records selected notes into persisted access history', () => {
      const items = createSampleItems();
      mockService._state.items = items;
      mockService._triggerSubscribers();
      const frecency = createMockFrecency();
      notesStore.init(mockService, { frecency });

      notesStore.selectNote('note-1.md');

      expect(frecency.record).toHaveBeenCalledWith('note', 'note-1.md');
    });

    it('clicking same note twice only triggers one update', () => {
      notesStore.init(mockService);

      let updateCount = 0;
      // Create a second subscription to count updates
      const unsubscribe = mockService.subscribe(() => {
        updateCount++;
      });

      // First select
      mockService.selectNote = vi.fn().mockImplementation((path: string | null) => {
        if (mockService._state.selectedPath !== path) {
          mockService._state.selectedPath = path;
          mockService._triggerSubscribers();
        }
      });

      const initialCount = updateCount;
      notesStore.selectNote('note.md');
      const afterFirst = updateCount;

      // Same note again - should not trigger another update
      notesStore.selectNote('note.md');
      const afterSecond = updateCount;

      expect(afterFirst).toBe(initialCount + 1);
      expect(afterSecond).toBe(afterFirst);

      unsubscribe();
    });
  });

  describe('deleteNote()', () => {
    it('calls service.deleteNote()', async () => {
      notesStore.init(mockService);

      const result = await notesStore.deleteNote('note.md');

      expect(mockService.deleteNote).toHaveBeenCalledWith('note.md');
      expect(result).toBe(true);
    });

    it('removes deleted notes from local sidebar state', async () => {
      notesStore.init(mockService);

      const items = createSampleItems();
      mockService._state.items = items;
      mockService._triggerSubscribers();

      notesStore.addFavorite('note-1.md');
      notesStore.selectNote('note-1.md');
      notesStore.searchResults = [items[0]!];

      const result = await notesStore.deleteNote('note-1.md');

      expect(result).toBe(true);
      expect(notesStore.favorites.has('note-1.md')).toBe(false);
      expect(notesStore.recentNotes.some((recent) => recent.path === 'note-1.md')).toBe(false);
      expect(notesStore.searchResults.some((note) => note.path === 'note-1.md')).toBe(false);
    });

    it('returns false and sets error on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Delete failed');
      mockService.deleteNote = vi.fn().mockResolvedValue(err(testError));

      const result = await notesStore.deleteNote('note.md');

      expect(result).toBe(false);
      expect(notesStore.error).toEqual(testError);
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.deleteNote('note.md')).rejects.toThrow(
        'NotesStore not initialized'
      );
    });
  });

  describe('trash operations', () => {
    it('loads recoverable Trash items', async () => {
      const deletedAt = new Date('2026-05-25T10:00:00.000Z');
      mockService.listTrashedNotes = vi.fn().mockResolvedValue(ok([
        {
          id: 'trash-1',
          originalPath: 'note-1.md',
          title: 'Note 1',
          deletedAt,
        },
      ]));
      notesStore.init(mockService);

      const result = await notesStore.loadTrashedNotes();

      expect(result).toHaveLength(1);
      expect(notesStore.trashedNotes[0]?.originalPath).toBe('note-1.md');
      expect(mockService.listTrashedNotes).toHaveBeenCalled();
    });

    it('restores a trashed note and selects it', async () => {
      const restored: Document = {
        meta: {
          id: 'restored',
          title: 'Restored',
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
        path: 'restored.md',
        blocks: [],
        isDirty: false,
      };
      mockService.restoreNoteFromTrash = vi.fn().mockResolvedValue(ok(restored));
      notesStore.init(mockService);
      notesStore.trashedNotes = [{
        id: 'trash-1',
        originalPath: 'old.md',
        title: 'Old',
        deletedAt: new Date(),
      }];

      const result = await notesStore.restoreTrashedNote('trash-1');

      expect(result?.path).toBe('restored.md');
      expect(mockService.restoreNoteFromTrash).toHaveBeenCalledWith('trash-1');
      expect(mockService.selectNote).toHaveBeenCalledWith('restored.md');
      expect(notesStore.trashedNotes.some((note) => note.id === 'trash-1')).toBe(false);
    });

    it('permanently deletes a trashed note entry', async () => {
      notesStore.init(mockService);
      notesStore.trashedNotes = [{
        id: 'trash-1',
        originalPath: 'old.md',
        title: 'Old',
        deletedAt: new Date(),
      }];

      const result = await notesStore.deleteTrashedNote('trash-1');

      expect(result).toBe(true);
      expect(mockService.deleteTrashedNote).toHaveBeenCalledWith('trash-1');
      expect(notesStore.trashedNotes).toHaveLength(0);
    });
  });

  describe('previewNoteTitle()', () => {
    it('immediately updates tree, tags, recents, search results, and title lookup', () => {
      const now = new Date('2026-05-11T15:18:00Z');
      const item: NotesListItem = {
        path: 'notes/old-title.md',
        title: 'Old Title',
        isFolder: false,
        modifiedAt: now,
        tags: ['project'],
      };
      mockService._state.items = [item];
      mockService._state.tagGroups = [
        {
          id: 'project',
          tag: 'project',
          title: '#project',
          notes: [item],
          count: 1,
          isUntagged: false,
        },
      ];
      notesStore.init(mockService);
      mockService._triggerSubscribers();
      notesStore.recentNotes = [{ path: item.path, title: item.title, accessedAt: now }];
      notesStore.searchResults = [item];

      notesStore.previewNoteTitle(item.path, 'New Title');

      expect(notesStore.items[0]?.title).toBe('New Title');
      expect(notesStore.allNotes[0]?.title).toBe('New Title');
      expect(notesStore.tagGroups[0]?.notes[0]?.title).toBe('New Title');
      expect(notesStore.recentNotes[0]?.title).toBe('New Title');
      expect(notesStore.searchResults[0]?.title).toBe('New Title');
      expect(notesStore.titleForPath(item.path)).toBe('New Title');
    });

    it('keeps pending title previews across stale service updates and refreshes', async () => {
      const now = new Date('2026-05-11T15:18:00Z');
      const oldItem: NotesListItem = {
        path: 'notes/old-title.md',
        title: 'Old Title',
        isFolder: false,
        modifiedAt: now,
        tags: [],
      };
      mockService._state.items = [oldItem];
      mockService.refresh = vi.fn().mockImplementation(async () => {
        mockService._state.items = [oldItem];
        mockService._triggerSubscribers();
        return ok([oldItem]);
      });
      notesStore.init(mockService);
      mockService._triggerSubscribers();

      notesStore.previewNoteTitle(oldItem.path, 'New Title');
      mockService._triggerSubscribers();
      await notesStore.refresh();

      expect(notesStore.items[0]?.title).toBe('New Title');
      expect(notesStore.titleForPath(oldItem.path)).toBe('New Title');
    });

    it('clears the pending preview after a successful same-path rename', async () => {
      const now = new Date('2026-05-11T15:18:00Z');
      mockService._state.items = [
        { path: 'same-path.md', title: 'Old Title', isFolder: false, modifiedAt: now, tags: [] },
      ];
      mockService.renameNote = vi.fn().mockImplementation(async () => {
        mockService._state.items = [
          { path: 'same-path.md', title: 'New Title', isFolder: false, modifiedAt: now, tags: [] },
        ];
        mockService._triggerSubscribers();
        return ok('same-path.md');
      });
      notesStore.init(mockService);
      mockService._triggerSubscribers();
      notesStore.previewNoteTitle('same-path.md', 'New Title');

      const result = await notesStore.renameNote('same-path.md', 'New Title');

      expect(result).toBe('same-path.md');
      expect(notesStore.titleForPath('same-path.md')).toBe('New Title');

      mockService._state.items = [
        { path: 'same-path.md', title: 'Service Title', isFolder: false, modifiedAt: now, tags: [] },
      ];
      mockService._triggerSubscribers();
      expect(notesStore.titleForPath('same-path.md')).toBe('Service Title');
    });

    it('rolls back the pending preview when rename fails', async () => {
      const now = new Date('2026-05-11T15:18:00Z');
      const item: NotesListItem = {
        path: 'notes/old-title.md',
        title: 'Old Title',
        isFolder: false,
        modifiedAt: now,
        tags: [],
      };
      const testError = new Error('Rename failed');
      mockService._state.items = [item];
      mockService.renameNote = vi.fn().mockResolvedValue(err(testError));
      notesStore.init(mockService);
      mockService._triggerSubscribers();
      notesStore.recentNotes = [{ path: item.path, title: item.title, accessedAt: now }];
      notesStore.searchResults = [item];
      notesStore.previewNoteTitle(item.path, 'New Title');

      const result = await notesStore.renameNote(item.path, 'New Title');

      expect(result).toBeNull();
      expect(notesStore.error).toEqual(testError);
      expect(notesStore.items[0]?.title).toBe('Old Title');
      expect(notesStore.recentNotes[0]?.title).toBe('Old Title');
      expect(notesStore.searchResults[0]?.title).toBe('Old Title');
      expect(notesStore.titleForPath(item.path)).toBe('Old Title');
    });
  });

  describe('renameNote()', () => {
    it('calls service.renameNote() and returns new path', async () => {
      notesStore.init(mockService);

      const result = await notesStore.renameNote('old.md', 'New Title');

      expect(mockService.renameNote).toHaveBeenCalledWith('old.md', 'New Title');
      expect(result).toBe('new-title.md');
    });

    it('returns null and sets error on failure', async () => {
      notesStore.init(mockService);

      const testError = new Error('Rename failed');
      mockService.renameNote = vi.fn().mockResolvedValue(err(testError));

      const result = await notesStore.renameNote('old.md', 'New Title');

      expect(result).toBeNull();
      expect(notesStore.error).toEqual(testError);
    });

    it('rewrites recents, favorites, search, selections, history, and frecency on success', async () => {
      const now = new Date('2026-05-11T15:18:00Z');
      mockService._state.items = [
        { path: 'Test/old.md', title: 'May 11, 2026 15:18', isFolder: false, modifiedAt: now, tags: [] },
        { path: 'other.md', title: 'Other', isFolder: false, modifiedAt: now, tags: [] },
      ];
      mockService.selectNote = vi.fn().mockImplementation((path: string | null) => {
        mockService._state.selectedPath = path;
        mockService._triggerSubscribers();
      });
      mockService.renameNote = vi.fn().mockImplementation(async () => {
        mockService._state.items = [
          { path: 'Test/renamed-note.md', title: 'Renamed Note', isFolder: false, modifiedAt: now, tags: [] },
          { path: 'other.md', title: 'Other', isFolder: false, modifiedAt: now, tags: [] },
        ];
        mockService._state.selectedPath = 'Test/renamed-note.md';
        mockService._triggerSubscribers();
        return ok('Test/renamed-note.md');
      });
      const frecency = createMockFrecency([
        { kind: 'note', id: 'Test/old.md', count: 3, lastAt: now.getTime() },
      ]);

      notesStore.init(mockService, { frecency });
      notesStore.selectNote('other.md');
      notesStore.selectNote('Test/old.md');
      notesStore.favorites = new Set(['Test/old.md']);
      notesStore.selectedPaths = new Set(['Test/old.md', 'other.md']);
      notesStore.searchResults = [
        { path: 'Test/old.md', title: 'May 11, 2026 15:18', isFolder: false, modifiedAt: now, tags: [] },
      ];

      const result = await notesStore.renameNote('Test/old.md', 'Renamed Note');

      expect(result).toBe('Test/renamed-note.md');
      expect(notesStore.recentNotes[0]).toMatchObject({
        path: 'Test/renamed-note.md',
        title: 'Renamed Note',
      });
      expect(notesStore.recentNotes.some((recent) => recent.path === 'Test/old.md')).toBe(false);
      expect(notesStore.favorites.has('Test/renamed-note.md')).toBe(true);
      expect(notesStore.favorites.has('Test/old.md')).toBe(false);
      expect(notesStore.selectedPaths.has('Test/renamed-note.md')).toBe(true);
      expect(notesStore.selectedPaths.has('Test/old.md')).toBe(false);
      expect(notesStore.searchResults[0]).toMatchObject({
        path: 'Test/renamed-note.md',
        title: 'Renamed Note',
      });
      expect(frecency.move).toHaveBeenCalledWith('note', 'Test/old.md', 'Test/renamed-note.md');

      notesStore.goBack();
      expect(notesStore.selectedPath).toBe('other.md');
      notesStore.goForward();
      expect(notesStore.selectedPath).toBe('Test/renamed-note.md');
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.renameNote('old.md', 'New')).rejects.toThrow(
        'NotesStore not initialized'
      );
    });
  });

  describe('selectNote()', () => {
    it('calls service.selectNote()', () => {
      notesStore.init(mockService);

      notesStore.selectNote('note.md');

      expect(mockService.selectNote).toHaveBeenCalledWith('note.md');
    });

    it('accepts null to deselect', () => {
      notesStore.init(mockService);

      notesStore.selectNote(null);

      expect(mockService.selectNote).toHaveBeenCalledWith(null);
    });

    it('throws if not initialized', () => {
      expect(() => notesStore.selectNote('note.md')).toThrow(
        'NotesStore not initialized'
      );
    });
  });

  describe('selectNoteByAnyPath()', () => {
    it('resolves a tilde artifact path against the configured notes folder', () => {
      notesStore.init(mockService);
      settingsStore.settings = {
        ...DEFAULT_SETTINGS,
        notesPath: '/Users/testuser/notes',
      };

      const selected = notesStore.selectNoteByAnyPath(
        '~/notes/Research/anthropic-best-notes.md'
      );

      expect(selected).toBe(true);
      expect(mockService.selectNote).toHaveBeenCalledWith('Research/anthropic-best-notes.md');
    });

    it('resolves a file URL artifact path against a tilde notes folder', () => {
      notesStore.init(mockService);
      settingsStore.settings = {
        ...DEFAULT_SETTINGS,
        notesPath: '~/notes',
      };

      const selected = notesStore.selectNoteByAnyPath(
        'file:///Users/testuser/notes/Research/safety%20and%20governance.md'
      );

      expect(selected).toBe(true);
      expect(mockService.selectNote).toHaveBeenCalledWith('Research/safety and governance.md');
    });

    it('matches an artifact path to the loaded note tree before falling back', () => {
      notesStore.init(mockService);
      mockService._state.items = createSampleItems();
      mockService._triggerSubscribers();

      const selected = notesStore.selectNoteByAnyPath(
        '~/notes/folder-1/nested-note.md'
      );

      expect(selected).toBe(true);
      expect(mockService.selectNote).toHaveBeenCalledWith('folder-1/nested-note.md');
    });

    it('does not select an unresolved absolute or tilde path', () => {
      notesStore.init(mockService);

      const selected = notesStore.selectNoteByAnyPath(
        '~/notes/Research/missing.md'
      );

      expect(selected).toBe(false);
      expect(mockService.selectNote).not.toHaveBeenCalled();
      expect(notesStore.error?.message).toContain('Could not find note');
    });
  });

  describe('folder operations', () => {
    describe('selectFolderView()', () => {
      it('selects a virtual folder view, clears note/tag selection, and expands ancestors', () => {
        notesStore.init(mockService);
        mockService._state.items = createNestedResearchItems();
        mockService._state.selectedPath = 'note-1.md';
        mockService._triggerSubscribers();

        notesStore.selectTagView('project');
        notesStore.selectedPaths = new Set(['note-1.md']);

        notesStore.selectFolderView('Research/topic/deep');

        expect(notesStore.activeFolderPath).toBe('Research/topic/deep');
        expect(notesStore.activeTagView).toBeNull();
        expect(notesStore.selectedPath).toBeNull();
        expect(notesStore.selectedPaths.size).toBe(0);
        expect(mockService.selectNote).toHaveBeenLastCalledWith(null);
        expect(mockService.expandFolder).toHaveBeenCalledWith('Research');
        expect(mockService.expandFolder).toHaveBeenCalledWith('Research/topic');
        expect(mockService.expandFolder).toHaveBeenCalledWith('Research/topic/deep');
      });

      it('resolves absolute note artifact paths to app-relative folder views', () => {
        notesStore.init(mockService);
        settingsStore.settings = {
          ...DEFAULT_SETTINGS,
          notesPath: '/Users/testuser/notes',
        };
        mockService._state.items = createNestedResearchItems();
        mockService._triggerSubscribers();

        const selected = notesStore.selectFolderByAnyPath(
          '/Users/testuser/notes/Research/topic/deep/deep-note.md'
        );

        expect(selected).toBe(true);
        expect(notesStore.activeFolderPath).toBe('Research/topic/deep');
      });
    });

    describe('toggleFolder()', () => {
      it('delegates to service.toggleFolder()', () => {
        notesStore.init(mockService);

        notesStore.toggleFolder('folder-1');

        expect(mockService.toggleFolder).toHaveBeenCalledWith('folder-1');
      });

      it('throws if not initialized', () => {
        expect(() => notesStore.toggleFolder('folder-1')).toThrow(
          'NotesStore not initialized'
        );
      });
    });

    describe('expandFolder()', () => {
      it('delegates to service.expandFolder()', () => {
        notesStore.init(mockService);

        notesStore.expandFolder('folder-1');

        expect(mockService.expandFolder).toHaveBeenCalledWith('folder-1');
      });

      it('throws if not initialized', () => {
        expect(() => notesStore.expandFolder('folder-1')).toThrow(
          'NotesStore not initialized'
        );
      });
    });

    describe('collapseFolder()', () => {
      it('delegates to service.collapseFolder()', () => {
        notesStore.init(mockService);

        notesStore.collapseFolder('folder-1');

        expect(mockService.collapseFolder).toHaveBeenCalledWith('folder-1');
      });

      it('throws if not initialized', () => {
        expect(() => notesStore.collapseFolder('folder-1')).toThrow(
          'NotesStore not initialized'
        );
      });
    });

    describe('isFolderExpanded()', () => {
      it('returns expansion state from store', () => {
        notesStore.init(mockService);

        // Set expanded folders in state
        mockService._state.expandedFolders = new Set(['folder-1']);
        mockService._triggerSubscribers();

        expect(notesStore.isFolderExpanded('folder-1')).toBe(true);
        expect(notesStore.isFolderExpanded('folder-2')).toBe(false);
      });
    });
  });

  describe('sidebar preferences', () => {
    it('orders root and nested folders per parent', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      await sidebarPreferences.reorderFolder('', 'Gamma', 'Alpha', 'before', ['Alpha', 'Beta', 'Gamma']);
      await sidebarPreferences.reorderFolder('Projects', 'Projects/Zeta', 'Projects/Alpha', 'before', [
        'Projects/Alpha',
        'Projects/Zeta',
      ]);

      mockService._state.items = [
        { path: 'Alpha', title: 'Alpha', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
        { path: 'Beta', title: 'Beta', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
        { path: 'Gamma', title: 'Gamma', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
        {
          path: 'Projects',
          title: 'Projects',
          isFolder: true,
          modifiedAt: new Date(),
          tags: [],
          children: [
            { path: 'Projects/Alpha', title: 'Alpha', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
            { path: 'Projects/Zeta', title: 'Zeta', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
          ],
        },
      ];

      notesStore.init(mockService, { sidebarPreferences });

      expect(notesStore.orderedItems.filter((item) => item.isFolder).map((item) => item.path)).toEqual([
        'Gamma',
        'Alpha',
        'Beta',
        'Projects',
      ]);
      const projects = notesStore.orderedItems.find((item) => item.path === 'Projects');
      expect(projects?.children?.map((item) => item.path)).toEqual([
        'Projects/Zeta',
        'Projects/Alpha',
      ]);
    });

    it('orders active folder overview direct subfolders per parent', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      await sidebarPreferences.reorderFolder(
        'Research/topic',
        'Research/topic/Zeta',
        'Research/topic/Alpha',
        'before',
        ['Research/topic/Alpha', 'Research/topic/Zeta']
      );

      mockService._state.items = createNestedFolderReorderItems();
      notesStore.init(mockService, { sidebarPreferences });
      notesStore.selectFolderView('Research/topic');

      expect(notesStore.activeFolderOverview?.directFolders.map((folder) => folder.path)).toEqual([
        'Research/topic/Zeta',
        'Research/topic/Alpha',
      ]);
    });

    it('persists nested sibling folder reorders under the direct parent', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      mockService._state.items = createNestedFolderReorderItems();
      notesStore.init(mockService, { sidebarPreferences });

      await expect(notesStore.reorderFolder(
        'Research/topic/Zeta',
        'Research/topic/Alpha',
        'before'
      )).resolves.toBe(true);

      expect(sidebarPreferences.getState().folderOrder).toEqual({
        'Research/topic': ['Research/topic/Zeta', 'Research/topic/Alpha'],
      });
      notesStore.selectFolderView('Research/topic');
      expect(notesStore.activeFolderOverview?.directFolders.map((folder) => folder.path)).toEqual([
        'Research/topic/Zeta',
        'Research/topic/Alpha',
      ]);
    });

    it('ignores cross-parent folder reorders', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      mockService._state.items = createNestedFolderReorderItems();
      notesStore.init(mockService, { sidebarPreferences });

      await expect(notesStore.reorderFolder(
        'Research/topic/Zeta',
        'Research/other',
        'before'
      )).resolves.toBe(false);

      expect(sidebarPreferences.getState().folderOrder).toEqual({});
    });

    it('derives favorite notes and folders while filtering missing paths', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      await sidebarPreferences.toggleFavorite({ kind: 'folder', path: 'Projects' });
      await sidebarPreferences.toggleFavorite({ kind: 'note', path: 'Projects/plan.md' });
      await sidebarPreferences.toggleFavorite({ kind: 'note', path: 'missing.md' });

      mockService._state.items = [
        {
          path: 'Projects',
          title: 'Projects',
          isFolder: true,
          modifiedAt: new Date(),
          tags: [],
          children: [
            { path: 'Projects/plan.md', title: 'Plan', isFolder: false, modifiedAt: new Date(), tags: [] },
          ],
        },
      ];

      notesStore.init(mockService, { sidebarPreferences });

      expect(notesStore.favoriteItems.map((item) => `${item.favoriteKind}:${item.path}`)).toEqual([
        'folder:Projects',
        'note:Projects/plan.md',
      ]);
      expect(notesStore.favoriteNotes.map((item) => item.path)).toEqual(['Projects/plan.md']);
    });

    it('keeps folder favorites and order clean on folder rename and delete', async () => {
      const sidebarPreferences = await createSidebarPreferences();
      await sidebarPreferences.toggleFavorite({ kind: 'folder', path: 'Old' });
      await sidebarPreferences.toggleFavorite({ kind: 'note', path: 'Old/plan.md' });
      await sidebarPreferences.reorderFolder('', 'Old', 'Other', 'after', ['Old', 'Other']);
      await sidebarPreferences.reorderFolder('Old', 'Old/B', 'Old/A', 'before', ['Old/A', 'Old/B']);

      mockService._state.items = [
        {
          path: 'Old',
          title: 'Old',
          isFolder: true,
          modifiedAt: new Date(),
          tags: [],
          children: [
            { path: 'Old/plan.md', title: 'Plan', isFolder: false, modifiedAt: new Date(), tags: [] },
            { path: 'Old/A', title: 'A', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
            { path: 'Old/B', title: 'B', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
          ],
        },
        { path: 'Other', title: 'Other', isFolder: true, modifiedAt: new Date(), tags: [], children: [] },
      ];
      mockService.renameFolder = vi.fn().mockResolvedValue(ok('New'));

      notesStore.init(mockService, { sidebarPreferences });

      await notesStore.renameFolder('Old', 'New');

      expect(sidebarPreferences.getState().favorites).toEqual([
        { kind: 'folder', path: 'New' },
        { kind: 'note', path: 'New/plan.md' },
      ]);
      expect(sidebarPreferences.getState().folderOrder).toEqual({
        '': ['Other', 'New'],
        New: ['New/B', 'New/A'],
      });

      mockService.deleteFolder = vi.fn().mockResolvedValue(ok(undefined));
      await notesStore.deleteFolder('New');

      expect(sidebarPreferences.getState()).toEqual({
        version: 1,
        favorites: [],
        folderOrder: {
          '': ['Other'],
        },
      });
    });
  });

  describe('search()', () => {
    it('calls service.searchNotes() with query', async () => {
      notesStore.init(mockService);

      await notesStore.search('test query');

      expect(mockService.searchNotes).toHaveBeenCalledWith('test query');
    });

    it('updates searchQuery state', async () => {
      notesStore.init(mockService);

      await notesStore.search('my search');

      expect(notesStore.searchQuery).toBe('my search');
    });

    it('updates searchResults with results', async () => {
      notesStore.init(mockService);

      const results: NotesListItem[] = [
        {
          path: 'result.md',
          title: 'Result',
          isFolder: false,
          modifiedAt: new Date(),
          tags: [],
        },
      ];
      mockService.searchNotes = vi.fn().mockResolvedValue(ok(results));

      await notesStore.search('query');

      expect(notesStore.searchResults).toEqual(results);
    });

    it('clears results for empty query', async () => {
      notesStore.init(mockService);

      // First search with results
      mockService.searchNotes = vi.fn().mockResolvedValue(
        ok([{ path: 'a.md', title: 'A', isFolder: false, modifiedAt: new Date(), tags: [] }])
      );
      await notesStore.search('query');
      expect(notesStore.searchResults.length).toBe(1);

      // Empty query clears results
      await notesStore.search('');

      expect(notesStore.searchQuery).toBe('');
      expect(notesStore.searchResults).toEqual([]);
      // Should not call searchNotes for empty query
      expect(mockService.searchNotes).toHaveBeenCalledTimes(1);
    });

    it('clears results for whitespace-only query', async () => {
      notesStore.init(mockService);

      await notesStore.search('   ');

      expect(notesStore.searchResults).toEqual([]);
    });

    it('throws if not initialized', async () => {
      await expect(notesStore.search('query')).rejects.toThrow(
        'NotesStore not initialized'
      );
    });
  });

  describe('clearSearch()', () => {
    it('clears query and results', async () => {
      notesStore.init(mockService);

      // Set up some search state
      mockService.searchNotes = vi.fn().mockResolvedValue(
        ok([{ path: 'a.md', title: 'A', isFolder: false, modifiedAt: new Date(), tags: [] }])
      );
      await notesStore.search('query');

      expect(notesStore.searchQuery).toBe('query');
      expect(notesStore.searchResults.length).toBe(1);

      // Clear search
      notesStore.clearSearch();

      expect(notesStore.searchQuery).toBe('');
      expect(notesStore.searchResults).toEqual([]);
    });
  });

  describe('sidebar visibility', () => {
    describe('toggleSidebar()', () => {
      it('toggles visibility state', () => {
        notesStore.init(mockService);

        expect(notesStore.sidebarVisible).toBe(true);

        notesStore.toggleSidebar();
        expect(notesStore.sidebarVisible).toBe(false);

        notesStore.toggleSidebar();
        expect(notesStore.sidebarVisible).toBe(true);
      });
    });

    describe('showSidebar()', () => {
      it('sets visibility to true', () => {
        notesStore.init(mockService);

        notesStore.hideSidebar();
        expect(notesStore.sidebarVisible).toBe(false);

        notesStore.showSidebar();
        expect(notesStore.sidebarVisible).toBe(true);
      });
    });

    describe('hideSidebar()', () => {
      it('sets visibility to false', () => {
        notesStore.init(mockService);

        expect(notesStore.sidebarVisible).toBe(true);

        notesStore.hideSidebar();
        expect(notesStore.sidebarVisible).toBe(false);
      });
    });
  });

  describe('destroy()', () => {
    it('resets all state', () => {
      notesStore.init(mockService);

      // Set up some state
      mockService._state.items = createSampleItems();
      mockService._state.selectedPath = 'note-1.md';
      mockService._state.expandedFolders = new Set(['folder-1']);
      mockService._triggerSubscribers();

      notesStore.destroy();

      expect(notesStore.isInitialized).toBe(false);
      expect(notesStore.items).toEqual([]);
      expect(notesStore.selectedPath).toBeNull();
      expect(notesStore.isLoading).toBe(false);
      expect(notesStore.searchQuery).toBe('');
      expect(notesStore.searchResults).toEqual([]);
      expect(notesStore.expandedFolders).toEqual(new Set());
      expect(notesStore.error).toBeNull();
      expect(notesStore.sidebarVisible).toBe(true);
    });

    it('unsubscribes from service', () => {
      notesStore.init(mockService);

      expect(mockService._subscribers.size).toBe(1);

      notesStore.destroy();

      expect(mockService._subscribers.size).toBe(0);
    });
  });

  describe('derived state', () => {
    describe('hasNotes', () => {
      it('returns false when items is empty', () => {
        notesStore.init(mockService);

        expect(notesStore.hasNotes).toBe(false);
      });

      it('returns true when items has content', () => {
        notesStore.init(mockService);

        mockService._state.items = createSampleItems();
        mockService._triggerSubscribers();

        expect(notesStore.hasNotes).toBe(true);
      });
    });

    describe('isSearching', () => {
      it('returns false when searchQuery is empty', () => {
        notesStore.init(mockService);

        expect(notesStore.isSearching).toBe(false);
      });

      it('returns true when searchQuery has content', async () => {
        notesStore.init(mockService);

        await notesStore.search('query');

        expect(notesStore.isSearching).toBe(true);
      });

      it('returns false for whitespace-only query', async () => {
        notesStore.init(mockService);

        await notesStore.search('   ');

        expect(notesStore.isSearching).toBe(false);
      });
    });

    describe('noteCount', () => {
      it('returns 0 for empty items', () => {
        notesStore.init(mockService);

        expect(notesStore.noteCount).toBe(0);
      });

      it('counts only notes, not folders', () => {
        notesStore.init(mockService);

        mockService._state.items = createSampleItems();
        mockService._triggerSubscribers();

        // 2 root notes + 1 nested note = 3 total
        expect(notesStore.noteCount).toBe(3);
      });

      it('counts nested notes recursively', () => {
        notesStore.init(mockService);

        const nestedItems: NotesListItem[] = [
          {
            path: 'folder-1',
            title: 'Folder 1',
            isFolder: true,
            modifiedAt: new Date(),
            tags: [],
            children: [
              {
                path: 'folder-1/folder-2',
                title: 'Folder 2',
                isFolder: true,
                modifiedAt: new Date(),
                tags: [],
                children: [
                  {
                    path: 'folder-1/folder-2/deep-note.md',
                    title: 'Deep Note',
                    isFolder: false,
                    modifiedAt: new Date(),
                    tags: [],
                  },
                ],
              },
            ],
          },
        ];
        mockService._state.items = nestedItems;
        mockService._triggerSubscribers();

        expect(notesStore.noteCount).toBe(1);
      });
    });

    describe('allNotes', () => {
      it('returns empty array for empty items', () => {
        notesStore.init(mockService);

        expect(notesStore.allNotes).toEqual([]);
      });

      it('returns flattened list of notes only', () => {
        notesStore.init(mockService);

        mockService._state.items = createSampleItems();
        mockService._triggerSubscribers();

        const allNotes = notesStore.allNotes;

        expect(allNotes.length).toBe(3);
        expect(allNotes.every((n) => !n.isFolder)).toBe(true);
        expect(allNotes.map((n) => n.path)).toEqual([
          'note-1.md',
          'note-2.md',
          'folder-1/nested-note.md',
        ]);
      });

      it('flattens deeply nested notes', () => {
        notesStore.init(mockService);

        const nestedItems: NotesListItem[] = [
          {
            path: 'root.md',
            title: 'Root',
            isFolder: false,
            modifiedAt: new Date(),
            tags: [],
          },
          {
            path: 'folder',
            title: 'Folder',
            isFolder: true,
            modifiedAt: new Date(),
            tags: [],
            children: [
              {
                path: 'folder/subfolder',
                title: 'Subfolder',
                isFolder: true,
                modifiedAt: new Date(),
                tags: [],
                children: [
                  {
                    path: 'folder/subfolder/deep.md',
                    title: 'Deep',
                    isFolder: false,
                    modifiedAt: new Date(),
                    tags: [],
                  },
                ],
              },
            ],
          },
        ];
        mockService._state.items = nestedItems;
        mockService._triggerSubscribers();

        const allNotes = notesStore.allNotes;

        expect(allNotes.length).toBe(2);
        expect(allNotes.map((n) => n.path)).toEqual(['root.md', 'folder/subfolder/deep.md']);
      });
    });

    describe('activeFolderOverview', () => {
      it('derives child notes, subfolders, nested notes, and latest modified time', () => {
        notesStore.init(mockService);
        mockService._state.items = createNestedResearchItems();
        mockService._triggerSubscribers();

        notesStore.selectFolderView('Research/topic');

        const overview = notesStore.activeFolderOverview;
        expect(overview?.title).toBe('topic');
        expect(overview?.directNotes.map((note) => note.path)).toEqual(['Research/topic/overview.md']);
        expect(overview?.directFolders.map((folder) => folder.path)).toEqual(['Research/topic/deep']);
        expect(overview?.allNotes.map((note) => note.path)).toEqual([
          'Research/topic/overview.md',
          'Research/topic/deep/deep-note.md',
        ]);
        expect(overview?.noteCount).toBe(2);
        expect(overview?.subfolderCount).toBe(1);
        expect(overview?.latestModifiedAt?.toISOString()).toBe('2026-05-11T12:30:00.000Z');
      });
    });
  });
});
