import type { Result } from '$lib/core';

export interface EncryptedStringEnvelope {
  version: number;
  algorithm: string;
  nonce: string;
  ciphertext: string;
}

export interface WrappedKeyMaterial extends EncryptedStringEnvelope {
  kdf: 'none' | 'argon2id' | 'pbkdf2-sha256';
  salt?: string;
}

export interface CryptoPort {
  generateKey(): Promise<Result<string, Error>>;
  randomId(prefix: string): Promise<Result<string, Error>>;
  encryptString(
    plaintext: string,
    key: string,
    associatedData: string
  ): Promise<Result<EncryptedStringEnvelope, Error>>;
  decryptString(
    envelope: EncryptedStringEnvelope,
    key: string,
    associatedData: string
  ): Promise<Result<string, Error>>;
  wrapKey(
    keyToWrap: string,
    wrappingKey: string,
    associatedData: string
  ): Promise<Result<WrappedKeyMaterial, Error>>;
  unwrapKey(
    wrapped: WrappedKeyMaterial,
    wrappingKey: string,
    associatedData: string
  ): Promise<Result<string, Error>>;
  wrapKeyWithPassphrase(
    keyToWrap: string,
    passphrase: string,
    associatedData: string
  ): Promise<Result<WrappedKeyMaterial, Error>>;
  unwrapKeyWithPassphrase(
    wrapped: WrappedKeyMaterial,
    passphrase: string,
    associatedData: string
  ): Promise<Result<string, Error>>;
}
