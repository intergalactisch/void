/**
 * GitHubPort - outbound port for GitHub API/auth operations.
 */

import type { Result } from '$lib/core';
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

export interface GitHubCreateRepositoryParams {
  name: string;
  private: boolean;
  description?: string;
  defaultBranch?: string;
}

export interface GitHubDeviceAuthCompleteParams {
  clientId: string;
  deviceCode: string;
}

export interface GitHubTokenResult {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string;
}

export interface GitHubPort {
  validateToken(token: string): Promise<Result<GitHubUser, Error>>;
  createRepository(token: string, params: GitHubCreateRepositoryParams): Promise<Result<GitHubCreatedRepository, Error>>;
  beginDeviceAuth(params: GitHubDeviceAuthRequest): Promise<Result<GitHubDeviceAuthStart, Error>>;
  completeDeviceAuth(params: GitHubDeviceAuthCompleteParams): Promise<Result<GitHubTokenResult, Error>>;
  listRepositories(token: string): Promise<Result<GitHubRepoSummary[], Error>>;
  getRepository(token: string, owner: string, repo: string): Promise<Result<GitHubRepoSummary, Error>>;
  getVoidReady(token: string, owner: string, repo: string, ref?: string): Promise<Result<GitHubVoidReadyProbe, Error>>;
  listBranches(token: string, owner: string, repo: string): Promise<Result<GitHubBranchSummary[], Error>>;
  checkRepositoryName(token: string, name: string): Promise<Result<GitHubNameAvailability, Error>>;
  revokeToken(clientId: string, token: string): Promise<Result<void, Error>>;
}
