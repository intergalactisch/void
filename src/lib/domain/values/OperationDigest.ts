/**
 * OperationDigest - Permanent audit trail entry
 *
 * Appended to .void/operations/digest.jsonl when operations complete.
 * Never deleted. ~200 bytes per entry = ~3.6MB/year at 50 ops/day.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export interface OperationDigest {
  /** Operation ID */
  operationId: string;
  /** ISO timestamp */
  ts: string;
  /** Human-readable label */
  label: string;
  /** Truncated prompt (max 200 chars) */
  prompt: string;
  /** Final operation status */
  status: 'completed' | 'failed' | 'cancelled';
  /** Notes that were affected */
  notesAffected: string[];
  /** Total execution time in ms */
  durationMs: number;
}

/**
 * Create a digest entry from operation completion data.
 */
export function createDigestEntry(data: {
  operationId: string;
  label: string;
  prompt: string;
  status: 'completed' | 'failed' | 'cancelled';
  notesAffected: string[];
  durationMs: number;
}): OperationDigest {
  return {
    operationId: data.operationId,
    ts: new Date().toISOString(),
    label: data.label,
    prompt: data.prompt.slice(0, 200),
    status: data.status,
    notesAffected: data.notesAffected,
    durationMs: data.durationMs,
  };
}
