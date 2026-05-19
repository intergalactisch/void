/**
 * WebFetchPort - verifies external research sources before citation use.
 */

import type { Result } from '$lib/core';

export interface WebFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  title?: string;
  excerpt?: string;
  contentType?: string;
  fetchedAt: string;
  error?: string;
}

export interface WebFetchPort {
  fetch(url: string, options?: WebFetchOptions): Promise<Result<WebFetchResult, Error>>;
}
