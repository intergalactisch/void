import { ok, type Result } from '$lib/core';
import type {
  FolderAccessGrant,
  FolderAccessPort,
  FolderAccessStatus,
} from '$lib/ports/outbound';

export class MemoryFolderAccessAdapter implements FolderAccessPort {
  private readonly grants = new Map<string, FolderAccessGrant>();

  async checkAccess(workspaceId: string, notesPath: string): Promise<Result<FolderAccessStatus, Error>> {
    const grant = this.grants.get(workspaceId);
    return ok({
      workspaceId,
      notesPath,
      state: 'available',
      ...(grant ? { grant } : {}),
    });
  }

  async requestAccess(workspaceId: string, suggestedPath: string): Promise<Result<FolderAccessGrant, Error>> {
    const grant: FolderAccessGrant = {
      workspaceId,
      path: suggestedPath,
      bookmarkData: '',
      grantedAt: new Date().toISOString(),
    };
    this.grants.set(workspaceId, grant);
    return ok(grant);
  }

  async withAccess<T>(
    _workspaceId: string,
    _path: string,
    operation: () => Promise<Result<T, Error>>,
  ): Promise<Result<T, Error>> {
    return operation();
  }

  async forgetAccess(workspaceId: string): Promise<Result<void, Error>> {
    this.grants.delete(workspaceId);
    return ok(undefined);
  }
}
