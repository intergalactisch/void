/**
 * CredentialPort - Outbound port for secure credential storage.
 *
 * This interface defines the contract for storing and retrieving credentials
 * securely (e.g., API keys). On macOS, this uses the system keychain.
 * Part of the Hexagonal Architecture - adapters implement this interface.
 *
 * Implementations:
 * - TauriCredentialAdapter: Uses macOS Keychain via keyring crate
 * - MemoryCredentialAdapter: In-memory for testing
 */

import type { Result } from '$lib/core';

export interface CredentialPort {
  /**
   * Store a credential securely
   * @param service - Service identifier (e.g., "void.claude.api_key")
   * @param credential - The credential value to store
   * @returns Success or error if storage fails
   */
  store(service: string, credential: string): Promise<Result<void, Error>>;

  /**
   * Retrieve a stored credential
   * @param service - Service identifier
   * @returns The credential value, null if not found, or error if retrieval fails
   */
  get(service: string): Promise<Result<string | null, Error>>;

  /**
   * Delete a stored credential
   * @param service - Service identifier
   * @returns Success or error if deletion fails
   */
  delete(service: string): Promise<Result<void, Error>>;

  /**
   * Check if a credential exists
   * @param service - Service identifier
   * @returns True if credential exists, false otherwise
   */
  has(service: string): Promise<boolean>;
}
