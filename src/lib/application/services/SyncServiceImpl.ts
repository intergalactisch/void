/**
 * SyncServiceImpl - local-first Git/GitHub sync orchestration.
 */

import type {
  AttachRepositoryParams,
  CreateAndAttachRepositoryParams,
  DeviceAuthPollResult,
  RemoteNotePreview,
  SyncService,
} from '$lib/ports/inbound/SyncService';
import type {
  CredentialService,
  DocumentService,
  EditorService,
  NotesService,
  SettingsService,
} from '$lib/ports/inbound';
import { CREDENTIAL_KEYS } from '$lib/ports/inbound';
import type { GitHubPort, GitRepositoryPort } from '$lib/ports/outbound';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import {
  cloneDefaultSyncSettings,
  EMPTY_SYNC_STATUS,
  VOID_REPO_MANIFEST_PATH,
  createVoidRepoManifest,
  mergeText3,
  parseGitHubRemote,
  syncStatusFromRepo,
  VOID_GITHUB_SCOPE,
  type GitBranchInfo,
  type GitHubBranchSummary,
  type GitHubDeviceAuthStart,
  type GitHubNameAvailability,
  type GitHubRepoSummary,
  type GitHubUser,
  type SyncAuthProbe,
  type SyncAuthState,
  type SyncConflict,
  type SyncConflictPreview,
  type SyncConflictResolution,
  type SyncConflictSession,
  type SyncMode,
  type SyncOperation,
  type SyncSettings,
  type SyncStatus,
  type GitHubVoidReadyProbe,
} from '$lib/domain/values';
import { ok, err, type Result } from '$lib/core';
import { events } from '$lib/events';
import { getLogger } from '$lib/logging';

const log = getLogger('GitHubSync');
const SYNC_CONFLICTS_PATH = 'sync/conflicts.json';

const NEW_CLASSIC_PAT_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=Void%20notes%20sync';

/**
 * Detect GitHub's "token cannot write to this repo" failure and replace the
 * raw git stderr with a precise, actionable message. Returns the original
 * error otherwise.
 *
 * Triggers on the two phrasings GitHub returns for write-permission denials:
 * `remote: Write access to repository not granted` and the HTTPS-level
 * `error: 403 ... The requested URL returned error: 403`.
 */
function translatePushPermissionError(error: Error, repoFullName: string): Error {
  const text = error.message ?? String(error);
  const matches =
    /Write access to repository not granted/i.test(text) ||
    /returned error:\s*403/i.test(text) ||
    /HTTP\s*403/i.test(text);
  if (!matches) return error;
  return new Error(
    `This token cannot write to ${repoFullName}. ` +
      `If it's a fine-grained PAT, edit it on GitHub and add ${repoFullName} to its selected repositories with Contents: Read and write. ` +
      `Or generate a classic PAT with the "repo" scope at ${NEW_CLASSIC_PAT_URL} and reconnect.`,
  );
}

export class SyncServiceImpl implements SyncService {
  private status: SyncStatus = EMPTY_SYNC_STATUS;
  private subscribers = new Set<(status: SyncStatus) => void>();
  private syncInFlight: Promise<Result<SyncStatus, Error>> | null = null;
  private currentUser: GitHubUser | null = null;
  private lastAuthError: Error | null = null;
  private activeSyncMode: SyncMode = 'manual';
  private conflictSession: SyncConflictSession | null = null;
  private voidReadyCache = new Map<string, { checkedAt: number; value: GitHubVoidReadyProbe }>();
  /**
   * In-memory cache of the GitHub access token populated after a successful
   * sign-in (token / device flow). We prefer this over reading from the
   * keychain on every request — both for latency and to avoid races where a
   * just-written credential isn't visible to the very next read on some
   * platforms. Cleared on sign-out.
   */
  private cachedToken: string | null = null;

  constructor(
    private readonly git: GitRepositoryPort,
    private readonly github: GitHubPort,
    private readonly settings: SettingsService,
    private readonly credentials: CredentialService,
    private readonly notesPath: string,
    private readonly notes: NotesService,
    private readonly editor?: EditorService,
    private readonly documents?: DocumentService,
    private readonly voidStorage?: VoidStoragePort,
  ) {}

  getStatus(): SyncStatus {
    return cloneStatus(this.status);
  }

  getCurrentUser(): GitHubUser | null {
    return this.currentUser ? { ...this.currentUser } : null;
  }

  subscribe(callback: (status: SyncStatus) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getStatus());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async refreshStatus(options: { authProbe?: SyncAuthProbe } = {}): Promise<Result<SyncStatus, Error>> {
    const authProbe = options.authProbe ?? 'keychain';
    const settings = this.syncSettings();
    this.setOperation('detecting');

    const repo = await this.git.detect(this.notesPath);
    if (!repo.ok) {
      const next = {
        ...EMPTY_SYNC_STATUS,
        kind: 'error' as const,
        operation: 'idle' as const,
        auth: await this.authState(authProbe),
        message: repo.error.message,
      };
      this.updateStatus(next);
      return err(repo.error);
    }

    const auth = await this.authState(authProbe);
    // Lazily resolve the GitHub user once per session so the UI can show
    // "Signed in as @login" without forcing the user to re-authenticate.
    if (auth === 'signed-in' && !this.currentUser) {
      const token = await this.getToken({ allowKeychain: authProbe === 'keychain' });
      if (token) {
        const profile = await this.github.validateToken(token);
        if (profile.ok) {
          this.currentUser = profile.value;
        }
      } else if (authProbe === 'passive') {
        const account = this.settings.current().githubAccount;
        if (account?.login) {
          this.currentUser = { login: account.login, name: account.name ?? null };
        }
      }
    }
    if (auth !== 'signed-in') {
      this.currentUser = null;
    }

    const next = this.withEditorPending(syncStatusFromRepo({
      settings,
      repo: repo.value,
      auth,
      operation: 'idle',
      message: this.authErrorMessage(),
    }));
    const session = await this.loadConflictSession();
    if (session.ok && session.value && isActiveConflictSession(session.value)) {
      const conflictStatus = {
        ...next,
        kind: 'conflicted' as const,
        conflicts: cloneConflicts(session.value.conflicts),
        message: `Sync conflicts need review. Recovery branch: ${session.value.recoveryBranch}`,
      };
      this.updateStatus(conflictStatus);
      return ok(conflictStatus);
    }
    if (session.ok && session.value?.status === 'aborted' && settings.paused) {
      const abortedStatus = {
        ...next,
        kind: 'paused' as const,
        message: `Sync merge aborted. Recovery branch: ${session.value.recoveryBranch}`,
      };
      this.updateStatus(abortedStatus);
      return ok(abortedStatus);
    }

    this.updateStatus(next);
    return ok(next);
  }

  async prepareAutomaticSyncAuth(): Promise<Result<SyncAuthState, Error>> {
    if (this.syncSettings().authMode === 'system-git') {
      const next = { ...this.status, auth: 'unknown' as const, message: null };
      this.updateStatus(next);
      return ok('unknown');
    }

    const token = await this.getToken({ allowKeychain: true });
    if (!token) {
      const message = this.authErrorMessage()
        ?? 'GitHub sign-in is required before automatic sync can run';
      this.updateStatus({
        ...this.status,
        operation: 'idle',
        kind: 'auth-required',
        auth: this.lastAuthError ? 'expired' : 'signed-out',
        message,
      });
      return err(new Error(message));
    }

    this.lastAuthError = null;
    this.updateStatus({
      ...this.status,
      operation: 'idle',
      auth: 'signed-in',
      message: this.status.kind === 'auth-required' ? null : this.status.message,
    });
    return ok('signed-in');
  }

