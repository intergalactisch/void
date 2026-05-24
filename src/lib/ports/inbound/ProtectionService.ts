import type { Result } from '$lib/core';
import type {
  AIContextAuthorization,
  AIContextAuthorizationScope,
  LegacyAIContextAuthorizationScope,
  LockState,
  ProtectedNoteMeta,
  ProtectionPolicy,
} from '$lib/domain/values/Protection';

export interface ProtectionStatus {
  workspaceId: string;
  lockState: LockState;
  keychainState:
    | 'not_checked'
    | 'available_this_session'
    | 'missing_after_unlock_attempt'
    | 'error_after_unlock_attempt';
  recoveryConfigured: boolean;
}

export interface AIContextAuthorizationRequest {
  noteIds: string[];
  scopes: AIContextAuthorizationScope[];
  providerTarget: AIContextAuthorization['providerTarget'];
  resources: string[];
  durationMinutes: number;
  reason: string;
}

export interface ProtectionService {
  status(): Promise<Result<ProtectionStatus, Error>>;
  lockWorkspace(): Promise<Result<void, Error>>;
  unlockWorkspace(passphrase?: string): Promise<Result<void, Error>>;
  setupRecovery(passphrase: string): Promise<Result<void, Error>>;
  protectBlock(markdown: string, lineCount: number): Promise<Result<string, Error>>;
  protectNote(path: string): Promise<Result<ProtectedNoteMeta, Error>>;
  unprotectNote(path: string): Promise<Result<void, Error>>;
  authorizeAIContext(request: AIContextAuthorizationRequest): Promise<Result<AIContextAuthorization, Error>>;
  listAIContextAuthorizations(noteId?: string): AIContextAuthorization[];
  revokeAIContext(authorizationId: string): void;
  hasAIContextAuthorization(
    noteId: string,
    scope: AIContextAuthorizationScope | LegacyAIContextAuthorizationScope,
    resource?: string,
  ): boolean;
  currentPolicy(): ProtectionPolicy;
}
