/**
 * TauriWebFetchAdapter - verifies web sources through the Rust backend.
 */

import { invoke } from '@tauri-apps/api/core';
import { ok, err, toError, type Result } from '$lib/core';
import type { WebFetchOptions, WebFetchPort, WebFetchResult } from '$lib/ports/outbound/WebFetchPort';

export class TauriWebFetchAdapter implements WebFetchPort {
  async fetch(url: string, options?: WebFetchOptions): Promise<Result<WebFetchResult, Error>> {
    if (options?.signal?.aborted) {
      return err(new Error('Web fetch cancelled'));
    }

    try {
      const args: { url: string; timeoutMs?: number } = { url };
      if (options?.timeoutMs !== undefined) args.timeoutMs = options.timeoutMs;
      const request = invoke<WebFetchResult>('web_fetch', args);
      const result = options?.signal
        ? await Promise.race([
            request,
            new Promise<WebFetchResult>((_resolve, reject) => {
              options.signal!.addEventListener('abort', () => reject(new Error('Web fetch cancelled')), { once: true });
            }),
          ])
        : await request;
      return ok(result);
    } catch (e) {
      return err(toError(e));
    }
  }
}
