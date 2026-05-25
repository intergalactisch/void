import { ok, type Result } from '$lib/core';
import type { ShareIntentPayload, ShareIntentPort } from '$lib/ports/outbound';

export class MemoryShareIntentAdapter implements ShareIntentPort {
  private initial: ShareIntentPayload | null = null;
  private subscribers = new Set<(payload: ShareIntentPayload) => void>();

  async getInitialIntent(): Promise<Result<ShareIntentPayload | null, Error>> {
    return ok(this.initial ? { ...this.initial, files: [...(this.initial.files ?? [])] } : null);
  }

  subscribe(callback: (payload: ShareIntentPayload) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  emit(payload: ShareIntentPayload): void {
    this.initial = payload;
    for (const callback of this.subscribers) callback(payload);
  }
}
