/**
 * Credentials Store - Primary Adapter
 *
 * Thin reactive wrapper around CredentialService. Components in the
 * settings UI use this store to store/get/delete API keys without
 * resolving the container directly.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import type { CredentialService } from '$lib/ports/inbound';
import type { Result } from '$lib/core';

class CredentialsStore {
  #service: CredentialService | null = null;

  init(service: CredentialService): void {
    this.#service = service;
  }

  get ready(): boolean {
    return this.#service !== null;
  }

  async store(key: string, value: string): Promise<Result<void, Error>> {
    if (!this.#service) throw new Error('CredentialsStore not initialized');
    return this.#service.store(key, value);
  }

  async get(key: string): Promise<Result<string | null, Error>> {
    if (!this.#service) throw new Error('CredentialsStore not initialized');
    return this.#service.get(key);
  }

  async delete(key: string): Promise<Result<void, Error>> {
    if (!this.#service) throw new Error('CredentialsStore not initialized');
    return this.#service.delete(key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.#service) throw new Error('CredentialsStore not initialized');
    return this.#service.has(key);
  }
}

export const credentialsStore = new CredentialsStore();
