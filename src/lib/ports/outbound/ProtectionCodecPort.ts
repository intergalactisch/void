import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import type { LockState, ProtectedNoteMeta } from '$lib/domain/values/Protection';
import type { Result } from '$lib/core';

export interface ProtectedDocumentEnvelope {
  version: number;
  algorithm: string;
  keyId: string;
  nonce: string;
  ciphertext: string;
  wrappedDek: {
    version: number;
    algorithm: string;
    kdf: 'none' | 'argon2id' | 'pbkdf2-sha256';
    nonce: string;
    ciphertext: string;
    salt?: string;
  };
}

export interface ProtectionCodecPort {
  lockState(): LockState;
  metaForLoad(meta: DocumentMeta): DocumentMeta;
  encryptDocument(
    path: string,
    meta: DocumentMeta,
    markdown: string
  ): Promise<Result<{ meta: DocumentMeta; envelopeMarkdown: string }, Error>>;
  decryptDocument(
    path: string,
    meta: DocumentMeta,
    envelopeMarkdown: string
  ): Promise<Result<string, Error>>;
  createLockedDocumentBlocks(): import('$lib/domain/entities/Block').Block[];
  createProtectedMeta(path: string, meta: DocumentMeta): Promise<Result<ProtectedNoteMeta, Error>>;
}
