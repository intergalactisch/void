import { err, ok, type Result } from '$lib/core';
import type { ProtectionCodecPort, ProtectedDocumentEnvelope } from '$lib/ports/outbound/ProtectionCodecPort';
import type { CryptoPort, KeyCustodyPort, VoidStoragePort, WrappedKeyMaterial } from '$lib/ports/outbound';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import { createBlock, type Block } from '$lib/domain/entities/Block';
import {
  createProtectedNoteMeta,
  customFromProtectionMeta,
  isProtectedDocumentMeta,
  PROTECTED_NOTE_ALGORITHM,
  PROTECTED_NOTE_ENVELOPE_VERSION,
  type LockState,
  type ProtectedNoteMeta,
} from '$lib/domain/values/Protection';

const ENVELOPE_START = '<!-- void-protected-note';
const ENVELOPE_END = '-->';
const ENVELOPE_FENCE = 'void-protected-note-v2';
const RECOVERY_PATH = 'keys/recovery.json';

export class ProtectionRuntime implements ProtectionCodecPort {
  #locked = true;
  #cachedWorkspaceKey: string | null = null;

  constructor(
    private readonly crypto: CryptoPort,
    private readonly keyCustody: KeyCustodyPort,
    private readonly voidStorage: VoidStoragePort,
    private readonly notesPath: string,
    private readonly workspaceId: string,
  ) {}

  lockState(): LockState {
    return this.#locked ? 'locked' : 'unlocked';
  }

  async status(): Promise<Result<{
    workspaceId: string;
    lockState: LockState;
    hasWorkspaceKey: boolean;
    recoveryConfigured: boolean;
  }, Error>> {
    const recovery = await this.voidStorage.readJson<WrappedKeyMaterial>(this.notesPath, RECOVERY_PATH);
    if (!recovery.ok) return err(recovery.error);
    return ok({
      workspaceId: this.workspaceId,
      lockState: this.lockState(),
      hasWorkspaceKey: await this.keyCustody.hasWorkspaceKey(this.workspaceId),
      recoveryConfigured: recovery.value !== null,
    });
  }

  async lockWorkspace(): Promise<Result<void, Error>> {
    this.#locked = true;
    this.#cachedWorkspaceKey = null;
    return ok(undefined);
  }

  async unlockWorkspace(passphrase?: string): Promise<Result<void, Error>> {
    const existing = await this.keyCustody.getWorkspaceKey(this.workspaceId);
    if (!existing.ok) return err(existing.error);
    if (existing.value) {
      this.#cachedWorkspaceKey = existing.value;
      this.#locked = false;
      return ok(undefined);
    }

    if (!passphrase) {
      return err(new Error('No workspace protection key is available. Enter the recovery passphrase to restore it.'));
    }

    const recovery = await this.voidStorage.readJson<WrappedKeyMaterial>(this.notesPath, RECOVERY_PATH);
    if (!recovery.ok) return err(recovery.error);
    if (!recovery.value) {
      return err(new Error('No recovery material exists for this workspace.'));
    }

    const unwrapped = await this.crypto.unwrapKeyWithPassphrase(
      recovery.value,
      passphrase,
      this.recoveryAssociatedData(),
    );
    if (!unwrapped.ok) return err(unwrapped.error);

    const stored = await this.keyCustody.storeWorkspaceKey(this.workspaceId, unwrapped.value);
    if (!stored.ok) return err(stored.error);

    this.#cachedWorkspaceKey = unwrapped.value;
    this.#locked = false;
    return ok(undefined);
  }

  async setupRecovery(passphrase: string): Promise<Result<void, Error>> {
    if (!passphrase || passphrase.length < 12) {
      return err(new Error('Recovery passphrase must be at least 12 characters.'));
    }
    const key = await this.ensureWorkspaceKey();
    if (!key.ok) return err(key.error);

    const wrapped = await this.crypto.wrapKeyWithPassphrase(
      key.value,
      passphrase,
      this.recoveryAssociatedData(),
    );
    if (!wrapped.ok) return err(wrapped.error);
    return this.voidStorage.writeJson(this.notesPath, RECOVERY_PATH, wrapped.value);
  }

