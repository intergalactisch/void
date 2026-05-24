import { describe, expect, it, vi } from 'vitest';
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
  return runtimeWithKeyCustody(new MemoryKeyCustodyAdapter());
}

function runtimeWithKeyCustody(keyCustody: MemoryKeyCustodyAdapter) {
  return new ProtectionRuntime(
    new MemoryCryptoAdapter(),
    keyCustody,
    new MemoryVoidStorageAdapter(),
    '/notes',
    'workspace-1',
  );
}

describe('ProtectionRuntime', () => {
  it('reports startup status without reading the workspace key', async () => {
    const keyCustody = new MemoryKeyCustodyAdapter();
    const getWorkspaceKey = vi.spyOn(keyCustody, 'getWorkspaceKey');
    const hasWorkspaceKey = vi.spyOn(keyCustody, 'hasWorkspaceKey');
    const protection = runtimeWithKeyCustody(keyCustody);

    const status = await protection.status();

    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.keychainState).toBe('not_checked');
    expect(getWorkspaceKey).not.toHaveBeenCalled();
    expect(hasWorkspaceKey).not.toHaveBeenCalled();
  });

  it('coalesces concurrent unlocks into one key lookup', async () => {
    const keyCustody = new MemoryKeyCustodyAdapter();
    const protection = runtimeWithKeyCustody(keyCustody);
    await protection.setupRecovery('correct horse battery staple');
    await protection.lockWorkspace();
    const getWorkspaceKey = vi.spyOn(keyCustody, 'getWorkspaceKey');

    const [first, second] = await Promise.all([
      protection.unlockWorkspace(),
      protection.unlockWorkspace(),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(getWorkspaceKey).toHaveBeenCalledTimes(1);
  });

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

  it('encrypts line capsules, prepares unlocked plaintext in memory, and seals it again for disk', async () => {
    const protection = runtime();
    await protection.setupRecovery('correct horse battery staple');

    const capsule = await protection.encryptProtectedBlock('API_KEY=sk_test_abcdefghijklmnopqrstuvwxyz\nregion=eu', 2);
    expect(capsule.ok).toBe(true);
    if (!capsule.ok) return;
    expect(capsule.value).toContain('```void-protected-lines-v1');
    expect(capsule.value).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz');

    await protection.lockWorkspace();
    const locked = await protection.prepareMarkdownForLoad(capsule.value);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.value).toContain('"lockState": "locked"');
    expect(locked.value).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz');

    await protection.unlockWorkspace();
    const unlocked = await protection.prepareMarkdownForLoad(capsule.value);
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(unlocked.value).toContain('sk_test_abcdefghijklmnopqrstuvwxyz');

    const sealed = await protection.sealMarkdownForSave(unlocked.value);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(sealed.value).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz');

    const reopened = await protection.prepareMarkdownForLoad(sealed.value);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toContain('API_KEY=sk_test_abcdefghijklmnopqrstuvwxyz');
  });

  it('recovers malformed inline line capsules produced by the editor insertion bug', async () => {
    const protection = runtime();
    await protection.setupRecovery('correct horse battery staple');

    const capsule = await protection.encryptProtectedBlock('API_KEY=sk_test_recovered', 1);
    expect(capsule.ok).toBe(true);
    if (!capsule.ok) return;

    const malformed = capsule.value.replace(
      '\n\n```void-protected-lines-v1',
      ' ```void-protected-lines-v1',
    );
    expect(malformed).toContain('Open in Void to unlock. ```void-protected-lines-v1');

    await protection.unlockWorkspace();
    const prepared = await protection.prepareMarkdownForLoad(malformed);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value).toContain('API_KEY=sk_test_recovered');

    const sealed = await protection.sealMarkdownForSave(prepared.value);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(sealed.value).not.toContain('API_KEY=sk_test_recovered');
    expect(sealed.value).toContain('```void-protected-lines-v1');
    expect(sealed.value).not.toContain('Open in Void to unlock. ```void-protected-lines-v1');
  });
});
