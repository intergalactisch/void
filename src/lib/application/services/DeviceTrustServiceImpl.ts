import { err, ok, type Result } from '$lib/core';
import { createTrustedDevice, type TrustedDevice } from '$lib/domain/values';
import type { DeviceTrustService, TrustDeviceInput } from '$lib/ports/inbound';
import type { DeviceTrustPort } from '$lib/ports/outbound';

export class DeviceTrustServiceImpl implements DeviceTrustService {
  constructor(private readonly devices: DeviceTrustPort) {}

  list(): Promise<Result<TrustedDevice[], Error>> {
    return this.devices.list();
  }

  trust(input: TrustDeviceInput): Promise<Result<TrustedDevice, Error>> {
    const device = createTrustedDevice({
      id: input.id,
      label: input.label,
      kind: input.kind,
      publicKey: input.publicKey,
      ...(input.permissions ? { permissions: input.permissions } : {}),
    });
    if (!device.id) return Promise.resolve(err(new Error('Trusted device id is required')));
    if (!device.publicKey) return Promise.resolve(err(new Error('Trusted device public key is required')));
    return this.devices.trust(device);
  }

  async revoke(deviceId: string): Promise<Result<TrustedDevice | null, Error>> {
    const trimmed = deviceId.trim();
    if (!trimmed) return err(new Error('Trusted device id is required'));
    return this.devices.revoke(trimmed);
  }
}