  async connectWithToken(token: string): Promise<Result<GitHubUser, Error>> {
    const trimmed = token.trim();
    if (!trimmed) return err(new Error('GitHub token cannot be empty'));

    this.setOperation('authenticating');
    const validated = await this.github.validateToken(trimmed);
    if (!validated.ok) {
      this.updateStatus({ ...this.status, operation: 'idle', kind: 'auth-required', auth: 'missing-permission', message: validated.error.message });
      return validated;
    }

    const stored = await this.storeAccessToken(trimmed);
    if (!stored.ok) {
      this.updateStatus({ ...this.status, operation: 'idle', kind: 'error', message: stored.error.message });
      return err(stored.error);
    }

    await this.updateSyncSettings({ authMode: 'token' });
    this.currentUser = validated.value;
    await this.rememberGitHubAccount(validated.value);
    this.updateStatus({ ...this.status, operation: 'idle', auth: 'signed-in', message: `Signed in as ${validated.value.login}` });
    events.emit('sync:auth-changed', { auth: 'signed-in' });
    void this.refreshStatus();
    return validated;
  }

  async beginDeviceAuth(clientId: string): Promise<Result<GitHubDeviceAuthStart, Error>> {
    const trimmed = clientId.trim();
    if (!trimmed) return err(new Error('GitHub OAuth client ID is required'));
    this.setOperation('authenticating');
    const result = await this.github.beginDeviceAuth({ clientId: trimmed, scope: VOID_GITHUB_SCOPE });
    this.setOperation('idle');
    return result;
  }

  async completeDeviceAuth(clientId: string, deviceCode: string): Promise<Result<GitHubUser, Error>> {
    this.setOperation('authenticating');
    const token = await this.github.completeDeviceAuth({ clientId, deviceCode });
    if (!token.ok) {
      this.updateStatus({ ...this.status, operation: 'idle', kind: 'auth-required', auth: 'expired', message: token.error.message });
      return err(token.error);
    }

    const stored = await this.storeAccessToken(token.value.accessToken);
    if (!stored.ok) return err(stored.error);
    if (token.value.refreshToken) {
      await this.credentials.store(CREDENTIAL_KEYS.GITHUB_REFRESH_TOKEN, token.value.refreshToken);
    }

    const user = await this.github.validateToken(token.value.accessToken);
    if (!user.ok) return err(user.error);

    await this.updateSyncSettings({ authMode: 'github-app' });
    this.currentUser = user.value;
    await this.rememberGitHubAccount(user.value);
    this.updateStatus({ ...this.status, operation: 'idle', auth: 'signed-in', message: `Signed in as ${user.value.login}` });
    events.emit('sync:auth-changed', { auth: 'signed-in' });
    void this.refreshStatus();
    return user;
  }

  /**
   * Single-shot poll for device-code authorization. Returns a structured
   * outcome instead of a Result so the UI can distinguish "still pending"
   * from "error" without parsing error strings.
   */
  async pollDeviceAuth(clientId: string, deviceCode: string): Promise<DeviceAuthPollResult> {
    const token = await this.github.completeDeviceAuth({ clientId, deviceCode });
    if (token.ok) {
      const stored = await this.storeAccessToken(token.value.accessToken);
      if (!stored.ok) return { status: 'error', error: stored.error.message };
      if (token.value.refreshToken) {
        await this.credentials.store(CREDENTIAL_KEYS.GITHUB_REFRESH_TOKEN, token.value.refreshToken);
      }
      const user = await this.github.validateToken(token.value.accessToken);
      if (!user.ok) return { status: 'error', error: user.error.message };

      await this.updateSyncSettings({ authMode: 'github-app' });
      this.currentUser = user.value;
      await this.rememberGitHubAccount(user.value);
      this.updateStatus({ ...this.status, operation: 'idle', auth: 'signed-in', message: `Signed in as ${user.value.login}` });
      events.emit('sync:auth-changed', { auth: 'signed-in' });
      void this.refreshStatus();
      return { status: 'authorized', user: user.value };
    }

    const message = token.error.message.toLowerCase();
    if (message.includes('authorization_pending') || message.includes('authorization pending')) {
      return { status: 'pending' };
    }
    if (message.includes('slow_down') || message.includes('slow down')) {
      return { status: 'slow_down' };
    }
    if (message.includes('expired') || message.includes('expired_token')) {
      return { status: 'expired', error: token.error.message };
    }
    if (message.includes('access_denied') || message.includes('denied')) {
      return { status: 'denied', error: token.error.message };
    }
    return { status: 'error', error: token.error.message };
  }

  async signOut(): Promise<Result<void, Error>> {
    // Best-effort revoke the OAuth grant if we know the client id. We don't
    // store the client id today, so this is a no-op until the UI passes it.
    const tokenResult = await this.credentials.get(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN);
    if (tokenResult.ok && tokenResult.value) {
      // We don't know the client id used to mint this token, so we can't
      // revoke the OAuth grant from here. Local credentials removal alone
      // is enough to log the user out from Void.
    }
    const deleteAccess = await this.credentials.delete(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN);
    if (!deleteAccess.ok) return err(deleteAccess.error);
    const deleteRefresh = await this.credentials.delete(CREDENTIAL_KEYS.GITHUB_REFRESH_TOKEN);
    if (!deleteRefresh.ok) return err(deleteRefresh.error);
    this.cachedToken = null;
    this.lastAuthError = null;
    this.currentUser = null;
    await this.settings.set('githubAccount', null);
    this.updateStatus({
      ...this.status,
      auth: 'signed-out',
      kind: this.syncSettings().enabled ? 'auth-required' : 'disabled',
      message: 'Signed out of GitHub',
    });
    events.emit('sync:auth-changed', { auth: 'signed-out' });
    return ok(undefined);
  }

  async createAndAttachRepository(params: CreateAndAttachRepositoryParams): Promise<Result<SyncSettings, Error>> {
    const token = await this.requireToken();
    if (!token.ok) return err(token.error);

    const name = params.name.trim();
    if (!name) return err(new Error('Repository name cannot be empty'));
    if (params.private === false) {
      return err(new Error('Void GitHub sync only supports private repositories'));
    }
    const branch = params.branch?.trim() || 'main';

    this.setOperation('creating-repo');
    const created = await this.github.createRepository(token.value, {
      name,
      private: true,
      ...(params.description ? { description: params.description } : {}),
      defaultBranch: branch,
    });
    if (!created.ok) {
      this.setFailure(created.error);
      return err(created.error);
    }

    const initialized = await this.ensureLocalRepository(branch);
    if (!initialized.ok) {
      this.setFailure(initialized.error);
      return err(initialized.error);
    }

    const manifest = await this.ensureVoidRepoManifest();
    if (!manifest.ok) {
      this.setFailure(manifest.error);
      return err(manifest.error);
    }

    const ref = this.git.createRepositoryRef(created.value, branch);
    const remote = await this.git.setRemote(this.notesPath, ref.remoteUrl);
    if (!remote.ok) {
      this.setFailure(remote.error);
      return err(remote.error);
    }

    const attached = await this.updateSyncSettings({
      enabled: true,
      paused: false,
      repository: {
        provider: 'github',
        owner: ref.owner,
        name: ref.name,
        fullName: ref.fullName,
        remoteUrl: ref.remoteUrl,
        htmlUrl: ref.htmlUrl,
        branch: ref.branch,
      },
      lastSyncAt: null,
    });
    if (!attached.ok) {
      this.setFailure(attached.error);
      return err(attached.error);
    }

    const committed = await this.commitAllowed('Initial Void sync');
    if (!committed.ok) {
      await this.setFailureWithAttachedRepository(committed.error);
      return err(committed.error);
    }

    const pushed = await this.git.push(this.notesPath, 'origin', branch, { token: token.value });
    if (!pushed.ok) {
      const translated = translatePushPermissionError(pushed.error, ref.fullName);
      await this.setFailureWithAttachedRepository(translated);
      return err(translated);
    }

    const next = await this.updateSyncSettings({
      lastSyncAt: new Date().toISOString(),
    });
    await this.refreshStatus();
    events.emit('sync:completed', { status: this.getStatus(), mode: 'manual' });
    return next;
  }

