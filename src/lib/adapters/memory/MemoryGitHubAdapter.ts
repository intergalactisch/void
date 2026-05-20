/**
 * MemoryGitHubAdapter - in-memory GitHubPort implementation.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  GitHubBranchSummary,
  GitHubCreatedRepository,
  GitHubDeviceAuthRequest,
  GitHubDeviceAuthStart,
  GitHubNameAvailability,
  GitHubRepoSummary,
  GitHubUser,
  GitHubVoidReadyProbe,
  VoidRepoManifest,
} from '$lib/domain/values';
import type {
  GitHubCreateRepositoryParams,
  GitHubDeviceAuthCompleteParams,
  GitHubPort,
  GitHubTokenResult,
} from '$lib/ports/outbound';

export class MemoryGitHubAdapter implements GitHubPort {
  private user: GitHubUser = { login: 'void-dev', name: 'Void Dev' };
  private repos: GitHubRepoSummary[] = [];
  private branchesByRepo: Map<string, GitHubBranchSummary[]> = new Map();
  private manifestsByRepo: Map<string, VoidRepoManifest> = new Map();
  private revokedTokens = new Set<string>();

  async validateToken(token: string): Promise<Result<GitHubUser, Error>> {
    if (!token.trim()) return err(new Error('GitHub token cannot be empty'));
    if (this.revokedTokens.has(token.trim())) return err(new Error('Token is invalid'));
    return ok(this.user);
  }

  async createRepository(
    token: string,
    params: GitHubCreateRepositoryParams,
  ): Promise<Result<GitHubCreatedRepository, Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    const name = params.name.trim();
    if (!name) return err(new Error('Repository name cannot be empty'));

    const defaultBranch = params.defaultBranch?.trim() || 'main';
    const created: GitHubCreatedRepository = {
      owner: this.user.login,
      name,
      fullName: `${this.user.login}/${name}`,
      cloneUrl: `https://github.com/${this.user.login}/${name}.git`,
      htmlUrl: `https://github.com/${this.user.login}/${name}`,
      defaultBranch,
    };
    this.repos.unshift({
      owner: created.owner,
      name: created.name,
      fullName: created.fullName,
      private: params.private,
      defaultBranch: created.defaultBranch,
      description: params.description ?? null,
      cloneUrl: created.cloneUrl,
      sshUrl: `git@github.com:${created.fullName}.git`,
      htmlUrl: created.htmlUrl,
      pushedAt: new Date().toISOString(),
      permissionsPush: true,
    });
    this.branchesByRepo.set(created.fullName, [
      { name: defaultBranch, isDefault: true, protected: false, lastCommit: 'abc1234' },
    ]);
    return ok(created);
  }

  async beginDeviceAuth(
    params: GitHubDeviceAuthRequest,
  ): Promise<Result<GitHubDeviceAuthStart, Error>> {
    if (!params.clientId.trim()) return err(new Error('GitHub OAuth client ID is required'));
    return ok({
      deviceCode: 'memory-device-code',
      userCode: 'VOID-DEV',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
  }

  async completeDeviceAuth(
    _params: GitHubDeviceAuthCompleteParams,
  ): Promise<Result<GitHubTokenResult, Error>> {
    return ok({
      accessToken: 'memory-access-token',
      refreshToken: null,
      tokenType: 'bearer',
      scope: 'repo',
    });
  }

  async listRepositories(token: string): Promise<Result<GitHubRepoSummary[], Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    return ok(this.repos.map((repo) => ({ ...repo })));
  }

  async getRepository(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Result<GitHubRepoSummary, Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    const fullName = `${owner.trim()}/${repo.trim()}`;
    const found = this.repos.find((item) => item.fullName === fullName);
    if (!found) {
      return ok({
        owner: owner.trim(),
        name: repo.trim(),
        fullName,
        private: true,
        defaultBranch: 'main',
        description: null,
        cloneUrl: `https://github.com/${fullName}.git`,
        sshUrl: `git@github.com:${fullName}.git`,
        htmlUrl: `https://github.com/${fullName}`,
        pushedAt: null,
        permissionsPush: true,
      });
    }
    return ok({ ...found });
  }

  async getVoidReady(
    token: string,
    owner: string,
    repo: string,
    _ref?: string,
  ): Promise<Result<GitHubVoidReadyProbe, Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    const fullName = `${owner.trim()}/${repo.trim()}`;
    const manifest = this.manifestsByRepo.get(fullName) ?? null;
    return ok(manifest
      ? { ready: true, manifest: { ...manifest }, reason: null }
      : { ready: false, manifest: null, reason: 'Missing .void/repo.json' });
  }


  async listBranches(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Result<GitHubBranchSummary[], Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    const key = `${owner.trim()}/${repo.trim()}`;
    return ok((this.branchesByRepo.get(key) ?? []).map((branch) => ({ ...branch })));
  }

  async checkRepositoryName(
    token: string,
    name: string,
  ): Promise<Result<GitHubNameAvailability, Error>> {
    if (!token.trim()) return err(new Error('GitHub sign-in is required'));
    const trimmed = name.trim();
    if (!trimmed) return ok({ available: false, reason: 'Repository name cannot be empty' });
    const taken = this.repos.some((repo) => repo.name === trimmed);
    return ok(taken
      ? { available: false, reason: `@${this.user.login} already has a repository named '${trimmed}'` }
      : { available: true, reason: null });
  }

  async revokeToken(_clientId: string, token: string): Promise<Result<void, Error>> {
    if (token.trim()) this.revokedTokens.add(token.trim());
    return ok(undefined);
  }

  seedUser(user: GitHubUser): void {
    this.user = user;
  }

  seedRepositories(repos: GitHubRepoSummary[]): void {
    this.repos = repos.map((repo) => ({ ...repo }));
  }

  seedVoidManifest(fullName: string, manifest: VoidRepoManifest): void {
    this.manifestsByRepo.set(fullName, { ...manifest });
  }

  seedBranches(fullName: string, branches: GitHubBranchSummary[]): void {
    this.branchesByRepo.set(fullName, branches.map((branch) => ({ ...branch })));
  }
}
