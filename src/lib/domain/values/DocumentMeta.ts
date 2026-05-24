/**
 * DocumentMeta value object - document metadata and organization info
 *
 * This is a pure domain value with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

import type { NoteIntent } from './NoteIntent';
import type { NoteStatus } from './NoteStatus';
import type { ProtectedNoteMeta } from './Protection';
import { normalizeNoteTags } from './NoteTags';

export interface DocumentMeta {
  /** Unique document identifier */
  id: string;
  /** Document title (extracted from first heading or filename) */
  title: string;
  /** Tags for organization */
  tags: string[];
  /** Optional category */
  category: string | null;
  /** Optional color for visual distinction */
  color: string | null;
  /** Creation timestamp */
  createdAt: Date;
  /** Last modification timestamp */
  updatedAt: Date;
  /** Whether document is pinned */
  pinned: boolean;
  /** Document lifecycle status */
  status: NoteStatus;
  /** Document intent — drives AI behavior */
  intent: NoteIntent;
  /** Count of AI-originated interactions */
  aiTouches: number;
  /** Note-level protection state. Null/undefined means normal portable markdown. */
  protection?: ProtectedNoteMeta | null;
  /** Optional custom metadata */
  custom: Record<string, unknown>;
}

export function createDocumentMeta(
  partial: Partial<DocumentMeta> & { id: string }
): DocumentMeta {
  const now = new Date();
  return {
    id: partial.id,
    title: partial.title ?? 'Untitled',
    tags: normalizeNoteTags(partial.tags),
    category: partial.category ?? null,
    color: partial.color ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    pinned: partial.pinned ?? false,
    status: partial.status ?? 'draft',
    intent: partial.intent ?? 'general',
    aiTouches: partial.aiTouches ?? 0,
    protection: partial.protection ?? null,
    custom: partial.custom ?? {},
  };
}
