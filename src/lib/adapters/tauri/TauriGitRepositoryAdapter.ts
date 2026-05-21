/**
 * TauriGitRepositoryAdapter - GitRepositoryPort via controlled Rust commands.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type {
  GitBranchInfo,
  GitHubCreatedRepository,
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
  GitRemoteFile,
  GitRepositoryPort,
} from '$lib/ports/outbound';
import { gitCommands } from './commands';

export class TauriGitRepositoryAdapter implements GitRepositoryPort {
  async detect(notesPath: string): Promise<Result<GitRepositoryState, Error>> {
    try {
      return ok(await gitCommands.detect(notesPath));
    } catch (e) {
      return err(toError(e));
    }
  }

  async init(notesPath: string, branch: string): Promise<Result<void, Error>> {
    try {
      await gitCommands.init(notesPath, branch);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async ensureArtifactPolicy(
    notesPath: string,
    policy: SyncArtifactPolicy,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.ensureArtifactPolicy(notesPath, policy);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async setRemote(notesPath: string, remoteUrl: string): Promise<Result<void, Error>> {
    try {
      await gitCommands.setRemote(notesPath, remoteUrl);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async commitAll(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>> {
    try {
      return ok(await gitCommands.commitAll(notesPath, message));
    } catch (e) {
      return err(toError(e));
    }
  }

  async fetch(
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.fetch(notesPath, remote, branch, auth);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async pullFastForward(
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.pullFastForward(notesPath, remote, branch, auth);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async push(
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.push(notesPath, remote, branch, auth);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async pushDryRun(
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.pushDryRun(notesPath, remote, branch, auth);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async readRemoteFile(
    notesPath: string,
    remote: string,
    branch: string,
    path: string,
    auth?: GitAuthOptions,
  ): Promise<Result<GitRemoteFile, Error>> {
    try {
      return ok(await gitCommands.readRemoteFile(notesPath, remote, branch, path, auth));
    } catch (e) {
      return err(toError(e));
    }
  }

  async buildDivergenceConflict(
    notesPath: string,
    branch: string,
  ): Promise<Result<SyncConflict, Error>> {
    try {
      return ok(await gitCommands.buildDivergenceConflict(notesPath, branch));
    } catch (e) {
      return err(toError(e));
    }
  }

  async createRecoveryBranch(notesPath: string, branch: string): Promise<Result<string, Error>> {
    try {
      return ok(await gitCommands.createRecoveryBranch(notesPath, branch));
    } catch (e) {
      return err(toError(e));
    }
  }

  async beginMerge(
    notesPath: string,
    remote: string,
    branch: string,
    auth?: GitAuthOptions,
  ): Promise<Result<GitMergeStartResult, Error>> {
    try {
      return ok(await gitCommands.beginMerge(notesPath, remote, branch, auth));
    } catch (e) {
      return err(toError(e));
    }
  }

  async listMergeConflicts(notesPath: string): Promise<Result<GitMergeConflictFile[], Error>> {
    try {
      return ok(await gitCommands.listMergeConflicts(notesPath));
    } catch (e) {
      return err(toError(e));
    }
  }

  async readMergeFile(notesPath: string, path: string): Promise<Result<GitMergeFile, Error>> {
    try {
      return ok(await gitCommands.readMergeFile(notesPath, path));
    } catch (e) {
      return err(toError(e));
    }
  }

  async writeWorkingFile(notesPath: string, path: string, content: string): Promise<Result<void, Error>> {
    try {
      await gitCommands.writeWorkingFile(notesPath, path, content);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async stagePaths(notesPath: string, paths: string[]): Promise<Result<void, Error>> {
    try {
      await gitCommands.stagePaths(notesPath, paths);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async commitMerge(notesPath: string, message: string): Promise<Result<GitCommitResult, Error>> {
    try {
      return ok(await gitCommands.commitMerge(notesPath, message));
    } catch (e) {
      return err(toError(e));
    }
  }

  async abortMerge(notesPath: string): Promise<Result<void, Error>> {
    try {
      await gitCommands.abortMerge(notesPath);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async isMergeInProgress(notesPath: string): Promise<Result<boolean, Error>> {
    try {
      return ok(await gitCommands.isMergeInProgress(notesPath));
    } catch (e) {
      return err(toError(e));
    }
  }

  async listLocalBranches(notesPath: string): Promise<Result<GitBranchInfo[], Error>> {
    try {
      return ok(await gitCommands.listLocalBranches(notesPath));
    } catch (e) {
      return err(toError(e));
    }
  }

  async createBranch(
    notesPath: string,
    branch: string,
    options?: CreateBranchOptions,
  ): Promise<Result<void, Error>> {
    try {
      await gitCommands.createBranch(notesPath, branch, options);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  async switchBranch(notesPath: string, branch: string): Promise<Result<void, Error>> {
    try {
      await gitCommands.switchBranch(notesPath, branch);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
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
}
