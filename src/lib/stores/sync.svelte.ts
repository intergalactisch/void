/**
 * Sync Store — Primary adapter for GitHub cloud sync UI.
 *
 * Holds reactive Svelte 5 state for the UI: status, current user, device-auth
 * flow, cached branches, and cached repository lists. Wraps {@link SyncService}
 * with loading and error tracking so views can render busy spinners without
 * duplicating try/catch.
 */

import {
  EMPTY_SYNC_STATUS,
  type GitBranchInfo,
  type GitHubBranchSummary,
  type GitHubDeviceAuthStart,
  type GitHubNameAvailability,
  type GitHubRepoSummary,
  type GitHubUser,
  type SyncAuthProbe,
  type SyncConflictPreview,
  type SyncConflictResolution,
  type SyncConflictSession,
  type SyncMode,
  type SyncSettings,
  type SyncStatus,
} from '$lib/domain/values';
import type {
  CreateAndAttachRepositoryParams,
  DeviceAuthPollResult,
  RemoteNotePreview,
  SyncService,
} from '$lib/ports/inbound';
import { events } from '$lib/events';
import { settingsStore } from './settings.svelte';

interface DeviceAuthSession {
  clientId: string;
  device: GitHubDeviceAuthStart;
  startedAt: number;
}

class SyncStore {
  #service: SyncService | null = null;
  #unsubscribe: (() => void) | null = null;
  #eventUnsubscribe: (() => void) | null = null;
  #devicePollTimer: ReturnType<typeof setTimeout> | null = null;
  #deviceCountdownTimer: ReturnType<typeof setInterval> | null = null;
  #recentSyncTimer: ReturnType<typeof setTimeout> | null = null;

  status = $state<SyncStatus>({ ...EMPTY_SYNC_STATUS, conflicts: [] });
  user = $state<GitHubUser | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  // Auth flow state
  deviceAuth = $state<DeviceAuthSession | null>(null);
  deviceAuthPhase = $state<'idle' | 'waiting' | 'authorized' | 'expired' | 'denied' | 'error'>(
    'idle',
  );
  deviceAuthExpiresInMs = $state<number | null>(null);
  deviceAuthMessage = $state<string | null>(null);

  // Cached lists (reset when sign-in changes or repo changes)
  localBranches = $state<GitBranchInfo[]>([]);
  remoteRepos = $state<GitHubRepoSummary[]>([]);
  remoteRepoFetchedAt = $state<number | null>(null);
  remoteBranches = $state<GitHubBranchSummary[]>([]);
  remoteBranchesFor = $state<string | null>(null);
  lastPreview = $state<RemoteNotePreview | null>(null);
  conflictSession = $state<SyncConflictSession | null>(null);
  activeConflictPreview = $state<SyncConflictPreview | null>(null);
  lastCompletedAt = $state<number | null>(null);
  lastFailureAt = $state<number | null>(null);
  lastSyncMode = $state<SyncMode | null>(null);
  recentSyncLabel = $state<string | null>(null);

