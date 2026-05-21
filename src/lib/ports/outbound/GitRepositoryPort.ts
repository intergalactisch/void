/**
 * GitRepositoryPort - outbound port for local vault Git operations.
 */

import type { Result } from '$lib/core';
import type {
  GitBranchInfo,
  GitHubCreatedRepository,
  GitRepositoryState,
  SyncArtifactPolicy,
  SyncConflict,
} from '$lib/domain/values';

export interface GitCommitResult {
  committed: boolean;
  commit: string | null;
  message: string;
}

export interface GitRemoteFile {
  path: string;
  content: string;
  ref: string;
}

export interface GitMergeStartResult {
  clean: boolean;
  message: string;
}

export interface GitMergeConflictFile {
  path: string;
  status: string;
  supported: boolean;
  reason: string | null;
}

export interface GitMergeFile {
  path: string;
  base: string | null;
  local: string | null;
  remote: string | null;
}

export interface GitAuthOptions {
  token?: string | null;
}

export interface CreateBranchOptions {
  base?: string | undefined;
  checkout?: boolean | undefined;
}

export interface GitRepositoryPort {
  detect(notesPath: string): Promise<Result<GitRepositoryState, Error>>;
  init(notesPath: string, branch: string): Promise<Result<void, Error>>;
  ensureArtifactPolicy(notesPath: string, policy: SyncArtifactPolicy): Promise<Result<void, Error>>;
  setRemote(notesPath: string, remoteUrl: string): Promise<Result<void, Error>>;
  commitAll(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>>;
  fetch(notesPath: string, remote: string, branch: string, auth?: GitAuthOptions): Promise<Result<void, Error>>;
  pullFastForward(notesPath: string, remote: string, branch: string, auth?: GitAuthOptions): Promise<Result<void, Error>>;
  push(notesPath: string, remote: string, branch: string, auth?: GitAuthOptions): Promise<Result<void, Error>>;
  /**
   * Negotiate a push with the remote without transferring objects. Surfaces
   * server-side permission failures (e.g. token lacks write scope on a
   * private repo) at attach time instead of on the first real sync.
   */
  pushDryRun(notesPath: string, remote: string, branch: string, auth?: GitAuthOptions): Promise<Result<void, Error>>;
  readRemoteFile(notesPath: string, remote: string, branch: string, path: string, auth?: GitAuthOptions): Promise<Result<GitRemoteFile, Error>>;
  buildDivergenceConflict(notesPath: string, branch: string): Promise<Result<SyncConflict, Error>>;
  createRecoveryBranch(notesPath: string, branch: string): Promise<Result<string, Error>>;
  beginMerge(notesPath: string, remote: string, branch: string, auth?: GitAuthOptions): Promise<Result<GitMergeStartResult, Error>>;
  listMergeConflicts(notesPath: string): Promise<Result<GitMergeConflictFile[], Error>>;
  readMergeFile(notesPath: string, path: string): Promise<Result<GitMergeFile, Error>>;
  writeWorkingFile(notesPath: string, path: string, content: string): Promise<Result<void, Error>>;
  stagePaths(notesPath: string, paths: string[]): Promise<Result<void, Error>>;
  commitMerge(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>>;
  abortMerge(notesPath: string): Promise<Result<void, Error>>;
  isMergeInProgress(notesPath: string): Promise<Result<boolean, Error>>;
  listLocalBranches(notesPath: string): Promise<Result<GitBranchInfo[], Error>>;
  createBranch(notesPath: string, branch: string, options?: CreateBranchOptions): Promise<Result<void, Error>>;
  switchBranch(notesPath: string, branch: string): Promise<Result<void, Error>>;
  createRepositoryRef(created: GitHubCreatedRepository, branch?: string): {
    owner: string;
    name: string;
    fullName: string;
    remoteUrl: string;
    htmlUrl: string;
    branch: string;
  };
}
