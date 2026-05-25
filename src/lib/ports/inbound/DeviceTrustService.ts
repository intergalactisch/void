import type { Result } from '$lib/core';
import type { TrustedDevice, TrustedDeviceKind, TrustedDevicePermissions } from '$lib/domain/values';

export interface TrustDeviceInput {
  id: string;
  label: string;
  kind: TrustedDeviceKind;
  publicKey: string;
  permissions?: Partial<TrustedDevicePermissions>;
}

export interface DeviceTrustService {
  list(): Promise<Result<TrustedDevice[], Error>>;
  trust(input: TrustDeviceInput): Promise<Result<TrustedDevice, Error>>;
  revoke(deviceId: string): Promise<Result<TrustedDevice | null, Error>>;
}
