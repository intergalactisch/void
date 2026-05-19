/**
 * DeepResearchEvidence - ingests candidate URLs into structured claim
 * and quote bundles that synthesis workers can ground their prose on.
 *
 * The thin excerpts returned by BrowserWebFetchAdapter (≤420 chars) are
 * not enough for substantive writing, so we ask the model with native
 * web access to read each URL and return structured claims/quotes.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { ResearchCitation } from '$lib/domain/entities/AgentRun';
import type { ResearchAspect, IngestedSource } from '$lib/domain/values/DeepResearchPhase';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { WebFetchPort } from '$lib/ports/outbound/WebFetchPort';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import { getLogger } from '$lib/logging';

const log = getLogger('DeepResearchEvidence');

interface ParsedExtraction {
  title?: string;
  claims?: string[];
  quotes?: string[];
}

export interface ExtractionInput {
  topic: string;
  aspect: ResearchAspect;
  citation: ResearchCitation;
  webAccess?: AIWebAccess;
  signal?: AbortSignal;
}

export class DeepResearchEvidence {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort,
    private readonly webFetch: WebFetchPort
  ) {}

  /**
   * Verify a URL is reachable and grab its title/excerpt. Used as a
   * lightweight precheck before asking the model to read it.
   */
  async verify(url: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; finalUrl: string; title?: string; excerpt?: string; fetchedAt: string }, Error>> {
    const fetchOptions = signal ? { signal } : undefined;
    const fetched = await this.webFetch.fetch(url, fetchOptions);
    if (!fetched.ok) return err(fetched.error);
    const result: { ok: boolean; finalUrl: string; title?: string; excerpt?: string; fetchedAt: string } = {
      ok: fetched.value.ok,
      finalUrl: fetched.value.finalUrl,
      fetchedAt: fetched.value.fetchedAt,
    };
    if (fetched.value.title) result.title = fetched.value.title;
    if (fetched.value.excerpt) result.excerpt = fetched.value.excerpt;
    return ok(result);
  }

  async extractFromCitation(input: ExtractionInput): Promise<Result<IngestedSource, Error>> {
    if (input.signal?.aborted) return err(new Error('Source extraction cancelled'));

    const verified = await this.verify(input.citation.url, input.signal);
    const fetchedAt = verified.ok ? verified.value.fetchedAt : new Date().toISOString();
    const baseStatus: IngestedSource['status'] = verified.ok && verified.value.ok ? 'verified' : 'failed';

    const fallback: IngestedSource = {
      url: input.citation.url,
      title: verified.ok ? (verified.value.title ?? input.citation.title) : input.citation.title,
      fetchedAt,
      status: baseStatus,
      claims: [],
      quotes: [],
    };
    if (verified.ok) {
      if (verified.value.finalUrl) fallback.finalUrl = verified.value.finalUrl;
      if (verified.value.excerpt) fallback.excerpt = verified.value.excerpt;
    }
    if (!verified.ok) fallback.error = verified.error.message;

    if (baseStatus === 'failed') return ok(fallback);

    try {
      const context = await this.contextProvider.getContext();
      const message = buildExtractionPrompt(input, fallback);
      const request: Parameters<typeof this.provider.prompt>[0] = {
        message,
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You are a research evidence extractor. Read the given URL and return strict JSON only. Do not invent claims or quotes that are not in the source.',
        temperature: 0.15,
        maxTokens: 1400,
      };
      if (input.webAccess !== undefined) Object.assign(request, { webAccess: input.webAccess });
      const response = await this.provider.prompt(request);
      if (!response.ok) {
        log.warn('Source extraction failed', { url: input.citation.url, error: response.error.message });
        return ok({ ...fallback, status: 'failed', error: response.error.message });
      }

      const parsed = parseExtractionJson(response.value.chat);
      if (!parsed) {
        return ok({ ...fallback, status: 'failed', error: 'Source extraction returned non-JSON output' });
      }

      const claims = sanitizeStringList(parsed.claims).slice(0, 12);
      const quotes = sanitizeStringList(parsed.quotes).slice(0, 6);
      const title = parsed.title?.trim() || fallback.title;
      const result: IngestedSource = {
        url: fallback.url,
        title: title.slice(0, 200),
        fetchedAt: fallback.fetchedAt,
        status: claims.length > 0 || quotes.length > 0 ? 'verified' : 'unverified',
        claims,
        quotes,
      };
      if (fallback.finalUrl) result.finalUrl = fallback.finalUrl;
      if (fallback.excerpt) result.excerpt = fallback.excerpt;
      return ok(result);
    } catch (error) {
      return ok({ ...fallback, status: 'failed', error: toError(error).message });
    }
  }

  async extractAll(
    topic: string,
    aspect: ResearchAspect,
    citations: ResearchCitation[],
    options: { webAccess?: AIWebAccess; signal?: AbortSignal; maxConcurrency?: number } = {}
  ): Promise<IngestedSource[]> {
    if (citations.length === 0) return [];
    const limit = Math.max(1, options.maxConcurrency ?? 4);
    const results: IngestedSource[] = [];
    const queue = [...citations];

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < Math.min(limit, queue.length); i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          if (options.signal?.aborted) return;
          const citation = queue.shift();
          if (!citation) return;
          const input: ExtractionInput = { topic, aspect, citation };
          if (options.webAccess !== undefined) input.webAccess = options.webAccess;
          if (options.signal !== undefined) input.signal = options.signal;
          const result = await this.extractFromCitation(input);
          if (result.ok) results.push(result.value);
        }
      })());
    }
    await Promise.all(workers);
    return results;
  }
}

