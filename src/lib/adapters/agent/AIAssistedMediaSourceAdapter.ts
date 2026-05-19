/**
 * AIAssistedMediaSourceAdapter - asks the configured assistant provider
 * to gather useful media leads with URLs and media kinds.
 */

import { ok, err, type Result } from '$lib/core';
import type { AgentMediaKind } from '$lib/domain/entities/AgentRun';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type {
  MediaSearchOptions,
  MediaSearchResult,
  MediaSourcePort,
} from '$lib/ports/outbound/MediaSourcePort';

interface ParsedMediaLead {
  title?: string;
  url?: string;
  mediaKind?: string;
  summary?: string;
  thumbnailUrl?: string;
  creator?: string;
  publishedAt?: string;
  source?: string;
  confidence?: number;
}

export class AIAssistedMediaSourceAdapter implements MediaSourcePort {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort
  ) {}

  async search(
    query: string,
    options?: MediaSearchOptions
  ): Promise<Result<MediaSearchResult[], Error>> {
    if (options?.signal?.aborted) {
      return err(new Error('Media search cancelled'));
    }

    const available = await this.provider.isAvailable();
    if (!available) {
      return ok([]);
    }

    const limit = options?.limit ?? 6;
    const kinds = normalizeKinds(options?.kinds);
    const context = await this.contextProvider.getContext();
    const result = await this.provider.prompt({
      message: [
        `Find up to ${limit} useful media leads for this Void research request:`,
        query,
        '',
        kinds.length > 0
          ? `Only include these media kinds: ${kinds.join(', ')}.`
          : 'Include articles, YouTube/videos, images, datasets, or audio when relevant.',
        '',
        'Return only JSON in this shape:',
        '[{"title":"...","url":"https://...","mediaKind":"article|youtube|image|video|audio|dataset|other","summary":"short relevance note","thumbnailUrl":"https://optional","creator":"optional","publishedAt":"ISO date optional","source":"optional","confidence":0.0}]',
        'Use native web search if available. If you cannot access current media leads, return [].',
      ].join('\n'),
      context,
      tools: [],
      conversationHistory: [],
      systemPrompt: 'You are a media lead collector. Return strict JSON only.',
      temperature: 0.2,
      webAccess: 'native',
    });

    if (!result.ok) {
      if (isNativeWebUnavailable(result.error)) {
        return ok([]);
      }
      return err(result.error);
    }

    const parsed = parseMediaJson(result.value.chat);
    const leads = parsed
      .map(toMediaLead)
      .filter((item): item is MediaSearchResult => item !== null)
      .filter((item) => kinds.length === 0 || kinds.includes(item.mediaKind))
      .slice(0, limit);

    return ok(leads);
  }
}

function toMediaLead(item: ParsedMediaLead): MediaSearchResult | null {
  const url = normalizeUrl(item.url);
  if (!url) return null;

  const mediaKind = normalizeMediaKind(item.mediaKind, url);
  const lead: MediaSearchResult = {
    title: item.title?.trim() || url,
    url,
    mediaKind,
  };

  const summary = item.summary?.trim();
  if (summary) lead.summary = summary;
  const thumbnailUrl = normalizeUrl(item.thumbnailUrl);
  if (thumbnailUrl) lead.thumbnailUrl = thumbnailUrl;
  const creator = item.creator?.trim();
  if (creator) lead.creator = creator;
  const publishedAt = item.publishedAt?.trim();
  if (publishedAt) lead.publishedAt = publishedAt;
  const source = item.source?.trim();
  if (source) lead.source = source;
  if (typeof item.confidence === 'number' && Number.isFinite(item.confidence)) {
    lead.confidence = Math.max(0, Math.min(1, item.confidence));
  }

  return lead;
}

function normalizeKinds(kinds: AgentMediaKind[] | undefined): AgentMediaKind[] {
  if (!Array.isArray(kinds)) return [];
  return kinds.filter(isAgentMediaKind);
}

function isAgentMediaKind(value: unknown): value is AgentMediaKind {
  return (
    value === 'article' ||
    value === 'youtube' ||
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'dataset' ||
    value === 'other'
  );
}

function normalizeMediaKind(value: unknown, url: string): AgentMediaKind {
  if (isAgentMediaKind(value)) return value;
  const normalized = url.toLowerCase();
  if (/youtu\.be|youtube\.com/.test(normalized)) return 'youtube';
  if (/\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/.test(normalized)) return 'image';
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/.test(normalized)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)(?:[?#]|$)/.test(normalized)) return 'audio';
  if (/\.(csv|json|parquet|xlsx|zip)(?:[?#]|$)/.test(normalized)) return 'dataset';
  return 'article';
}

function parseMediaJson(text: string): ParsedMediaLead[] {
  const trimmed = text.trim();
  const json = trimmed.startsWith('[')
    ? trimmed
    : trimmed.match(/\[[\s\S]*\]/)?.[0] ?? '[]';

  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as ParsedMediaLead[] : [];
  } catch {
    return [];
  }
}

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function isNativeWebUnavailable(error: Error): boolean {
  return /unexpected argument ['"]?--search|unknown option.*search|websearch|web search.*unavailable|not available/i
    .test(error.message);
}
