import type { TrustedDevice, TrustedDeviceKind, TrustedDevicePermissions } from '$lib/domain/values';
import type { DeviceTrustService } from '$lib/ports/inbound';
import { events } from '$lib/events';

class DeviceTrustStore {
  #service: DeviceTrustService | null = null;
  devices = $state<TrustedDevice[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(service: DeviceTrustService): void {
    this.#service = service;
    void this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    try {
      const result = await this.#service.list();
      if (!result.ok) {
        this.error = result.error;
        return false;
      }
      this.devices = result.value;
      return true;
    } finally {
      this.loading = false;
    }
  }

  async trust(input: {
    id: string;
    label: string;
    kind: TrustedDeviceKind;
    publicKey: string;
    permissions?: Partial<TrustedDevicePermissions>;
  }): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.#service.trust(input);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Device trust', error: result.error });
      return false;
    }
    await this.refresh();
    return true;
  }

  async revoke(deviceId: string): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.#service.revoke(deviceId);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'Device trust', error: result.error });
      return false;
    }
    await this.refresh();
    return true;
  }
}

export const deviceTrustStore = new DeviceTrustStore();