  async attachRepository(params: AttachRepositoryParams): Promise<Result<SyncSettings, Error>> {
    const branch = params.branch?.trim() || 'main';
    const repo = parseGitHubRemote(params.remoteUrl, branch);
    if (!repo) return err(new Error('Only GitHub HTTPS or SSH remotes are supported'));

    const token = await this.requireToken();
    if (!token.ok) return err(token.error);

    const validation = await this.validatePrivateRepositoryForSync(token.value, repo.owner, repo.name, branch);
    if (!validation.ok) return err(validation.error);

    this.setOperation('attaching');
    const initialized = await this.ensureLocalRepository(branch);
    if (!initialized.ok) {
      this.setFailure(initialized.error);
      return err(initialized.error);
    }

    const remote = await this.git.setRemote(this.notesPath, repo.remoteUrl);
    if (!remote.ok) {
      this.setFailure(remote.error);
      return err(remote.error);
    }

    // Probe write permission with a dry-run push before persisting the attach.
    // GitHub's repo-permissions metadata can report `push: true` for tokens
    // (notably fine-grained PATs) that still cannot actually write — only the
    // negotiation surfaces that. Bail loudly here rather than at first sync.
    const probe = await this.git.pushDryRun(this.notesPath, 'origin', branch, { token: token.value });
    if (!probe.ok) {
      const translated = translatePushPermissionError(probe.error, repo.fullName);
      this.setFailure(translated);
      return err(translated);
    }

    const next = await this.updateSyncSettings({
      enabled: true,
      paused: false,
      repository: repo,
      lastSyncAt: null,
    });
    await this.refreshStatus();
    return next;
  }

  async detach(): Promise<Result<SyncSettings, Error>> {
    this.setOperation('detaching');
    // Preserve the user's preferred auth mode AND the artifact policy across
    // detach/re-attach. Wiping those would force the user to reconfigure on
    // every re-attach, which the original code did inadvertently.
    const current = this.syncSettings();
    const cleared = cloneDefaultSyncSettings();
    const next = await this.updateSyncSettings({
      ...cleared,
      authMode: current.authMode,
      autoSync: current.autoSync,
      artifactPolicy: current.artifactPolicy,
    });
    await this.saveConflictSession(null);
    this.updateStatus({ ...EMPTY_SYNC_STATUS, auth: await this.authState('passive') });
    events.emit('sync:status-changed', { status: this.getStatus() });
    return next;
  }

  async syncNow(options: { mode?: SyncMode } = {}): Promise<Result<SyncStatus, Error>> {
    if (this.syncInFlight) return this.syncInFlight;
    const mode = options.mode ?? 'manual';
    const previousMode = this.activeSyncMode;
    this.activeSyncMode = mode;
    this.syncInFlight = this.syncNowUnlocked(mode).finally(() => {
      this.syncInFlight = null;
      this.activeSyncMode = previousMode;
    });
    return this.syncInFlight;
  }

  async previewRemoteNote(path: string): Promise<Result<RemoteNotePreview, Error>> {
    const settings = this.syncSettings();
    if (!settings.repository) return err(new Error('No GitHub repository is attached'));
    const token = await this.getToken();

    const remote = await this.git.readRemoteFile(
      this.notesPath,
      'origin',
      settings.repository.branch,
      path,
      { token }
    );
    if (!remote.ok) return err(remote.error);

    const local = this.documents
      ? await this.documents.readContent(path)
      : { ok: true as const, value: null };

    return ok({
      path,
      localMarkdown: local.ok ? local.value : null,
      remoteMarkdown: remote.value.content,
      remoteRef: remote.value.ref,
    });
  }

  async refreshNoteFromRemote(path: string): Promise<Result<RemoteNotePreview, Error>> {
    if (!this.documents) return err(new Error('Document service is not available'));
    const preview = await this.previewRemoteNote(path);
    if (!preview.ok) return preview;

    this.setOperation('resolving');
    const written = await this.documents.writeContent(path, preview.value.remoteMarkdown, {
      actor: { kind: 'external-editor', name: 'GitHub' },
      intentKind: 'external-reconcile',
      summary: `Accepted remote GitHub version from ${preview.value.remoteRef}`,
      captureReason: 'external-reconcile',
      commandId: 'note.refreshFromGitHub',
      source: { type: 'tool', ref: preview.value.remoteRef },
    });
    if (!written.ok) {
      this.setFailure(written.error);
      return err(written.error);
    }

    const committed = await this.commitAllowed(`Refresh ${path} from GitHub`);
    if (!committed.ok) {
      this.setFailure(committed.error);
      return err(committed.error);
    }

    await this.notes.refresh();
    await this.refreshStatus();
    return preview;
  }

  async resolveConflict(conflictId: string, resolution: SyncConflictResolution): Promise<Result<SyncConflict | null, Error>> {
    const session = await this.loadConflictSession();
    if (session.ok && session.value && isActiveConflictSession(session.value)) {
      const applied = await this.applyConflictResolution(conflictId, resolution);
      if (!applied.ok) return err(applied.error);
      return ok(applied.value?.conflicts.find((item) => item.id === conflictId) ?? null);
    }

    const conflict = this.status.conflicts.find((item) => item.id === conflictId) ?? null;
    if (!conflict) return ok(null);

    if (conflict.kind === 'history-diverged') {
      return err(new Error('Diverged history needs the conflict workspace before Void can resume sync'));
    }

    if (resolution === 'manual') {
      return ok(conflict);
    }

    const nextConflicts = this.status.conflicts.filter((item) => item.id !== conflictId);
    this.updateStatus({
      ...this.status,
      conflicts: nextConflicts,
      kind: nextConflicts.length > 0 ? 'conflicted' : 'pending',
    });
    return ok(null);
  }

  async loadConflictSession(): Promise<Result<SyncConflictSession | null, Error>> {
    if (!this.voidStorage) return ok(this.conflictSession ? cloneSession(this.conflictSession) : null);
    const loaded = await this.voidStorage.readJson<SyncConflictSession>(this.notesPath, SYNC_CONFLICTS_PATH);
    if (!loaded.ok) return err(loaded.error);
    this.conflictSession = loaded.value ? cloneSession(loaded.value) : null;
    return ok(this.conflictSession ? cloneSession(this.conflictSession) : null);
  }

