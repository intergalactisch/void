/**
 * ResearchSourcePort - current-source lookup for research workflows.
 */

import type { Result } from '$lib/core';
import type { ResearchCitation } from '$lib/domain/entities/AgentRun';

export interface ResearchSourceSearchOptions {
  limit?: number;
  signal?: AbortSignal;
  requireVerified?: boolean;
}

export interface ResearchSourcePort {
  search(query: string, options?: ResearchSourceSearchOptions): Promise<Result<ResearchCitation[], Error>>;
}
