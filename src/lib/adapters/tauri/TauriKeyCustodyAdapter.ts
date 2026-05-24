import type { CredentialPort, KeyCustodyPort } from '$lib/ports/outbound';
import type { Result } from '$lib/core';

const KEYCHAIN_PREFIX = 'protection:workspace:';

export class TauriKeyCustodyAdapter implements KeyCustodyPort {
  constructor(private readonly credentials: CredentialPort) {}

  getWorkspaceKey(workspaceId: string): Promise<Result<string | null, Error>> {
    return this.credentials.get(this.key(workspaceId));
  }

  storeWorkspaceKey(workspaceId: string, key: string): Promise<Result<void, Error>> {
    return this.credentials.store(this.key(workspaceId), key);
  }

  deleteWorkspaceKey(workspaceId: string): Promise<Result<void, Error>> {
    return this.credentials.delete(this.key(workspaceId));
  }

  hasWorkspaceKey(workspaceId: string): Promise<boolean> {
    return this.credentials.has(this.key(workspaceId));
  }

  private key(workspaceId: string): string {
    return `${KEYCHAIN_PREFIX}${workspaceId}`;
  }
}
