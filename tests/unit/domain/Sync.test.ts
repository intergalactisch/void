import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_ARTIFACT_POLICY,
  cloneDefaultSyncSettings,
  createVoidRepoManifest,
  parseGitHubRemote,
  syncStatusFromRepo,
  validateSyncSettings,
  validateVoidRepoManifest,
  type GitRepositoryState,
} from '$lib/domain/values';

function repoState(patch: Partial<GitRepositoryState> = {}): GitRepositoryState {
  return {
    repoKind: 'managed',
    root: '/notes',
    branch: 'main',
    remoteUrl: 'https://github.com/me/notes.git',
    upstream: 'origin/main',
    detached: false,
    ahead: 0,
    behind: 0,
    changedFiles: [],
    conflicts: [],
    lastCommit: 'abc123',
    message: null,
    ...patch,
  };
}

describe('GitHub sync domain values', () => {
  it('parses GitHub HTTPS and SSH remotes', () => {
    expect(parseGitHubRemote('https://github.com/sander/void-notes.git')).toMatchObject({
      owner: 'sander',
      name: 'void-notes',
      fullName: 'sander/void-notes',
      branch: 'main',
    });

    expect(parseGitHubRemote('git@github.com:sander/void-notes.git', 'trunk')).toMatchObject({
      owner: 'sander',
      name: 'void-notes',
      branch: 'trunk',
      htmlUrl: 'https://github.com/sander/void-notes',
    });

    expect(parseGitHubRemote('https://github.com/sander/void.notes.git')).toMatchObject({
      owner: 'sander',
      name: 'void.notes',
      fullName: 'sander/void.notes',
    });
  });

  it('rejects non-GitHub remotes', () => {
    expect(parseGitHubRemote('https://gitlab.com/sander/notes.git')).toBeNull();
    expect(parseGitHubRemote('https://github.com/sander/notes.git?token=secret')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
  });

  it('keeps durable Void history and excludes rebuildable local state by default', () => {
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns).toContain('.void/provenance/**');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns).toContain('.void/lineage/**');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns).toContain('.void/conversations/**');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns).toContain('assets/**');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns).toContain('.void/repo.json');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns).toContain('.void/index/**');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns).toContain('.void/insights/pending.json');
    expect(DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns).toContain('.void/sync/**');
  });

  it('validates Void-ready repository manifests', () => {
    const manifest = createVoidRepoManifest({ workspaceId: 'workspace-a', createdAt: '2026-05-20T00:00:00.000Z' });

    expect(validateVoidRepoManifest(manifest)).toMatchObject({
      ready: true,
      manifest: { workspaceId: 'workspace-a' },
      reason: null,
    });
    expect(validateVoidRepoManifest({ ...manifest, kind: 'code' })).toMatchObject({
      ready: false,
    });
  });

  it('validates malformed sync settings back to safe defaults', () => {
    const settings = validateSyncSettings({
      enabled: true,
      autoSync: false,
      authMode: 'mystery',
      repository: { provider: 'github', owner: 'me', name: 'notes', remoteUrl: 'x' },
      artifactPolicy: { includePatterns: [], excludePatterns: ['.void/cache/**'] },
      paused: true,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.autoSync).toBe(false);
    expect(settings.authMode).toBe('github-app');
    expect(settings.repository?.branch).toBe('main');
    expect(settings.artifactPolicy.includePatterns).toEqual(DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns);
    expect(settings.artifactPolicy.excludePatterns).toEqual(['.void/cache/**']);
    expect(settings.paused).toBe(true);
  });

  it('derives pending, ready, auth, and conflict status from repo state', () => {
    const settings = {
      ...cloneDefaultSyncSettings(),
      enabled: true,
      repository: parseGitHubRemote('https://github.com/me/notes.git'),
    };

    expect(syncStatusFromRepo({ settings, repo: repoState(), auth: 'signed-in' }).kind).toBe('ready');
    expect(syncStatusFromRepo({ settings, repo: repoState({ ahead: 1 }), auth: 'signed-in' }).kind).toBe('pending');
    expect(syncStatusFromRepo({ settings, repo: repoState(), auth: 'signed-out' }).kind).toBe('auth-required');
    expect(syncStatusFromRepo({
      settings,
      repo: repoState({
        conflicts: [{
          id: 'c1',
          kind: 'merge-conflict',
          path: 'note.md',
          message: 'Conflict',
          localRef: 'HEAD',
          remoteRef: 'origin/main',
          baseRef: null,
        }],
      }),
      auth: 'signed-in',
    }).kind).toBe('conflicted');
  });
});
