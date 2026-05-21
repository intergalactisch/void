/**
 * Tauri Commands - Raw type-safe invoke wrappers
 *
 * This file provides a centralized, type-safe layer over Tauri's invoke API.
 * All Tauri command invocations should go through this module to ensure
 * consistent typing and easier maintenance.
 *
 * These commands map directly to Rust commands defined in src-tauri/src/commands/
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { FileEntry } from '$lib/core';
import type { Settings } from '$lib/domain';
import type { UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound';
import type {
  GitBranchInfo,
  GitHubBranchSummary,
  GitHubCreatedRepository,
  GitHubDeviceAuthRequest,
  GitHubDeviceAuthStart,
  GitHubNameAvailability,
  GitHubRepoSummary,
  GitHubUser,
  GitHubVoidReadyProbe,
  GitRepositoryState,
  SyncArtifactPolicy,
  SyncConflict,
} from '$lib/domain/values';
import type {
  CreateBranchOptions,
  GitAuthOptions,
  GitCommitResult,
  GitMergeConflictFile,
  GitMergeFile,
  GitMergeStartResult,
  GitHubCreateRepositoryParams,
  GitHubDeviceAuthCompleteParams,
  GitHubTokenResult,
  GitRemoteFile,
} from '$lib/ports/outbound';

/**
 * Raw file entry from Tauri (Rust uses camelCase via serde)
 */
interface RawFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  modified?: number;
}

/**
 * Transform raw Tauri FileEntry to our domain FileEntry
 */
function transformFileEntry(raw: RawFileEntry): FileEntry {
  const entry: FileEntry = {
    name: raw.name,
    path: raw.path,
    isDirectory: raw.isDirectory,
    isFile: raw.isFile,
  };

  // Only include optional properties if they have values
  // (required for exactOptionalPropertyTypes)
  if (raw.size !== undefined) {
    entry.size = raw.size;
  }
  if (raw.modified !== undefined) {
    entry.modifiedAt = new Date(raw.modified * 1000);
  }

  return entry;
}

/**
 * File system commands
 */
export const fileCommands = {
  /**
   * Read file content as string
   */
  readFile: (path: string): Promise<string> => invoke<string>('read_file', { path }),

  /**
   * Write content to file
   */
  writeFile: (path: string, content: string): Promise<void> =>
    invoke<void>('write_file', { path, content }),

  /**
   * Delete a file
   */
  deleteFile: (path: string): Promise<void> => invoke<void>('delete_file', { path }),

  /**
   * List directory contents
   */
  listDirectory: async (path: string): Promise<FileEntry[]> => {
    const entries = await invoke<RawFileEntry[]>('list_directory', { path });
    return entries.map(transformFileEntry);
  },

  /**
   * Check if path exists
   */
  exists: (path: string): Promise<boolean> => invoke<boolean>('file_exists', { path }),

  /**
   * Create directory (including parents)
   */
  createDirectory: (path: string): Promise<void> => invoke<void>('create_directory', { path }),

  /**
   * Recursively remove a directory and all of its contents
   */
  removeDirectory: (path: string): Promise<void> => invoke<void>('remove_directory', { path }),

  /**
   * Move a file or directory to the operating system Trash
   */
  moveToTrash: (path: string): Promise<void> => invoke<void>('move_to_trash', { path }),

  /**
   * Rename or move a file/directory
   */
  renamePath: (from: string, to: string): Promise<void> =>
    invoke<void>('rename_path', { from, to }),
};

/**
 * Settings commands
 */
export const settingsCommands = {
  /**
   * Get settings from storage
   */
  getSettings: (): Promise<Settings> => invoke<Settings>('get_settings'),

  /**
   * Save settings to storage
   */
  saveSettings: (settings: Settings): Promise<void> =>
    invoke<void>('save_settings', { settings }),

  /**
   * Get path to settings file
   */
  getSettingsPath: (): Promise<string> => invoke<string>('get_settings_path'),
};

