/**
 * TauriGitHubAdapter - GitHubPort via Rust/reqwest commands.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type {
  GitHubBranchSummary,
  GitHubCreatedRepository,
  GitHubDeviceAuthRequest,
  GitHubDeviceAuthStart,
  GitHubNameAvailability,
  GitHubRepoSummary,
  GitHubUser,
  GitHubVoidReadyProbe,
} from '$lib/domain/values';
import type {
  GitHubCreateRepositoryParams,
  GitHubDeviceAuthCompleteParams,
  GitHubPort,
  GitHubTokenResult,
} from '$lib/ports/outbound';
import { githubCommands } from './commands';

export class TauriGitHubAdapter implements GitHubPort {
  async validateToken(token: string): Promise<Result<GitHubUser, Error>> {
    try {
      return ok(await githubCommands.validateToken(token));
    } catch (e) {
      return err(toError(e));
    }
  }

  async createRepository(
    token: string,
    params: GitHubCreateRepositoryParams,
  ): Promise<Result<GitHubCreatedRepository, Error>> {
    try {
      return ok(await githubCommands.createRepository(token, params));
    } catch (e) {
      return err(toError(e));
    }
  }

  async beginDeviceAuth(
    params: GitHubDeviceAuthRequest,
  ): Promise<Result<GitHubDeviceAuthStart, Error>> {
    try {
      return ok(await githubCommands.beginDeviceAuth(params));
    } catch (e) {
      return err(toError(e));
    }
  }

  async completeDeviceAuth(
    params: GitHubDeviceAuthCompleteParams,
  ): Promise<Result<GitHubTokenResult, Error>> {
    try {
      return ok(await githubCommands.completeDeviceAuth(params));
    } catch (e) {
      return err(toError(e));
    }
  }

  async listRepositories(token: string): Promise<Result<GitHubRepoSummary[], Error>> {
    try {
      return ok(await githubCommands.listRepositories(token));
    } catch (e) {
      return err(toError(e));
    }
  }

  async getRepository(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Result<GitHubRepoSummary, Error>> {
    try {
      return ok(await githubCommands.getRepository(token, owner, repo));
    } catch (e) {
      return err(toError(e));
    }
  }

  async getVoidReady(
    token: string,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<Result<GitHubVoidReadyProbe, Error>> {
    try {
      return ok(await githubCommands.getVoidReady(token, owner, repo, ref));
    } catch (e) {
      return err(toError(e));
    }
  }

  async listBranches(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Result<GitHubBranchSummary[], Error>> {
    try {
      return ok(await githubCommands.listBranches(token, owner, repo));
    } catch (e) {
      return err(toError(e));
    }
  }

  async checkRepositoryName(
    token: string,
    name: string,
  ): Promise<Result<GitHubNameAvailability, Error>> {
    try {
      return ok(await githubCommands.checkRepositoryName(token, name));
    } catch (e) {
      return err(toError(e));
    }
  }

  async revokeToken(clientId: string, token: string): Promise<Result<void, Error>> {
    try {
      await githubCommands.revokeToken(clientId, token);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }
}
