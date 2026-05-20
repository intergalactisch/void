/**
 * MemoryGitRepositoryAdapter - in-memory GitRepositoryPort implementation.
 *
 * Used by tests and browser-only development. It models repo state changes
 * without touching a real .git directory.
 */

import { ok, err, type Result } from '$lib/core';
import {
  parseGitHubRemote,
  type GitBranchInfo,
  type GitFileChange,
  type GitHubCreatedRepository,
  type GitRepositoryState,
  type SyncArtifactPolicy,
  type SyncConflict,
  type SyncRepoKind,
} from '$lib/domain/values';
import type {
  CreateBranchOptions,
  GitAuthOptions,
  GitCommitResult,
  GitMergeConflictFile,
  GitMergeFile,
  GitMergeStartResult,
  GitRemoteFile,
  GitRepositoryPort,
} from '$lib/ports/outbound';

interface MemoryRepo {
  repoKind: SyncRepoKind;
  branch: string;
  remoteUrl: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changedFiles: GitFileChange[];
  conflicts: SyncConflict[];
  lastCommit: string | null;
  remoteFiles: Map<string, string>;
  branches: Set<string>;
  recoveryBranches: Set<string>;
  mergeInProgress: boolean;
  mergeFiles: Map<string, GitMergeFile & { status: string; supported: boolean; reason: string | null }>;
  stagedPaths: Set<string>;
  workingFiles: Map<string, string>;
}

function createRepo(notesPath: string): MemoryRepo {
  void notesPath;
  return {
    repoKind: 'none',
    branch: 'main',
    remoteUrl: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changedFiles: [],
    conflicts: [],
    lastCommit: null,
    remoteFiles: new Map(),
    branches: new Set<string>(),
    recoveryBranches: new Set<string>(),
    mergeInProgress: false,
    mergeFiles: new Map(),
    stagedPaths: new Set(),
    workingFiles: new Map(),
  };
}

export class MemoryGitRepositoryAdapter implements GitRepositoryPort {
  private repos = new Map<string, MemoryRepo>();
  private sequence = 0;

  async detect(notesPath: string): Promise<Result<GitRepositoryState, Error>> {
    const repo = this.repo(notesPath);
    return ok({
      repoKind: repo.repoKind,
      root: repo.repoKind === 'none' ? null : notesPath,
      branch: repo.repoKind === 'none' ? null : repo.branch,
      remoteUrl: repo.remoteUrl,
      upstream: repo.upstream,
      detached: false,
      ahead: repo.ahead,
      behind: repo.behind,
      changedFiles: repo.changedFiles.map((change) => ({ ...change })),
      conflicts: repo.conflicts.map((conflict) => ({ ...conflict })),
      lastCommit: repo.lastCommit,
      message: repo.conflicts.length > 0 ? 'Conflicts need resolution' : null,
    });
  }

