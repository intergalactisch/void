/**
 * OperationResult - Structured output from AI operations
 *
 * Parsed from raw CLI output into actionable items:
 * content (markdown), todos, cross-references, metadata.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { OperationStatus } from './OperationStatus';

/**
 * Content output - markdown text to insert/create.
 */
export interface ContentOutput {
  type: 'content';
  content: string;
  targetNote?: string;
}

/**
 * Todo output - extracted or generated todo item.
 */
export interface TodoOutput {
  type: 'todo';
  text: string;
  targetNote?: string;
  priority?: string;
}

/**
 * Reference output - cross-link between notes.
 */
export interface ReferenceOutput {
  type: 'reference';
  fromNote: string;
  toNote: string;
}

/**
 * Metadata output - tag, title, or other note metadata.
 */
export interface MetadataOutput {
  type: 'metadata';
  key: string;
  value: unknown;
  targetNote?: string;
}

/**
 * Discriminated union of all operation output types.
 */
export type OperationOutput =
  | ContentOutput
  | TodoOutput
  | ReferenceOutput
  | MetadataOutput;

/**
 * Complete result of an operation.
 */
export interface OperationResult {
  /** Final status */
  status: OperationStatus;
  /** Parsed outputs */
  outputs: OperationOutput[];
  /** Raw CLI response */
  rawResponse: string;
  /** Execution duration in ms */
  durationMs: number;
  /** Additional metadata (session_id from JSON output, etc.) */
  metadata: Record<string, unknown>;
}

/**
 * Create an empty operation result.
 */
export function createEmptyOperationResult(): OperationResult {
  return {
    status: 'completed',
    outputs: [],
    rawResponse: '',
    durationMs: 0,
    metadata: {},
  };
}
