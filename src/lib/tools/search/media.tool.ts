import { defineTool } from '../define';
import type { AgentMediaKind } from '$lib/domain/entities/AgentRun';
import type { MediaSearchResult } from '$lib/ports/outbound/MediaSourcePort';

interface SearchMediaArgs {
  query: string;
  kinds?: AgentMediaKind[] | string;
  limit?: number;
}

interface SearchMediaResult {
  query: string;
  results: MediaSearchResult[];
  total: number;
}

const MEDIA_KINDS: AgentMediaKind[] = [
  'article',
  'youtube',
  'image',
  'video',
  'audio',
  'dataset',
  'other',
];

export default defineTool<SearchMediaArgs, SearchMediaResult>({
  id: 'search:media',
  name: 'Search Media',
  description: 'Find useful media leads for research, including articles, YouTube/videos, images, datasets, and audio. Returns URLs and media kinds for orchestrator review.',
  category: 'search',

  args: {
    query: { type: 'string', description: 'Research topic or media search query', required: true },
    kinds: {
      type: 'array',
      description: 'Optional media kinds to include',
      items: {
        type: 'string',
        description: 'Media kind',
        enum: MEDIA_KINDS,
      },
    },
    limit: {
      type: 'number',
      description: 'Maximum number of media leads to return',
      minimum: 1,
      maximum: 12,
      default: 6,
    },
  },
  keywords: ['media', 'youtube', 'video', 'image', 'article', 'dataset', 'source'],
  examples: [
    'Find YouTube videos about local-first AI note apps',
    'Find images and articles for the research brief',
  ],
  estimatedDuration: 8000,
  accessMode: 'read',

  async execute(args, { services, progress, signal }) {
    if (!services.mediaSources) {
      throw new Error('Media source search is not available');
    }

    const query = args.query.trim();
    if (!query) {
      throw new Error('Media search query cannot be empty');
    }

    progress(10, 'Searching media leads...');
    const limit = clampLimit(args.limit);
    const kinds = normalizeKinds(args.kinds);
    const result = await services.mediaSources.search(query, {
      limit,
      ...(kinds.length > 0 ? { kinds } : {}),
      signal,
    });
    if (!result.ok) {
      throw new Error(`Media search failed: ${result.error.message}`);
    }

    progress(100, 'Media search complete');
    return {
      query,
      results: result.value,
      total: result.value.length,
    };
  },

  summary: (args, result) =>
    `Found ${result.total} media lead${result.total === 1 ? '' : 's'} for "${args.query}"`,
});

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 6;
  return Math.max(1, Math.min(12, Math.floor(limit!)));
}

function normalizeKinds(value: AgentMediaKind[] | string | undefined): AgentMediaKind[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : [];
  return raw.filter((item): item is AgentMediaKind =>
    MEDIA_KINDS.includes(item as AgentMediaKind)
  );
}
