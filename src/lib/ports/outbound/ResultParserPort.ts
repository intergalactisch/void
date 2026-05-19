/**
 * ResultParserPort - Outbound port for parsing CLI output
 *
 * Converts raw CLI responses into structured operation outputs:
 * content, todos, references, metadata.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { OperationOutput, TodoOutput, ReferenceOutput } from '$lib/domain/values/OperationResult';
import type { OperationType } from '$lib/domain/values/OperationType';

/**
 * ResultParser outbound port.
 */
export interface ResultParserPort {
  parse(rawOutput: string, operationType: OperationType): Result<OperationOutput[], Error>;
  parseJson(jsonOutput: string): Result<OperationOutput[], Error>;
  extractContent(raw: string): string;
  extractTodos(raw: string): TodoOutput[];
  extractReferences(raw: string, knownNotes: string[]): ReferenceOutput[];
}
