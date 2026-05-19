/**
 * TauriCredentialAdapter - Secondary adapter for secure credential storage
 *
 * Implements CredentialPort using Tauri's credential commands (backed by keyring).
 * Part of the Hexagonal Architecture - this adapter translates between
 * the domain's CredentialPort interface and the system keychain via Tauri.
 *
 * On macOS, credentials are stored in the system Keychain.
 * On Windows, credentials are stored in Windows Credential Manager.
 * On Linux, credentials are stored via the Secret Service API.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { CredentialPort } from '$lib/ports/outbound';
import { credentialCommands } from './commands';

export class TauriCredentialAdapter implements CredentialPort {
  /**
   * Store a credential securely in the system keychain
   */
  async store(service: string, credential: string): Promise<Result<void, Error>> {
    try {
      await credentialCommands.storeCredential(service, credential);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Retrieve a credential from the system keychain
   * Returns null if not found
   */
  async get(service: string): Promise<Result<string | null, Error>> {
    try {
      const credential = await credentialCommands.getCredential(service);
      return ok(credential);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Delete a credential from the system keychain
   */
  async delete(service: string): Promise<Result<void, Error>> {
    try {
      await credentialCommands.deleteCredential(service);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Check if a credential exists in the system keychain
   */
  async has(service: string): Promise<boolean> {
    try {
      return await credentialCommands.hasCredential(service);
    } catch {
      // If the check itself fails, assume the credential doesn't exist
      return false;
    }
  }
}
