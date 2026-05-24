import type { Result } from '$lib/core';

export interface KeyCustodyPort {
  getWorkspaceKey(workspaceId: string): Promise<Result<string | null, Error>>;
  storeWorkspaceKey(workspaceId: string, key: string): Promise<Result<void, Error>>;
  deleteWorkspaceKey(workspaceId: string): Promise<Result<void, Error>>;
  hasWorkspaceKey(workspaceId: string): Promise<boolean>;
}