  async refreshConflictSession(): Promise<Result<SyncConflictSession | null, Error>> {
    const loaded = await this.loadConflictSession();
    if (!loaded.ok || !loaded.value) return loaded;

    const session = cloneSession(loaded.value);
    const merge = await this.git.isMergeInProgress(this.notesPath);
    if (merge.ok) session.mergeInProgress = merge.value;

    const gitConflicts = await this.git.listMergeConflicts(this.notesPath);
    if (gitConflicts.ok) {
      const unresolvedPaths = new Set(gitConflicts.value.map((conflict) => conflict.path));
      session.conflicts = session.conflicts.map((conflict) => {
        if (!conflict.path || unresolvedPaths.has(conflict.path) || conflict.mergeStatus === 'resolved') {
          return { ...conflict };
        }
        return { ...conflict, mergeStatus: 'resolved', resolution: conflict.resolution ?? 'manual' };
      });
      if (session.status !== 'aborted') {
        session.status = unresolvedPaths.size === 0 && session.conflicts.every(isResolvedConflict)
          ? 'resolved'
          : 'conflicted';
      }
    }
    session.updatedAt = new Date().toISOString();
    const saved = await this.saveConflictSession(session);
    if (!saved.ok) return err(saved.error);
    this.applyConflictSessionToStatus(session);
    return ok(cloneSession(session));
  }

  async previewConflict(conflictId: string): Promise<Result<SyncConflictPreview, Error>> {
    const session = await this.loadConflictSession();
    if (!session.ok) return err(session.error);
    const conflict = session.value?.conflicts.find((item) => item.id === conflictId);
    if (!conflict) return err(new Error('Sync conflict was not found'));
    if (!conflict.path) return err(new Error('This sync conflict is not tied to a file'));
    return ok({
      conflictId: conflict.id,
      path: conflict.path,
      baseMarkdown: conflict.baseMarkdown ?? null,
      localMarkdown: conflict.localMarkdown ?? null,
      remoteMarkdown: conflict.remoteMarkdown ?? null,
      mergedMarkdown: conflict.mergedMarkdown ?? conflict.localMarkdown ?? conflict.remoteMarkdown ?? '',
      hunks: conflict.hunks?.map((hunk) => ({ ...hunk })) ?? [],
      mergeClean: conflict.mergeStatus === 'auto-merged' || conflict.mergeStatus === 'resolved',
      supported: conflict.supported === true,
    });
  }

  async applyConflictResolution(
    conflictId: string,
    resolution: SyncConflictResolution,
    mergedMarkdown?: string,
  ): Promise<Result<SyncConflictSession | null, Error>> {
    const loaded = await this.loadConflictSession();
    if (!loaded.ok) return err(loaded.error);
    if (!loaded.value) return ok(null);

    const session = cloneSession(loaded.value);
    const index = session.conflicts.findIndex((item) => item.id === conflictId);
    if (index === -1) return ok(session);

    const conflict = session.conflicts[index];
    if (!conflict) return ok(session);
    if (!conflict.path) return err(new Error('This sync conflict is not tied to a file'));

    if (resolution === 'manual') {
      session.conflicts[index] = {
        ...conflict,
        resolution,
        mergeStatus: 'manual',
      };
      session.updatedAt = new Date().toISOString();
      const saved = await this.saveConflictSession(session);
      if (!saved.ok) return err(saved.error);
      this.applyConflictSessionToStatus(session);
      return ok(cloneSession(session));
    }

    const editorBlock = this.editorConflictBlocker(conflict.path);
    if (editorBlock) return err(editorBlock);

    const write = await this.writeResolution(conflict, resolution, mergedMarkdown);
    if (!write.ok) return err(write.error);

    const stage = await this.git.stagePaths(this.notesPath, write.value.pathsToStage);
    if (!stage.ok) return err(stage.error);

    session.conflicts[index] = {
      ...conflict,
      resolution,
      mergeStatus: 'resolved',
      mergedMarkdown: write.value.resolvedContent,
    };
    session.updatedAt = new Date().toISOString();
    const saved = await this.saveConflictSession(session);
    if (!saved.ok) return err(saved.error);

    return this.completeConflictSessionIfReady(session);
  }

  async resumeConflictResolution(): Promise<Result<SyncStatus, Error>> {
    const refreshed = await this.refreshConflictSession();
    if (!refreshed.ok) return err(refreshed.error);
    if (!refreshed.value) return this.refreshStatus();
    if (refreshed.value.conflicts.some((conflict) => !isResolvedConflict(conflict))) {
      return err(new Error('Resolve every sync conflict before resuming'));
    }
    const completed = await this.completeConflictSessionIfReady(refreshed.value, true);
    if (!completed.ok) return err(completed.error);
    return this.refreshStatus();
  }

