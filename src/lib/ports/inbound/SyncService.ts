/**
 * SyncService - inbound port for GitHub-backed local-first sync.
 */

import type { Result } from '$lib/core';
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
  SyncSettings,
  SyncStatus,
} from '$lib/domain/values';

export interface CreateAndAttachRepositoryParams {
  name: string;
  private?: boolean;
  description?: string;
  branch?: string;
}

export interface AttachRepositoryParams {
  remoteUrl: string;
  branch?: string;
}

export interface RemoteNotePreview {
  path: string;
  localMarkdown: string | null;
  remoteMarkdown: string;
  remoteRef: string;
}

export interface DeviceAuthPollResult {
  status: 'authorized' | 'pending' | 'slow_down' | 'expired' | 'denied' | 'error';
  user?: GitHubUser;
  error?: string;
  retryAfter?: number;
}

export interface SyncService {
  getStatus(): SyncStatus;
  getCurrentUser(): GitHubUser | null;
  subscribe(callback: (status: SyncStatus) => void): () => void;
  refreshStatus(): Promise<Result<SyncStatus, Error>>;
  connectWithToken(token: string): Promise<Result<GitHubUser, Error>>;
  beginDeviceAuth(clientId: string): Promise<Result<GitHubDeviceAuthStart, Error>>;
  completeDeviceAuth(clientId: string, deviceCode: string): Promise<Result<GitHubUser, Error>>;
  pollDeviceAuth(clientId: string, deviceCode: string): Promise<DeviceAuthPollResult>;
  signOut(): Promise<Result<void, Error>>;
  createAndAttachRepository(params: CreateAndAttachRepositoryParams): Promise<Result<SyncSettings, Error>>;
  attachRepository(params: AttachRepositoryParams): Promise<Result<SyncSettings, Error>>;
  detach(): Promise<Result<SyncSettings, Error>>;
  syncNow(): Promise<Result<SyncStatus, Error>>;
  previewRemoteNote(path: string): Promise<Result<RemoteNotePreview, Error>>;
  refreshNoteFromRemote(path: string): Promise<Result<RemoteNotePreview, Error>>;
  resolveConflict(conflictId: string, resolution: SyncConflictResolution): Promise<Result<SyncConflict | null, Error>>;
  loadConflictSession(): Promise<Result<SyncConflictSession | null, Error>>;
  refreshConflictSession(): Promise<Result<SyncConflictSession | null, Error>>;
  previewConflict(conflictId: string): Promise<Result<SyncConflictPreview, Error>>;
  applyConflictResolution(
    conflictId: string,
    resolution: SyncConflictResolution,
    mergedMarkdown?: string,
  ): Promise<Result<SyncConflictSession | null, Error>>;
  resumeConflictResolution(): Promise<Result<SyncStatus, Error>>;
  abortConflictResolution(): Promise<Result<SyncConflictSession | null, Error>>;
  listLocalBranches(): Promise<Result<GitBranchInfo[], Error>>;
  switchBranch(branch: string): Promise<Result<SyncSettings, Error>>;
  createBranch(branch: string, options?: { base?: string; checkout?: boolean }): Promise<Result<GitBranchInfo[], Error>>;
  listRemoteRepositories(): Promise<Result<GitHubRepoSummary[], Error>>;
  listRemoteBranches(owner: string, repo: string): Promise<Result<GitHubBranchSummary[], Error>>;
  checkRepositoryName(name: string): Promise<Result<GitHubNameAvailability, Error>>;
  setAutoSync(enabled: boolean): Promise<Result<SyncSettings, Error>>;
  setPaused(paused: boolean): Promise<Result<SyncSettings, Error>>;
}
