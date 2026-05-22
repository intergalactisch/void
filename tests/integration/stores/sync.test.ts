import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySettingsAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl } from '$lib/application/services';
import { EMPTY_SYNC_STATUS, type SyncSettings, type SyncStatus } from '$lib/domain/values';
import { ok, err } from '$lib/core';
import { events } from '$lib/events';
import { settingsStore } from '$lib/stores/settings.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import type { AttachRepositoryParams, CreateAndAttachRepositoryParams, RemoteNotePreview, SyncService } from '$lib/ports/inbound/SyncService';
import type {
  GitBranchInfo,
  GitHubBranchSummary,
  GitHubDeviceAuthStart,
  GitHubNameAvailability,
  GitHubRepoSummary,
  GitHubUser,
  SyncConflict,
  SyncConflictPreview,
  SyncConflictResolution,
  SyncConflictSession,
} from '$lib/domain/values';

describe('Sync Store Integration', () => {
  let settings: SettingsServiceImpl;
  let status: SyncStatus;

  beforeEach(async () => {
    settings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath: '/notes' }));
    settingsStore.init(settings);
    await settingsStore.load();
    status = { ...EMPTY_SYNC_STATUS, conflicts: [] };
  });

  function service(): SyncService {
    return {
      getStatus: () => status,
      getCurrentUser: () => ({ login: 'void-dev', name: null } satisfies GitHubUser),
      subscribe: (callback: (next: SyncStatus) => void) => {
        callback(status);
        return () => undefined;
      },
      refreshStatus: vi.fn(async () => ok(status)),
      prepareAutomaticSyncAuth: vi.fn(async () => ok('signed-in' as const)),
      connectWithToken: vi.fn(async () => ok({ login: 'void-dev', name: null } satisfies GitHubUser)),
      beginDeviceAuth: vi.fn(async () => ok({
        deviceCode: 'device',
        userCode: 'USER-CODE',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      } satisfies GitHubDeviceAuthStart)),
      completeDeviceAuth: vi.fn(async () => ok({ login: 'void-dev', name: null } satisfies GitHubUser)),
      pollDeviceAuth: vi.fn(async () => ({ status: 'pending' as const })),
      signOut: vi.fn(async () => ok(undefined)),
      createAndAttachRepository: vi.fn(async (params: CreateAndAttachRepositoryParams) => attachSettings(params.name, params.branch ?? 'main')),
      attachRepository: vi.fn(async (params: AttachRepositoryParams) => attachSettings('notes', params.branch ?? 'main', params.remoteUrl)),
      detach: vi.fn(async () => {
        const next: SyncSettings = { ...settings.current().sync, enabled: false, repository: null };
        const saved = await settings.set('sync', next);
        return saved.ok ? ok(settings.current().sync) : err(saved.error);
      }),
      syncNow: vi.fn(async () => ok(status)),
      previewRemoteNote: vi.fn(async () => ok({
        path: 'plan.md',
        localMarkdown: null,
        remoteMarkdown: '# Plan\n',
        remoteRef: 'origin/main:plan.md',
      } satisfies RemoteNotePreview)),
      refreshNoteFromRemote: vi.fn(async () => ok({
        path: 'plan.md',
        localMarkdown: null,
        remoteMarkdown: '# Plan\n',
        remoteRef: 'origin/main:plan.md',
      } satisfies RemoteNotePreview)),
      resolveConflict: vi.fn(async (_id: string, _resolution: SyncConflictResolution) => ok(null as SyncConflict | null)),
      loadConflictSession: vi.fn(async () => ok(null as SyncConflictSession | null)),
      refreshConflictSession: vi.fn(async () => ok(null as SyncConflictSession | null)),
      previewConflict: vi.fn(async () => ok({
        conflictId: 'conflict',
        path: 'plan.md',
        baseMarkdown: null,
        localMarkdown: null,
        remoteMarkdown: null,
        mergedMarkdown: '',
        hunks: [],
        mergeClean: false,
        supported: true,
      } satisfies SyncConflictPreview)),
      applyConflictResolution: vi.fn(async () => ok(null as SyncConflictSession | null)),
      resumeConflictResolution: vi.fn(async () => ok(status)),
      abortConflictResolution: vi.fn(async () => ok(null as SyncConflictSession | null)),
      listLocalBranches: vi.fn(async () => ok([] as GitBranchInfo[])),
      switchBranch: vi.fn(async () => ok(settings.current().sync)),
      createBranch: vi.fn(async () => ok([] as GitBranchInfo[])),
      listRemoteRepositories: vi.fn(async () => ok([] as GitHubRepoSummary[])),
      listRemoteBranches: vi.fn(async () => ok([] as GitHubBranchSummary[])),
      checkRepositoryName: vi.fn(async () => ok({ available: true, reason: null } satisfies GitHubNameAvailability)),
      setAutoSync: vi.fn(async () => ok(settings.current().sync)),
      setPaused: vi.fn(async () => ok(settings.current().sync)),
    };
  }

  async function attachSettings(name: string, branch: string, remoteUrl = `https://github.com/me/${name}.git`) {
    const next: SyncSettings = {
      ...settings.current().sync,
      enabled: true,
      paused: false,
      repository: {
        provider: 'github',
        owner: 'me',
        name,
        fullName: `me/${name}`,
        remoteUrl,
        htmlUrl: `https://github.com/me/${name}`,
        branch,
      },
    };
    const saved = await settings.set('sync', next);
    return saved.ok ? ok(settings.current().sync) : err(saved.error);
  }

  it('reloads settings after attach mutates sync config through the service', async () => {
    syncStore.init(service());

    const attached = await syncStore.attachRepository('https://github.com/me/notes.git', 'main');

    expect(attached?.repository?.fullName).toBe('me/notes');
    expect(settingsStore.settings?.sync.repository?.fullName).toBe('me/notes');
    expect(settingsStore.settings?.sync.enabled).toBe(true);
  });

  it('reloads settings when create partially attaches before surfacing an error', async () => {
    const mock = service();
    mock.createAndAttachRepository = vi.fn(async (params: CreateAndAttachRepositoryParams) => {
      await attachSettings(params.name, params.branch ?? 'main');
      return err(new Error('initial push failed'));
    });
    syncStore.init(mock);

    const attached = await syncStore.createRepository({ name: 'void-notes' });

    expect(attached).toBeNull();
    expect(settingsStore.settings?.sync.repository?.fullName).toBe('me/void-notes');
    expect(settingsStore.settings?.sync.enabled).toBe(true);
  });

  it('shows a temporary quiet completion label after sync completes', async () => {
    syncStore.init(service());

    events.emit('sync:completed', {
      status: { ...status, kind: 'ready' },
      mode: 'background',
    });

    expect(syncStore.displayLabel).toBe('GitHub synced just now');
    expect(syncStore.lastSyncMode).toBe('background');

    events.emit('sync:started', { operation: 'committing', mode: 'background' });
  });
});
