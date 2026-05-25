import type { Result } from '$lib/core';

export interface ShareIntentPayload {
  id: string;
  receivedAt: string;
  title?: string;
  text?: string;
  url?: string;
  files?: string[];
}

export interface ShareIntentPort {
  getInitialIntent(): Promise<Result<ShareIntentPayload | null, Error>>;
  subscribe(callback: (payload: ShareIntentPayload) => void): () => void;
}