  init(service: SyncService): void {
    this.#unsubscribe?.();
    this.#eventUnsubscribe?.();
    this.#service = service;
    this.#unsubscribe = service.subscribe((status) => {
      this.status = status;
      if (status.kind !== 'ready') {
        this.clearRecentSyncLabel();
      }
      // Keep the cached user in sync with the service-tracked one. Service
      // clears it when auth turns 'signed-out'; we mirror that here.
      this.user = service.getCurrentUser();
    });
    this.user = service.getCurrentUser();
    this.#eventUnsubscribe = this.registerSyncEvents();
  }

  async refreshStatus(options?: { authProbe?: SyncAuthProbe }): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.refreshStatus(options));
    if (result) this.user = this.#service.getCurrentUser();
    return !!result;
  }

  async prepareAutomaticSyncAuth(): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.prepareAutomaticSyncAuth());
    if (result) this.user = this.#service.getCurrentUser();
    return !!result;
  }

  // ─── Auth ───

  async connectWithToken(token: string): Promise<GitHubUser | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.connectWithToken(token));
    if (!result) return null;
    await this.reloadSettingsStore();
    if (result.ok) this.user = result.value;
    return result.ok ? result.value : null;
  }

  async beginDeviceAuth(clientId: string): Promise<GitHubDeviceAuthStart | null> {
    if (!this.#service) return null;
    this.cancelDevicePoll();
    this.deviceAuthPhase = 'idle';
    this.deviceAuthMessage = null;
    const result = await this.run(async () => this.#service!.beginDeviceAuth(clientId));
    if (!result) return null;
    if (result.ok) {
      this.deviceAuth = {
        clientId: clientId.trim(),
        device: result.value,
        startedAt: Date.now(),
      };
      this.deviceAuthPhase = 'waiting';
      this.deviceAuthExpiresInMs = result.value.expiresIn * 1000;
      this.startDeviceCountdown();
    }
    return result.ok ? result.value : null;
  }

  /**
   * Begin auto-polling. Call after the user has clicked "Open GitHub" so we
   * don't burn rate budget for users who never opened the verification URL.
   * Safe to call multiple times: idempotent.
   */
  startDevicePolling(intervalSeconds?: number): void {
    if (!this.#service || !this.deviceAuth) return;
    this.cancelDevicePoll();
    const session = this.deviceAuth;
    let delay = Math.max(1, intervalSeconds ?? session.device.interval) * 1000;
    const tick = async () => {
      if (!this.#service || !this.deviceAuth || this.deviceAuth !== session) return;
      const outcome = await this.#service.pollDeviceAuth(session.clientId, session.device.deviceCode);
      if (this.deviceAuth !== session) return;
      switch (outcome.status) {
        case 'authorized':
          this.deviceAuthPhase = 'authorized';
          this.deviceAuth = null;
          this.cancelDevicePoll();
          if (outcome.user) this.user = outcome.user;
          await this.reloadSettingsStore();
          break;
        case 'pending':
          this.#devicePollTimer = setTimeout(tick, delay);
          break;
        case 'slow_down':
          delay = Math.min(delay + 5000, 60000);
          this.#devicePollTimer = setTimeout(tick, delay);
          break;
        case 'expired':
          this.deviceAuthPhase = 'expired';
          this.deviceAuthMessage = 'The device code expired before authorization. Start again.';
          this.cancelDevicePoll();
          break;
        case 'denied':
          this.deviceAuthPhase = 'denied';
          this.deviceAuthMessage = 'Authorization was denied. Start again to grant access.';
          this.cancelDevicePoll();
          break;
        case 'error':
          this.deviceAuthPhase = 'error';
          this.deviceAuthMessage = outcome.error ?? 'Could not complete sign-in.';
          this.cancelDevicePoll();
          break;
      }
    };
    this.#devicePollTimer = setTimeout(tick, delay);
  }

  cancelDeviceAuth(): void {
    this.cancelDevicePoll();
    this.deviceAuth = null;
    this.deviceAuthPhase = 'idle';
    this.deviceAuthMessage = null;
    this.deviceAuthExpiresInMs = null;
  }

  async completeDeviceAuth(clientId?: string, deviceCode?: string): Promise<GitHubUser | null> {
    if (!this.#service) return null;
    const session = this.deviceAuth;
    const id = clientId ?? session?.clientId ?? '';
    const code = deviceCode ?? session?.device.deviceCode ?? '';
    if (!id || !code) return null;
    const result = await this.run(async () => this.#service!.completeDeviceAuth(id, code));
    if (!result) return null;
    if (result.ok) {
      this.cancelDeviceAuth();
      this.deviceAuthPhase = 'authorized';
      this.user = result.value;
    }
    await this.reloadSettingsStore();
    return result.ok ? result.value : null;
  }

  async signOut(): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.signOut());
    if (!result) return false;
    this.user = null;
    this.remoteRepos = [];
    this.remoteRepoFetchedAt = null;
    this.remoteBranches = [];
    this.remoteBranchesFor = null;
    return true;
  }

  // ─── Repository ───

  async createRepository(params: CreateAndAttachRepositoryParams): Promise<SyncSettings | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.createAndAttachRepository(params));
    await this.reloadSettingsStore();
    await this.refreshLocalBranches();
    if (!result) return null;
    return result.ok ? result.value : null;
  }

  async attachRepository(remoteUrl: string, branch = 'main'): Promise<SyncSettings | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.attachRepository({ remoteUrl, branch }));
    if (!result) return null;
    await this.reloadSettingsStore();
    if (result.ok) await this.refreshLocalBranches();
    return result.ok ? result.value : null;
  }

  async detach(): Promise<SyncSettings | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.detach());
    if (!result) return null;
    await this.reloadSettingsStore();
    this.localBranches = [];
    this.remoteBranches = [];
    this.remoteBranchesFor = null;
    return result.ok ? result.value : null;
  }

  async syncNow(options?: { mode?: SyncMode }): Promise<boolean> {
    if (!this.#service) return false;
    return !!(await this.run(async () => this.#service!.syncNow(options)));
  }

  // ─── Branches ───

  async refreshLocalBranches(): Promise<GitBranchInfo[]> {
    if (!this.#service) return [];
    const result = await this.run(async () => this.#service!.listLocalBranches());
    if (!result || !result.ok) {
      this.localBranches = [];
      return [];
    }
    this.localBranches = result.value;
    return result.value;
  }

  async switchBranch(branch: string): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.switchBranch(branch));
    if (!result) return false;
    await this.reloadSettingsStore();
    await this.refreshLocalBranches();
    return true;
  }

  async createBranch(branch: string, options?: { base?: string; checkout?: boolean }): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.createBranch(branch, options));
    if (!result) return false;
    if (options?.checkout !== false) await this.reloadSettingsStore();
    await this.refreshLocalBranches();
    return true;
  }

  // ─── Remote browsing ───

  async refreshRemoteRepos(): Promise<GitHubRepoSummary[]> {
    if (!this.#service) return [];
    const result = await this.run(async () => this.#service!.listRemoteRepositories());
    if (!result || !result.ok) return this.remoteRepos;
    this.remoteRepos = result.value;
    this.remoteRepoFetchedAt = Date.now();
    return result.value;
  }

  async refreshRemoteBranches(owner: string, repo: string): Promise<GitHubBranchSummary[]> {
    if (!this.#service) return [];
    const result = await this.run(async () => this.#service!.listRemoteBranches(owner, repo));
    if (!result || !result.ok) {
      if (this.remoteBranchesFor !== `${owner}/${repo}`) this.remoteBranches = [];
      return [];
    }
    this.remoteBranches = result.value;
    this.remoteBranchesFor = `${owner}/${repo}`;
    return result.value;
  }

  async checkRepositoryName(name: string): Promise<GitHubNameAvailability | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.checkRepositoryName(name));
    return result && result.ok ? result.value : null;
  }

  // ─── Settings ───

  async setAutoSync(enabled: boolean): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.setAutoSync(enabled));
    if (!result) return false;
    await this.reloadSettingsStore();
    return true;
  }

  async setPaused(paused: boolean): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.setPaused(paused));
    if (!result) return false;
    await this.reloadSettingsStore();
    return true;
  }

  // ─── Conflicts ───

  async previewRemoteNote(path: string): Promise<RemoteNotePreview | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.previewRemoteNote(path));
    if (!result) return null;
    if (result.ok) this.lastPreview = result.value;
    return result.ok ? result.value : null;
  }

  async refreshNoteFromRemote(path: string): Promise<RemoteNotePreview | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.refreshNoteFromRemote(path));
    if (!result) return null;
    if (result.ok) this.lastPreview = result.value;
    return result.ok ? result.value : null;
  }

  async resolveConflict(conflictId: string, resolution: SyncConflictResolution): Promise<boolean> {
    if (!this.#service) return false;
    return await this.applyConflictResolution(conflictId, resolution);
  }

  async refreshConflictSession(): Promise<SyncConflictSession | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.refreshConflictSession());
    if (!result) return null;
    this.conflictSession = result.value ? cloneSession(result.value) : null;
    return this.conflictSession;
  }

  async previewConflict(conflictId: string): Promise<SyncConflictPreview | null> {
    if (!this.#service) return null;
    const result = await this.run(async () => this.#service!.previewConflict(conflictId));
    if (!result) return null;
    this.activeConflictPreview = result.value;
    return result.value;
  }

  async applyConflictResolution(
    conflictId: string,
    resolution: SyncConflictResolution,
    mergedMarkdown?: string,
  ): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () =>
      this.#service!.applyConflictResolution(conflictId, resolution, mergedMarkdown),
    );
    if (!result) return false;
    this.conflictSession = result.value ? cloneSession(result.value) : null;
    if (result.value === null) this.activeConflictPreview = null;
    await this.refreshStatus();
    return true;
  }

  async resumeConflictResolution(): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.resumeConflictResolution());
    if (!result) return false;
    this.conflictSession = null;
    this.activeConflictPreview = null;
    await this.reloadSettingsStore();
    return true;
  }

  async abortConflictResolution(): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.abortConflictResolution());
    if (!result) return false;
    this.conflictSession = result.value ? cloneSession(result.value) : null;
    this.activeConflictPreview = null;
    await this.reloadSettingsStore();
    return true;
  }

  // ─── Derived ───

  get isAttached(): boolean {
    return this.status.remoteUrl !== null;
  }

  get isSignedIn(): boolean {
    return this.status.auth === 'signed-in';
  }

  get hasConflicts(): boolean {
    return this.status.conflicts.length > 0;
  }

  get label(): string {
    switch (this.status.kind) {
      case 'ready':
        return 'GitHub synced';
      case 'syncing':
        return 'GitHub syncing';
      case 'pending':
        return 'GitHub pending';
      case 'auth-required':
        return 'GitHub auth needed';
      case 'conflicted':
        return 'GitHub conflicts';
      case 'paused':
        return 'GitHub paused';
      case 'error':
        return 'GitHub sync failed';
      case 'disabled':
      default:
        return 'GitHub off';
    }
  }

  get displayLabel(): string {
    return this.recentSyncLabel ?? this.label;
  }

  // ─── Internals ───

  private registerSyncEvents(): () => void {
    const started = (payload: { mode: SyncMode }) => {
      this.lastSyncMode = payload.mode;
      this.clearRecentSyncLabel();
    };
    const completed = (payload: { mode: SyncMode }) => {
      this.lastSyncMode = payload.mode;
      this.lastCompletedAt = Date.now();
      this.recentSyncLabel = 'GitHub synced just now';
      if (this.#recentSyncTimer) clearTimeout(this.#recentSyncTimer);
      this.#recentSyncTimer = setTimeout(() => {
        this.recentSyncLabel = null;
        this.#recentSyncTimer = null;
      }, 7000);
    };
    const failed = (payload: { mode: SyncMode }) => {
      this.lastSyncMode = payload.mode;
      this.lastFailureAt = Date.now();
      this.clearRecentSyncLabel();
    };

    events.on('sync:started', started);
    events.on('sync:completed', completed);
    events.on('sync:failed', failed);
    return () => {
      events.off('sync:started', started);
      events.off('sync:completed', completed);
      events.off('sync:failed', failed);
      this.clearRecentSyncLabel();
    };
  }

  private clearRecentSyncLabel(): void {
    this.recentSyncLabel = null;
    if (this.#recentSyncTimer) {
      clearTimeout(this.#recentSyncTimer);
      this.#recentSyncTimer = null;
    }
  }

  private cancelDevicePoll(): void {
    if (this.#devicePollTimer) clearTimeout(this.#devicePollTimer);
    this.#devicePollTimer = null;
    if (this.#deviceCountdownTimer) clearInterval(this.#deviceCountdownTimer);
    this.#deviceCountdownTimer = null;
  }

  private startDeviceCountdown(): void {
    if (!this.deviceAuth) return;
    const startedAt = this.deviceAuth.startedAt;
    const totalMs = this.deviceAuth.device.expiresIn * 1000;
    if (this.#deviceCountdownTimer) clearInterval(this.#deviceCountdownTimer);
    const tick = () => {
      if (!this.deviceAuth) {
        if (this.#deviceCountdownTimer) clearInterval(this.#deviceCountdownTimer);
        this.#deviceCountdownTimer = null;
        return;
      }
      const remaining = Math.max(0, totalMs - (Date.now() - startedAt));
      this.deviceAuthExpiresInMs = remaining;
      if (remaining === 0) {
        this.deviceAuthPhase = 'expired';
        this.deviceAuthMessage = 'Device code expired. Start again to sign in.';
        this.cancelDevicePoll();
      }
    };
    tick();
    this.#deviceCountdownTimer = setInterval(tick, 1000);
  }

  private async run<T>(operation: () => Promise<{ ok: true; value: T } | { ok: false; error: Error }>): Promise<{ ok: true; value: T } | false> {
    this.loading = true;
    this.error = null;
    try {
      const result = await operation();
      if (!result.ok) {
        this.error = result.error;
        events.emit('error:user-facing', { source: 'GitHub sync', error: result.error });
        return false;
      }
      return result;
    } finally {
      this.loading = false;
    }
  }

  private async reloadSettingsStore(): Promise<void> {
    if (!settingsStore.isInitialized) return;
    try {
      await settingsStore.load();
    } catch {
      // The sync operation already succeeded. Settings reload failures are
      // surfaced by the settings store itself when the panel next renders.
    }
  }
}

export const syncStore = new SyncStore();

function cloneSession(session: SyncConflictSession): SyncConflictSession {
  return {
    ...session,
    conflicts: session.conflicts.map((conflict) => {
      const copy = { ...conflict };
      if (conflict.hunks) copy.hunks = conflict.hunks.map((hunk) => ({ ...hunk }));
      return copy;
    }),
  };
}
