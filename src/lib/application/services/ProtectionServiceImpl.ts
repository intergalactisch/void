import { err, ok, type Result } from '$lib/core';
import type { ProtectionService, AIContextAuthorizationRequest, ProtectionStatus } from '$lib/ports/inbound/ProtectionService';
import type { DocumentPort, MarkdownSerializerPort } from '$lib/ports/outbound';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import {
  authorizationResourceMatches,
  isAISelectionResource,
  normalizeAIContextAuthorizationScope,
  type AIContextAuthorization,
  type AIContextAuthorizationScope,
  type LegacyAIContextAuthorizationScope,
  type ProtectedNoteMeta,
  type ProtectionPolicy,
} from '$lib/domain/values/Protection';
import { stripProtectionCustom } from '$lib/domain/values/Protection';
import { ProtectionRuntime } from './ProtectionRuntime';
import { events } from '$lib/events';

export class ProtectionServiceImpl implements ProtectionService {
  private readonly authorizations = new Map<string, AIContextAuthorization>();

  constructor(
    private readonly runtime: ProtectionRuntime,
    private readonly documentPort: DocumentPort,
    private readonly markdown: MarkdownSerializerPort,
    private readonly notes: NotesService,
    private readonly policy: ProtectionPolicy | (() => ProtectionPolicy),
  ) {}

  status(): Promise<Result<ProtectionStatus, Error>> {
    return this.runtime.status();
  }

  async lockWorkspace(): Promise<Result<void, Error>> {
    const result = await this.runtime.lockWorkspace();
    if (result.ok) {
      this.authorizations.clear();
      events.emit('protection:changed', { lockState: 'locked' });
    }
    return result;
  }

  async unlockWorkspace(passphrase?: string): Promise<Result<void, Error>> {
    const result = await this.runtime.unlockWorkspace(passphrase);
    if (result.ok) {
      events.emit('protection:changed', { lockState: 'unlocked' });
    }
    return result;
  }

  setupRecovery(passphrase: string): Promise<Result<void, Error>> {
    return this.runtime.setupRecovery(passphrase);
  }

  protectBlock(markdown: string, lineCount: number): Promise<Result<string, Error>> {
    return this.runtime.encryptProtectedBlock(markdown, lineCount);
  }

  async protectNote(path: string): Promise<Result<ProtectedNoteMeta, Error>> {
    const loaded = await this.documentPort.load(path);
    if (!loaded.ok) return err(loaded.error);

    const protection = await this.runtime.createProtectedMeta(path, loaded.value.meta);
    if (!protection.ok) return err(protection.error);

    const document = {
      ...loaded.value,
      meta: {
        ...loaded.value.meta,
        protection: protection.value,
      },
    };
    const saved = await this.documentPort.save(document);
    if (!saved.ok) return err(saved.error);

    await this.notes.refresh();
    events.emit('document:saved', { path });
    events.emit('protection:changed', { path, lockState: 'unlocked' });
    return ok(protection.value);
  }

  async unprotectNote(path: string): Promise<Result<void, Error>> {
    const loaded = await this.documentPort.load(path);
    if (!loaded.ok) return err(loaded.error);
    if (loaded.value.meta.protection?.lockState === 'locked') {
      return err(new Error('Unlock this protected note before removing protection.'));
    }

    const markdown = this.markdown.serializeBlocks(loaded.value.blocks);
    loaded.value.blocks = this.markdown.parseToBlocks(markdown);
    loaded.value.meta = {
      ...loaded.value.meta,
      protection: null,
      custom: stripProtectionCustom(loaded.value.meta.custom),
    };

    const saved = await this.documentPort.save(loaded.value);
    if (!saved.ok) return err(saved.error);

    await this.notes.refresh();
    events.emit('document:saved', { path });
    events.emit('protection:changed', { path, lockState: 'unprotected' });
    return ok(undefined);
  }

  async authorizeAIContext(
    request: AIContextAuthorizationRequest,
  ): Promise<Result<AIContextAuthorization, Error>> {
    const duration = Math.max(1, Math.min(Math.round(request.durationMinutes), 240));
    const now = new Date();
    const authorization: AIContextAuthorization = {
      id: `auth_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      noteIds: [...new Set(request.noteIds)],
      scopes: [...new Set(request.scopes.map(normalizeAIContextAuthorizationScope))],
      providerTarget: request.providerTarget,
      resources: [...new Set(request.resources)],
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + duration * 60_000).toISOString(),
      reason: request.reason,
    };
    this.authorizations.set(authorization.id, authorization);
    events.emit('protection:ai-authorized', { authorization });
    return ok(authorization);
  }

  revokeAIContext(authorizationId: string): void {
    if (this.authorizations.delete(authorizationId)) {
      events.emit('protection:ai-revoked', { authorizationId });
    }
  }

  listAIContextAuthorizations(noteId?: string): AIContextAuthorization[] {
    this.pruneExpiredAuthorizations();
    return [...this.authorizations.values()]
      .filter((authorization) => !noteId || authorization.noteIds.includes(noteId));
  }

  hasAIContextAuthorization(
    noteId: string,
    scope: AIContextAuthorizationScope | LegacyAIContextAuthorizationScope,
    resource?: string,
  ): boolean {
    const normalizedScope = normalizeAIContextAuthorizationScope(scope);
    this.pruneExpiredAuthorizations();
    for (const authorization of this.authorizations.values()) {
      if (authorization.noteIds.includes(noteId) && authorization.scopes.includes(normalizedScope)) {
        if (this.authorizationCoversResource(authorization, resource)) return true;
      }
    }
    return false;
  }

  currentPolicy(): ProtectionPolicy {
    return typeof this.policy === 'function' ? this.policy() : this.policy;
  }

  private pruneExpiredAuthorizations(): void {
    const now = Date.now();
    for (const authorization of this.authorizations.values()) {
      if (new Date(authorization.expiresAt).getTime() <= now) {
        this.authorizations.delete(authorization.id);
        events.emit('protection:ai-revoked', { authorizationId: authorization.id });
      }
    }
  }

  private authorizationCoversResource(
    authorization: AIContextAuthorization,
    resource: string | undefined,
  ): boolean {
    if (!resource) {
      return authorization.resources.length === 0
        || authorization.resources.some((candidate) => !isAISelectionResource(candidate));
    }
    if (authorization.resources.length === 0) return true;
    return authorization.resources.some((candidate) => authorizationResourceMatches(candidate, resource));
  }
}
