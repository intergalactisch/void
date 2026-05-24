import { err, ok, type Result } from '$lib/core';
import type {
  ProtectionCodecPort,
  ProtectedBlockEnvelope,
  ProtectedDocumentEnvelope,
} from '$lib/ports/outbound/ProtectionCodecPort';
import type { CryptoPort, KeyCustodyPort, VoidStoragePort, WrappedKeyMaterial } from '$lib/ports/outbound';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import { createBlock, type Block } from '$lib/domain/entities/Block';
import {
  createProtectedNoteMeta,
  customFromProtectionMeta,
  isProtectedDocumentMeta,
  PROTECTED_NOTE_ALGORITHM,
  PROTECTED_NOTE_ENVELOPE_VERSION,
  PROTECTED_LINES_ALGORITHM,
  PROTECTED_LINES_ENVELOPE_VERSION,
  type LockState,
  type ProtectedNoteMeta,
} from '$lib/domain/values/Protection';

const ENVELOPE_START = '<!-- void-protected-note';
const ENVELOPE_END = '-->';
const ENVELOPE_FENCE = 'void-protected-note-v2';
const PROTECTED_LINES_FENCE = 'void-protected-lines-v1';
const RECOVERY_PATH = 'keys/recovery.json';

export class ProtectionRuntime implements ProtectionCodecPort {
  #locked = true;
  #cachedWorkspaceKey: string | null = null;
  #keychainState: 'not_checked' | 'available_this_session' | 'missing_after_unlock_attempt' | 'error_after_unlock_attempt' = 'not_checked';
  #unlockInFlight: Promise<Result<void, Error>> | null = null;

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
    keychainState: 'not_checked' | 'available_this_session' | 'missing_after_unlock_attempt' | 'error_after_unlock_attempt';
    recoveryConfigured: boolean;
  }, Error>> {
    const recovery = await this.voidStorage.readJson<WrappedKeyMaterial>(this.notesPath, RECOVERY_PATH);
    if (!recovery.ok) return err(recovery.error);
    return ok({
      workspaceId: this.workspaceId,
      lockState: this.lockState(),
      keychainState: this.#keychainState,
      recoveryConfigured: recovery.value !== null,
    });
  }

  async lockWorkspace(): Promise<Result<void, Error>> {
    this.#locked = true;
    this.#cachedWorkspaceKey = null;
    this.#keychainState = 'not_checked';
    return ok(undefined);
  }

  async unlockWorkspace(passphrase?: string): Promise<Result<void, Error>> {
    if (this.#unlockInFlight) return this.#unlockInFlight;
    this.#unlockInFlight = this.performUnlockWorkspace(passphrase);
    try {
      return await this.#unlockInFlight;
    } finally {
      this.#unlockInFlight = null;
    }
  }

  private async performUnlockWorkspace(passphrase?: string): Promise<Result<void, Error>> {
    const existing = await this.keyCustody.getWorkspaceKey(this.workspaceId);
    if (!existing.ok) {
      this.#keychainState = 'error_after_unlock_attempt';
      return err(existing.error);
    }
    if (existing.value) {
      this.#cachedWorkspaceKey = existing.value;
      this.#locked = false;
      this.#keychainState = 'available_this_session';
      return ok(undefined);
    }

    if (!passphrase) {
      this.#keychainState = 'missing_after_unlock_attempt';
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
    this.#keychainState = 'available_this_session';
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

  async prepareMarkdownForLoad(markdown: string): Promise<Result<string, Error>> {
    const prepared = await this.transformProtectedLineCapsules(markdown, async (envelope) => {
      const runtimeEnvelope = { ...envelope };
      if (this.#locked) {
        return {
          ...runtimeEnvelope,
          __void: { lockState: 'locked' },
        };
      }

      const decrypted = await this.decryptProtectedBlockEnvelope(envelope);
      if (!decrypted.ok) {
        return {
          ...runtimeEnvelope,
          __void: {
            lockState: 'locked',
            error: decrypted.error.message,
          },
        };
      }
      return {
        ...runtimeEnvelope,
        __void: {
          lockState: 'unlocked',
          plaintext: decrypted.value,
        },
      };
    });
    if (!prepared.ok) return err(prepared.error);
    return ok(prepared.value);
  }

  async sealMarkdownForSave(markdown: string): Promise<Result<string, Error>> {
    const sealed = await this.transformProtectedLineCapsules(markdown, async (envelope) => {
      const plaintext = runtimePlaintextFromEnvelope(envelope);
      if (plaintext === null) {
        return cleanProtectedBlockEnvelope(envelope);
      }
      const encrypted = await this.encryptProtectedBlockEnvelope(
        plaintext,
        envelope.lineCount || countMarkdownLines(plaintext),
        {
          id: envelope.id,
          keyId: envelope.keyId,
          protectedAt: envelope.protectedAt,
          titleVisible: envelope.titleVisible,
        },
      );
      if (!encrypted.ok) throw encrypted.error;
      return encrypted.value;
    });
    if (!sealed.ok) return err(sealed.error);
    return ok(sealed.value);
  }

  async encryptProtectedBlock(markdown: string, lineCount: number): Promise<Result<string, Error>> {
    const id = await this.crypto.randomId('pblk');
    if (!id.ok) return err(id.error);
    const keyId = await this.crypto.randomId('pkey');
    if (!keyId.ok) return err(keyId.error);
    const encrypted = await this.encryptProtectedBlockEnvelope(markdown, lineCount, {
      id: id.value,
      keyId: keyId.value,
      protectedAt: new Date().toISOString(),
      titleVisible: true,
    });
    if (!encrypted.ok) return err(encrypted.error);
    return ok(formatProtectedLinesCapsule(encrypted.value));
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

  private async encryptProtectedBlockEnvelope(
    markdown: string,
    lineCount: number,
    identity: {
      id: string;
      keyId: string;
      protectedAt: string;
      titleVisible: boolean;
    },
  ): Promise<Result<ProtectedBlockEnvelope, Error>> {
    const workspaceKey = await this.ensureWorkspaceKey();
    if (!workspaceKey.ok) return err(workspaceKey.error);

    const dek = await this.crypto.generateKey();
    if (!dek.ok) return err(dek.error);

    const meta = {
      id: identity.id,
      keyId: identity.keyId,
    };
    const encrypted = await this.crypto.encryptString(
      markdown,
      dek.value,
      this.protectedBlockAssociatedData(meta),
    );
    if (!encrypted.ok) return err(encrypted.error);

    const wrappedDek = await this.crypto.wrapKey(
      dek.value,
      workspaceKey.value,
      this.protectedBlockDekAssociatedData(meta),
    );
    if (!wrappedDek.ok) return err(wrappedDek.error);

    return ok({
      id: identity.id,
      version: PROTECTED_LINES_ENVELOPE_VERSION,
      algorithm: PROTECTED_LINES_ALGORITHM,
      keyId: identity.keyId,
      nonce: encrypted.value.nonce,
      ciphertext: encrypted.value.ciphertext,
      wrappedDek: wrappedDek.value,
      lineCount: Math.max(1, Math.round(lineCount)),
      protectedAt: identity.protectedAt,
      titleVisible: identity.titleVisible,
    });
  }

  private async decryptProtectedBlockEnvelope(envelope: ProtectedBlockEnvelope): Promise<Result<string, Error>> {
    if (this.#locked) {
      return err(new Error('Protected lines are locked.'));
    }
    const workspaceKey = await this.ensureWorkspaceKey();
    if (!workspaceKey.ok) return err(workspaceKey.error);
    const meta = {
      id: envelope.id,
      keyId: envelope.keyId,
    };

    const dek = await this.crypto.unwrapKey(
      envelope.wrappedDek,
      workspaceKey.value,
      this.protectedBlockDekAssociatedData(meta),
    );
    if (!dek.ok) return err(dek.error);

    const decrypted = await this.crypto.decryptString(
      {
        version: envelope.version,
        algorithm: envelope.algorithm,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
      },
      dek.value,
      this.protectedBlockAssociatedData(meta),
    );
    if (!decrypted.ok) return err(decrypted.error);
    return ok(decrypted.value);
  }

  private async transformProtectedLineCapsules(
    markdown: string,
    transform: (envelope: ProtectedBlockEnvelope & { __void?: unknown }) => Promise<unknown>,
  ): Promise<Result<string, Error>> {
    const normalizedMarkdown = normalizeProtectedLineCapsules(markdown);
    const pattern = new RegExp(
      `(?:^|\\n)(?:> Locked encrypted lines[^\\n]*\\n\\n)?\\\`\\\`\\\`${PROTECTED_LINES_FENCE}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`(?=\\n|$)`,
      'g',
    );
    let output = '';
    let lastIndex = 0;
    for (const match of normalizedMarkdown.matchAll(pattern)) {
      const fullMatch = match[0] ?? '';
      const json = match[1]?.trim();
      const index = match.index ?? 0;
      output += normalizedMarkdown.slice(lastIndex, index);
      try {
        const envelope = parseProtectedBlockEnvelopeJson(json ?? '');
        const next = await transform(envelope);
        const prefix = fullMatch.startsWith('\n') ? '\n' : '';
        output += `${prefix}\`\`\`${PROTECTED_LINES_FENCE}\n${JSON.stringify(next, null, 2)}\n\`\`\``;
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
      lastIndex = index + fullMatch.length;
    }
    output += normalizedMarkdown.slice(lastIndex);
    return ok(output);
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
    this.#keychainState = 'available_this_session';
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

  private protectedBlockAssociatedData(meta: { id: string; keyId: string }): string {
    return `void:protected-block:${this.workspaceId}:${meta.id}:${meta.keyId}`;
  }

  private protectedBlockDekAssociatedData(meta: { id: string; keyId: string }): string {
    return `void:protected-block-dek:${this.workspaceId}:${meta.id}:${meta.keyId}`;
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

function parseProtectedBlockEnvelopeJson(json: string): ProtectedBlockEnvelope & { __void?: unknown } {
  const parsed = JSON.parse(json) as ProtectedBlockEnvelope & { __void?: unknown };
  if (
    typeof parsed.id !== 'string' ||
    parsed.version !== PROTECTED_LINES_ENVELOPE_VERSION ||
    parsed.algorithm !== PROTECTED_LINES_ALGORITHM ||
    typeof parsed.keyId !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.ciphertext !== 'string' ||
    !parsed.wrappedDek
  ) {
    throw new Error('Protected lines envelope is not supported.');
  }
  return parsed;
}

function cleanProtectedBlockEnvelope(
  envelope: ProtectedBlockEnvelope & { __void?: unknown },
): ProtectedBlockEnvelope {
  return {
    id: envelope.id,
    version: envelope.version,
    algorithm: envelope.algorithm,
    keyId: envelope.keyId,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    wrappedDek: envelope.wrappedDek,
    lineCount: envelope.lineCount,
    protectedAt: envelope.protectedAt,
    titleVisible: envelope.titleVisible,
  };
}

function runtimePlaintextFromEnvelope(envelope: { __void?: unknown }): string | null {
  const runtime = envelope.__void && typeof envelope.__void === 'object'
    ? envelope.__void as { plaintext?: unknown }
    : null;
  return typeof runtime?.plaintext === 'string' ? runtime.plaintext : null;
}

function formatProtectedLinesCapsule(envelope: ProtectedBlockEnvelope): string {
  const lines = Math.max(1, envelope.lineCount);
  return [
    `> Locked encrypted lines · ${lines} line${lines === 1 ? '' : 's'} · Open in Void to unlock.`,
    '',
    `\`\`\`${PROTECTED_LINES_FENCE}`,
    JSON.stringify(envelope, null, 2),
    '```',
  ].join('\n');
}

function normalizeProtectedLineCapsules(markdown: string): string {
  return markdown.replace(
    new RegExp(`(^|\\n)(> Locked encrypted lines[^\\n]*?)\\s+\\\`\\\`\\\`${PROTECTED_LINES_FENCE}\\s*\\n?([\\s\\S]*?)\\n?\\\`\\\`\\\`(?=\\n|$)`, 'g'),
    (_match, prefix: string, stub: string, envelope: string) =>
      `${prefix}${stub}\n\n\`\`\`${PROTECTED_LINES_FENCE}\n${envelope.trim()}\n\`\`\``,
  );
}

function countMarkdownLines(markdown: string): number {
  const trimmed = markdown.replace(/\n+$/, '');
  if (!trimmed) return 1;
  return trimmed.split(/\r?\n/).length;
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
