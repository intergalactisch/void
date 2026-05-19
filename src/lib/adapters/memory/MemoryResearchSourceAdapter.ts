/**
 * MemoryResearchSourceAdapter - deterministic research source adapter.
 */

import { ok, type Result } from '$lib/core';
import type { ResearchCitation } from '$lib/domain/entities/AgentRun';
import type {
  ResearchSourcePort,
  ResearchSourceSearchOptions,
} from '$lib/ports/outbound/ResearchSourcePort';

export class MemoryResearchSourceAdapter implements ResearchSourcePort {
  constructor(private readonly seeded: ResearchCitation[] = []) {}

  async search(
    query: string,
    options?: ResearchSourceSearchOptions
  ): Promise<Result<ResearchCitation[], Error>> {
    const limit = options?.limit ?? 5;
    if (this.seeded.length > 0) {
      return ok(this.seeded.slice(0, limit).map((citation) => ({
        ...citation,
        status: citation.status ?? 'verified',
      })));
    }

    const citations: ResearchCitation[] = [
      {
        title: `Research source placeholder for ${query}`,
        url: 'https://example.com/research-source-placeholder',
        excerpt: 'Mock source used when Void is running with memory adapters.',
        fetchedAt: new Date().toISOString(),
        sourceType: 'web',
        status: 'verified',
      },
    ];
    return ok(citations.slice(0, limit));
  }
}