  metaForLoad(meta: DocumentMeta): DocumentMeta {
    if (!isProtectedDocumentMeta(meta)) return meta;
    return {
      ...meta,
      protection: {
        ...meta.protection,
        lockState: this.#locked ? 'locked' : 'unlocked',
      },
    };
  }

  async createProtectedMeta(_path: string, meta: DocumentMeta): Promise<Result<ProtectedNoteMeta, Error>> {
    if (isProtectedDocumentMeta(meta)) return ok(meta.protection);
    const workspaceKey = await this.ensureWorkspaceKey();
    if (!workspaceKey.ok) return err(workspaceKey.error);
    const noteId = await this.crypto.randomId('pnote');
    if (!noteId.ok) return err(noteId.error);
    const keyId = await this.crypto.randomId('pkey');
    if (!keyId.ok) return err(keyId.error);
    return ok(createProtectedNoteMeta({
      noteId: noteId.value,
      keyId: keyId.value,
      lockState: 'unlocked',
    }));
  }

  async encryptDocument(
    path: string,
    meta: DocumentMeta,
    markdown: string,
  ): Promise<Result<{ meta: DocumentMeta; envelopeMarkdown: string }, Error>> {
    if (!isProtectedDocumentMeta(meta)) {
      return err(new Error('Cannot encrypt an unprotected note.'));
    }

    const workspaceKey = await this.getExistingWorkspaceKey();
    if (!workspaceKey.ok) return err(workspaceKey.error);

    const dek = await this.crypto.generateKey();
    if (!dek.ok) return err(dek.error);

    const noteMeta = {
      ...meta.protection,
      envelopeVersion: PROTECTED_NOTE_ENVELOPE_VERSION,
      lockState: 'unlocked' as const,
    };
    const aad = this.noteAssociatedData(path, noteMeta);

    const encrypted = await this.crypto.encryptString(markdown, dek.value, aad);
    if (!encrypted.ok) return err(encrypted.error);

    const wrappedDek = await this.crypto.wrapKey(dek.value, workspaceKey.value, this.dekAssociatedData(noteMeta));
    if (!wrappedDek.ok) return err(wrappedDek.error);

    const envelope: ProtectedDocumentEnvelope = {
      version: 1,
      algorithm: PROTECTED_NOTE_ALGORITHM,
      keyId: noteMeta.keyId,
      nonce: encrypted.value.nonce,
      ciphertext: encrypted.value.ciphertext,
      wrappedDek: wrappedDek.value,
    };

    const protectedMeta: DocumentMeta = {
      ...meta,
      protection: noteMeta,
      custom: {
        ...meta.custom,
        ...customFromProtectionMeta(noteMeta),
      },
    };

    return ok({
      meta: protectedMeta,
      envelopeMarkdown: formatEnvelope(envelope, protectedMeta),
    });
  }

  async decryptDocument(
    path: string,
    meta: DocumentMeta,
    envelopeMarkdown: string,
  ): Promise<Result<string, Error>> {
    if (!isProtectedDocumentMeta(meta)) {
      return err(new Error('Cannot decrypt an unprotected note.'));
    }
    if (this.#locked) {
      return err(new Error('Protected note is locked.'));
    }

    const envelope = parseEnvelope(envelopeMarkdown);
    if (!envelope.ok) return err(envelope.error);
    if (envelope.value.keyId !== meta.protection.keyId) {
      return err(new Error('Protected note key metadata does not match its envelope.'));
    }

    const workspaceKey = await this.ensureWorkspaceKey();
    if (!workspaceKey.ok) return err(workspaceKey.error);

    const dek = await this.crypto.unwrapKey(
      envelope.value.wrappedDek,
      workspaceKey.value,
      this.dekAssociatedData(meta.protection),
    );
    if (!dek.ok) return err(dek.error);

    const decrypted = await this.crypto.decryptString(
      {
        version: envelope.value.version,
        algorithm: envelope.value.algorithm,
        nonce: envelope.value.nonce,
        ciphertext: envelope.value.ciphertext,
      },
      dek.value,
      this.noteAssociatedData(path, meta.protection),
    );
    if (!decrypted.ok) return err(decrypted.error);
    return ok(decrypted.value);
  }

  createLockedDocumentBlocks(): Block[] {
    return [
      createBlock(
        'paragraph',
        'This protected note is locked. Unlock it to read or edit the body.',
      ),
    ];
  }

