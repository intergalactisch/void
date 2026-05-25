import { ok, type Result } from '$lib/core';
import type { PeerSyncBundle, PeerTransportPort } from '$lib/ports/outbound';

export class NoopPeerTransportAdapter implements PeerTransportPort {
  async sendBundle(_bundle: PeerSyncBundle): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async receiveBundles(_deviceId: string): Promise<Result<PeerSyncBundle[], Error>> {
    return ok([]);
  }
}
