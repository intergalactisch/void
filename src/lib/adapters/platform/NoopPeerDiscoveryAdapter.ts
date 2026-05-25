import { ok, type Result } from '$lib/core';
import type { PeerRemote } from '$lib/domain/values';
import type { PeerAdvertisement, PeerDiscoveryPort } from '$lib/ports/outbound';

export class NoopPeerDiscoveryAdapter implements PeerDiscoveryPort {
  async startAdvertising(_advertisement: PeerAdvertisement): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async stopAdvertising(): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async discover(): Promise<Result<PeerRemote[], Error>> {
    return ok([]);
  }

  subscribe(_callback: (peers: PeerRemote[]) => void): () => void {
    return () => undefined;
  }
}
