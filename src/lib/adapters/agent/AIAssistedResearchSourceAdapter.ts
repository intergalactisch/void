/**
 * AIAssistedResearchSourceAdapter - asks the configured assistant provider
 * to gather citeable research leads.
 *
 * Providers with browsing/current-source access can return real sources.
 * Providers without it still return a graceful empty set instead of blocking
 * the rest of the orchestration.
 */

import { ok, err, type Result } from '$lib/core';
import type { ResearchCitation } from '$lib/domain/entities/AgentRun';
import type {
  ResearchSourcePort,
  ResearchSourceSearchOptions,
} from '$lib/ports/outbound/ResearchSourcePort';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { WebFetchPort } from '$lib/ports/outbound/WebFetchPort';

interface ParsedCitation {
  title?: string;
  url?: string;
  excerpt?: string;
  fetchedAt?: string;
}

export class AIAssistedResearchSourceAdapter implements ResearchSourcePort {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort,
    private readonly webFetch?: WebFetchPort | null
  ) {}

  async search(
    query: string,
    options?: ResearchSourceSearchOptions
  ): Promise<Result<ResearchCitation[], Error>> {
    if (options?.signal?.aborted) {
      return err(new Error('Research source search cancelled'));
    }

    const available = await this.provider.isAvailable();
    if (!available) {
      return ok([]);
    }

    const limit = options?.limit ?? 5;
    const context = await this.contextProvider.getContext();
    const result = await this.provider.prompt({
      message: [
        `Find up to ${limit} current, citeable web sources for this research request:`,
        query,
        '',
        'Return only JSON in this shape:',
        '[{"title":"...","url":"https://...","excerpt":"short relevance note","fetchedAt":"ISO timestamp"}]',
        'Use native web search if it is available. If you cannot access current web sources, return [].',
      ].join('\n'),
      context,
      tools: [],
      conversationHistory: [],
      systemPrompt: 'You are a research source collector. Return strict JSON only.',
      temperature: 0.2,
      webAccess: 'native',
    });

    if (!result.ok) {
      if (isNativeWebUnavailable(result.error)) {
        return ok([]);
      }
      return err(result.error);
    }

    const parsed = parseCitationJson(result.value.chat);
    const now = new Date().toISOString();
    const candidates: ResearchCitation[] = parsed.slice(0, limit)
      .map((item): ResearchCitation | null => {
        const url = normalizeSourceUrl(item.url);
        if (!url) return null;
        const citation: ResearchCitation = {
          title: item.title?.trim() || url,
          url,
          fetchedAt: item.fetchedAt || now,
          sourceType: 'web',
          status: 'unverified',
        };
        const excerpt = item.excerpt?.trim();
        if (excerpt) citation.excerpt = excerpt;
        return citation;
      })
      .filter((item): item is ResearchCitation => item !== null);

    if (!this.webFetch) {
      return ok(options?.requireVerified === false ? candidates : []);
    }

    const verified: ResearchCitation[] = [];
    for (const candidate of candidates) {
      if (options?.signal?.aborted) {
        return err(new Error('Research source search cancelled'));
      }

      const fetchOptions = options?.signal ? { signal: options.signal } : undefined;
      const fetched = await this.webFetch.fetch(candidate.url, fetchOptions);
      if (!fetched.ok) return err(fetched.error);

      const source: ResearchCitation = {
        ...candidate,
        fetchedAt: fetched.value.fetchedAt,
        status: fetched.value.ok ? 'verified' : 'failed',
        finalUrl: fetched.value.finalUrl,
      };
      if (fetched.value.title) source.title = fetched.value.title;
      if (fetched.value.excerpt) source.excerpt = fetched.value.excerpt;
      if (fetched.value.contentType) source.contentType = fetched.value.contentType;
      if (fetched.value.error) source.error = fetched.value.error;

      if (source.status === 'verified' || options?.requireVerified === false) {
        verified.push(source);
      }
    }

    return ok(verified);
  }
}

function isNativeWebUnavailable(error: Error): boolean {
  return /unexpected argument ['"]?--search|unknown option.*search|websearch|web search.*unavailable|not available/i
    .test(error.message);
}

function parseCitationJson(text: string): ParsedCitation[] {
  const trimmed = text.trim();
  const json = trimmed.startsWith('[')
    ? trimmed
    : trimmed.match(/\[[\s\S]*\]/)?.[0] ?? '[]';

  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as ParsedCitation[] : [];
  } catch {
    return [];
  }
}

function normalizeSourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
