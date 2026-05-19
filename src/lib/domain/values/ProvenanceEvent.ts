/**
 * ProvenanceEvent - Interaction history for a document
 *
 * Records every significant interaction between the user and AI
 * on a specific document. Stored as JSONL in .void/provenance/.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export const PROVENANCE_EVENT_TYPES = [
  'ai_rewrite',
  'ai_action',
  'user_edit',
  'ai_generate',
  'ai_continue',
] as const;

export type ProvenanceEventType = typeof PROVENANCE_EVENT_TYPES[number];

export interface ProvenanceEvent {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: ProvenanceEventType;
  /** ISO timestamp */
  ts: string;
  /** Affected block IDs */
  blocks: string[];
  /** User prompt that triggered this (AI events) */
  prompt?: string;
  /** Content before change (AI rewrites) */
  before?: string;
  /** Content after change (AI rewrites) */
  after?: string;
  /** Edit diff summary (user edits) */
  diff?: { added: number; removed: number };
  /** Whether user accepted the AI result */
  accepted?: boolean;
  /** Action name (for ai_action events) */
  action?: string;
  /** Action result summary */
  result?: string;
  /** AI model used */
  model?: string;
  /** Links to the Operation that caused this (batch tracking) */
  operationId?: string;
  /** Links to the canonical lineage patch that caused this receipt. */
  patchId?: string;
  /** Links to the canonical lineage intent frame. */
  intentId?: string;
  /** Links to an external AI/tool receipt where available. */
  receiptId?: string;
  /** Groups provenance receipts that belong to one lineage save cluster. */
  lineageClusterId?: string;
  /** Other notes in the same batch operation */
  relatedNotes?: string[];
}

/**
 * Create a provenance event with auto-generated ID and timestamp.
 */
export function createProvenanceEvent(
  type: ProvenanceEventType,
  data: Omit<ProvenanceEvent, 'id' | 'ts' | 'type'>
): ProvenanceEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    ts: new Date().toISOString(),
    ...data,
  };
}

/**
 * Parse a JSON string into a ProvenanceEvent.
 * Returns null if parsing fails.
 */
export function parseProvenanceEvent(json: string): ProvenanceEvent | null {
  try {
    const parsed = JSON.parse(json) as ProvenanceEvent;
    if (!parsed.id || !parsed.type || !parsed.ts) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if an event is an AI-originated event.
 */
export function isAIEvent(event: ProvenanceEvent): boolean {
  return event.type !== 'user_edit';
}
