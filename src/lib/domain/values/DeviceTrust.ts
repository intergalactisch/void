export type TrustedDeviceKind = 'desktop' | 'ios' | 'android';
export type TrustedDeviceStatus = 'pending' | 'trusted' | 'revoked';

export interface TrustedDevicePermissions {
  canSync: boolean;
  canExecuteAI: boolean;
  canApproveProtectedContext: boolean;
}

export interface TrustedDevice {
  id: string;
  label: string;
  kind: TrustedDeviceKind;
  publicKey: string;
  status: TrustedDeviceStatus;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  permissions: TrustedDevicePermissions;
}

export interface PeerRemote {
  id: string;
  deviceId: string;
  label: string;
  reachable: boolean;
  lastSeenAt: string | null;
  transport: 'lan' | 'github' | 'manual';
}

export const DEFAULT_TRUSTED_DEVICE_PERMISSIONS: TrustedDevicePermissions = {
  canSync: true,
  canExecuteAI: false,
  canApproveProtectedContext: false,
};

export function createTrustedDevice(input: {
  id: string;
  label: string;
  kind: TrustedDeviceKind;
  publicKey: string;
  now?: string;
  permissions?: Partial<TrustedDevicePermissions>;
}): TrustedDevice {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id.trim(),
    label: input.label.trim() || 'Trusted device',
    kind: input.kind,
    publicKey: input.publicKey,
    status: 'trusted',
    pairedAt: now,
    lastSeenAt: null,
    revokedAt: null,
    permissions: {
      ...DEFAULT_TRUSTED_DEVICE_PERMISSIONS,
      ...input.permissions,
    },
  };
}
