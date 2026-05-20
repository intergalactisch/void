import { beforeEach, describe, expect, it, vi } from 'vitest';
import mitt from 'mitt';
import type { EventMap } from '$lib/events/types';
import { MemorySettingsAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl, WorkspaceServiceImpl } from '$lib/application/services';
import { EMPTY_SELECTION } from '$lib/domain/values';
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
        selection: EMPTY_SELECTION,
        isReady: true,
        isDirty: false,
        isSaving: false,
        conflictState: 'clean',
        aiProcessing: null,
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
});
