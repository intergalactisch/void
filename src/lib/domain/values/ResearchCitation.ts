/**
 * ResearchCitation - normalized citeable source metadata.
 */

export interface ResearchCitation {
  title: string;
  url: string;
  excerpt?: string;
  fetchedAt: string;
  sourceType?: 'web' | 'note' | 'manual' | 'ai';
  status?: 'verified' | 'failed' | 'unverified';
  finalUrl?: string;
  error?: string;
  contentType?: string;
}
