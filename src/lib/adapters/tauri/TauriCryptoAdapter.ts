import { err, ok, toError, type Result } from '$lib/core';
import type {
  CryptoPort,
  EncryptedStringEnvelope,
  WrappedKeyMaterial,
} from '$lib/ports/outbound/CryptoPort';
import { protectionCommands } from './commands';

export class TauriCryptoAdapter implements CryptoPort {
  async generateKey(): Promise<Result<string, Error>> {
    try {
      return ok(await protectionCommands.generateKey());
    } catch (error) {
      return err(toError(error));
    }
  }

  async randomId(prefix: string): Promise<Result<string, Error>> {
    try {
      return ok(await protectionCommands.randomId(prefix));
    } catch (error) {
      return err(toError(error));
    }
  }

  async encryptString(
    plaintext: string,
    key: string,
    associatedData: string,
  ): Promise<Result<EncryptedStringEnvelope, Error>> {
    try {
      return ok(await protectionCommands.encryptString(plaintext, key, associatedData));
    } catch (error) {
      return err(toError(error));
    }
  }

  async decryptString(
    envelope: EncryptedStringEnvelope,
    key: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    try {
      return ok(await protectionCommands.decryptString(envelope, key, associatedData));
    } catch (error) {
      return err(toError(error));
    }
  }

  async wrapKey(
    keyToWrap: string,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<WrappedKeyMaterial, Error>> {
    return this.encryptKey(keyToWrap, wrappingKey, associatedData);
  }

  async unwrapKey(
    wrapped: WrappedKeyMaterial,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    return this.decryptKey(wrapped, wrappingKey, associatedData);
  }

  async wrapKeyWithPassphrase(
    keyToWrap: string,
    passphrase: string,
    associatedData: string,
  ): Promise<Result<WrappedKeyMaterial, Error>> {
    try {
      return ok(await protectionCommands.wrapKeyWithPassphrase(keyToWrap, passphrase, associatedData));
    } catch (error) {
      return err(toError(error));
    }
  }

  async unwrapKeyWithPassphrase(
    wrapped: WrappedKeyMaterial,
    passphrase: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    try {
      return ok(await protectionCommands.unwrapKeyWithPassphrase(wrapped, passphrase, associatedData));
    } catch (error) {
      return err(toError(error));
    }
  }

  private async encryptKey(
    keyToWrap: string,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<WrappedKeyMaterial, Error>> {
    const encrypted = await this.encryptString(keyToWrap, wrappingKey, associatedData);
    if (!encrypted.ok) return encrypted;
    return ok({ ...encrypted.value, kdf: 'none' });
  }

  private async decryptKey(
    wrapped: WrappedKeyMaterial,
    wrappingKey: string,
    associatedData: string,
  ): Promise<Result<string, Error>> {
    return this.decryptString(wrapped, wrappingKey, associatedData);
  }
}
