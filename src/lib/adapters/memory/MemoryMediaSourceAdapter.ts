/**
 * MemoryMediaSourceAdapter - deterministic media lead adapter.
 */

import { ok, type Result } from '$lib/core';
import type {
  MediaSearchOptions,
  MediaSearchResult,
  MediaSourcePort,
} from '$lib/ports/outbound/MediaSourcePort';

export class MemoryMediaSourceAdapter implements MediaSourcePort {
  constructor(private readonly seeded: MediaSearchResult[] = []) {}

  async search(
    query: string,
    options?: MediaSearchOptions
  ): Promise<Result<MediaSearchResult[], Error>> {
    const limit = options?.limit ?? 6;
    const kinds = new Set(options?.kinds ?? []);
    const candidates = this.seeded.length > 0
      ? this.seeded
      : [{
          title: `Media lead placeholder for ${query}`,
          url: 'https://example.com/media-lead-placeholder',
          mediaKind: 'article' as const,
          summary: 'Mock media lead used when Void is running with memory adapters.',
          confidence: 0.5,
        }];

    const filtered = kinds.size > 0
      ? candidates.filter((item) => kinds.has(item.mediaKind))
      : candidates;

    return ok(filtered.slice(0, limit));
  }
}
