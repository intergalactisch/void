import type { Result } from '$lib/core';
import type { RefId, RefIdKind } from '$lib/domain/values/RefId';
import type { ResolvedPromptReference } from '$lib/domain/values/PromptContext';

export interface ReferenceService {
  /**
   * Resolve one copied RefId into compact AI context.
   */
  resolve(refId: string): Promise<Result<ResolvedPromptReference, Error>>;

  /**
   * Resolve many RefIds. Invalid/unavailable refs are returned as unresolved
   * entries instead of failing the whole batch.
   */
  resolveMany(refIds: string[]): Promise<Result<ResolvedPromptReference[], Error>>;

  /**
   * Extract all RefIds from prompt text and resolve them.
   */
  resolvePrompt(prompt: string): Promise<Result<ResolvedPromptReference[], Error>>;
}

export interface ReferenceTargetSummary {
  refId: RefId;
  kind: RefIdKind;
  label: string;
}
