import { beforeEach, describe, expect, it, vi } from 'vitest';
import mitt from 'mitt';
import type { EventMap } from '$lib/events/types';
import { MemoryCredentialAdapter, MemoryGitHubAdapter, MemoryGitRepositoryAdapter, MemorySettingsAdapter, MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { CredentialServiceImpl, SettingsServiceImpl, SyncServiceImpl } from '$lib/application/services';
import { EMPTY_SELECTION, createVoidRepoManifest, type SyncSettings } from '$lib/domain/values';
import { CREDENTIAL_KEYS, type CredentialService, type DocumentService, type EditorService, type EditorState, type NotesService } from '$lib/ports/inbound';

vi.mock('$lib/events', () => {
  const mockEvents = mitt<EventMap>();
  return { events: mockEvents };
});

describe('SyncServiceImpl', () => {
  const notesPath = '/notes';
  let git: MemoryGitRepositoryAdapter;
  let github: MemoryGitHubAdapter;
  let settings: SettingsServiceImpl;
  let credentials: CredentialServiceImpl;
  let voidStorage: MemoryVoidStorageAdapter;
  let notes: NotesService;
  let documents: DocumentService;
  let contents: Map<string, string>;

  beforeEach(async () => {
    git = new MemoryGitRepositoryAdapter();
    github = new MemoryGitHubAdapter();
    settings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath }));
    credentials = new CredentialServiceImpl(new MemoryCredentialAdapter());
    voidStorage = new MemoryVoidStorageAdapter();
    notes = {
      refresh: vi.fn(async () => ({ ok: true, value: [] })),
    } as unknown as NotesService;
    contents = new Map([['plan.md', '# Local\n']]);
    documents = {
      readContent: vi.fn(async (path: string) => ({ ok: true, value: contents.get(path) ?? null })),
      writeContent: vi.fn(async (path: string, markdown: string) => {
        contents.set(path, markdown);
        return { ok: true, value: undefined };
      }),
    } as unknown as DocumentService;
    await settings.load();
    github.seedVoidManifest('me/notes', createVoidRepoManifest({ workspaceId: settings.current().activeWorkspaceId }));
  });

  function service(): SyncServiceImpl {
    return new SyncServiceImpl(git, github, settings, credentials, notesPath, notes, undefined, documents, voidStorage);
  }

  async function configureAttachedSync(): Promise<void> {
    const next: SyncSettings = {
      ...settings.current().sync,
      enabled: true,
      autoSync: true,
      paused: false,
      authMode: 'token',
      repository: {
        provider: 'github',
        owner: 'me',
        name: 'notes',
        fullName: 'me/notes',
        remoteUrl: 'https://github.com/me/notes.git',
        htmlUrl: 'https://github.com/me/notes',
        branch: 'main',
      },
    };
    await settings.set('sync', next);
    git.attachGitHubRemote(notesPath, next.repository!.remoteUrl, next.repository!.branch);
  }

  function createEditor(state: EditorState): EditorService {
    return {
      getState: vi.fn(() => state),
      switchTab: vi.fn(async (path: string) => {
        state.activePath = path;
        return { ok: true, value: undefined };
      }),
      saveDocument: vi.fn(async () => {
        for (const tab of state.tabs) {
          if (tab.path === state.activePath) tab.isDirty = false;
        }
        state.isDirty = state.tabs.some((tab) => tab.path === state.activePath && tab.isDirty);
        return { ok: true, value: undefined };
      }),
    } as unknown as EditorService;
  }

  it('detects an unattached folder as disabled', async () => {
    const result = await service().refreshStatus();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('disabled');
      expect(result.value.repoKind).toBe('none');
    }
  });

  it('stores GitHub tokens in credentials and not sync settings', async () => {
    const result = await service().connectWithToken('ghp_test');

    expect(result.ok).toBe(true);
    expect(await credentials.has(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN)).toBe(true);
    expect(settings.current().sync.authMode).toBe('token');
    expect(JSON.stringify(settings.current().sync)).not.toContain('ghp_test');
  });

  it('rehydrates GitHub auth from stored credentials after service recreation', async () => {
    const first = service();
    const connected = await first.connectWithToken('ghp_test');
    expect(connected.ok).toBe(true);

    const nextSession = service();
    const status = await nextSession.refreshStatus();

    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.auth).toBe('signed-in');
    }
    expect(nextSession.getCurrentUser()?.login).toBe('void-dev');
  });

  it('can refresh status passively without reading stored credentials', async () => {
    await settings.set('githubAccount', {
      provider: 'github',
      login: 'void-dev',
      name: null,
      lastAuthenticatedAt: '2026-01-01T00:00:00.000Z',
    });
    const getCredential = vi.spyOn(credentials, 'get');

    const status = await service().refreshStatus({ authProbe: 'passive' });

    expect(status.ok).toBe(true);
    expect(getCredential).not.toHaveBeenCalled();
    if (status.ok) {
      expect(status.value.auth).toBe('signed-in');
    }
  });

  it('warms automatic sync auth and then background sync uses the cached token', async () => {
    await configureAttachedSync();
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    git.seed(notesPath, {
      changedFiles: [{ path: 'plan.md', status: 'M', staged: false, conflicted: false }],
    });
    const sync = service();
    const getCredential = vi.spyOn(credentials, 'get');

    const prepared = await sync.prepareAutomaticSyncAuth();
    expect(prepared.ok).toBe(true);
    expect(getCredential).toHaveBeenCalledTimes(1);

    getCredential.mockClear();
    const result = await sync.syncNow({ mode: 'background' });

    expect(result.ok).toBe(true);
    expect(getCredential).not.toHaveBeenCalled();
  });

  it('does not read Keychain for background sync when auth was not prepared', async () => {
    await configureAttachedSync();
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const getCredential = vi.spyOn(credentials, 'get');

    const sync = service();
    const result = await sync.syncNow({ mode: 'background' });

    expect(result.ok).toBe(false);
    expect(getCredential).not.toHaveBeenCalled();
    expect(sync.getStatus().kind).toBe('auth-required');
  });

  it('reports pending status when open editor tabs have unsynced changes', async () => {
    await configureAttachedSync();
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const editor = createEditor({
      document: null,
      tabs: [
        { path: 'plan.md', title: 'Plan', isDirty: true, isSaving: false, conflictState: 'clean' },
      ],
      activePath: 'plan.md',
      activePaneId: null,
      panes: {},
      selection: EMPTY_SELECTION,
      isReady: true,
      isDirty: true,
      isSaving: false,
      conflictState: 'clean',
      aiProcessing: null,
      aiInlineComposers: [],
      activeAIInlineComposerId: null,
    });
    const sync = new SyncServiceImpl(git, github, settings, credentials, notesPath, notes, editor, documents, voidStorage);

    const status = await sync.refreshStatus();

    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.kind).toBe('pending');
      expect(status.value.message).toContain('1 open note');
    }
  });

  it('fails sign-in when the saved GitHub token cannot be read back', async () => {
    const brokenCredentials: CredentialService = {
      store: vi.fn(async () => ({ ok: true, value: undefined })),
      get: vi.fn(async () => ({ ok: true, value: null })),
      delete: vi.fn(async () => ({ ok: true, value: undefined })),
      has: vi.fn(async () => false),
    };
    const sync = new SyncServiceImpl(git, github, settings, brokenCredentials, notesPath, notes, undefined, documents, voidStorage);

    const result = await sync.connectWithToken('ghp_test');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not readable from keychain');
    }
    expect(sync.getStatus().kind).toBe('error');
    expect(settings.current().sync.authMode).toBe('github-app');
  });

  it('creates a private GitHub repo, initializes local Git, and attaches settings', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const write = vi.spyOn(git, 'writeWorkingFile');

    const result = await service().createAndAttachRepository({ name: 'void-notes', private: true });

    expect(result.ok).toBe(true);
    expect(settings.current().sync.enabled).toBe(true);
    expect(settings.current().sync.repository?.fullName).toBe('void-dev/void-notes');
    expect(write).toHaveBeenCalledWith(
      notesPath,
      '.void/repo.json',
      expect.stringContaining('"kind": "void-workspace"'),
    );

    const status = await service().refreshStatus();
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.kind).toBe('ready');
      expect(status.value.remoteUrl).toBe('https://github.com/void-dev/void-notes.git');
    }
  });

  it('refuses to create public repositories for sync', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');

    const result = await service().createAndAttachRepository({ name: 'void-notes', private: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('private repositories');
    }
    expect(settings.current().sync.enabled).toBe(false);
  });

  it('filters the remote repository picker to private Void-ready repositories', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    github.seedRepositories([
      {
        owner: 'me',
        name: 'private-notes',
        fullName: 'me/private-notes',
        private: true,
        defaultBranch: 'main',
        description: null,
        cloneUrl: 'https://github.com/me/private-notes.git',
        sshUrl: 'git@github.com:me/private-notes.git',
        htmlUrl: 'https://github.com/me/private-notes',
        pushedAt: null,
        permissionsPush: true,
      },
      {
        owner: 'me',
        name: 'public-notes',
        fullName: 'me/public-notes',
        private: false,
        defaultBranch: 'main',
        description: null,
        cloneUrl: 'https://github.com/me/public-notes.git',
        sshUrl: 'git@github.com:me/public-notes.git',
        htmlUrl: 'https://github.com/me/public-notes',
        pushedAt: null,
        permissionsPush: true,
      },
    ]);
    github.seedVoidManifest('me/private-notes', createVoidRepoManifest({ workspaceId: 'workspace-private-notes' }));

    const result = await service().listRemoteRepositories();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((repo) => repo.fullName)).toEqual(['me/private-notes']);
    }
  });

  it('refuses to attach private repositories that are not Void-ready', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    github.seedRepositories([
      {
        owner: 'me',
        name: 'code',
        fullName: 'me/code',
        private: true,
        defaultBranch: 'main',
        description: null,
        cloneUrl: 'https://github.com/me/code.git',
        sshUrl: 'git@github.com:me/code.git',
        htmlUrl: 'https://github.com/me/code',
        pushedAt: null,
        permissionsPush: true,
      },
    ]);
    const setRemote = vi.spyOn(git, 'setRemote');

    const result = await service().attachRepository({ remoteUrl: 'https://github.com/me/code.git' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not a Void-ready repository');
    }
    expect(setRemote).not.toHaveBeenCalled();
    expect(settings.current().sync.enabled).toBe(false);
  });

  it('refuses to attach public repositories before changing local Git state', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    github.seedRepositories([
      {
        owner: 'me',
        name: 'public-notes',
        fullName: 'me/public-notes',
        private: false,
        defaultBranch: 'main',
        description: null,
        cloneUrl: 'https://github.com/me/public-notes.git',
        sshUrl: 'git@github.com:me/public-notes.git',
        htmlUrl: 'https://github.com/me/public-notes',
        pushedAt: null,
        permissionsPush: true,
      },
    ]);
    const setRemote = vi.spyOn(git, 'setRemote');

    const result = await service().attachRepository({ remoteUrl: 'https://github.com/me/public-notes.git' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('private repositories');
    }
    expect(setRemote).not.toHaveBeenCalled();
    expect(settings.current().sync.enabled).toBe(false);
  });

  it('keeps a newly created repository attached when the initial push fails', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    vi.spyOn(git, 'push').mockResolvedValue({
      ok: false,
      error: new Error('GitHub authentication failed before Git could obtain credentials.'),
    });
    const sync = service();

    const result = await sync.createAndAttachRepository({ name: 'void-notes', private: true });

    expect(result.ok).toBe(false);
    expect(settings.current().sync.enabled).toBe(true);
    expect(settings.current().sync.repository?.fullName).toBe('void-dev/void-notes');
    expect(sync.getStatus().kind).toBe('error');
    expect(sync.getStatus().remoteUrl).toBe('https://github.com/void-dev/void-notes.git');
  });

  it('creates a recovery branch before a clean divergent merge and pushes normally', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    const recovery = vi.spyOn(git, 'createRecoveryBranch');
    const merge = vi.spyOn(git, 'beginMerge');

    const result = await sync.syncNow();

    expect(result.ok).toBe(true);
    expect(recovery).toHaveBeenCalledWith(notesPath, expect.stringMatching(/^void-sync-recovery\/\d{8}-\d{6}$/));
    expect(recovery.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    expect(settings.current().sync.paused).toBe(false);
    expect(sync.getStatus().kind).toBe('ready');
    expect((await sync.loadConflictSession()).ok).toBe(true);
  });

  it('persists an overlapping markdown conflict session and reloads it after restart', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, {
      path: 'plan.md',
      base: '# Plan\nold\n',
      local: '# Plan\nlocal\n',
      remote: '# Plan\nremote\n',
    });

    const result = await sync.syncNow();

    expect(result.ok).toBe(false);
    expect(settings.current().sync.paused).toBe(true);
    expect(sync.getStatus().kind).toBe('conflicted');
    const session = await sync.loadConflictSession();
    expect(session.ok).toBe(true);
    if (session.ok) {
      expect(session.value?.recoveryBranch).toMatch(/^void-sync-recovery\/\d{8}-\d{6}$/);
      expect(session.value?.conflicts[0]?.mergeStatus).toBe('pending');
      expect(session.value?.conflicts[0]?.hunks).toHaveLength(1);
    }

    const restarted = service();
    const reloaded = await restarted.loadConflictSession();
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value?.conflicts[0]?.path).toBe('plan.md');
    }
  });

  it('applies keep-local and completes the merge only after all conflicts are resolved', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, {
      path: 'plan.md',
      base: 'base\n',
      local: 'local\n',
      remote: 'remote\n',
    });
    await sync.syncNow();

    const write = vi.spyOn(git, 'writeWorkingFile');
    const result = await sync.applyConflictResolution('sync-conflict-plan.md', 'keep-local');

    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledWith(notesPath, 'plan.md', 'local\n');
    expect(settings.current().sync.paused).toBe(false);
    expect(sync.getStatus().conflicts).toHaveLength(0);
  });

  it('duplicates the local copy before taking remote content', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, {
      path: 'folder/plan.md',
      base: 'base\n',
      local: 'local\n',
      remote: 'remote\n',
    });
    await sync.syncNow();
    const write = vi.spyOn(git, 'writeWorkingFile');
    const stage = vi.spyOn(git, 'stagePaths');

    const result = await sync.applyConflictResolution('sync-conflict-folder-plan.md', 'duplicate-local');

    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledWith(notesPath, expect.stringMatching(/^folder\/plan \(local \d{8}-\d{6}\)\.md$/), 'local\n');
    expect(write).toHaveBeenCalledWith(notesPath, 'folder/plan.md', 'remote\n');
    expect(stage).toHaveBeenCalledWith(notesPath, expect.arrayContaining(['folder/plan.md']));
  });

  it('uses edited merged content for use-merged', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, {
      path: 'plan.md',
      base: 'base\n',
      local: 'local\n',
      remote: 'remote\n',
    });
    await sync.syncNow();
    const write = vi.spyOn(git, 'writeWorkingFile');

    const result = await sync.applyConflictResolution('sync-conflict-plan.md', 'use-merged', 'edited\n');

    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledWith(notesPath, 'plan.md', 'edited\n');
  });

  it('blocks resume until every conflict has been resolved', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, { path: 'one.md', base: 'b\n', local: 'l1\n', remote: 'r1\n' });
    git.seedMergeConflict(notesPath, { path: 'two.md', base: 'b\n', local: 'l2\n', remote: 'r2\n' });
    await sync.syncNow();
    await sync.applyConflictResolution('sync-conflict-one.md', 'keep-local');

    const result = await sync.resumeConflictResolution();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Resolve every sync conflict');
    expect(settings.current().sync.paused).toBe(true);
  });

  it('aborts a merge while preserving the recovery session and paused state', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const sync = service();
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    git.seedMergeConflict(notesPath, { path: 'plan.md', base: 'base\n', local: 'local\n', remote: 'remote\n' });
    await sync.syncNow();

    const result = await sync.abortConflictResolution();

    expect(result.ok).toBe(true);
    expect(settings.current().sync.paused).toBe(true);
    if (result.ok) {
      expect(result.value?.status).toBe('aborted');
      expect(result.value?.recoveryBranch).toMatch(/^void-sync-recovery\/\d{8}-\d{6}$/);
    }
  });

  it('flushes dirty editor tabs before committing sync changes', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const editorState: EditorState = {
      document: null,
      tabs: [
        { path: 'plan.md', title: 'Plan', isDirty: true, isSaving: false, conflictState: 'clean' },
        { path: 'idea.md', title: 'Idea', isDirty: true, isSaving: false, conflictState: 'clean' },
      ],
      activePath: 'plan.md',
      activePaneId: null,
      panes: {},
      selection: EMPTY_SELECTION,
      isReady: true,
      isDirty: true,
      isSaving: false,
      conflictState: 'clean',
      aiProcessing: null,
      aiInlineComposers: [],
      activeAIInlineComposerId: null,
    };
    const editor = createEditor(editorState);
    const sync = new SyncServiceImpl(git, github, settings, credentials, notesPath, notes, editor, documents, voidStorage);
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });

    const result = await sync.syncNow();

    expect(result.ok).toBe(true);
    expect(editor.saveDocument).toHaveBeenCalledTimes(2);
    expect(editor.switchTab).toHaveBeenCalledWith('idea.md');
    expect(editor.switchTab).toHaveBeenLastCalledWith('plan.md');
  });

  it('blocks sync when an open editor tab has an unresolved file conflict', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    const editorState: EditorState = {
      document: null,
      tabs: [
        { path: 'plan.md', title: 'Plan', isDirty: true, isSaving: false, conflictState: 'external-modified' },
      ],
      activePath: 'plan.md',
      activePaneId: null,
      panes: {},
      selection: EMPTY_SELECTION,
      isReady: true,
      isDirty: true,
      isSaving: false,
      conflictState: 'external-modified',
      aiProcessing: null,
      aiInlineComposers: [],
      activeAIInlineComposerId: null,
    };
    const editor = createEditor(editorState);
    const sync = new SyncServiceImpl(git, github, settings, credentials, notesPath, notes, editor, documents, voidStorage);
    await sync.attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });

    const result = await sync.syncNow();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Resolve editor conflicts before syncing');
    }
    expect(editor.saveDocument).not.toHaveBeenCalled();
  });

  it('refreshes one note from GitHub as a normal local edit', async () => {
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'ghp_test');
    await service().attachRepository({ remoteUrl: 'https://github.com/me/notes.git' });
    git.seedRemoteFile(notesPath, 'plan.md', '# Remote\n');

    const result = await service().refreshNoteFromRemote('plan.md');

    expect(result.ok).toBe(true);
    expect(contents.get('plan.md')).toBe('# Remote\n');
    expect(documents.writeContent).toHaveBeenCalledWith(
      'plan.md',
      '# Remote\n',
      expect.objectContaining({ commandId: 'note.refreshFromGitHub' }),
    );
  });
});
