import { err, ok, type Result } from '$lib/core';
import type {
  CryptoPort,
  EncryptedStringEnvelope,
  WrappedKeyMaterial,
} from '$lib/ports/outbound/CryptoPort';

const ALGORITHM = 'AES-256-GCM';
const KDF_ITERATIONS = 210_000;

export class MemoryCryptoAdapter implements CryptoPort {
  async generateKey(): Promise<Result<string, Error>> {
    const bytes = randomBytes(32);
    return ok(bytesToBase64(bytes));
  }

  async randomId(prefix: string): Promise<Result<string, Error>> {
    const bytes = randomBytes(16);
    return ok(`${prefix}_${bytesToHex(bytes)}`);
  }

  async encryptString(
    plaintext: string,
    key: string,
    associatedData: string,
  ): Promise<Result<EncryptedStringEnvelope, Error>> {
    try {
      const nonce = randomBytes(12);
      const cryptoKey = await importAesKey(key);
      const encoded = new TextEncoder().encode(plaintext);
      const cipher = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: new TextEncoder().encode(associatedData),
        },
        cryptoKey,
        encoded,
      );
      return ok({
        version: 1,
        algorithm: ALGORITHM,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(new Uint8Array(cipher)),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async decryptString(
    envelope: EncryptedStringEnvelope,
    key: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    try {
      const cryptoKey = await importAesKey(key);
      const plain = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToBytes(envelope.nonce),
          additionalData: new TextEncoder().encode(associatedData),
        },
        cryptoKey,
        base64ToBytes(envelope.ciphertext),
      );
      return ok(new TextDecoder().decode(plain));
    } catch {
      return err(new Error('Protected content could not be decrypted'));
    }
  }

  async wrapKey(
    keyToWrap: string,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<WrappedKeyMaterial, Error>> {
    const encrypted = await this.encryptString(keyToWrap, wrappingKey, associatedData);
    if (!encrypted.ok) return encrypted;
    return ok({ ...encrypted.value, kdf: 'none' });
  }

  async unwrapKey(
    wrapped: WrappedKeyMaterial,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    return this.decryptString(wrapped, wrappingKey, associatedData);
  }

  async wrapKeyWithPassphrase(
    keyToWrap: string,
    passphrase: string,
    associatedData: string,
  ): Promise<Result<WrappedKeyMaterial, Error>> {
    try {
      const salt = randomBytes(16);
      const wrappingKey = await derivePassphraseKey(passphrase, salt);
      const encrypted = await this.encryptString(keyToWrap, wrappingKey, associatedData);
      if (!encrypted.ok) return encrypted;
      return ok({ ...encrypted.value, kdf: 'pbkdf2-sha256', salt: bytesToBase64(salt) });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async unwrapKeyWithPassphrase(
    wrapped: WrappedKeyMaterial,
    passphrase: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    if (!wrapped.salt) return err(new Error('Recovery material is missing a salt'));
    const wrappingKey = await derivePassphraseKey(passphrase, base64ToBytes(wrapped.salt));
    return this.decryptString(wrapped, wrappingKey, associatedData);
  }
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: KDF_ITERATIONS },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
