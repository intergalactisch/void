import type { DocumentService, ProtectionService } from '$lib/ports/inbound';
import type { AIContextAuthorizationScope } from '$lib/domain/values/Protection';

export interface AIPrivacyGateServices {
  documents: DocumentService;
  protection: ProtectionService;
}

export async function assertProtectedAIReadAllowed(
  services: AIPrivacyGateServices,
  path: string,
  scope: AIContextAuthorizationScope = 'note.read',
  resource?: string,
): Promise<void> {
  if (!path) return;
  const meta = await services.documents.readMeta(path);
  if (!meta.ok) return;

  const protection = meta.value.protection;
  if (!protection || protection.level !== 'protected') return;
  if (protection.lockState === 'locked') {
    throw new Error(`Protected note "${meta.value.title}" is locked. Unlock the vault first.`);
  }

  const policy = services.protection.currentPolicy();
  if (!policy.requireAIApprovalForProtectedReads) return;
  if (
    services.protection.hasAIContextAuthorization(protection.noteId, scope, resource ?? path) ||
    (scope === 'selection.read' && services.protection.hasAIContextAuthorization(protection.noteId, 'note.read', path))
  ) {
    return;
  }

  if (scope === 'selection.read') {
    throw new Error(`Grant AI access to this highlighted text before using inline Ask.`);
  }
  throw new Error(`Protected note "${meta.value.title}" requires explicit AI access approval.`);
}

export async function assertProtectedAIWriteAllowed(
  services: AIPrivacyGateServices,
  path: string,
  resource?: string,
): Promise<void> {
  if (!path) return;
  const meta = await services.documents.readMeta(path);
  if (!meta.ok) return;

  const protection = meta.value.protection;
  if (!protection || protection.level !== 'protected') return;
  if (protection.lockState === 'locked') {
    throw new Error(`Protected note "${meta.value.title}" is locked. Unlock the vault first.`);
  }

  const policy = services.protection.currentPolicy();
  if (!policy.requireAIApprovalForProtectedWrites) return;
  if (services.protection.hasAIContextAuthorization(protection.noteId, 'note.write', resource ?? path)) return;

  throw new Error(`Protected note "${meta.value.title}" requires explicit AI write approval.`);
}
