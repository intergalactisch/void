import { ok, type Result } from '$lib/core';
import type { PeerRemote } from '$lib/domain/values';
import type { PeerAdvertisement, PeerDiscoveryPort } from '$lib/ports/outbound';

export class MemoryPeerDiscoveryAdapter implements PeerDiscoveryPort {
  private peers: PeerRemote[] = [];
  private advertising: PeerAdvertisement | null = null;
  private subscribers = new Set<(peers: PeerRemote[]) => void>();

  async startAdvertising(advertisement: PeerAdvertisement): Promise<Result<void, Error>> {
    this.advertising = advertisement;
    return ok(undefined);
  }

  async stopAdvertising(): Promise<Result<void, Error>> {
    this.advertising = null;
    return ok(undefined);
  }

  async discover(): Promise<Result<PeerRemote[], Error>> {
    return ok(this.clonePeers());
  }

  subscribe(callback: (peers: PeerRemote[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.clonePeers());
    return () => this.subscribers.delete(callback);
  }

  seed(peers: PeerRemote[]): void {
    this.peers = peers.map((peer) => ({ ...peer }));
    const next = this.clonePeers();
    for (const callback of this.subscribers) callback(next);
  }

  currentAdvertisement(): PeerAdvertisement | null {
    return this.advertising ? { ...this.advertising, capabilities: [...this.advertising.capabilities] } : null;
  }

  private clonePeers(): PeerRemote[] {
    return this.peers.map((peer) => ({ ...peer }));
  }
}
