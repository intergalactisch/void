import type { Result } from '$lib/core';

export interface FolderAccessGrant {
  workspaceId: string;
  path: string;
  bookmarkData: string;
  grantedAt: string;
  stale?: boolean;
}

export interface FolderAccessStatus {
  workspaceId: string;
  notesPath: string;
  state: 'available' | 'reconnect_required' | 'unsupported' | 'error';
  message?: string;
  grant?: FolderAccessGrant;
}

export interface FolderAccessPort {
  checkAccess(workspaceId: string, notesPath: string): Promise<Result<FolderAccessStatus, Error>>;
  requestAccess(workspaceId: string, suggestedPath: string): Promise<Result<FolderAccessGrant, Error>>;
  withAccess<T>(
    workspaceId: string,
    path: string,
    operation: () => Promise<Result<T, Error>>,
  ): Promise<Result<T, Error>>;
  forgetAccess(workspaceId: string): Promise<Result<void, Error>>;
}