  async abortConflictResolution(): Promise<Result<SyncConflictSession | null, Error>> {
    const loaded = await this.loadConflictSession();
    if (!loaded.ok) return err(loaded.error);
    const aborted = await this.git.abortMerge(this.notesPath);
    if (!aborted.ok) return err(aborted.error);

    const settings = await this.updateSyncSettings({ paused: true });
    if (!settings.ok) return err(settings.error);

    if (!loaded.value) {
      await this.refreshStatus();
      return ok(null);
    }

    const session = {
      ...cloneSession(loaded.value),
      status: 'aborted' as const,
      mergeInProgress: false,
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.saveConflictSession(session);
    if (!saved.ok) return err(saved.error);
    this.applyConflictSessionToStatus(session);
    return ok(cloneSession(session));
  }

  async listLocalBranches(): Promise<Result<GitBranchInfo[], Error>> {
    return this.git.listLocalBranches(this.notesPath);
  }

  async switchBranch(branch: string): Promise<Result<SyncSettings, Error>> {
    const trimmed = branch.trim();
    if (!trimmed) return err(new Error('Branch name cannot be empty'));
    const switched = await this.git.switchBranch(this.notesPath, trimmed);
    if (!switched.ok) {
      this.setFailure(switched.error);
      return err(switched.error);
    }
    const current = this.syncSettings();
    const next = current.repository
      ? await this.updateSyncSettings({
          repository: { ...current.repository, branch: trimmed },
        })
      : ok(current);
    if (!next.ok) return next;
    await this.refreshStatus();
    return next;
  }

  async createBranch(
    branch: string,
    options?: { base?: string; checkout?: boolean },
  ): Promise<Result<GitBranchInfo[], Error>> {
    const trimmed = branch.trim();
    if (!trimmed) return err(new Error('Branch name cannot be empty'));
    const created = await this.git.createBranch(this.notesPath, trimmed, {
      ...(options?.base !== undefined ? { base: options.base } : {}),
      ...(options?.checkout !== undefined ? { checkout: options.checkout } : {}),
    });
    if (!created.ok) return err(created.error);
    if (options?.checkout !== false) {
      const current = this.syncSettings();
      if (current.repository) {
        const next = await this.updateSyncSettings({
          repository: { ...current.repository, branch: trimmed },
        });
        if (!next.ok) return err(next.error);
      }
      await this.refreshStatus();
    }
    return this.listLocalBranches();
  }

  async listRemoteRepositories(): Promise<Result<GitHubRepoSummary[], Error>> {
    const token = await this.requireToken();
    if (!token.ok) return err(token.error);
    const repos = await this.github.listRepositories(token.value);
    if (!repos.ok) return err(repos.error);
    const privateWritable = repos.value.filter((repo) => repo.private && repo.permissionsPush);
    const readyRepos = await mapWithConcurrency(privateWritable, 6, async (repo) => {
      const probe = await this.probeVoidReady(token.value, repo.owner, repo.name, repo.defaultBranch);
      return {
        ...repo,
        voidReady: probe.ok ? probe.value.ready : false,
        voidReadyReason: probe.ok ? probe.value.reason : probe.error.message,
        voidManifest: probe.ok ? probe.value.manifest : null,
      };
    });
    return ok(readyRepos.filter((repo) => repo.voidReady));
  }

  async listRemoteBranches(owner: string, repo: string): Promise<Result<GitHubBranchSummary[], Error>> {
    const token = await this.requireToken();
    if (!token.ok) return err(token.error);
    return this.github.listBranches(token.value, owner, repo);
  }

  async checkRepositoryName(name: string): Promise<Result<GitHubNameAvailability, Error>> {
    const token = await this.requireToken();
    if (!token.ok) return err(token.error);
    return this.github.checkRepositoryName(token.value, name);
  }

  async setAutoSync(enabled: boolean): Promise<Result<SyncSettings, Error>> {
    const next = await this.updateSyncSettings({ autoSync: enabled });
    return next;
  }

  async setPaused(paused: boolean): Promise<Result<SyncSettings, Error>> {
    const next = await this.updateSyncSettings({ paused });
    if (next.ok) await this.refreshStatus();
    return next;
  }

  private async syncNowUnlocked(mode: SyncMode): Promise<Result<SyncStatus, Error>> {
    const settings = this.syncSettings();
    if (!settings.enabled || !settings.repository) {
      const refreshed = await this.refreshStatus({ authProbe: mode === 'background' ? 'passive' : 'keychain' });
      if (refreshed.ok) {
        const disabled = { ...refreshed.value, kind: 'disabled' as const, message: 'GitHub sync is not attached' };
        this.updateStatus(disabled);
        return ok(disabled);
      }
      return refreshed;
    }

    const activeSession = await this.loadConflictSession();
    if (!activeSession.ok) return err(activeSession.error);
    if (activeSession.value && isActiveConflictSession(activeSession.value)) {
      this.applyConflictSessionToStatus(activeSession.value);
      return err(new Error('Resolve the current GitHub sync conflict before syncing again'));
    }

    const token = await this.getToken({ allowKeychain: mode !== 'background' });
    if (settings.authMode !== 'system-git' && !token) {
      const message = this.authErrorMessage() ?? (mode === 'background'
        ? 'GitHub sign-in is required before automatic sync can run'
        : 'GitHub sign-in is required');
      const next = {
        ...this.status,
        kind: 'auth-required' as const,
        auth: this.lastAuthError ? 'expired' as const : 'signed-out' as const,
        message,
      };
      this.updateStatus(next);
      events.emit('sync:failed', { error: new Error(message), mode, actionable: mode === 'manual' });
      return err(new Error(message));
    }

    events.emit('sync:started', { operation: 'committing', mode });
    this.setOperation('committing');
    const committed = await this.commitAllowed(`Sync Void notes ${new Date().toISOString()}`);
    if (!committed.ok) {
      this.setFailure(committed.error);
      return err(committed.error);
    }

    this.setOperation('fetching');
    const fetched = await this.git.fetch(this.notesPath, 'origin', settings.repository.branch, { token });
    if (!fetched.ok) {
      this.setFailure(fetched.error);
      return err(fetched.error);
    }

    const detected = await this.git.detect(this.notesPath);
    if (!detected.ok) {
      this.setFailure(detected.error);
      return err(detected.error);
    }
    if (detected.value.ahead > 0 && detected.value.behind > 0) {
      return this.handleDivergedMerge(settings, token);
    }

    if (detected.value.behind > 0) {
      this.setOperation('pulling');
      const pulled = await this.git.pullFastForward(this.notesPath, 'origin', settings.repository.branch, { token });
      if (!pulled.ok) {
        this.setFailure(pulled.error);
        return err(pulled.error);
      }
    }

    const afterPull = await this.git.detect(this.notesPath);
    if (!afterPull.ok) {
      this.setFailure(afterPull.error);
      return err(afterPull.error);
    }

    if (afterPull.value.ahead > 0) {
      this.setOperation('pushing');
      const pushed = await this.git.push(this.notesPath, 'origin', settings.repository.branch, { token });
      if (!pushed.ok) {
        this.setFailure(pushed.error);
        return err(pushed.error);
      }
    }

    const saved = await this.updateSyncSettings({
      paused: false,
      lastSyncAt: new Date().toISOString(),
    });
    if (!saved.ok) return err(saved.error);

    await this.notes.refresh();
    const refreshed = await this.refreshStatus({ authProbe: 'passive' });
    if (!refreshed.ok) return refreshed;
    events.emit('sync:completed', { status: refreshed.value, mode });
    return refreshed;
  }

  private async handleDivergedMerge(
    settings: SyncSettings,
    token: string | null,
  ): Promise<Result<SyncStatus, Error>> {
    if (!settings.repository) return err(new Error('No GitHub repository is attached'));

    const branch = settings.repository.branch;
    const divergence = await this.git.buildDivergenceConflict(this.notesPath, branch);
    const recoveryName = recoveryBranchName(new Date());
    const recovery = await this.git.createRecoveryBranch(this.notesPath, recoveryName);
    if (!recovery.ok) {
      this.setFailure(recovery.error);
      return err(recovery.error);
    }

    this.setOperation('pulling');
    const merge = await this.git.beginMerge(this.notesPath, 'origin', branch, { token });
    if (!merge.ok) {
      this.setFailure(merge.error);
      return err(merge.error);
    }

    const sessionBase = this.createConflictSession({
      branch,
      recoveryBranch: recovery.value,
      divergence: divergence.ok ? divergence.value : null,
    });

    if (merge.value.clean) {
      const completed = await this.finalizeMergeAndPush(settings, token, sessionBase, 'Merge GitHub changes into Void notes');
      if (!completed.ok) return err(completed.error);
      return ok(completed.value);
    }

    const built = await this.buildConflictSessionFromGit(sessionBase);
    if (!built.ok) {
      await this.saveConflictSession(sessionBase);
      this.setFailure(built.error);
      return err(built.error);
    }

    const session = built.value;
    const unresolved = session.conflicts.filter((conflict) => !isResolvedConflict(conflict));
    if (unresolved.length === 0) {
      const completed = await this.finalizeMergeAndPush(settings, token, session, 'Merge GitHub changes into Void notes');
      if (!completed.ok) return err(completed.error);
      return ok(completed.value);
    }

    const paused = await this.updateSyncSettings({ paused: true });
    if (!paused.ok) return err(paused.error);
    const saved = await this.saveConflictSession(session);
    if (!saved.ok) return err(saved.error);
    this.applyConflictSessionToStatus(session);
    events.emit('sync:conflict', { conflicts: cloneConflicts(session.conflicts) });
    return err(new Error('Sync paused because local and remote changes need review'));
  }

  private createConflictSession(params: {
    branch: string;
    recoveryBranch: string;
    divergence: SyncConflict | null;
  }): SyncConflictSession {
    const now = new Date().toISOString();
    return {
      id: `sync-conflict-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      branch: params.branch,
      remoteBranch: `origin/${params.branch}`,
      recoveryBranch: params.recoveryBranch,
      baseRef: params.divergence?.baseRef ?? null,
      localRef: params.divergence?.localRef ?? null,
      remoteRef: params.divergence?.remoteRef ?? null,
      mergeInProgress: true,
      status: 'conflicted',
      conflicts: [],
    };
  }

  private async buildConflictSessionFromGit(
    session: SyncConflictSession,
  ): Promise<Result<SyncConflictSession, Error>> {
    const gitConflicts = await this.git.listMergeConflicts(this.notesPath);
    if (!gitConflicts.ok) return err(gitConflicts.error);

    const next = cloneSession(session);
    const cleanStagePaths: string[] = [];
    next.conflicts = [];

    for (const gitConflict of gitConflicts.value) {
      const mergeFile = await this.git.readMergeFile(this.notesPath, gitConflict.path);
      if (!mergeFile.ok) {
        next.conflicts.push(this.unsupportedConflict(gitConflict.path, gitConflict.reason ?? mergeFile.error.message));
        continue;
      }

      const file = mergeFile.value;
      if (!gitConflict.supported || file.base === null || file.local === null || file.remote === null) {
        next.conflicts.push({
          ...this.unsupportedConflict(gitConflict.path, gitConflict.reason ?? 'This conflict shape needs manual resolution'),
          baseMarkdown: file.base,
          localMarkdown: file.local,
          remoteMarkdown: file.remote,
        });
        continue;
      }

      const base = file.base;
      const local = file.local;
      const remote = file.remote;
      const merged = mergeText3(base, local, remote);
      if (merged.clean) {
        const written = await this.git.writeWorkingFile(this.notesPath, gitConflict.path, merged.mergedText);
        if (!written.ok) return err(written.error);
        cleanStagePaths.push(gitConflict.path);
        next.conflicts.push({
          id: conflictIdForPath(gitConflict.path),
          kind: conflictKindForPath(gitConflict.path),
          path: gitConflict.path,
          message: `Automatically merged non-overlapping changes in ${gitConflict.path}`,
          localRef: next.localRef,
          remoteRef: next.remoteRef,
          baseRef: next.baseRef,
          supported: true,
          mergeStatus: 'auto-merged',
          resolution: 'use-merged',
          baseMarkdown: base,
          localMarkdown: local,
          remoteMarkdown: remote,
          mergedMarkdown: merged.mergedText,
          hunks: [],
        });
        continue;
      }

      next.conflicts.push({
        id: conflictIdForPath(gitConflict.path),
        kind: conflictKindForPath(gitConflict.path),
        path: gitConflict.path,
        message: `Overlapping GitHub sync conflict in ${gitConflict.path}`,
        localRef: next.localRef,
        remoteRef: next.remoteRef,
        baseRef: next.baseRef,
        supported: true,
        mergeStatus: 'pending',
        resolution: null,
        baseMarkdown: base,
        localMarkdown: local,
        remoteMarkdown: remote,
        mergedMarkdown: merged.mergedText,
        hunks: merged.hunks,
      });
    }

    if (cleanStagePaths.length > 0) {
      const staged = await this.git.stagePaths(this.notesPath, cleanStagePaths);
      if (!staged.ok) return err(staged.error);
    }

    next.updatedAt = new Date().toISOString();
    next.mergeInProgress = true;
    next.status = next.conflicts.some((conflict) => !isResolvedConflict(conflict))
      ? 'conflicted'
      : 'resolved';
    return ok(next);
  }

  private unsupportedConflict(path: string, reason: string): SyncConflict {
    return {
      id: conflictIdForPath(path),
      kind: conflictKindForPath(path),
      path,
      message: reason,
      localRef: null,
      remoteRef: null,
      baseRef: null,
      supported: false,
      mergeStatus: 'unsupported',
      resolution: null,
    };
  }

  private async finalizeMergeAndPush(
    settings: SyncSettings,
    token: string | null,
    session: SyncConflictSession,
    message: string,
  ): Promise<Result<SyncStatus, Error>> {
    if (!settings.repository) return err(new Error('No GitHub repository is attached'));
    this.setOperation('resolving');
    const committed = await this.git.commitMerge(this.notesPath, message);
    if (!committed.ok) {
      this.setFailure(committed.error);
      return err(committed.error);
    }

    this.setOperation('pushing');
    const pushed = await this.git.push(this.notesPath, 'origin', settings.repository.branch, { token });
    if (!pushed.ok) {
      this.setFailure(pushed.error);
      return err(pushed.error);
    }

    const savedSession = await this.saveConflictSession(null);
    if (!savedSession.ok) return err(savedSession.error);
    const saved = await this.updateSyncSettings({
      paused: false,
      lastSyncAt: new Date().toISOString(),
    });
    if (!saved.ok) return err(saved.error);
    await this.notes.refresh();
    const refreshed = await this.refreshStatus({ authProbe: 'passive' });
    if (!refreshed.ok) return err(refreshed.error);
    events.emit('sync:completed', { status: refreshed.value, mode: this.activeSyncMode });
    return ok(refreshed.value);
  }

  private async completeConflictSessionIfReady(
    session: SyncConflictSession,
    force = false,
  ): Promise<Result<SyncConflictSession | null, Error>> {
    const next = cloneSession(session);
    const gitConflicts = await this.git.listMergeConflicts(this.notesPath);
    if (gitConflicts.ok) {
      const unresolvedPaths = new Set(gitConflicts.value.map((conflict) => conflict.path));
      next.conflicts = next.conflicts.map((conflict) => {
        if (!conflict.path || unresolvedPaths.has(conflict.path) || isResolvedConflict(conflict)) {
          return { ...conflict };
        }
        return { ...conflict, mergeStatus: 'resolved', resolution: conflict.resolution ?? 'manual' };
      });
    }

    const unresolved = next.conflicts.filter((conflict) => !isResolvedConflict(conflict));
    if (unresolved.length > 0) {
      if (force) return err(new Error('Resolve every sync conflict before resuming'));
      next.status = 'conflicted';
      next.updatedAt = new Date().toISOString();
      const saved = await this.saveConflictSession(next);
      if (!saved.ok) return err(saved.error);
      this.applyConflictSessionToStatus(next);
      return ok(cloneSession(next));
    }

    const merge = await this.git.isMergeInProgress(this.notesPath);
    if (!merge.ok) return err(merge.error);
    if (!merge.value) {
      const saved = await this.saveConflictSession(null);
      if (!saved.ok) return err(saved.error);
      await this.refreshStatus();
      return ok(null);
    }

    const token = await this.getToken();
    const settings = this.syncSettings();
    if (settings.authMode !== 'system-git' && !token) {
      return err(new Error(this.authErrorMessage() ?? 'GitHub sign-in is required'));
    }

    const completed = await this.finalizeMergeAndPush(settings, token, next, 'Merge GitHub conflict resolutions');
    if (!completed.ok) return err(completed.error);
    return ok(null);
  }

  private async validatePrivateRepositoryForSync(
    token: string,
    owner: string,
    repo: string,
    branch?: string,
  ): Promise<Result<GitHubRepoSummary, Error>> {
    const remote = await this.github.getRepository(token, owner, repo);
    if (!remote.ok) return err(remote.error);
    if (!remote.value.private) {
      return err(new Error('Void GitHub sync only supports private repositories'));
    }
    if (!remote.value.permissionsPush) {
      return err(new Error(`You do not have push permission for ${remote.value.fullName}`));
    }
    const probe = await this.probeVoidReady(token, owner, repo, branch ?? remote.value.defaultBranch);
    if (!probe.ok) return err(probe.error);
    if (!probe.value.ready) {
      return err(new Error(
        `${remote.value.fullName} is not a Void-ready repository. Create a private Void repo from the app, or add ${VOID_REPO_MANIFEST_PATH}.`
      ));
    }
    return ok({
      ...remote.value,
      voidReady: true,
      voidReadyReason: null,
      voidManifest: probe.value.manifest,
    });
  }

  private async probeVoidReady(
    token: string,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<Result<GitHubVoidReadyProbe, Error>> {
    const key = `${owner}/${repo}@${ref ?? ''}`;
    const cached = this.voidReadyCache.get(key);
    if (cached && Date.now() - cached.checkedAt < 60_000) {
      return ok(cached.value);
    }
    const probe = await this.github.getVoidReady(token, owner, repo, ref);
    if (probe.ok) this.voidReadyCache.set(key, { checkedAt: Date.now(), value: probe.value });
    return probe;
  }

  private async ensureVoidRepoManifest(): Promise<Result<void, Error>> {
    const workspaceId = this.settings.current().activeWorkspaceId || 'legacy-workspace';
    const manifest = createVoidRepoManifest({ workspaceId });
    const written = await this.git.writeWorkingFile(
      this.notesPath,
      VOID_REPO_MANIFEST_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return written.ok ? ok(undefined) : err(written.error);
  }

  private async writeResolution(
    conflict: SyncConflict,
    resolution: SyncConflictResolution,
    mergedMarkdown?: string,
  ): Promise<Result<{ pathsToStage: string[]; resolvedContent: string }, Error>> {
    if (!conflict.path) return err(new Error('This sync conflict is not tied to a file'));

    if (resolution === 'duplicate-local') {
      if (conflict.localMarkdown === null || conflict.localMarkdown === undefined) {
        return err(new Error('No local version is available to duplicate'));
      }
      if (conflict.remoteMarkdown === null || conflict.remoteMarkdown === undefined) {
        return err(new Error('No remote version is available to apply'));
      }
      const duplicatePath = duplicateLocalPath(conflict.path, new Date());
      const duplicate = await this.git.writeWorkingFile(this.notesPath, duplicatePath, conflict.localMarkdown);
      if (!duplicate.ok) return err(duplicate.error);
      const original = await this.git.writeWorkingFile(this.notesPath, conflict.path, conflict.remoteMarkdown);
      if (!original.ok) return err(original.error);
      return ok({
        pathsToStage: [conflict.path, duplicatePath],
        resolvedContent: conflict.remoteMarkdown,
      });
    }

    const resolvedContent =
      resolution === 'keep-local'
        ? conflict.localMarkdown
        : resolution === 'take-remote'
          ? conflict.remoteMarkdown
          : mergedMarkdown ?? conflict.mergedMarkdown;
    if (resolvedContent === null || resolvedContent === undefined) {
      return err(new Error('Selected conflict resolution has no content to write'));
    }

    const written = await this.git.writeWorkingFile(this.notesPath, conflict.path, resolvedContent);
    if (!written.ok) return err(written.error);
    return ok({ pathsToStage: [conflict.path], resolvedContent });
  }

  private editorConflictBlocker(path: string): Error | null {
    if (!this.editor) return null;
    const tab = this.editor.getState().tabs.find((item) => item.path === path);
    if (!tab) return null;
    if (tab.conflictState !== 'clean') {
      return new Error(`Resolve the open editor conflict for ${path} before applying a GitHub sync resolution`);
    }
    if (tab.isDirty || tab.isSaving) {
      return new Error(`Save or close the dirty editor tab for ${path} before applying a GitHub sync resolution`);
    }
    return null;
  }

  private async saveConflictSession(session: SyncConflictSession | null): Promise<Result<void, Error>> {
    this.conflictSession = session ? cloneSession(session) : null;
    if (!this.voidStorage) return ok(undefined);
    const saved = await this.voidStorage.writeJson(this.notesPath, SYNC_CONFLICTS_PATH, session);
    return saved.ok ? ok(undefined) : err(saved.error);
  }

  private applyConflictSessionToStatus(session: SyncConflictSession): void {
    if (isActiveConflictSession(session)) {
      this.updateStatus({
        ...this.status,
        operation: 'idle',
        kind: 'conflicted',
        conflicts: cloneConflicts(session.conflicts),
        message: `Sync conflicts need review. Recovery branch: ${session.recoveryBranch}`,
      });
      return;
    }
    if (session.status === 'aborted') {
      this.updateStatus({
        ...this.status,
        operation: 'idle',
        kind: 'paused',
        conflicts: [],
        message: `Sync merge aborted. Recovery branch: ${session.recoveryBranch}`,
      });
    }
  }

  private async ensureLocalRepository(branch: string): Promise<Result<void, Error>> {
    const detected = await this.git.detect(this.notesPath);
    if (!detected.ok) return err(detected.error);
    if (detected.value.repoKind === 'nested') {
      return err(new Error('The notes folder is inside a larger Git repository. Move notes to their own folder before attaching sync.'));
    }
    if (detected.value.repoKind === 'bare' || detected.value.repoKind === 'invalid') {
      return err(new Error(detected.value.message ?? 'The notes folder is not a usable Git repository'));
    }
    if (detected.value.repoKind === 'none') {
      const initialized = await this.git.init(this.notesPath, branch);
      if (!initialized.ok) return initialized;
    }
    return this.git.ensureArtifactPolicy(this.notesPath, this.syncSettings().artifactPolicy);
  }

  private async commitAllowed(message: string): Promise<Result<void, Error>> {
    const flushed = await this.flushEditorBeforeCommit();
    if (!flushed.ok) return err(flushed.error);

    const ignored = await this.git.ensureArtifactPolicy(this.notesPath, this.syncSettings().artifactPolicy);
    if (!ignored.ok) return err(ignored.error);
    const result = await this.git.commitAll(this.notesPath, message);
    return result.ok ? ok(undefined) : err(result.error);
  }

  private async flushEditorBeforeCommit(): Promise<Result<void, Error>> {
    if (!this.editor) return ok(undefined);

    const initial = this.editor.getState();
    const conflictedTabs = initial.tabs.filter((tab) => tab.conflictState !== 'clean');
    if (conflictedTabs.length > 0) {
      return err(new Error(
        `Resolve editor conflicts before syncing: ${conflictedTabs.map((tab) => tab.path).join(', ')}`
      ));
    }

    const dirtyPaths = initial.tabs
      .filter((tab) => tab.isDirty)
      .map((tab) => tab.path);
    if (dirtyPaths.length === 0) return ok(undefined);

    const originalPath = initial.activePath;
    for (const path of dirtyPaths) {
      if (this.editor.getState().activePath !== path) {
        const switched = await this.editor.switchTab(path);
        if (!switched.ok) return err(switched.error);
      }

      const saved = await this.editor.saveDocument({
        actor: { kind: 'user', name: 'Local editor' },
        intentKind: 'update',
        summary: 'Flushed local editor changes before GitHub sync',
        captureReason: 'manual-save',
        commandId: 'sync.now',
      });
      if (!saved.ok) return err(saved.error);
    }

    if (originalPath && this.editor.getState().activePath !== originalPath) {
      const restored = await this.editor.switchTab(originalPath);
      if (!restored.ok) return err(restored.error);
    }

    const remainingDirty = this.editor.getState().tabs.filter((tab) => tab.isDirty);
    if (remainingDirty.length > 0) {
      return err(new Error(
        `Could not flush editor changes before syncing: ${remainingDirty.map((tab) => tab.path).join(', ')}`
      ));
    }

    return ok(undefined);
  }

  private syncSettings(): SyncSettings {
    return this.settings.current().sync;
  }

  private async updateSyncSettings(patch: Partial<SyncSettings>): Promise<Result<SyncSettings, Error>> {
    const current = this.syncSettings();
    const next: SyncSettings = {
      ...current,
      ...patch,
      artifactPolicy: patch.artifactPolicy ?? current.artifactPolicy,
    };
    const saved = await this.settings.set('sync', next);
    if (!saved.ok) return err(saved.error);
    return ok(next);
  }

  private async requireToken(): Promise<Result<string, Error>> {
    const token = await this.getToken({ allowKeychain: true });
    if (token) return ok(token);
    if (this.lastAuthError) {
      return err(new Error(`Could not read GitHub token from keychain: ${this.lastAuthError.message}`));
    }
    return err(new Error('GitHub sign-in is required'));
  }

  private async storeAccessToken(token: string): Promise<Result<void, Error>> {
    const stored = await this.credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, token);
    if (!stored.ok) return err(stored.error);

    const verified = await this.credentials.get(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN);
    if (!verified.ok) {
      this.cachedToken = null;
      this.lastAuthError = verified.error;
      return err(new Error(`GitHub token was saved, but could not be read back from keychain: ${verified.error.message}`));
    }
    if (verified.value !== token) {
      this.cachedToken = null;
      this.lastAuthError = new Error('Saved GitHub token did not round-trip through keychain');
      return err(new Error('GitHub token was saved, but was not readable from keychain. Check Keychain access for Void and try signing in again.'));
    }

    this.cachedToken = token;
    this.lastAuthError = null;
    return ok(undefined);
  }

  private authErrorMessage(): string | null {
    return this.lastAuthError
      ? `Could not read GitHub token from keychain: ${this.lastAuthError.message}`
      : null;
  }

  private withEditorPending(status: SyncStatus): SyncStatus {
    if (!this.editor || status.kind !== 'ready') return status;
    const editorState = this.editor.getState();
    const pendingTabs = editorState.tabs.filter((tab) => tab.isDirty || tab.isSaving);
    if (pendingTabs.length === 0) return status;
    const count = pendingTabs.length;
    return {
      ...status,
      kind: 'pending',
      message: `${count} open note${count === 1 ? '' : 's'} not synced to GitHub yet`,
    };
  }

  private async getToken(options: { allowKeychain?: boolean } = {}): Promise<string | null> {
    if (this.cachedToken) {
      this.lastAuthError = null;
      return this.cachedToken;
    }
    if (options.allowKeychain === false) {
      return null;
    }
    const result = await this.credentials.get(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN);
    if (!result.ok) {
      this.lastAuthError = result.error;
      log.warn('Could not read GitHub token from keychain', { error: result.error.message });
      return null;
    }
    if (result.ok && result.value) {
      this.cachedToken = result.value;
      this.lastAuthError = null;
      return result.value;
    }
    this.lastAuthError = null;
    return null;
  }

  private async rememberGitHubAccount(user: GitHubUser): Promise<void> {
    await this.settings.set('githubAccount', {
      provider: 'github',
      login: user.login,
      name: user.name,
      lastAuthenticatedAt: new Date().toISOString(),
    });
  }

  private async authState(authProbe: SyncAuthProbe = 'keychain'): Promise<SyncAuthState> {
    if (this.syncSettings().authMode === 'system-git') return 'unknown';
    if (authProbe === 'passive' && !this.cachedToken) {
      if (this.lastAuthError) return 'expired';
      return this.settings.current().githubAccount ? 'signed-in' : 'signed-out';
    }
    return await this.getToken({ allowKeychain: true })
      ? 'signed-in'
      : this.lastAuthError
        ? 'expired'
        : 'signed-out';
  }

  private setOperation(operation: SyncOperation): void {
    this.updateStatus({ ...this.status, operation, kind: operation === 'idle' ? this.status.kind : 'syncing' });
  }

  private setFailure(error: Error, options: { mode?: SyncMode; actionable?: boolean } = {}): void {
    const mode = options.mode ?? this.activeSyncMode;
    const actionable = options.actionable ?? mode !== 'background';
    log.error(error.message);
    this.updateStatus({ ...this.status, operation: 'idle', kind: 'error', message: error.message });
    events.emit('sync:failed', { error, mode, actionable });
  }

  private async setFailureWithAttachedRepository(error: Error): Promise<void> {
    this.setFailure(error);
    const refreshed = await this.refreshStatus();
    if (refreshed.ok) {
      this.updateStatus({
        ...refreshed.value,
        operation: 'idle',
        kind: 'error',
        message: error.message,
      });
    }
  }

  private updateStatus(status: SyncStatus): void {
    this.status = cloneStatus(status);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(this.getStatus());
      } catch {
        // Ignore subscriber failures.
      }
    }
    events.emit('sync:status-changed', { status: this.getStatus() });
  }
}

function cloneStatus(status: SyncStatus): SyncStatus {
  return {
    ...status,
    conflicts: cloneConflicts(status.conflicts),
  };
}

function cloneSession(session: SyncConflictSession): SyncConflictSession {
  return {
    ...session,
    conflicts: cloneConflicts(session.conflicts),
  };
}

function cloneConflicts(conflicts: SyncConflict[]): SyncConflict[] {
  return conflicts.map((conflict) => {
    const copy: SyncConflict = { ...conflict };
    if (conflict.hunks) copy.hunks = conflict.hunks.map((hunk) => ({ ...hunk }));
    return copy;
  });
}

function isActiveConflictSession(session: SyncConflictSession): boolean {
  return session.status === 'merging' || session.status === 'conflicted';
}

function isResolvedConflict(conflict: SyncConflict): boolean {
  return conflict.mergeStatus === 'resolved' || conflict.mergeStatus === 'auto-merged';
}

function recoveryBranchName(date: Date): string {
  return `void-sync-recovery/${timestampForName(date)}`;
}

function duplicateLocalPath(path: string, date: Date): string {
  const slash = path.lastIndexOf('/');
  const directory = slash >= 0 ? path.slice(0, slash + 1) : '';
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  return `${directory}${stem} (local ${timestampForName(date)})${extension}`;
}

function timestampForName(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function conflictIdForPath(path: string): string {
  return `sync-conflict-${path.replace(/[^a-z0-9_.-]+/gi, '-')}`;
}

function conflictKindForPath(path: string): SyncConflict['kind'] {
  return path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown')
    ? 'remote-note'
    : 'sidecar';
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
