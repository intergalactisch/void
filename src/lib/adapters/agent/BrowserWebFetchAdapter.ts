/**
 * BrowserWebFetchAdapter - verifies sources through the browser fetch API.
 *
 * This is intentionally an adapter, not orchestration state. In Tauri builds
 * it can later be replaced by a Rust/reqwest adapter without changing the
 * research workflow.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type { WebFetchOptions, WebFetchPort, WebFetchResult } from '$lib/ports/outbound/WebFetchPort';

export class BrowserWebFetchAdapter implements WebFetchPort {
  async fetch(url: string, options?: WebFetchOptions): Promise<Result<WebFetchResult, Error>> {
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
      }
    } catch (e) {
      return err(toError(e));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8000);
    const abort = () => controller.abort();
    options?.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await globalThis.fetch(parsed.href, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      });

      const contentType = response.headers.get('content-type') ?? undefined;
      const text = await response.text();
      const title = extractTitle(text);
      const excerpt = extractExcerpt(text);
      const result: WebFetchResult = {
        url: parsed.href,
        finalUrl: response.url || parsed.href,
        ok: response.ok,
        status: response.status,
        fetchedAt: new Date().toISOString(),
      };

      if (title) result.title = title;
      if (excerpt) result.excerpt = excerpt;
      if (contentType) result.contentType = contentType;
      if (!response.ok) result.error = `HTTP ${response.status}`;

      return ok(result);
    } catch (e) {
      return ok({
        url: parsed.href,
        finalUrl: parsed.href,
        ok: false,
        status: 0,
        fetchedAt: new Date().toISOString(),
        error: toError(e).message,
      });
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abort);
    }
  }
}

function extractTitle(text: string): string | undefined {
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim();
  return title ? decodeHtml(title).slice(0, 180) : undefined;
}

function extractExcerpt(text: string): string | undefined {
  const meta = text.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)?.[1];
  const raw = meta ?? text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const decoded = decodeHtml(raw);
  return decoded ? decoded.slice(0, 420) : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
