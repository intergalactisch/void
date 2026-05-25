import type { Result } from '$lib/core';
import type { TrustedDevice } from '$lib/domain/values';

export interface DeviceTrustPort {
  list(): Promise<Result<TrustedDevice[], Error>>;
  get(deviceId: string): Promise<Result<TrustedDevice | null, Error>>;
  trust(device: TrustedDevice): Promise<Result<TrustedDevice, Error>>;
  revoke(deviceId: string, revokedAt?: string): Promise<Result<TrustedDevice | null, Error>>;
}
