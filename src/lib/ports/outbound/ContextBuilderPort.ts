/**
 * ContextBuilderPort - Outbound port for building operation context
 *
 * Reads notes, builds summaries, and assembles context for AI operations.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { OperationContext } from '$lib/domain/values/OperationContext';
import type { ContextRequirement } from '$lib/domain/values/OperationTemplate';

/**
 * Options for context building.
 */
export interface ContextBuildOptions {
  /** Max token budget for the context */
  maxTokens?: number;
  /** Current note path for 'currentNote' requirement */
  currentNotePath?: string;
}

/**
 * ContextBuilder outbound port.
 */
export interface ContextBuilderPort {
  buildContext(
    requirements: ContextRequirement[],
    options?: ContextBuildOptions
  ): Promise<Result<OperationContext, Error>>;
  estimateTokens(context: OperationContext): number;
  trimContext(context: OperationContext, targetTokens: number): OperationContext;
}
