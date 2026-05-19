/**
 * MemoryExternalNavigationAdapter - test/browser fallback for external navigation.
 */

import type { ExternalNavigationPort } from '$lib/ports/outbound';
import type { Result } from '$lib/core';
import { ok } from '$lib/core';

export class MemoryExternalNavigationAdapter implements ExternalNavigationPort {
  openedUrls: string[] = [];
  revealedPaths: string[] = [];

  async openUrl(url: string): Promise<Result<void, Error>> {
    this.openedUrls.push(url);
    return ok(undefined);
  }

  async revealPath(path: string): Promise<Result<void, Error>> {
    this.revealedPaths.push(path);
    return ok(undefined);
  }
}
