/**
 * Note protection value objects.
 *
 * Domain-only shapes for selected protected notes. The encrypted payload lives
 * at the adapter boundary; the domain records only policy and visible state.
 */

export type ProtectionLevel = 'normal' | 'protected';

export type LockState = 'unprotected' | 'locked' | 'unlocked';

export type AIContextAuthorizationScope =
  | 'selection.read'
  | 'note.read'
  | 'related.read'
  | 'history.read'
  | 'note.write';

export type LegacyAIContextAuthorizationScope = 'selection' | 'note' | 'related-notes';

export interface ProtectedNoteMeta {
  level: 'protected';
  /** Stable opaque id used for sidecars and encryption associated data. */
  noteId: string;
  keyId: string;
  algorithm: string;
  envelopeVersion: number;
  protectedAt: string;
  titleVisible: boolean;
  lockState: Extract<LockState, 'locked' | 'unlocked'>;
}

export type ProtectedContentKind = 'note' | 'block';

export interface ProtectedBlockMeta {
  kind: 'block';
  protectionId: string;
  keyId: string;
  algorithm: string;
  envelopeVersion: number;
  protectedAt: string;
  titleVisible: boolean;
  lineCount: number;
  lockState: Extract<LockState, 'locked' | 'unlocked'>;
}

export interface AIContextAuthorization {
  id: string;
  noteIds: string[];
  scopes: AIContextAuthorizationScope[];
  providerTarget: 'local-agent' | 'external-provider' | 'any';
  resources: string[];
  grantedAt: string;
  expiresAt: string;
  reason: string;
}

export interface AISelectionResourceInput {
  notePath: string;
  from: number | null;
  to: number | null;
  selectedText: string;
}

export interface ProtectionPolicy {
  idleLockMinutes: number;
  lockOnAppClose: boolean;
  lockOnSleep: boolean;
  hideProtectedPreviews: boolean;
  requireAIApprovalForProtectedReads: boolean;
  requireAIApprovalForProtectedWrites: boolean;
}

export const DEFAULT_PROTECTION_POLICY: ProtectionPolicy = {
  idleLockMinutes: 15,
  lockOnAppClose: true,
  lockOnSleep: false,
  hideProtectedPreviews: true,
  requireAIApprovalForProtectedReads: true,
  requireAIApprovalForProtectedWrites: true,
};

export const PROTECTED_NOTE_ALGORITHM = 'AES-256-GCM';
export const PROTECTED_NOTE_ENVELOPE_VERSION = 2;
export const PROTECTED_LINES_ALGORITHM = 'AES-256-GCM';
export const PROTECTED_LINES_ENVELOPE_VERSION = 1;

export const PROTECTED_FRONTMATTER_KEYS = {
  level: 'void_protection',
  noteId: 'void_protection_id',
  keyId: 'void_protection_key_id',
  algorithm: 'void_protection_algorithm',
  version: 'void_protection_version',
  protectedAt: 'void_protection_at',
  titleVisible: 'void_protection_title_visible',
} as const;

export function isProtectedNoteMeta(value: unknown): value is ProtectedNoteMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<ProtectedNoteMeta>;
  return (
    meta.level === 'protected' &&
    typeof meta.noteId === 'string' &&
    meta.noteId.length > 0 &&
    typeof meta.keyId === 'string' &&
    meta.keyId.length > 0
  );
}

export function isProtectedDocumentMeta<T extends { protection?: ProtectedNoteMeta | null }>(
  meta: T,
): meta is T & { protection: ProtectedNoteMeta } {
  return isProtectedNoteMeta(meta.protection);
}

export function isLockedProtectedMeta<T extends { protection?: ProtectedNoteMeta | null }>(
  meta: T,
): meta is T & { protection: ProtectedNoteMeta & { lockState: 'locked' } } {
  return isProtectedNoteMeta(meta.protection) && meta.protection.lockState === 'locked';
}

export function protectionMetaFromCustom(
  custom: Record<string, unknown> | undefined,
  lockState: Extract<LockState, 'locked' | 'unlocked'> = 'locked',
): ProtectedNoteMeta | null {
  if (!custom) return null;
  if (custom[PROTECTED_FRONTMATTER_KEYS.level] !== 'protected') return null;

  const noteId = stringValue(custom[PROTECTED_FRONTMATTER_KEYS.noteId]);
  const keyId = stringValue(custom[PROTECTED_FRONTMATTER_KEYS.keyId]);
  if (!noteId || !keyId) return null;

  const algorithm = stringValue(custom[PROTECTED_FRONTMATTER_KEYS.algorithm]) ?? PROTECTED_NOTE_ALGORITHM;
  const versionRaw = custom[PROTECTED_FRONTMATTER_KEYS.version];
  const envelopeVersion = typeof versionRaw === 'number'
    ? versionRaw
    : Number.parseInt(String(versionRaw ?? PROTECTED_NOTE_ENVELOPE_VERSION), 10);

  return {
    level: 'protected',
    noteId,
    keyId,
    algorithm,
    envelopeVersion: Number.isFinite(envelopeVersion) ? envelopeVersion : PROTECTED_NOTE_ENVELOPE_VERSION,
    protectedAt: stringValue(custom[PROTECTED_FRONTMATTER_KEYS.protectedAt]) ?? new Date(0).toISOString(),
    titleVisible: custom[PROTECTED_FRONTMATTER_KEYS.titleVisible] !== false,
    lockState,
  };
}

