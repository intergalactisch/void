import { ok, type Result } from '$lib/core';
import type { ShareIntentPayload, ShareIntentPort } from '$lib/ports/outbound';

export class NoopShareIntentAdapter implements ShareIntentPort {
  async getInitialIntent(): Promise<Result<ShareIntentPayload | null, Error>> {
    return ok(null);
  }

  subscribe(_callback: (payload: ShareIntentPayload) => void): () => void {
    return () => undefined;
  }
}