  private async ensureWorkspaceKey(): Promise<Result<string, Error>> {
    if (this.#cachedWorkspaceKey && !this.#locked) return ok(this.#cachedWorkspaceKey);

    const existing = await this.keyCustody.getWorkspaceKey(this.workspaceId);
    if (!existing.ok) return err(existing.error);
    if (existing.value) {
      if (this.#locked) {
        return err(new Error('Protected notes are locked. Unlock the workspace before reading or editing them.'));
      }
      this.#cachedWorkspaceKey = existing.value;
      return ok(existing.value);
    }

    const generated = await this.crypto.generateKey();
    if (!generated.ok) return err(generated.error);
    const stored = await this.keyCustody.storeWorkspaceKey(this.workspaceId, generated.value);
    if (!stored.ok) return err(stored.error);
    this.#cachedWorkspaceKey = generated.value;
    this.#locked = false;
    return ok(generated.value);
  }

  private async getExistingWorkspaceKey(): Promise<Result<string, Error>> {
    if (this.#locked) {
      return err(new Error('Protected notes are locked. Unlock the workspace before reading or editing them.'));
    }
    if (this.#cachedWorkspaceKey) return ok(this.#cachedWorkspaceKey);

    const existing = await this.keyCustody.getWorkspaceKey(this.workspaceId);
    if (!existing.ok) return err(existing.error);
    if (!existing.value) {
      return err(new Error('Workspace protection key is missing. Use the recovery passphrase to restore it.'));
    }
    this.#cachedWorkspaceKey = existing.value;
    return ok(existing.value);
  }

  private recoveryAssociatedData(): string {
    return `void:workspace:${this.workspaceId}:recovery`;
  }

  private dekAssociatedData(meta: ProtectedNoteMeta): string {
    return `void:note-dek:${this.workspaceId}:${meta.noteId}:${meta.keyId}`;
  }

  private noteAssociatedData(path: string, meta: ProtectedNoteMeta): string {
    if (meta.envelopeVersion >= 2) {
      return `void:note:${this.workspaceId}:${meta.noteId}:${meta.keyId}`;
    }
    return `void:note:${this.workspaceId}:${meta.noteId}:${meta.keyId}:${path.replace(/\\/g, '/')}`;
  }
}

function formatEnvelope(envelope: ProtectedDocumentEnvelope, meta: DocumentMeta): string {
  const title = meta.protection?.titleVisible === false
    ? 'Protected note'
    : meta.title?.trim() || 'Protected note';
  return [
    `# ${escapeMarkdownHeading(title)}`,
    '',
    'This note is encrypted by Void. Open it in Void and unlock the workspace to read or edit it.',
    '',
    `\`\`\`${ENVELOPE_FENCE}`,
    JSON.stringify(envelope, null, 2),
    '```',
    '',
  ].join('\n');
}

function parseEnvelope(markdown: string): Result<ProtectedDocumentEnvelope, Error> {
  const trimmed = markdown.trim();
  const fenced = extractFencedEnvelope(trimmed);
  const json = fenced ?? extractLegacyCommentEnvelope(trimmed);
  if (!json) return err(new Error('Protected note envelope is missing or malformed.'));

  try {
    const parsed = JSON.parse(json) as ProtectedDocumentEnvelope;
    if (
      parsed.version !== 1 ||
      parsed.algorithm !== PROTECTED_NOTE_ALGORITHM ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.ciphertext !== 'string' ||
      !parsed.wrappedDek
    ) {
      return err(new Error('Protected note envelope is not supported.'));
    }
    return ok(parsed);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function extractFencedEnvelope(markdown: string): string | null {
  const pattern = new RegExp(`(^|\\n)\\\`\\\`\\\`${ENVELOPE_FENCE}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`(?=\\n|$)`);
  const match = markdown.match(pattern);
  return match?.[2]?.trim() ?? null;
}

function extractLegacyCommentEnvelope(markdown: string): string | null {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith(ENVELOPE_START) || !trimmed.endsWith(ENVELOPE_END)) {
    return null;
  }
  return trimmed
    .slice(ENVELOPE_START.length, trimmed.length - ENVELOPE_END.length)
    .trim();
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/^#+\s*/, '').trim() || 'Protected note';
}
