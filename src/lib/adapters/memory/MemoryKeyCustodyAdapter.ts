import { ok, type Result } from '$lib/core';
import type { KeyCustodyPort } from '$lib/ports/outbound';

export class MemoryKeyCustodyAdapter implements KeyCustodyPort {
  private keys = new Map<string, string>();

  async getWorkspaceKey(workspaceId: string): Promise<Result<string | null, Error>> {
    return ok(this.keys.get(workspaceId) ?? null);
  }

  async storeWorkspaceKey(workspaceId: string, key: string): Promise<Result<void, Error>> {
    this.keys.set(workspaceId, key);
    return ok(undefined);
  }

  async deleteWorkspaceKey(workspaceId: string): Promise<Result<void, Error>> {
    this.keys.delete(workspaceId);
    return ok(undefined);
  }

  async hasWorkspaceKey(workspaceId: string): Promise<boolean> {
    return this.keys.has(workspaceId);
  }
}
