import { ok, type Result } from '$lib/core';
import type { TrustedDevice } from '$lib/domain/values';
import type { DeviceTrustPort } from '$lib/ports/outbound';

export class MemoryDeviceTrustAdapter implements DeviceTrustPort {
  private devices = new Map<string, TrustedDevice>();

  async list(): Promise<Result<TrustedDevice[], Error>> {
    return ok([...this.devices.values()].map(cloneDevice));
  }

  async get(deviceId: string): Promise<Result<TrustedDevice | null, Error>> {
    const device = this.devices.get(deviceId);
    return ok(device ? cloneDevice(device) : null);
  }

  async trust(device: TrustedDevice): Promise<Result<TrustedDevice, Error>> {
    this.devices.set(device.id, cloneDevice(device));
    return ok(cloneDevice(device));
  }

  async revoke(deviceId: string, revokedAt = new Date().toISOString()): Promise<Result<TrustedDevice | null, Error>> {
    const existing = this.devices.get(deviceId);
    if (!existing) return ok(null);
    const revoked: TrustedDevice = {
      ...existing,
      status: 'revoked',
      revokedAt,
    };
    this.devices.set(deviceId, revoked);
    return ok(cloneDevice(revoked));
  }
}

function cloneDevice(device: TrustedDevice): TrustedDevice {
  return {
    ...device,
    permissions: { ...device.permissions },
  };
}
