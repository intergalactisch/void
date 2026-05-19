/**
 * AgentIntakeServiceImpl - model-led request routing.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type {
  AgentIntakeDecision,
  AgentIntakeOptions,
  AgentIntakeService,
  ToolCapabilityManifestItem,
} from '$lib/ports/inbound/AgentIntakeService';
import type { ToolRegistryService } from '$lib/ports/inbound/ToolRegistryService';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { Tool } from '$lib/domain/entities/Tool';
import { serializeContext } from '$lib/domain/values/PromptContext';
import type { ResolvedPromptReference } from '$lib/domain/values/PromptContext';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import type { ReferenceService } from '$lib/ports/inbound/ReferenceService';

const DECISION_KINDS = new Set(['direct_answer', 'single_tool_action', 'agent_run']);

export class AgentIntakeServiceImpl implements AgentIntakeService {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly toolRegistry: ToolRegistryService,
    private readonly contextProvider: ContextProviderPort,
    private readonly referenceService?: ReferenceService | null
  ) {}

  async getToolManifest(): Promise<Result<ToolCapabilityManifestItem[], Error>> {
    try {
      const tools = await this.toolRegistry.getAll(true);
      return ok(tools.map(toManifestItem));
    } catch (e) {
      return err(toError(e));
    }
  }

  async decide(prompt: string, _options?: AgentIntakeOptions): Promise<Result<AgentIntakeDecision, Error>> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return err(new Error('Prompt cannot be empty'));
    }

    try {
      const durableResearch = detectDurableResearchIntent(trimmed);
      if (durableResearch) {
        return ok(durableResearch);
      }

      const durableWork = detectDurableMultiStepIntent(trimmed);
      if (durableWork) {
        return ok(durableWork);
      }

      const manifest = await this.getToolManifest();
      if (!manifest.ok) return err(manifest.error);

      const available = await this.provider.isAvailable();
      if (!available) {
        return ok({
          kind: 'direct_answer',
          confidence: 0.35,
          rationale: 'No AI intake provider is configured, so Void will keep this as normal chat.',
        });
      }

      const currentInfo = detectCurrentInfoIntent(trimmed);
      if (currentInfo) {
        return ok(currentInfo);
      }

      let context = await this.contextProvider.getContext();
      if (this.referenceService) {
        const references = await this.referenceService.resolvePrompt(trimmed);
        if (references.ok && references.value.length > 0) {
          context = {
            ...context,
            references: mergeReferences(context.references, references.value),
          };
        }
      }
      const response = await this.provider.prompt({
        message: [
          'Decide how Void should handle this user request.',
          '',
          'Return strict JSON only:',
          '{"kind":"direct_answer|single_tool_action|agent_run","confidence":0.0,"rationale":"short user-facing reason","suggestedToolId":"optional","suggestedMode":"optional"}',
          '',
          'Decision rules:',
          '- direct_answer: conversational answer, explanation, or a small edit that does not need durable orchestration.',
          '- single_tool_action: one obvious typed app action is enough. Bounded action loops ("make N todos", "tag these N notes", "create a folder", "rename this file") also belong here — the chat layer can call the tool repeatedly without durable orchestration.',
          '- agent_run: reserved for work that spans multiple notes, requires research synthesis, or produces a connected artifact set (briefs, dossiers, knowledge bases). Use it when the model would need to create its own task plan AND keep working across multiple app actions to produce linked artifacts.',
          '- Never expose scratchpad, internal prompts, or raw tool blobs to the user.',
          '',
          'Examples:',
          '- "Maak 3 todos" → single_tool_action (todo:create)',
          '- "Hernoem deze notitie naar X" → single_tool_action (note:update)',
          '- "Doe research naar X en maak notities" → agent_run (research)',
          '- "Schrijf een dossier over Y" → agent_run (research)',
          '',
          'Current app context:',
          serializeContext(context),
          '',
          'Available typed tools/capabilities:',
          JSON.stringify(manifest.value.slice(0, 80)),
          '',
          'User request:',
          trimmed,
        ].join('\n'),
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You are Void intake. Choose the safest execution mode from app context and typed capabilities. Return JSON only.',
        temperature: 0,
        maxTokens: 500,
      });

      if (!response.ok) return err(response.error);

      const decision = normalizeDecision(trimmed, parseDecision(response.value.chat));
      return ok(decision ?? {
        kind: 'direct_answer',
        confidence: 0.25,
        rationale: 'The intake model response could not be parsed, so Void will keep this in normal chat.',
      });
    } catch (e) {
      return err(toError(e));
    }
  }
}

function mergeReferences(
  existing: ResolvedPromptReference[],
  incoming: ResolvedPromptReference[]
): ResolvedPromptReference[] {
  const byRef = new Map<string, ResolvedPromptReference>();
  for (const reference of existing) byRef.set(reference.refId, reference);
  for (const reference of incoming) byRef.set(reference.refId, reference);
  return Array.from(byRef.values());
}

function detectDurableResearchIntent(prompt: string): AgentIntakeDecision | null {
  const intent = classifyDurableAgentPrompt(prompt);
  if (intent?.mode !== 'research') {
    return null;
  }

  return {
    kind: 'agent_run',
    confidence: intent.confidence,
    rationale: intent.rationale,
    suggestedMode: 'research',
  };
}

function detectDurableMultiStepIntent(prompt: string): AgentIntakeDecision | null {
  const intent = classifyDurableAgentPrompt(prompt);
  if (intent?.mode !== 'multi_step') {
    return null;
  }

  return {
    kind: 'agent_run',
    confidence: intent.confidence,
    rationale: intent.rationale,
    suggestedMode: 'multi_step',
  };
}

function detectCurrentInfoIntent(prompt: string): AgentIntakeDecision | null {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  const wantsCurrentInfo =
    /\b(latest|today|current|recent|newest|up-to-date|as of now|this week|this month)\b/.test(normalized) ||
    /\b(vandaag|laatste|recent|actueel|huidige|deze week|deze maand)\b/.test(normalized);

  if (!wantsCurrentInfo) {
    return null;
  }

  return {
    kind: 'direct_answer',
    confidence: 0.86,
    rationale: 'This request asks for current information, so Void should answer in chat with native web research enabled.',
    suggestedMode: 'current_info',
  };
}

function normalizeDecision(prompt: string, decision: AgentIntakeDecision | null): AgentIntakeDecision | null {
  const durableResearch = detectDurableResearchIntent(prompt);
  if (durableResearch && decision?.kind !== 'agent_run') {
    return durableResearch;
  }
  const durableWork = detectDurableMultiStepIntent(prompt);
  if (durableWork && decision?.kind !== 'agent_run') {
    return durableWork;
  }
  const currentInfo = detectCurrentInfoIntent(prompt);
  if (currentInfo && decision?.kind === 'direct_answer') {
    if (decision.suggestedMode !== undefined) return decision;
    const suggestedMode = currentInfo.suggestedMode;
    return suggestedMode === undefined ? decision : { ...decision, suggestedMode };
  }
  return decision;
}

function toManifestItem(tool: Tool): ToolCapabilityManifestItem {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    requiresConfirmation: tool.requiresConfirmation,
    parameters: Object.keys(tool.parameters),
  };
}

function parseDecision(text: string): AgentIntakeDecision | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Partial<AgentIntakeDecision>;
    const kind = typeof parsed.kind === 'string' && DECISION_KINDS.has(parsed.kind)
      ? parsed.kind as AgentIntakeDecision['kind']
      : null;
    if (!kind) return null;

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    const decision: AgentIntakeDecision = {
      kind,
      confidence,
      rationale: typeof parsed.rationale === 'string'
        ? parsed.rationale.slice(0, 500)
        : 'Void chose an execution mode from current context and capabilities.',
    };
    if (typeof parsed.suggestedToolId === 'string') decision.suggestedToolId = parsed.suggestedToolId;
    if (typeof parsed.suggestedMode === 'string') decision.suggestedMode = parsed.suggestedMode;
    return decision;
  } catch {
    return null;
  }
}