/**
 * App updater commands.
 *
 * These wrap narrow Void-owned Rust commands instead of exposing the generic
 * updater plugin surface to the webview. The endpoint, public key, target,
 * headers, proxy, timeout, and downgrade behavior stay owned by Rust/Tauri
 * configuration.
 */
export const updaterCommands = {
  currentVersion: (): Promise<string> => invoke<string>('void_updater_current_version'),

  check: (): Promise<UpdateInfo | null> => invoke<UpdateInfo | null>('void_updater_check'),

  install: (onEvent?: (event: UpdateInstallEvent) => void): Promise<void> => {
    const channel = new Channel<UpdateInstallEvent>();
    if (onEvent) {
      channel.onmessage = onEvent;
    }
    return invoke<void>('void_updater_install', { onEvent: channel });
  },

  restart: (): Promise<void> => invoke<void>('void_updater_restart'),
};

/**
 * Credential commands (uses system keychain)
 */
export const credentialCommands = {
  /**
   * Store a credential in the system keychain
   */
  storeCredential: (service: string, credential: string): Promise<void> =>
    invoke<void>('store_credential', { key: service, value: credential }),

  /**
   * Get a credential from the system keychain
   * Returns null if not found
   */
  getCredential: (service: string): Promise<string | null> =>
    invoke<string | null>('get_credential', { key: service }),

  /**
   * Delete a credential from the system keychain
   */
  deleteCredential: (service: string): Promise<void> =>
    invoke<void>('delete_credential', { key: service }),

  /**
   * Check if a credential exists in the system keychain
   */
  hasCredential: (service: string): Promise<boolean> =>
    invoke<boolean>('has_credential', { key: service }),
};

/**
 * Local Git repository commands.
 */
