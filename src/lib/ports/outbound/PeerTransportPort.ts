import type { Result } from '$lib/core';

export interface PeerSyncBundle {
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  createdAt: string;
  encrypted: true;
  payload: string;
}

export interface PeerTransportPort {
  sendBundle(bundle: PeerSyncBundle): Promise<Result<void, Error>>;
  receiveBundles(deviceId: string): Promise<Result<PeerSyncBundle[], Error>>;
}
