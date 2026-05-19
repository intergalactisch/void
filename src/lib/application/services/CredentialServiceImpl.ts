/**
 * CredentialServiceImpl - Application service for secure credential storage
 *
 * This is a use case implementation that orchestrates credential operations.
 * It depends ONLY on port interfaces, never on concrete adapters.
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { CredentialService } from '$lib/ports/inbound';
import type { CredentialPort } from '$lib/ports/outbound';
import type { Result } from '$lib/core';

export class CredentialServiceImpl implements CredentialService {
  constructor(private credentialStorage: CredentialPort) {}

  /**
   * Store a credential securely in the system keychain
   */
  async store(key: string, value: string): Promise<Result<void, Error>> {
    return this.credentialStorage.store(key, value);
  }

  /**
   * Retrieve a credential from the system keychain
   * Returns null if the credential does not exist
   */
  async get(key: string): Promise<Result<string | null, Error>> {
    return this.credentialStorage.get(key);
  }

  /**
   * Delete a credential from the system keychain
   */
  async delete(key: string): Promise<Result<void, Error>> {
    return this.credentialStorage.delete(key);
  }

  /**
   * Check if a credential exists in the system keychain
   */
  async has(key: string): Promise<boolean> {
    return this.credentialStorage.has(key);
  }
}