export function customFromProtectionMeta(meta: ProtectedNoteMeta): Record<string, unknown> {
  return {
    [PROTECTED_FRONTMATTER_KEYS.level]: 'protected',
    [PROTECTED_FRONTMATTER_KEYS.noteId]: meta.noteId,
    [PROTECTED_FRONTMATTER_KEYS.keyId]: meta.keyId,
    [PROTECTED_FRONTMATTER_KEYS.algorithm]: meta.algorithm,
    [PROTECTED_FRONTMATTER_KEYS.version]: meta.envelopeVersion,
    [PROTECTED_FRONTMATTER_KEYS.protectedAt]: meta.protectedAt,
    [PROTECTED_FRONTMATTER_KEYS.titleVisible]: meta.titleVisible,
  };
}

export function stripProtectionCustom(custom: Record<string, unknown>): Record<string, unknown> {
  const next = { ...custom };
  for (const key of Object.values(PROTECTED_FRONTMATTER_KEYS)) {
    delete next[key];
  }
  return next;
}

export function createProtectedNoteMeta(input: {
  noteId: string;
  keyId: string;
  protectedAt?: string;
  titleVisible?: boolean;
  lockState?: Extract<LockState, 'locked' | 'unlocked'>;
}): ProtectedNoteMeta {
  return {
    level: 'protected',
    noteId: input.noteId,
    keyId: input.keyId,
    algorithm: PROTECTED_NOTE_ALGORITHM,
    envelopeVersion: PROTECTED_NOTE_ENVELOPE_VERSION,
    protectedAt: input.protectedAt ?? new Date().toISOString(),
    titleVisible: input.titleVisible ?? true,
    lockState: input.lockState ?? 'unlocked',
  };
}

export function normalizeAIContextAuthorizationScope(
  scope: AIContextAuthorizationScope | LegacyAIContextAuthorizationScope,
): AIContextAuthorizationScope {
  switch (scope) {
    case 'selection':
      return 'selection.read';
    case 'note':
      return 'note.read';
    case 'related-notes':
      return 'related.read';
    default:
      return scope;
  }
}

export function createAISelectionResource(input: AISelectionResourceInput): string {
  const path = normalizeAuthorizationResource(input.notePath);
  const from = input.from ?? 'unknown';
  const to = input.to ?? 'unknown';
  return `selection:${path}#${from}-${to}:${hashAuthorizationText(input.selectedText)}`;
}

export function isAISelectionResource(resource: string): boolean {
  return normalizeAuthorizationResource(resource).startsWith('selection:');
}

export function normalizeAuthorizationResource(resource: string): string {
  return resource.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

export function authorizationResourceMatches(
  authorizedResource: string,
  requestedResource: string,
): boolean {
  const authorized = normalizeAuthorizationResource(authorizedResource);
  const requested = normalizeAuthorizationResource(requestedResource);
  if (authorized === requested) return true;

  // A note-level authorization covers selection resources inside that note,
  // but a selection-scoped authorization must not cover the whole note.
  return !isAISelectionResource(authorized)
    && requested.startsWith(`selection:${authorized}#`);
}

export function normalizeProtectionPolicy(value: unknown): ProtectionPolicy {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ProtectionPolicy>
    : {};
  const minutes = Number(candidate.idleLockMinutes ?? DEFAULT_PROTECTION_POLICY.idleLockMinutes);
  return {
    idleLockMinutes: Number.isFinite(minutes)
      ? Math.min(Math.max(Math.round(minutes), 1), 240)
      : DEFAULT_PROTECTION_POLICY.idleLockMinutes,
    lockOnAppClose: typeof candidate.lockOnAppClose === 'boolean'
      ? candidate.lockOnAppClose
      : DEFAULT_PROTECTION_POLICY.lockOnAppClose,
    lockOnSleep: typeof candidate.lockOnSleep === 'boolean'
      ? candidate.lockOnSleep
      : DEFAULT_PROTECTION_POLICY.lockOnSleep,
    hideProtectedPreviews: typeof candidate.hideProtectedPreviews === 'boolean'
      ? candidate.hideProtectedPreviews
      : DEFAULT_PROTECTION_POLICY.hideProtectedPreviews,
    requireAIApprovalForProtectedReads: typeof candidate.requireAIApprovalForProtectedReads === 'boolean'
      ? candidate.requireAIApprovalForProtectedReads
      : DEFAULT_PROTECTION_POLICY.requireAIApprovalForProtectedReads,
    requireAIApprovalForProtectedWrites: typeof candidate.requireAIApprovalForProtectedWrites === 'boolean'
      ? candidate.requireAIApprovalForProtectedWrites
      : DEFAULT_PROTECTION_POLICY.requireAIApprovalForProtectedWrites,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hashAuthorizationText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
