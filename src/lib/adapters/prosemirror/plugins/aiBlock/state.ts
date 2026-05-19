/**
 * AI Block Lock Plugin - State Types
 *
 * Defines the state shape for AI block locking with an auto-apply lifecycle:
 * queued -> locking -> streaming -> applying -> complete/error -> unlock
 *
 * The plugin prevents user edits to locked blocks via filterTransaction,
 * tracks streaming text in plugin state (overlay approach — not in the PM doc),
 * and manages phase lifecycles. A single doc-modifying transaction replaces
 * block content at finalization (accept).
 *
 * Part of the ProseMirror infrastructure adapter.
 */

/** Lifecycle phases for an AI block lock */
export type AIBlockPhase = 'queued' | 'locking' | 'streaming' | 'applying' | 'complete' | 'error';

/** Lock metadata for a single block */
export interface AIBlockLock {
  blockId: string;
  operation: string;
  phase: AIBlockPhase;
  originalContent: string;
  streamedText: string;
  abortId: string;
  lockedAt: number;
  error: string | null;
}

/** Plugin state: map of blockId -> lock metadata */
export type AIBlockState = Map<string, AIBlockLock>;

/** Meta types for dispatching AI block lock transactions */
export type AIBlockMeta =
  | { type: 'LOCK'; blockId: string; operation: string; originalContent: string; abortId: string; expectedContent?: string }
  | { type: 'QUEUE'; blockId: string; operation: string; originalContent: string; abortId: string; expectedContent?: string }
  | { type: 'STREAM_CHUNK'; blockId: string; text: string }
  | { type: 'STREAM_COMPLETE'; blockId: string }
  | { type: 'APPLYING'; blockId: string }
  | { type: 'COMPLETE'; blockId: string }
  | { type: 'ACCEPT'; blockId: string }
  | { type: 'REJECT'; blockId: string }
  | { type: 'CANCEL'; blockId: string }
  | { type: 'CANCEL_ALL' }
  | { type: 'ERROR'; blockId: string; message: string }
  | { type: 'PHASE'; blockId: string; phase: AIBlockPhase };
