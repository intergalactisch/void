import type { Result } from '$lib/core';
import type { PeerRemote } from '$lib/domain/values';

export interface PeerAdvertisement {
  deviceId: string;
  label: string;
  publicKey: string;
  capabilities: string[];
}

export interface PeerDiscoveryPort {
  startAdvertising(advertisement: PeerAdvertisement): Promise<Result<void, Error>>;
  stopAdvertising(): Promise<Result<void, Error>>;
  discover(): Promise<Result<PeerRemote[], Error>>;
  subscribe(callback: (peers: PeerRemote[]) => void): () => void;
}