  async init(notesPath: string, branch: string): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    repo.repoKind = 'managed';
    repo.branch = branch || 'main';
    repo.branches.add(repo.branch);
    return ok(undefined);
  }

  async ensureArtifactPolicy(
    _notesPath: string,
    _policy: SyncArtifactPolicy,
  ): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async setRemote(notesPath: string, remoteUrl: string): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    repo.remoteUrl = remoteUrl;
    repo.upstream = `origin/${repo.branch}`;
    repo.repoKind = repo.repoKind === 'none' ? 'managed' : repo.repoKind;
    return ok(undefined);
  }

  async commitAll(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>> {
    const repo = this.repo(notesPath);
    if (repo.repoKind !== 'managed') {
      return err(new Error('No managed Git repository'));
    }
    if (repo.changedFiles.length === 0 && repo.lastCommit) {
      return ok({ committed: false, commit: repo.lastCommit, message: 'No changes to commit' });
    }
    const commit = `mem-${++this.sequence}`;
    repo.lastCommit = commit;
    repo.ahead += 1;
    repo.changedFiles = [];
    return ok({ committed: true, commit, message });
  }

  async fetch(
    _notesPath: string,
    _remote: string,
    _branch: string,
    _auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async pullFastForward(
    notesPath: string,
    _remote: string,
    _branch: string,
    _auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    repo.behind = 0;
    return ok(undefined);
  }

  async push(
    notesPath: string,
    _remote: string,
    _branch: string,
    _auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    repo.ahead = 0;
    repo.upstream = `origin/${repo.branch}`;
    return ok(undefined);
  }

  async readRemoteFile(
    notesPath: string,
    _remote: string,
    branch: string,
    path: string,
    _auth?: GitAuthOptions,
  ): Promise<Result<GitRemoteFile, Error>> {
    const repo = this.repo(notesPath);
    const content = repo.remoteFiles.get(path);
    if (content === undefined) return err(new Error(`Remote note not found: ${path}`));
    return ok({ path, content, ref: `origin/${branch}` });
  }

  async buildDivergenceConflict(
    notesPath: string,
    branch: string,
  ): Promise<Result<SyncConflict, Error>> {
    const repo = this.repo(notesPath);
    return ok({
      id: `memory-diverged-${++this.sequence}`,
      kind: 'history-diverged',
      path: null,
      message: 'Local and remote histories diverged',
      localRef: repo.lastCommit,
      remoteRef: `origin/${branch}`,
      baseRef: null,
    });
  }

  async createRecoveryBranch(notesPath: string, branch: string): Promise<Result<string, Error>> {
    const repo = this.repo(notesPath);
    if (repo.repoKind !== 'managed') return err(new Error('No managed Git repository'));
    let name = branch.trim();
    if (!name) return err(new Error('Recovery branch name cannot be empty'));
    let suffix = 2;
    while (repo.branches.has(name) || repo.recoveryBranches.has(name)) {
      name = `${branch}-${suffix}`;
      suffix += 1;
    }
    repo.branches.add(name);
    repo.recoveryBranches.add(name);
    return ok(name);
  }

  async beginMerge(
    notesPath: string,
    _remote: string,
    _branch: string,
    _auth?: GitAuthOptions,
  ): Promise<Result<GitMergeStartResult, Error>> {
    const repo = this.repo(notesPath);
    if (repo.repoKind !== 'managed') return err(new Error('No managed Git repository'));
    repo.mergeInProgress = true;
    return ok({
      clean: repo.mergeFiles.size === 0,
      message: repo.mergeFiles.size === 0 ? 'Automatic merge went well' : 'Automatic merge failed; fix conflicts',
    });
  }

  async listMergeConflicts(notesPath: string): Promise<Result<GitMergeConflictFile[], Error>> {
    const repo = this.repo(notesPath);
    if (!repo.mergeInProgress) return ok([]);
    return ok(Array.from(repo.mergeFiles.values()).map((file) => ({
      path: file.path,
      status: file.status,
      supported: file.supported,
      reason: file.reason,
    })));
  }

  async readMergeFile(notesPath: string, path: string): Promise<Result<GitMergeFile, Error>> {
    const file = this.repo(notesPath).mergeFiles.get(path);
    if (!file) return err(new Error(`Merge file not found: ${path}`));
    return ok({
      path: file.path,
      base: file.base,
      local: file.local,
      remote: file.remote,
    });
  }

  async writeWorkingFile(notesPath: string, path: string, content: string): Promise<Result<void, Error>> {
    this.repo(notesPath).workingFiles.set(path, content);
    return ok(undefined);
  }

  async stagePaths(notesPath: string, paths: string[]): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    for (const path of paths) {
      repo.stagedPaths.add(path);
      repo.mergeFiles.delete(path);
    }
    return ok(undefined);
  }

  async commitMerge(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>> {
    const repo = this.repo(notesPath);
    if (!repo.mergeInProgress) return err(new Error('No merge in progress'));
    if (repo.mergeFiles.size > 0) return err(new Error('Merge conflicts are still unresolved'));
    const commit = `mem-${++this.sequence}`;
    repo.lastCommit = commit;
    repo.ahead = Math.max(repo.ahead, 1);
    repo.behind = 0;
    repo.mergeInProgress = false;
    repo.stagedPaths.clear();
    return ok({ committed: true, commit, message });
  }

  async abortMerge(notesPath: string): Promise<Result<void, Error>> {
    const repo = this.repo(notesPath);
    repo.mergeInProgress = false;
    repo.mergeFiles.clear();
    repo.stagedPaths.clear();
    return ok(undefined);
  }

  async isMergeInProgress(notesPath: string): Promise<Result<boolean, Error>> {
    return ok(this.repo(notesPath).mergeInProgress);
  }

  async listLocalBranches(notesPath: string): Promise<Result<GitBranchInfo[], Error>> {
    const repo = this.repo(notesPath);
    if (repo.repoKind === 'none') return ok([]);
    const names = new Set<string>(repo.branches);
    names.add(repo.branch);
    const branches: GitBranchInfo[] = Array.from(names).map((name) => ({
      name,
      isCurrent: name === repo.branch,
      upstream: repo.remoteUrl ? `origin/${name}` : null,
      lastCommit: repo.lastCommit,
      lastCommitSubject: null,
    }));
    branches.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    });
    return ok(branches);
  }

  async createBranch(
    notesPath: string,
    branch: string,
    options?: CreateBranchOptions,
  ): Promise<Result<void, Error>> {
    const trimmed = branch.trim();
    if (!trimmed) return err(new Error('Branch name cannot be empty'));
    const repo = this.repo(notesPath);
    if (repo.repoKind !== 'managed') return err(new Error('No managed Git repository'));
    if (repo.branches.has(trimmed)) return err(new Error(`Branch ${trimmed} already exists`));
    repo.branches.add(trimmed);
    if (options?.checkout !== false) {
      repo.branch = trimmed;
    }
    return ok(undefined);
  }

  async switchBranch(notesPath: string, branch: string): Promise<Result<void, Error>> {
    const trimmed = branch.trim();
    if (!trimmed) return err(new Error('Branch name cannot be empty'));
    const repo = this.repo(notesPath);
    if (repo.repoKind !== 'managed') return err(new Error('No managed Git repository'));
    if (!repo.branches.has(trimmed) && repo.branch !== trimmed) {
      return err(new Error(`Branch ${trimmed} does not exist`));
    }
    repo.branch = trimmed;
    return ok(undefined);
  }

  createRepositoryRef(created: GitHubCreatedRepository, branch?: string) {
    return {
      owner: created.owner,
      name: created.name,
      fullName: created.fullName,
      remoteUrl: created.cloneUrl,
      htmlUrl: created.htmlUrl,
      branch: branch || created.defaultBranch || 'main',
    };
  }

  seed(notesPath: string, state: Partial<MemoryRepo>): void {
    const repo = this.repo(notesPath);
    Object.assign(repo, state);
  }

  seedRemoteFile(notesPath: string, path: string, content: string): void {
    this.repo(notesPath).remoteFiles.set(path, content);
  }

  seedMergeConflict(
    notesPath: string,
    file: GitMergeFile & Partial<Pick<GitMergeConflictFile, 'status' | 'supported' | 'reason'>>,
  ): void {
    const repo = this.repo(notesPath);
    repo.mergeFiles.set(file.path, {
      path: file.path,
      base: file.base,
      local: file.local,
      remote: file.remote,
      status: file.status ?? 'UU',
      supported: file.supported ?? true,
      reason: file.reason ?? null,
    });
  }

  attachGitHubRemote(notesPath: string, remoteUrl: string, branch = 'main'): void {
    const repoRef = parseGitHubRemote(remoteUrl, branch);
    if (!repoRef) throw new Error('Invalid GitHub remote URL');
    const repo = this.repo(notesPath);
    repo.repoKind = 'managed';
    repo.branch = repoRef.branch;
    repo.remoteUrl = repoRef.remoteUrl;
    repo.upstream = `origin/${repoRef.branch}`;
    repo.branches.add(repoRef.branch);
  }

  private repo(notesPath: string): MemoryRepo {
    let repo = this.repos.get(notesPath);
    if (!repo) {
      repo = createRepo(notesPath);
      this.repos.set(notesPath, repo);
    }
    return repo;
  }
}
