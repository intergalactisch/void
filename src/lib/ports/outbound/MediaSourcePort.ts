/**
 * MediaSourcePort - current media lead lookup for research workflows.
 */

import type { Result } from '$lib/core';
import type { AgentMediaKind } from '$lib/domain/entities/AgentRun';

export interface MediaSearchOptions {
  limit?: number;
  kinds?: AgentMediaKind[];
  signal?: AbortSignal;
}

export interface MediaSearchResult {
  title: string;
  url: string;
  mediaKind: AgentMediaKind;
  summary?: string;
  thumbnailUrl?: string;
  creator?: string;
  publishedAt?: string;
  source?: string;
  confidence?: number;
}

export interface MediaSourcePort {
  search(query: string, options?: MediaSearchOptions): Promise<Result<MediaSearchResult[], Error>>;
}
