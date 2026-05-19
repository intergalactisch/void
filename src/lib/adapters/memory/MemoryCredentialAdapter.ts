/**
 * MemoryCredentialAdapter - In-memory implementation of CredentialPort
 *
 * This adapter stores credentials in memory, enabling testing without Tauri.
 * Part of the Hexagonal Architecture - implements the CredentialPort interface.
 *
 * WARNING: This adapter is for testing only. In production, credentials
 * should be stored securely using the TauriCredentialAdapter (macOS Keychain).
 *
 * Use Cases:
 * - Unit testing services that depend on CredentialPort
 * - Browser-only development mode
 * - Storybook component development
 */

import { ok, type Result } from '$lib/core';
import type { CredentialPort } from '$lib/ports/outbound';

export class MemoryCredentialAdapter implements CredentialPort {
  private credentials = new Map<string, string>();

  async store(service: string, credential: string): Promise<Result<void, Error>> {
    this.credentials.set(service, credential);
    return ok(undefined);
  }

  async get(service: string): Promise<Result<string | null, Error>> {
    const credential = this.credentials.get(service);
    return ok(credential ?? null);
  }

  async delete(service: string): Promise<Result<void, Error>> {
    this.credentials.delete(service);
    return ok(undefined);
  }

  async has(service: string): Promise<boolean> {
    return this.credentials.has(service);
  }

  // --- Testing utilities ---

  /**
   * Seed credentials for testing.
   * @param credentials - Record of service to credential value
   */
  seed(credentials: Record<string, string>): void {
    for (const [service, credential] of Object.entries(credentials)) {
      this.credentials.set(service, credential);
    }
  }

  /**
   * Clear all stored credentials.
   */
  clear(): void {
    this.credentials.clear();
  }

  /**
   * Get all stored services (for testing assertions).
   */
  getServices(): string[] {
    return Array.from(this.credentials.keys());
  }

  /**
   * Get the count of stored credentials.
   */
  count(): number {
    return this.credentials.size;
  }
}
