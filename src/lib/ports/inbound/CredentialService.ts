/**
 * Credential Service - Inbound Port
 *
 * This interface defines the application API for secure credential storage.
 * Uses the system keychain (macOS Keychain, Windows Credential Manager, etc.)
 *
 * Part of Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';

/**
 * Pre-defined credential keys for the application.
 * Use these constants instead of raw strings.
 */
export const CREDENTIAL_KEYS = {
  CLAUDE_API_KEY: 'void.claude.api_key',
  OPENAI_API_KEY: 'void.openai.api_key',
} as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[keyof typeof CREDENTIAL_KEYS];

/**
 * Maps AI provider identifiers to their credential storage keys.
 */
export const PROVIDER_CREDENTIAL_MAP: Record<string, CredentialKey> = {
  claude: CREDENTIAL_KEYS.CLAUDE_API_KEY,
  openai: CREDENTIAL_KEYS.OPENAI_API_KEY,
};

/**
 * Get the credential key for a given AI provider.
 * Returns null if the provider doesn't require an API key (e.g. local, null).
 */
export function getCredentialKeyForProvider(provider: string | null): CredentialKey | null {
  if (!provider) return null;
  return PROVIDER_CREDENTIAL_MAP[provider] ?? null;
}

export interface CredentialService {
  /**
   * Store a credential securely in the system keychain
   */
  store(key: string, value: string): Promise<Result<void, Error>>;

  /**
   * Retrieve a credential from the system keychain
   * Returns null if the credential does not exist
   */
  get(key: string): Promise<Result<string | null, Error>>;

  /**
   * Delete a credential from the system keychain
   */
  delete(key: string): Promise<Result<void, Error>>;

  /**
   * Check if a credential exists in the system keychain
   */
  has(key: string): Promise<boolean>;
}
