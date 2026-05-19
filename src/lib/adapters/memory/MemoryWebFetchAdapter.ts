/**
 * MemoryWebFetchAdapter - deterministic source verification for tests/dev.
 */

import { ok, type Result } from '$lib/core';
import type { WebFetchOptions, WebFetchPort, WebFetchResult } from '$lib/ports/outbound/WebFetchPort';

export class MemoryWebFetchAdapter implements WebFetchPort {
  constructor(private readonly seeded = new Map<string, Partial<WebFetchResult>>()) {}

  async fetch(url: string, _options?: WebFetchOptions): Promise<Result<WebFetchResult, Error>> {
    const seeded = this.seeded.get(url);
    const result: WebFetchResult = {
      url,
      finalUrl: seeded?.finalUrl ?? url,
      ok: seeded?.ok ?? true,
      status: seeded?.status ?? 200,
      fetchedAt: seeded?.fetchedAt ?? new Date().toISOString(),
    };

    if (seeded?.title !== undefined) result.title = seeded.title;
    if (seeded?.excerpt !== undefined) result.excerpt = seeded.excerpt;
    if (seeded?.contentType !== undefined) result.contentType = seeded.contentType;
    if (seeded?.error !== undefined) result.error = seeded.error;

    return ok(result);
  }
}
