import { err, ok, type Result } from '$lib/core';
import type { TrustedDevice } from '$lib/domain/values';
import type { DeviceTrustPort, VoidStoragePort } from '$lib/ports/outbound';

const DEVICES_PATH = 'devices/trusted.json';

export class VoidDeviceTrustAdapter implements DeviceTrustPort {
  constructor(
    private readonly storage: VoidStoragePort,
    private readonly notesPath: string,
  ) {}

  async list(): Promise<Result<TrustedDevice[], Error>> {
    return this.readAll();
  }

  async get(deviceId: string): Promise<Result<TrustedDevice | null, Error>> {
    const devices = await this.readAll();
    if (!devices.ok) return err(devices.error);
    return ok(devices.value.find((device) => device.id === deviceId) ?? null);
  }

  async trust(device: TrustedDevice): Promise<Result<TrustedDevice, Error>> {
    const devices = await this.readAll();
    if (!devices.ok) return err(devices.error);
    const next = [
      ...devices.value.filter((existing) => existing.id !== device.id),
      device,
    ];
    const saved = await this.writeAll(next);
    if (!saved.ok) return err(saved.error);
    return ok(device);
  }

  async revoke(deviceId: string, revokedAt = new Date().toISOString()): Promise<Result<TrustedDevice | null, Error>> {
    const devices = await this.readAll();
    if (!devices.ok) return err(devices.error);
    let revoked: TrustedDevice | null = null;
    const next = devices.value.map((device) => {
      if (device.id !== deviceId) return device;
      revoked = { ...device, status: 'revoked', revokedAt };
      return revoked;
    });
    if (!revoked) return ok(null);
    const saved = await this.writeAll(next);
    if (!saved.ok) return err(saved.error);
    return ok(revoked);
  }

  private async readAll(): Promise<Result<TrustedDevice[], Error>> {
    const result = await this.storage.readJson<TrustedDevice[]>(this.notesPath, DEVICES_PATH);
    if (!result.ok) return err(result.error);
    return ok(Array.isArray(result.value) ? result.value : []);
  }

  private writeAll(devices: TrustedDevice[]): Promise<Result<void, Error>> {
    return this.storage.writeJson(this.notesPath, DEVICES_PATH, devices);
  }
}
