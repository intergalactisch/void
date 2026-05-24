import type { ProtectionService, ProtectionStatus } from '$lib/ports/inbound/ProtectionService';
import type {
  AIContextAuthorization,
  AIContextAuthorizationScope,
  ProtectedNoteMeta,
} from '$lib/domain/values/Protection';
import { events } from '$lib/events';

class ProtectionStore {
  #service: ProtectionService | null = null;
  #cleanup: (() => void) | null = null;
  #authorizationTimer: ReturnType<typeof setInterval> | null = null;

  status = $state<ProtectionStatus | null>(null);
  authorizations = $state<AIContextAuthorization[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(service: ProtectionService) {
    this.#cleanup?.();
    if (this.#authorizationTimer) {
      clearInterval(this.#authorizationTimer);
      this.#authorizationTimer = null;
    }
    this.#service = service;
    const refresh = () => {
      void this.refresh();
    };
    const refreshAuthorizations = () => this.refreshAuthorizations();
    events.on('protection:changed', refresh);
    events.on('protection:ai-authorized', refreshAuthorizations);
    events.on('protection:ai-revoked', refreshAuthorizations);
    this.#authorizationTimer = setInterval(refreshAuthorizations, 30_000);
    this.#cleanup = () => {
      events.off('protection:changed', refresh);
      events.off('protection:ai-authorized', refreshAuthorizations);
      events.off('protection:ai-revoked', refreshAuthorizations);
      if (this.#authorizationTimer) {
        clearInterval(this.#authorizationTimer);
        this.#authorizationTimer = null;
      }
    };
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.#service) return;
    const result = await this.#service.status();
    if (result.ok) {
      this.status = result.value;
      this.error = null;
    } else {
      this.error = result.error;
    }
    this.refreshAuthorizations();
  }

  refreshAuthorizations(noteId?: string): void {
    if (!this.#service) {
      this.authorizations = [];
      return;
    }
    this.authorizations = this.#service.listAIContextAuthorizations(noteId);
  }

  async lock(): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    const result = await this.#service.lockWorkspace();
    this.loading = false;
    await this.refresh();
    if (!result.ok) this.error = result.error;
    return result.ok;
  }

  async unlock(passphrase?: string): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    const result = await this.#service.unlockWorkspace(passphrase);
    this.loading = false;
    await this.refresh();
    if (!result.ok) this.error = result.error;
    return result.ok;
  }

  async unlockWithRecoveryPrompt(): Promise<boolean> {
    const unlocked = await this.unlock();
    if (unlocked) return true;

    const message = this.error?.message ?? '';
    const needsRecovery = /recovery passphrase|workspace protection key|recovery material/i.test(message);
    if (!needsRecovery || typeof window === 'undefined') return false;

    const passphrase = window.prompt('Enter the recovery passphrase for this Void workspace');
    if (!passphrase) return false;
    return this.unlock(passphrase);
  }

  async setupRecovery(passphrase: string): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.#service.setupRecovery(passphrase);
    await this.refresh();
    if (!result.ok) this.error = result.error;
    return result.ok;
  }

  async protectNote(path: string): Promise<ProtectedNoteMeta | null> {
    if (!this.#service) return null;
    this.loading = true;
    const result = await this.#service.protectNote(path);
    this.loading = false;
    await this.refresh();
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    return result.value;
  }

  async unprotectNote(path: string): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    const result = await this.#service.unprotectNote(path);
    this.loading = false;
    await this.refresh();
    if (!result.ok) this.error = result.error;
    return result.ok;
  }

  async authorizeContext(
    note: ProtectedNoteMeta,
    path: string,
    options: {
      scopes?: AIContextAuthorizationScope[];
      providerTarget?: AIContextAuthorization['providerTarget'];
      resources?: string[];
      durationMinutes?: number;
      reason?: string;
    } = {},
  ): Promise<AIContextAuthorization | null> {
    if (!this.#service) return null;
    const result = await this.#service.authorizeAIContext({
      noteIds: [note.noteId],
      scopes: options.scopes ?? ['note.read'],
      providerTarget: options.providerTarget ?? 'local-agent',
      resources: options.resources ?? [path],
      durationMinutes: options.durationMinutes ?? 30,
      reason: options.reason ?? 'Approved from protected note editor',
    });
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    this.refreshAuthorizations();
    return result.value;
  }

  async authorizeCurrentNote(note: ProtectedNoteMeta, path: string): Promise<AIContextAuthorization | null> {
    return this.authorizeContext(note, path);
  }

  revokeContext(authorizationId: string): void {
    this.#service?.revokeAIContext(authorizationId);
    this.refreshAuthorizations();
  }

  hasAuthorization(noteId: string, scope: AIContextAuthorizationScope, resource?: string): boolean {
    return this.#service?.hasAIContextAuthorization(noteId, scope, resource) ?? false;
  }
}

export const protectionStore = new ProtectionStore();
