/**
 * MethodologyGuard - detects research-process language that should never
 * appear in a final research note. Pure heuristics; no I/O.
 *
 * Why: the deep research pipeline grounds writing in fetched evidence so
 * workers no longer have an excuse to narrate the research process. This
 * guard runs after generation and triggers a repair retry if it fires.
 */

const FIRST_PERSON_NARRATION =
  /(?:^|[.!?]\s+|\n\s*)(?:First |Then |Next |Finally |So |Now |Later )?(?:I|We)\s+(?:searched|search|looked|found|investigated|gathered|reviewed|compiled|examined|located|identified|discovered|browsed|read|consulted|explored|analy[sz]ed|surveyed)\b/i;

const PROCESS_FRAMING =
  /(?:\b(?:research (?:process|methodology|approach|plan)|to research this|in order to (?:research|investigate)|after (?:gathering|searching|reviewing|consulting) (?:sources|the web|materials|references)|the (?:research|investigation) (?:was|will be) conducted)\b|(?:^|\n)\s*methodology\s*:)/i;

const WORKER_META =
  /\b(?:as the \w+ worker|this worker|my (?:assignment|task|objective)|the orchestrator|the swarm|the (?:research|deep research) pipeline|prior worker|fellow workers?)\b/i;

const SOURCE_AS_FINDING =
  /(^|\n)\s*(?:Source\s+\d+|Reference\s+\d+|Citation\s+\d+)\s*[:\-]\s+\w/i;

const SEARCH_RESULTS_HEADING =
  /(^|\n)\s*#+\s*(?:Search\s+Results|Research\s+(?:Process|Methodology|Approach|Notes)|Methodology|My\s+Approach)\b/i;

const ANTICIPATORY_NARRATION =
  /\b(?:I (?:will|am going to|plan to)|We (?:will|are going to|plan to))\s+(?:research|search|look|investigate|gather|explore|examine|analy[sz]e|review)\b/i;

const PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'first-person-narration', regex: FIRST_PERSON_NARRATION },
  { name: 'anticipatory-narration', regex: ANTICIPATORY_NARRATION },
  { name: 'process-framing', regex: PROCESS_FRAMING },
  { name: 'worker-meta', regex: WORKER_META },
  { name: 'source-as-finding', regex: SOURCE_AS_FINDING },
  { name: 'search-results-heading', regex: SEARCH_RESULTS_HEADING },
];

export interface MethodologyHit {
  pattern: string;
  match: string;
}

export function detectMethodologyLanguage(text: string): MethodologyHit[] {
  if (!text) return [];
  const hits: MethodologyHit[] = [];
  for (const { name, regex } of PATTERNS) {
    const match = text.match(regex);
    if (match) hits.push({ pattern: name, match: match[0].trim().slice(0, 160) });
  }
  return hits;
}

export function containsMethodologyLanguage(text: string): boolean {
  return detectMethodologyLanguage(text).length > 0;
}