function buildExtractionPrompt(input: ExtractionInput, source: IngestedSource): string {
  const lines = [
    `Read this source about "${input.topic}" and extract evidence for the aspect "${input.aspect.title}".`,
    '',
    `Source URL: ${source.finalUrl ?? source.url}`,
    source.title ? `Source title: ${source.title}` : '',
    source.excerpt ? `Snippet (may be incomplete): ${source.excerpt}` : '',
    '',
    'Aspect research questions:',
    ...input.aspect.questions.map((question) => `- ${question}`),
    '',
    'Use native web access to read the URL above. Then return strict JSON only in this shape:',
    '{"title":"page title","claims":["one specific factual claim","another claim"],"quotes":["short direct quote with no surrounding commentary"]}',
    '',
    'Rules:',
    '- Each claim is a single concrete fact from the source, written as a complete sentence about the topic itself. Never describe what you did to find it.',
    '- Each quote is a short verbatim string copied from the source (under 30 words). Do not paraphrase quotes.',
    '- Claims and quotes must be specific to the topic and aspect. Skip unrelated boilerplate.',
    '- If the page is paywalled, broken, or off-topic, return {"title":"...","claims":[],"quotes":[]}. Do not invent.',
    '- Never include process language ("I searched", "I found", "after reviewing", "methodology"). Just the facts.',
  ].filter(Boolean);
  return lines.join('\n');
}

function parseExtractionJson(text: string): ParsedExtraction | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as ParsedExtraction;
  } catch {
    return null;
  }
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatEvidenceForSynthesis(
  topic: string,
  aspect: ResearchAspect,
  sources: IngestedSource[]
): string {
  const usable = sources.filter((source) => source.claims.length > 0 || source.quotes.length > 0);
  if (usable.length === 0) {
    return [
      `No verified evidence is available for the aspect "${aspect.title}".`,
      'Write substantive subject prose from prior model knowledge.',
      'Prefix every factual sentence with "*Unverified:*" so the reader sees it is not source-backed.',
    ].join('\n');
  }

  const lines: string[] = [
    `Topic: ${topic}`,
    `Aspect: ${aspect.title}`,
    '',
    'Aspect research questions:',
    ...aspect.questions.map((question) => `- ${question}`),
    '',
    'Evidence — cite inline as [n] where n is the source number below:',
    '',
  ];
  usable.forEach((source, index) => {
    const n = index + 1;
    lines.push(`[${n}] ${source.title}`);
    lines.push(`URL: ${source.finalUrl ?? source.url}`);
    if (source.claims.length > 0) {
      lines.push('Claims:');
      lines.push(...source.claims.map((claim) => `  - ${claim}`));
    }
    if (source.quotes.length > 0) {
      lines.push('Quotes:');
      lines.push(...source.quotes.map((quote) => `  > ${quote}`));
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function citationsForSources(sources: IngestedSource[]): ResearchCitation[] {
  return sources
    .filter((source) => source.status === 'verified')
    .map((source) => {
      const citation: ResearchCitation = {
        title: source.title,
        url: source.url,
        fetchedAt: source.fetchedAt,
        sourceType: 'web',
        status: 'verified',
      };
      if (source.finalUrl) citation.finalUrl = source.finalUrl;
      if (source.excerpt) citation.excerpt = source.excerpt;
      return citation;
    });
}
