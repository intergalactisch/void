/**
 * TauriExternalNavigationAdapter - opens external URLs and file locations via Tauri.
 *
 * URL safety: openUrl can be reached from markdown links (`[text](url)`) and from
 * AI-generated content. Both sources are untrusted. We restrict the schemes the
 * adapter is willing to hand to the system to a small, safe allowlist so a
 * crafted note can't trigger `javascript:`, `file://`, `data:` or custom-handler
 * exploitation.
 */

import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { ExternalNavigationPort } from '$lib/ports/outbound';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function parseAllowedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!ALLOWED_URL_SCHEMES.has(url.protocol)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export class TauriExternalNavigationAdapter implements ExternalNavigationPort {
  async openUrl(url: string): Promise<Result<void, Error>> {
    const parsed = parseAllowedUrl(url);
    if (!parsed) {
      return err(new Error(`Refusing to open URL with disallowed scheme: ${url}`));
    }
    try {
      await openUrl(parsed.toString());
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async revealPath(path: string): Promise<Result<void, Error>> {
    try {
      await revealItemInDir(path);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
