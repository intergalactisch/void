import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { DeepResearchPhase } from '$lib/domain/values/DeepResearchPhase';
import { getLogger } from '$lib/logging';

const log = getLogger('PhaseNarrator');

export interface PhaseNarration {
  title: string;
  detail: string;
}

export type PhaseNarrationMap = Map<DeepResearchPhase, PhaseNarration>;

export interface NarrateOpeningsInput {
  topic: string;
  prompt: string;
  locale: string;
  fallback: PhaseNarrationMap;
  signal?: AbortSignal;
}

export interface NarrateCompletionInput {
  phase: DeepResearchPhase;
  topic: string;
  locale: string;
  outcomes: Record<string, string | number>;
  fallbackDetail: string;
  signal?: AbortSignal;
}

const PHASE_ORDER: DeepResearchPhase[] = ['outline', 'discover', 'ingest', 'synthesize', 'overview', 'sources'];

const PHASE_PURPOSES: Record<DeepResearchPhase, string> = {
  outline: 'decompose the topic into research aspects',
  discover: 'find citeable web sources per aspect',
  ingest: 'read those sources and extract claims/quotes',
  synthesize: 'write aspect notes from the evidence',
  overview: 'write a cross-linked overview note',
  sources: 'write the bibliography note',
};

interface ParsedOpening {
  items?: Array<{ phaseId?: string; title?: string; detail?: string }>;
}

interface ParsedCompletion {
  detail?: string;
}

export class PhaseNarrator {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort
  ) {}

  async narrateOpenings(input: NarrateOpeningsInput): Promise<PhaseNarrationMap> {
    if (input.signal?.aborted) return input.fallback;
    try {
      const context = await this.contextProvider.getContext();
      const message = buildOpeningPrompt(input.prompt, input.topic, input.locale, input.fallback);
      const response = await this.provider.prompt({
        message,
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You narrate phase progress for the Void deep research orchestrator. Return strict JSON only.',
        temperature: 0.3,
        maxTokens: 800,
      });
      if (!response.ok) {
        log.warn('Opening narration failed; using fallback', { error: response.error.message });
        return input.fallback;
      }
      const parsed = parseJson<ParsedOpening>(response.value.chat);
      if (!parsed?.items?.length) return input.fallback;
      const next: PhaseNarrationMap = new Map(input.fallback);
      for (const item of parsed.items) {
        const phase = item.phaseId as DeepResearchPhase | undefined;
        if (!phase || !PHASE_ORDER.includes(phase)) continue;
        const title = sanitizeText(item.title);
        const detail = sanitizeText(item.detail);
        const fb = input.fallback.get(phase) ?? { title: phase, detail: phase };
        next.set(phase, {
          title: title || fb.title,
          detail: dedupDetail(title || fb.title, detail) || fb.detail,
        });
      }
      return next;
    } catch (error) {
      log.warn('Opening narration threw; using fallback', { error: toMessage(error) });
      return input.fallback;
    }
  }

  async narrateCompletion(input: NarrateCompletionInput): Promise<string> {
    if (input.signal?.aborted) return input.fallbackDetail;
    try {
      const context = await this.contextProvider.getContext();
      const message = buildCompletionPrompt(input.phase, input.topic, input.locale, input.outcomes);
      const response = await this.provider.prompt({
        message,
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You write one-sentence phase summaries for the Void deep research orchestrator. Return strict JSON only.',
        temperature: 0.3,
        maxTokens: 200,
      });
      if (!response.ok) return input.fallbackDetail;
      const parsed = parseJson<ParsedCompletion>(response.value.chat);
      const detail = sanitizeText(parsed?.detail);
      return detail || input.fallbackDetail;
    } catch (error) {
      log.warn('Completion narration threw; using fallback', { error: toMessage(error) });
      return input.fallbackDetail;
    }
  }
}

function buildOpeningPrompt(prompt: string, topic: string, locale: string, fallback: PhaseNarrationMap): string {
  const phaseLines = PHASE_ORDER.map((phase) => {
    const fb = fallback.get(phase);
    return `${phase} — ${PHASE_PURPOSES[phase]}${fb ? ` (fallback title: "${fb.title}")` : ''}`;
  }).join('\n');
  return [
    'You narrate what the Void deep-research orchestrator is about to do, in the user\'s language.',
    '',
    `User asked: "${prompt}"`,
    `Topic: "${topic}"`,
    `Locale: "${locale}" (write all output in this language; fall back to English if unknown).`,
    '',
    'For each of the 6 phases below, write:',
    '- title: 3–6 words, present-tense verb phrase, topic-aware. NOT "Phase 1".',
    '- detail: ONE short sentence, max 12 words, explaining WHAT you will do for THIS phase. MUST NOT restate the title. Mention concrete topic-specific anchors.',
    '',
    'Phases:',
    phaseLines,
    '',
    'Return strict JSON only:',
    '{"items":[{"phaseId":"outline","title":"...","detail":"..."}, ...]}',
  ].join('\n');
}

function buildCompletionPrompt(phase: DeepResearchPhase, topic: string, locale: string, outcomes: Record<string, string | number>): string {
  const outcomeLines = Object.entries(outcomes).map(([key, value]) => `- ${key}: ${value}`).join('\n');
  return [
    `Write a one-sentence summary of what the "${phase}" phase just finished for the topic "${topic}".`,
    `Locale: "${locale}" (write the sentence in this language; fall back to English if unknown).`,
    '',
    'Outcome facts to ground the sentence:',
    outcomeLines || '(no facts)',
    '',
    'Rules:',
    '- One sentence, max 14 words.',
    '- Concrete: include at least one count or specific anchor from the outcome facts.',
    '- No methodology framing ("I searched", "we found"). State the result.',
    '',
    'Return strict JSON only:',
    '{"detail":"..."}',
  ].join('\n');
}

function parseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const json = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function dedupDetail(title: string, detail: string): string {
  if (!detail) return '';
  if (detail.toLowerCase() === title.toLowerCase()) return '';
  return detail;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
