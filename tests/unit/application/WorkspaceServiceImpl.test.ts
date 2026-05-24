import { beforeEach, describe, expect, it, vi } from 'vitest';
import mitt from 'mitt';
import type { EventMap } from '$lib/events/types';
import { MemoryFileSystemAdapter, MemorySettingsAdapter, MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl, WorkspaceServiceImpl } from '$lib/application/services';
import { EMPTY_SELECTION, DEFAULT_SYNC_SETTINGS } from '$lib/domain/values';
import type { EditorService, EditorState, SyncService } from '$lib/ports/inbound';

vi.mock('$lib/events', () => {
  const mockEvents = mitt<EventMap>();
  return { events: mockEvents };
});

describe('WorkspaceServiceImpl', () => {
  let settings: SettingsServiceImpl;

  beforeEach(async () => {
    settings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath: '/notes' }));
    await settings.load();
  });

  function editorWithState(state: Partial<EditorState>): EditorService {
    return {
      getState: vi.fn(() => ({
        document: null,
        tabs: [],
        activePath: null,
        activePaneId: null,
        panes: {},
        selection: EMPTY_SELECTION,
        isReady: true,
        isDirty: false,
        isSaving: false,
        conflictState: 'clean',
        aiProcessing: null,
        aiInlineComposers: [],
        activeAIInlineComposerId: null,
        ...state,
      })),
    } as unknown as EditorService;
  }

  function cleanSync(): SyncService {
    return {
      getStatus: vi.fn(() => ({
        kind: 'ready',
        operation: 'idle',
        auth: 'signed-in',
        repoKind: 'managed',
        branch: 'main',
        remoteUrl: 'https://github.com/me/notes.git',
        ahead: 0,
        behind: 0,
        changedFiles: 0,
        conflicts: [],
        lastSyncAt: null,
        message: null,
      })),
      loadConflictSession: vi.fn(async () => ({ ok: true, value: null })),
    } as unknown as SyncService;
  }

  function syncing(): SyncService {
    return {
      ...cleanSync(),
      getStatus: vi.fn(() => ({
        kind: 'syncing',
        operation: 'pushing',
        auth: 'signed-in',
        repoKind: 'managed',
        branch: 'main',
        remoteUrl: 'https://github.com/me/notes.git',
        ahead: 0,
        behind: 0,
        changedFiles: 0,
        conflicts: [],
        lastSyncAt: null,
        message: null,
      })),
    } as unknown as SyncService;
  }

  function serviceWithStorage(sync: SyncService = cleanSync()) {
    const fileSystem = new MemoryFileSystemAdapter();
    const voidStorage = new MemoryVoidStorageAdapter();
    const service = new WorkspaceServiceImpl(
      settings,
      editorWithState({}),
      sync,
      fileSystem,
      voidStorage,
    );
    return { service, fileSystem, voidStorage };
  }

  async function addInactiveWorkspace(
    service: WorkspaceServiceImpl,
    name = 'Research',
    notesPath = '/research',
  ) {
    const created = await service.create({ name, notesPath });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    return created.value;
  }

  it('creates workspaces without changing the active workspace', async () => {
    const service = new WorkspaceServiceImpl(settings, editorWithState({}), cleanSync());

    const created = await service.create({ name: 'Research', notesPath: '/research' });

    expect(created.ok).toBe(true);
    expect(service.list().map((workspace) => workspace.name)).toEqual(['Void', 'Research']);
    expect(service.active().notesPath).toBe('/notes');
  });

  it('blocks switching when editor tabs are dirty', async () => {
    const service = new WorkspaceServiceImpl(
      settings,
      editorWithState({
        tabs: [{ path: 'plan.md', title: 'Plan', isDirty: true, isSaving: false, conflictState: 'clean' }],
      }),
      cleanSync(),
    );
    const created = await service.create({ name: 'Research', notesPath: '/research' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await service.switchTo(created.value.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('dirty editor tabs');
    expect(service.active().notesPath).toBe('/notes');
  });

  it('switches active workspace and updates the mirrored notes path', async () => {
    const service = new WorkspaceServiceImpl(settings, editorWithState({}), cleanSync());
    const created = await service.create({ name: 'Research', notesPath: '/research' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const switched = await service.switchTo(created.value.id);

    expect(switched.ok).toBe(true);
    expect(settings.current().activeWorkspaceId).toBe(created.value.id);
    expect(settings.current().notesPath).toBe('/research');
    expect(settings.current().sync).toEqual(created.value.sync);
  });

  it('creates and switches to a managed workflow from only a name', async () => {
    const { service, fileSystem } = serviceWithStorage();

    const created = await service.createAndSwitch({ name: 'Research' });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresReload).toBe(true);
    expect(settings.current().activeWorkspaceId).toBe(created.value.workspace.id);
    expect(settings.current().notesPath).toBe('~/Documents/Void/Research');
    expect(settings.current().sync.repository).toBeNull();
    await expect(fileSystem.exists('~/Documents/Void/Research')).resolves.toEqual({ ok: true, value: true });
  });

  it('creates and switches to a custom absolute folder', async () => {
    const { service, fileSystem } = serviceWithStorage();

    const created = await service.createAndSwitch({ name: 'Scratch', notesPath: '/tmp/void-scratch' });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(settings.current().notesPath).toBe('/tmp/void-scratch');
    await expect(fileSystem.exists('/tmp/void-scratch')).resolves.toEqual({ ok: true, value: true });
  });

  it('rejects relative custom folders', async () => {
    const { service } = serviceWithStorage();

    const created = await service.createAndSwitch({ name: 'Test', notesPath: 'Test' });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.message).toContain('absolute folder path');
  });

  it('blocks create-and-switch when sync is active', async () => {
    const { service } = serviceWithStorage(syncing());

    const created = await service.createAndSwitch({ name: 'Research' });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.message).toContain('sync');
    expect(settings.current().notesPath).toBe('/notes');
  });

  it('migrates the legacy default workflow into the managed layout', async () => {
    const syncedSettings = new SettingsServiceImpl(new MemorySettingsAdapter({
      notesPath: '~/Documents/void',
      sync: {
        ...DEFAULT_SYNC_SETTINGS,
        enabled: true,
        repository: {
          provider: 'github',
          owner: 'me',
          name: 'notes',
          fullName: 'me/notes',
          remoteUrl: 'https://github.com/me/notes.git',
          branch: 'main',
        },
      },
    }));
    await syncedSettings.load();
    const fileSystem = new MemoryFileSystemAdapter();
    fileSystem.seed({
      '~/Documents/void/note.md': '# Note',
      '~/Documents/void/.git/config': '[remote "origin"]',
      '~/Documents/void/.void/provenance/note.jsonl': '{}',
    });
    const service = new WorkspaceServiceImpl(
      syncedSettings,
      editorWithState({}),
      cleanSync(),
      fileSystem,
      new MemoryVoidStorageAdapter(),
    );

    const migrated = await service.migrateLegacyDefaultWorkspace();

    expect(migrated.ok).toBe(true);
    expect(syncedSettings.current().notesPath).toBe('~/Documents/Void/Default');
    expect(syncedSettings.current().sync.repository?.fullName).toBe('me/notes');
    await expect(fileSystem.exists('~/Documents/Void/Default/note.md')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('~/Documents/Void/Default/.git/config')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('~/Documents/Void/Default/.void/provenance/note.jsonl')).resolves.toEqual({ ok: true, value: true });
  });

  it('migrates the legacy default before creating and switching to a managed workflow', async () => {
    const legacySettings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath: '~/Documents/void' }));
    await legacySettings.load();
    const fileSystem = new MemoryFileSystemAdapter();
    fileSystem.seed({ '~/Documents/void/index.md': '# Home' });
    const service = new WorkspaceServiceImpl(
      legacySettings,
      editorWithState({}),
      cleanSync(),
      fileSystem,
      new MemoryVoidStorageAdapter(),
    );

    const created = await service.createAndSwitch({ name: 'Test', migrateLegacyDefault: true });

    expect(created.ok).toBe(true);
    expect(legacySettings.current().notesPath).toBe('~/Documents/Void/Test');
    expect(legacySettings.current().workspaces.map((workspace) => workspace.notesPath)).toEqual([
      '~/Documents/Void/Default',
      '~/Documents/Void/Test',
    ]);
    await expect(fileSystem.exists('~/Documents/Void/Default/index.md')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('~/Documents/Void/Test')).resolves.toEqual({ ok: true, value: true });
  });

  it('aborts legacy migration when the managed default destination exists', async () => {
    const legacySettings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath: '~/Documents/void' }));
    await legacySettings.load();
    const fileSystem = new MemoryFileSystemAdapter();
    await fileSystem.createDirectory('~/Documents/void');
    await fileSystem.createDirectory('~/Documents/Void/Default');
    const service = new WorkspaceServiceImpl(
      legacySettings,
      editorWithState({}),
      cleanSync(),
      fileSystem,
      new MemoryVoidStorageAdapter(),
    );

    const migrated = await service.migrateLegacyDefaultWorkspace();

    expect(migrated.ok).toBe(false);
    if (!migrated.ok) expect(migrated.error.message).toContain('already exists');
    expect(legacySettings.current().notesPath).toBe('~/Documents/void');
  });

  it('renames a workspace display name without changing its folder', async () => {
    const { service } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);

    const renamed = await service.rename(workspace.id, 'Ideas');

    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.name).toBe('Ideas');
    expect(renamed.value.notesPath).toBe('/research');
  });

  it('moves an inactive workspace folder and preserves sync config', async () => {
    const { service, fileSystem } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);
    const repository = {
      provider: 'github' as const,
      owner: 'me',
      name: 'research',
      fullName: 'me/research',
      remoteUrl: 'https://github.com/me/research.git',
      branch: 'main',
    };
    const withSync = {
      ...settings.current(),
      workspaces: settings.current().workspaces.map((item) =>
        item.id === workspace.id
          ? {
              ...item,
              sync: {
                ...DEFAULT_SYNC_SETTINGS,
                enabled: true,
                repository,
              },
            }
          : item
      ),
    };
    await settings.save(withSync);
    fileSystem.seed({
      '/research/note.md': '# Note',
      '/research/.git/config': '[remote "origin"]',
      '/research/.void/provenance/note.jsonl': '{}',
    });

    const moved = await service.moveFolder(workspace.id, '/archive/research');

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.notesPath).toBe('/archive/research');
    expect(moved.value.sync.repository?.fullName).toBe('me/research');
    expect(settings.current().workspaces.find((item) => item.id === workspace.id)?.sync.repository?.fullName).toBe('me/research');
    await expect(fileSystem.exists('/archive/research/note.md')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('/archive/research/.git/config')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('/archive/research/.void/provenance/note.jsonl')).resolves.toEqual({ ok: true, value: true });
    await expect(fileSystem.exists('/research')).resolves.toEqual({ ok: true, value: false });
  });

  it('rejects moving the active workspace', async () => {
    const { service } = serviceWithStorage();
    await addInactiveWorkspace(service);
    const active = service.active();

    const moved = await service.moveFolder(active.id, '/archive/default');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.message).toContain('before moving');
  });

  it('rejects moving the last workspace', async () => {
    const { service } = serviceWithStorage();
    const active = service.active();

    const moved = await service.moveFolder(active.id, '/archive/default');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.message).toContain('At least one workspace');
  });

  it('rejects moving to a relative destination', async () => {
    const { service } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);

    const moved = await service.moveFolder(workspace.id, 'archive/research');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.message).toContain('absolute destination');
  });

  it('rejects moving to a folder that already exists', async () => {
    const { service, fileSystem } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);
    await fileSystem.createDirectory('/archive/research');

    const moved = await service.moveFolder(workspace.id, '/archive/research');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.message).toContain('already exists');
  });

  it('rejects moving to a folder used by another workspace', async () => {
    const { service } = serviceWithStorage();
    const research = await addInactiveWorkspace(service, 'Research', '/research');
    await addInactiveWorkspace(service, 'Archive', '/archive');

    const moved = await service.moveFolder(research.id, '/archive');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.message).toContain('Another workspace');
  });

  it('rejects trashing the active workspace', async () => {
    const { service } = serviceWithStorage();
    await addInactiveWorkspace(service);
    const active = service.active();

    const trashed = await service.trash(active.id);

    expect(trashed.ok).toBe(false);
    if (!trashed.ok) expect(trashed.error.message).toContain('before trashing');
  });

  it('rejects trashing the last workspace', async () => {
    const { service } = serviceWithStorage();
    const active = service.active();

    const trashed = await service.trash(active.id);

    expect(trashed.ok).toBe(false);
    if (!trashed.ok) expect(trashed.error.message).toContain('At least one workspace');
  });

  it('removes an inactive workspace from settings and moves its folder to Trash', async () => {
    const { service, fileSystem } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);
    fileSystem.seed({
      '/research/note.md': '# Note',
      '/research/.void/provenance/note.jsonl': '{}',
    });

    const trashed = await service.trash(workspace.id);

    expect(trashed.ok).toBe(true);
    expect(settings.current().workspaces.some((item) => item.id === workspace.id)).toBe(false);
    await expect(fileSystem.exists('/research')).resolves.toEqual({ ok: true, value: false });
  });

  it('removes an inactive workspace when its absolute folder is already missing', async () => {
    const { service, fileSystem } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);
    await fileSystem.deleteDirectory('/research');

    const trashed = await service.trash(workspace.id);

    expect(trashed.ok).toBe(true);
    expect(settings.current().workspaces.some((item) => item.id === workspace.id)).toBe(false);
  });

  it('removes an inactive workspace with a legacy relative folder path without touching disk', async () => {
    const { service } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service);
    await settings.save({
      ...settings.current(),
      workspaces: settings.current().workspaces.map((item) =>
        item.id === workspace.id ? { ...item, notesPath: 'Test' } : item
      ),
    });

    const trashed = await service.trash(workspace.id);

    expect(trashed.ok).toBe(true);
    expect(settings.current().workspaces.some((item) => item.id === workspace.id)).toBe(false);
  });

  it('keeps GitHub remote data untouched when trashing a synced workspace locally', async () => {
    const { service, fileSystem } = serviceWithStorage();
    const workspace = await addInactiveWorkspace(service, 'Synced', '/synced');
    const repository = {
      provider: 'github' as const,
      owner: 'me',
      name: 'synced',
      fullName: 'me/synced',
      remoteUrl: 'https://github.com/me/synced.git',
      branch: 'main',
    };
    await settings.save({
      ...settings.current(),
      workspaces: settings.current().workspaces.map((item) =>
        item.id === workspace.id
          ? {
              ...item,
              sync: {
                ...DEFAULT_SYNC_SETTINGS,
                enabled: true,
                repository,
              },
            }
          : item
      ),
    });
    fileSystem.seed({ '/synced/.git/config': '[remote "origin"]' });

    const trashed = await service.trash(workspace.id);

    expect(trashed.ok).toBe(true);
    expect(settings.current().workspaces.some((item) => item.sync.repository?.fullName === 'me/synced')).toBe(false);
    expect(settings.current().sync.repository).toBeNull();
  });
});
