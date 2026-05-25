import { describe, expect, it } from 'vitest';
import { DeviceTrustServiceImpl } from '$lib/application/services';
import { MemoryDeviceTrustAdapter } from '$lib/adapters/memory';

describe('DeviceTrustServiceImpl', () => {
  it('trusts and revokes devices with per-device permissions', async () => {
    const service = new DeviceTrustServiceImpl(new MemoryDeviceTrustAdapter());

    const trusted = await service.trust({
      id: 'desktop-a',
      label: 'Studio Mac',
      kind: 'desktop',
      publicKey: 'pubkey',
      permissions: { canExecuteAI: true },
    });

    expect(trusted.ok).toBe(true);
    if (!trusted.ok) return;
    expect(trusted.value.permissions.canSync).toBe(true);
    expect(trusted.value.permissions.canExecuteAI).toBe(true);

    const revoked = await service.revoke('desktop-a');
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value?.status).toBe('revoked');
  });
});
