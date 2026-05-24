import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectionServiceImpl } from '$lib/application/services/ProtectionServiceImpl';
import { createAISelectionResource } from '$lib/domain/values/Protection';
import { events } from '$lib/events';
import type { ProtectionRuntime } from '$lib/application/services/ProtectionRuntime';
import type { DocumentPort, MarkdownSerializerPort } from '$lib/ports/outbound';
import type { NotesService } from '$lib/ports/inbound/NotesService';

function createService(): ProtectionServiceImpl {
  return new ProtectionServiceImpl(
    {} as unknown as ProtectionRuntime,
    {} as unknown as DocumentPort,
    {} as unknown as MarkdownSerializerPort,
    {} as unknown as NotesService,
    {
      idleLockMinutes: 15,
      lockOnAppClose: true,
      lockOnSleep: false,
      hideProtectedPreviews: true,
      requireAIApprovalForProtectedReads: true,
      requireAIApprovalForProtectedWrites: true,
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProtectionServiceImpl AI context authorizations', () => {
  it('lists, matches, and revokes resource-scoped approvals', async () => {
    const service = createService();
    const emit = vi.spyOn(events, 'emit');
    const selection = createAISelectionResource({
      notePath: 'secret.md',
      from: 2,
      to: 8,
      selectedText: 'secret',
    });

    const granted = await service.authorizeAIContext({
      noteIds: ['pnote_1'],
      scopes: ['selection.read', 'note.write'],
      providerTarget: 'local-agent',
      resources: [selection],
      durationMinutes: 15,
      reason: 'test',
    });

    expect(granted.ok).toBe(true);
    if (!granted.ok) throw granted.error;
    expect(service.listAIContextAuthorizations('pnote_1')).toHaveLength(1);
    expect(service.hasAIContextAuthorization('pnote_1', 'selection.read', selection)).toBe(true);
    expect(service.hasAIContextAuthorization('pnote_1', 'note.write', selection)).toBe(true);
    expect(service.hasAIContextAuthorization('pnote_1', 'note.write', 'secret.md')).toBe(false);
    expect(service.hasAIContextAuthorization('pnote_1', 'note.write')).toBe(false);

    service.revokeAIContext(granted.value.id);

    expect(service.listAIContextAuthorizations('pnote_1')).toHaveLength(0);
    expect(service.hasAIContextAuthorization('pnote_1', 'selection.read', selection)).toBe(false);
    expect(emit).toHaveBeenCalledWith('protection:ai-revoked', { authorizationId: granted.value.id });
  });

  it('lets note-level approvals cover selected text but not the reverse', async () => {
    const service = createService();
    const selection = createAISelectionResource({
      notePath: 'secret.md',
      from: 2,
      to: 8,
      selectedText: 'secret',
    });

    await service.authorizeAIContext({
      noteIds: ['pnote_1'],
      scopes: ['note.read', 'note.write'],
      providerTarget: 'local-agent',
      resources: ['secret.md'],
      durationMinutes: 15,
      reason: 'test',
    });

    expect(service.hasAIContextAuthorization('pnote_1', 'note.read', selection)).toBe(true);
    expect(service.hasAIContextAuthorization('pnote_1', 'note.write', selection)).toBe(true);
  });

  it('expires approvals when queried', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'));
    const service = createService();

    await service.authorizeAIContext({
      noteIds: ['pnote_1'],
      scopes: ['note.read'],
      providerTarget: 'local-agent',
      resources: ['secret.md'],
      durationMinutes: 1,
      reason: 'test',
    });

    expect(service.listAIContextAuthorizations('pnote_1')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-05-23T12:01:01Z'));

    expect(service.listAIContextAuthorizations('pnote_1')).toHaveLength(0);
    expect(service.hasAIContextAuthorization('pnote_1', 'note.read', 'secret.md')).toBe(false);
  });
});
