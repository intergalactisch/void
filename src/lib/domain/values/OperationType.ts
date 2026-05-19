/**
 * OperationType - Classification of AI operations
 *
 * Determines how an operation is executed:
 * - single: One prompt, one response
 * - batch: Multiple prompts in parallel
 * - pipeline: Sequential prompts with data flow between steps
 * - session: Resumable persistent CLI session (uses --session-id / --resume)
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Operation execution type.
 */
export type OperationType = 'single' | 'batch' | 'pipeline' | 'session';
