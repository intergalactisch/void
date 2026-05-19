/**
 * DeepResearchPhase - phase enum and evidence value types for the deep
 * research pipeline. The orchestrator advances through phases in order;
 * each phase produces structured artefacts that ground the next.
 */

import type { ResearchCitation } from './ResearchCitation';

export type DeepResearchPhase =
  | 'outline'
  | 'discover'
  | 'ingest'
  | 'synthesize'
  | 'overview'
  | 'sources';

export const DEEP_RESEARCH_PHASES: readonly DeepResearchPhase[] = [
  'outline',
  'discover',
  'ingest',
  'synthesize',
  'overview',
  'sources',
] as const;

export interface ResearchAspect {
  id: string;
  slug: string;
  title: string;
  questions: string[];
  noteTitle: string;
}

export interface IngestedSource {
  url: string;
  finalUrl?: string;
  title: string;
  excerpt?: string;
  fetchedAt: string;
  status: 'verified' | 'unverified' | 'failed';
  claims: string[];
  quotes: string[];
  error?: string;
}

export interface AspectEvidence {
  aspectId: string;
  candidateUrls: ResearchCitation[];
  sources: IngestedSource[];
  notePath?: string;
}

export interface DeepResearchState {
  topic: string;
  topicSlug: string;
  folder: string;
  phase: DeepResearchPhase;
  aspects: ResearchAspect[];
  evidence: AspectEvidence[];
  overviewPath?: string;
  sourcesPath?: string;
  startedAt: string;
}
