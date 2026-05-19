export type DurableAgentPromptMode = 'research' | 'multi_step';

export interface DurableAgentPromptIntent {
  mode: DurableAgentPromptMode;
  confidence: number;
  rationale: string;
}

/**
 * Deterministic guardrail for prompts that should create durable app work
 * before any model-led intake gets a chance to under-route them as chat.
 */
export function classifyDurableAgentPrompt(prompt: string): DurableAgentPromptIntent | null {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const explicitResearch =
    /^(please\s+)?(do\s+)?(full\s+|deep\s+|extensive\s+|thorough\s+|complete\s+)?(research|deep dive|investigation|study)\s+(on|about|into|for)?\s*\S/.test(normalized) ||
    /^(please\s+)?(can you|could you|please)\s+(do\s+)?(full\s+|deep\s+|extensive\s+|thorough\s+|complete\s+)?(research|investigate|study)\s+(on|about|into|for)?\s*\S/.test(normalized) ||
    /^(doe|maak|voer|start|begin)\s+(een\s+)?(full\s+|deep\s+|uitgebreid(e)?\s+|grondig(e)?\s+|complete\s+|volledig(e)?\s+)?(research|onderzoek)\s+(naar|over|on|about|into|voor)?\s*\S/.test(normalized) ||
    /^(doe\s+)?onderzoek\s+(naar|over|voor)\s+\S/.test(normalized) ||
    /^(kun je|kan je|wil je|zou je)\s+(een\s+)?(full\s+|deep\s+|uitgebreid(e)?\s+|grondig(e)?\s+)?(research|onderzoek\s+doen|onderzoeken)\s+(naar|over|on|about|voor)?\s*\S/.test(normalized) ||
    /\b(create|prepare|write|build|make|maak|schrijf)\s+(a\s+|een\s+)?(research|dossier|briefing|report|rapport|onderzoeksnotitie)\s+(on|about|for|over|naar|voor)\s+\S/.test(normalized);

  if (explicitResearch) {
    return {
      mode: 'research',
      confidence: 0.96,
      rationale: 'Explicit research requests need durable planning, source gathering, note creation, and visible progress.',
    };
  }

  const asksForResearchAndArtifact =
    /\b(research|investigate|study|deep dive|onderzoek|onderzoeken)\b/.test(normalized) &&
    /\b(create|write|build|make|prepare|update|organize|organise|synthesize|maak|schrijf|werk bij|bijwerken|orden|samenvat|verbind)\b/.test(normalized);
  const asksForBroadArtifactWork =
    /\b(create|write|build|prepare|organize|organise|synthesize|update|maak|schrijf|orden|samenbrengen|bijwerken)\b/.test(normalized) &&
    /\b(notes?|brief|briefing|report|dossier|project brief|plan|knowledge base|notities?|rapport|kennisbank)\b/.test(normalized) &&
    /\b(and|with|from|across|using|en|met|vanuit|over)\b/.test(normalized);
  const explicitSwarm =
    /\b(multi-agent|multiple agents|parallel agents|swarm|several agents|meerdere agents|parallelle agents)\b/.test(normalized);

  if (!asksForResearchAndArtifact && !asksForBroadArtifactWork && !explicitSwarm) {
    return null;
  }

  return {
    mode: asksForResearchAndArtifact ? 'research' : 'multi_step',
    confidence: 0.9,
    rationale: 'This request combines multiple steps or artifact creation, so Void should use durable orchestration.',
  };
}
