import { describe, expect, it } from 'vitest';
import { MemoryCryptoAdapter, MemoryKeyCustodyAdapter, MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { ProtectionRuntime } from '$lib/application/services/ProtectionRuntime';
import type { DocumentMeta } from '$lib/domain';

function meta(title = 'Secrets'): DocumentMeta {
  return {
    id: 'doc-1',
    title,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    tags: [],
    category: null,
    color: null,
    pinned: false,
    status: 'draft',
    intent: 'general',
    aiTouches: 0,
    custom: {},
  };
}

function runtime() {
  return new ProtectionRuntime(
    new MemoryCryptoAdapter(),
    new MemoryKeyCustodyAdapter(),
    new MemoryVoidStorageAdapter(),
    '/notes',
    'workspace-1',
  );
}

describe('ProtectionRuntime', () => {
  it('encrypts protected markdown and decrypts only while unlocked', async () => {
    const protection = runtime();
    const recovery = await protection.setupRecovery('correct horse battery staple');
    expect(recovery.ok).toBe(true);

    const protectedMeta = await protection.createProtectedMeta('secret.md', meta());
    expect(protectedMeta.ok).toBe(true);
    if (!protectedMeta.ok) return;

    const encrypted = await protection.encryptDocument(
      'secret.md',
      { ...meta(), protection: protectedMeta.value },
      'API_KEY=sk_test_abcdefghijklmnopqrstuvwxyz',
    );
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;
    expect(encrypted.value.envelopeMarkdown).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz');
    expect(encrypted.value.envelopeMarkdown).toContain('This note is encrypted by Void');
    expect(encrypted.value.envelopeMarkdown).toContain('```void-protected-note-v2');

    await protection.lockWorkspace();
    const locked = await protection.decryptDocument(
      'secret.md',
      encrypted.value.meta,
      encrypted.value.envelopeMarkdown,
    );
    expect(locked.ok).toBe(false);

    const unlocked = await protection.unlockWorkspace();
    expect(unlocked.ok).toBe(true);
    const decrypted = await protection.decryptDocument(
      'secret.md',
      encrypted.value.meta,
      encrypted.value.envelopeMarkdown,
    );
    expect(decrypted).toEqual({ ok: true, value: 'API_KEY=sk_test_abcdefghijklmnopqrstuvwxyz' });
  });

  it('keeps v2 protected notes decryptable after external rename', async () => {
    const protection = runtime();
    await protection.setupRecovery('correct horse battery staple');

    const protectedMeta = await protection.createProtectedMeta('secret.md', meta());
    expect(protectedMeta.ok).toBe(true);
    if (!protectedMeta.ok) return;

    const encrypted = await protection.encryptDocument(
      'secret.md',
      { ...meta(), protection: protectedMeta.value },
      'top secret',
    );
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const renamed = await protection.decryptDocument(
      'renamed.md',
      encrypted.value.meta,
      encrypted.value.envelopeMarkdown,
    );
    expect(renamed).toEqual({ ok: true, value: 'top secret' });
  });
});