export const gitCommands = {
  detect: (notesPath: string): Promise<GitRepositoryState> =>
    invoke<GitRepositoryState>('git_detect', { notesPath }),

  init: (notesPath: string, branch: string): Promise<void> =>
    invoke<void>('git_init', { notesPath, branch }),

  ensureArtifactPolicy: (
    notesPath: string,
    artifactPolicy: SyncArtifactPolicy,
  ): Promise<void> =>
    invoke<void>('git_ensure_artifact_policy', { notesPath, artifactPolicy }),

  setRemote: (notesPath: string, remoteUrl: string): Promise<void> =>
    invoke<void>('git_set_remote', { notesPath, remoteUrl }),

  commitAll: (notesPath: string, message: string): Promise<GitCommitResult> =>
    invoke<GitCommitResult>('git_commit_all', { notesPath, message }),

  fetch: (
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<void> =>
    invoke<void>('git_fetch', { notesPath, remote, branch, token: auth?.token ?? null }),

  pullFastForward: (
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<void> =>
    invoke<void>('git_pull_ff', { notesPath, remote, branch, token: auth?.token ?? null }),

  push: (
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<void> =>
    invoke<void>('git_push', { notesPath, remote, branch, token: auth?.token ?? null }),

  pushDryRun: (
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<void> =>
    invoke<void>('git_push_dry_run', { notesPath, remote, branch, token: auth?.token ?? null }),

  readRemoteFile: (
    notesPath: string,
    remote: string,
    branch: string,
    path: string,
    auth?: GitAuthOptions,
  ): Promise<GitRemoteFile> =>
    invoke<GitRemoteFile>('git_read_remote_file', {
      notesPath,
      remote,
      branch,
      path,
      token: auth?.token ?? null,
    }),

  buildDivergenceConflict: (notesPath: string, branch: string): Promise<SyncConflict> =>
    invoke<SyncConflict>('git_build_divergence_conflict', { notesPath, branch }),

  createRecoveryBranch: (notesPath: string, branch: string): Promise<string> =>
    invoke<string>('git_create_recovery_branch', { notesPath, branch }),

  beginMerge: (
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<GitMergeStartResult> =>
    invoke<GitMergeStartResult>('git_begin_merge', {
      notesPath,
      remote,
      branch,
      token: auth?.token ?? null,
    }),

  listMergeConflicts: (notesPath: string): Promise<GitMergeConflictFile[]> =>
    invoke<GitMergeConflictFile[]>('git_list_merge_conflicts', { notesPath }),

  readMergeFile: (notesPath: string, path: string): Promise<GitMergeFile> =>
    invoke<GitMergeFile>('git_read_merge_file', { notesPath, path }),

  writeWorkingFile: (notesPath: string, path: string, content: string): Promise<void> =>
    invoke<void>('git_write_working_file', { notesPath, path, content }),

  stagePaths: (notesPath: string, paths: string[]): Promise<void> =>
    invoke<void>('git_stage_paths', { notesPath, paths }),

  commitMerge: (notesPath: string, message: string): Promise<GitCommitResult> =>
    invoke<GitCommitResult>('git_commit_merge', { notesPath, message }),

  abortMerge: (notesPath: string): Promise<void> =>
    invoke<void>('git_abort_merge', { notesPath }),

  isMergeInProgress: (notesPath: string): Promise<boolean> =>
    invoke<boolean>('git_is_merge_in_progress', { notesPath }),

  listLocalBranches: (notesPath: string): Promise<GitBranchInfo[]> =>
    invoke<GitBranchInfo[]>('git_list_local_branches', { notesPath }),

  createBranch: (
    notesPath: string,
    branch: string,
    options?: CreateBranchOptions,
  ): Promise<void> =>
    invoke<void>('git_create_branch', {
      notesPath,
      branch,
      base: options?.base ?? null,
      checkout: options?.checkout ?? true,
    }),

  switchBranch: (notesPath: string, branch: string): Promise<void> =>
    invoke<void>('git_switch_branch', { notesPath, branch }),
};

/**
 * GitHub API/auth commands.
 */
export const githubCommands = {
  validateToken: (token: string): Promise<GitHubUser> =>
    invoke<GitHubUser>('github_validate_token', { token }),

  createRepository: (
    token: string,
    params: GitHubCreateRepositoryParams,
  ): Promise<GitHubCreatedRepository> =>
    invoke<GitHubCreatedRepository>('github_create_repo', {
      token,
      name: params.name,
      privateRepo: params.private,
      description: params.description ?? null,
    }),

  beginDeviceAuth: (
    params: GitHubDeviceAuthRequest,
  ): Promise<GitHubDeviceAuthStart> =>
    invoke<GitHubDeviceAuthStart>('github_begin_device_auth', {
      clientId: params.clientId,
      scope: params.scope,
    }),

  completeDeviceAuth: (
    params: GitHubDeviceAuthCompleteParams,
  ): Promise<GitHubTokenResult> =>
    invoke<GitHubTokenResult>('github_complete_device_auth', {
      clientId: params.clientId,
      deviceCode: params.deviceCode,
    }),

  listRepositories: (token: string): Promise<GitHubRepoSummary[]> =>
    invoke<GitHubRepoSummary[]>('github_list_repositories', { token }),

  getRepository: (
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubRepoSummary> =>
    invoke<GitHubRepoSummary>('github_get_repository', { token, owner, repo }),

  getVoidReady: (
    token: string,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitHubVoidReadyProbe> =>
    invoke<GitHubVoidReadyProbe>('github_get_void_ready', {
      token,
      owner,
      repo,
      refName: ref ?? null,
    }),

  listBranches: (
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubBranchSummary[]> =>
    invoke<GitHubBranchSummary[]>('github_list_branches', { token, owner, repo }),

  checkRepositoryName: (token: string, name: string): Promise<GitHubNameAvailability> =>
    invoke<GitHubNameAvailability>('github_check_repo_name', { token, name }),

  revokeToken: (clientId: string, token: string): Promise<void> =>
    invoke<void>('github_revoke_token', { clientId, token }),
};

/**
 * All commands grouped for convenience
 */
export const commands = {
  files: fileCommands,
  settings: settingsCommands,
  updater: updaterCommands,
  credentials: credentialCommands,
  git: gitCommands,
  github: githubCommands,
};
