import { ok, type Result } from '$lib/core';
import type { PeerSyncBundle, PeerTransportPort } from '$lib/ports/outbound';

export class MemoryPeerTransportAdapter implements PeerTransportPort {
  private bundles: PeerSyncBundle[] = [];

  async sendBundle(bundle: PeerSyncBundle): Promise<Result<void, Error>> {
    this.bundles.push({ ...bundle });
    return ok(undefined);
  }

  async receiveBundles(deviceId: string): Promise<Result<PeerSyncBundle[], Error>> {
    return ok(this.bundles.filter((bundle) => bundle.toDeviceId === deviceId).map((bundle) => ({ ...bundle })));
  }
}
