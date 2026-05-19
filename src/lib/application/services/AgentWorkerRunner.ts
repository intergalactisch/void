/**
 * AgentWorkerRunner - isolated in-app worker execution.
 */

import type {
  AgentArtifactDraft,
  AgentAssignedNote,
  AgentMediaKind,
  AgentResearchEvidenceLevel,
  AgentWorkerMessage,
  AgentWorkerResult,
  AgentWorkerSpec,
  ResearchCitation,
} from '$lib/domain/entities/AgentRun';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { AIResponse, ToolCall } from '$lib/domain/values/AIResponse';
import type { ToolResult } from '$lib/domain/values/ToolResult';
import { createInvocation, startInvocation, completeInvocation } from '$lib/domain/entities/ToolInvocation';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import type { Result } from '$lib/core';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { AIAssistantRequest } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { ToolRegistryService } from '$lib/ports/inbound/ToolRegistryService';
import { serializeContext } from '$lib/domain/values/PromptContext';
import type { Message } from '$lib/domain/entities/Message';
import { createUserMessage, createAssistantMessage } from '$lib/domain/entities/Message';
import { ScopedWorkerToolExecutor } from './ScopedWorkerToolExecutor';

export interface AgentWorkerRunInput {
  runId: string;
  prompt: string;
  spec: AgentWorkerSpec;
  webAccess?: AIWebAccess;
  signal?: AbortSignal;
  priorResults?: AgentWorkerResult[];
  priorMessages?: AgentWorkerMessage[];
  onMessage?: (message: {
    type: Extract<AgentWorkerMessage['type'],
      | 'worker.prompt'
      | 'worker.response'
      | 'worker.progress'
      | 'worker.tool_result'
      | 'worker.artifact_draft'
      | 'worker.result'
      | 'worker.failed'>;
    message: string;
    progress?: number;
    toolId?: string;
    artifactDraft?: AgentArtifactDraft;
    result?: AgentWorkerResult;
    data?: Record<string, unknown>;
  }) => Promise<void>;
}

interface ParsedWorkerResult {
  summary?: string;
  findings?: string[];
  artifactDrafts?: Array<{
    type?: string;
    title?: string;
    path?: string;
    url?: string;
    thumbnailUrl?: string;
    mediaKind?: string;
    content?: string;
    summary?: string;
    confidence?: number;
  }>;
  citations?: ResearchCitation[];
  risks?: string[];
  nextActions?: string[];
  confidence?: number;
}

type WorkerToolCallResult = { call: ToolCall; result: ToolResult };

export class AgentWorkerRunner {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort,
    private readonly toolRegistry: ToolRegistryService,
    private readonly scopedExecutor: ScopedWorkerToolExecutor
  ) {}

  async run(input: AgentWorkerRunInput): Promise<AgentWorkerResult> {
    this.throwIfAborted(input.signal);
    const resume = this.buildResumeContext(input.priorMessages);
    await input.onMessage?.({
      type: 'worker.progress',
      message: resume ? `Worker ${input.spec.title} resumed` : `Worker ${input.spec.title} started`,
      progress: 5,
    });

    const context = await this.contextProvider.getContext();
    const allTools = await this.toolRegistry.getAll(true);
    const workerTools = this.scopedExecutor.filterTools(allTools, input.spec.allowedTools, input.spec);

    const firstRequest: AIAssistantRequest = {
      message: resume ? resume.newMessage : this.buildWorkerPrompt(input),
      context,
      tools: workerTools,
      conversationHistory: resume ? resume.history : [],
      systemPrompt: this.buildSystemPrompt(input.spec, serializeContext(context)),
      temperature: 0.2,
      maxTokens: 1800,
    };
    if (input.webAccess !== undefined) {
      Object.assign(firstRequest, { webAccess: input.webAccess });
    }
    const first = await this.promptWithTrace(input, firstRequest, resume ? 'worker.resume' : 'worker.initial', resume ? 'Resume worker prompt' : 'Initial worker prompt');

    if (!first.ok) throw first.error;
    this.throwIfAborted(input.signal);

    let finalText = first.value.chat;
    let citations = first.value.meta.citations ?? [];
    let toolResults: WorkerToolCallResult[] = [];

    if (first.value.toolCalls.length > 0 && first.value.stopReason === 'tool_use') {
      toolResults = await this.executeToolCalls(first.value.toolCalls, input);
      await input.onMessage?.({
        type: 'worker.progress',
        message: `Worker ${input.spec.title} reviewed ${toolResults.length} tool result${toolResults.length === 1 ? '' : 's'}`,
        progress: 65,
      });

      const followupRequest: AIAssistantRequest = {
        message: this.buildToolResultPrompt(input, toolResults),
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: this.buildSystemPrompt(input.spec, serializeContext(context)),
        temperature: 0.15,
        maxTokens: 1800,
      };
      if (input.webAccess !== undefined) {
        Object.assign(followupRequest, { webAccess: input.webAccess });
      }
      const followup = await this.promptWithTrace(input, followupRequest, 'worker.tool_followup', 'Tool-result follow-up prompt');
      if (!followup.ok) throw followup.error;
      finalText = followup.value.chat;
      citations = [...citations, ...(followup.value.meta.citations ?? [])];
    }

    if (needsStructuredRepair(input.prompt, finalText)) {
      const repairRequest: AIAssistantRequest = {
        message: this.buildStructuredRepairPrompt(input, finalText),
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: this.buildSystemPrompt(input.spec, serializeContext(context)),
        temperature: 0.15,
        maxTokens: 1400,
      };
      if (input.webAccess !== undefined) {
        Object.assign(repairRequest, { webAccess: input.webAccess });
      }
      const repaired = await this.promptWithTrace(input, repairRequest, 'worker.repair', 'Structured repair prompt');
      if (repaired.ok) {
        finalText = repaired.value.chat;
        citations = [...citations, ...(repaired.value.meta.citations ?? [])];
      }
    }

    const result = this.parseResult(input, finalText, citations, toolResults);
    for (const draft of result.artifactDrafts) {
      await input.onMessage?.({
        type: 'worker.artifact_draft',
        message: `Drafted ${draft.title}`,
        artifactDraft: draft,
      });
    }
    await input.onMessage?.({
      type: 'worker.result',
      message: result.summary,
      progress: 100,
      result,
    });
    return result;
  }

  private async promptWithTrace(
    input: AgentWorkerRunInput,
    request: AIAssistantRequest,
    phase: string,
    label: string
  ): Promise<Result<AIResponse, Error>> {
    await input.onMessage?.({
      type: 'worker.prompt',
      message: label,
      data: {
        phase,
        request: serializePromptRequest(request),
      },
    });

    const result = await this.provider.prompt(request);
    if (result.ok) {
      await input.onMessage?.({
        type: 'worker.response',
        message: responseTraceLabel(result.value, label),
        data: {
          phase,
          response: serializePromptResponse(result.value),
        },
      });
    } else {
      await input.onMessage?.({
        type: 'worker.response',
        message: `${label} failed: ${result.error.message}`,
        data: {
          phase,
          error: result.error.message,
        },
      });
    }

    return result;
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    input: AgentWorkerRunInput
  ): Promise<WorkerToolCallResult[]> {
    const results: WorkerToolCallResult[] = [];
    for (const call of toolCalls) {
      this.throwIfAborted(input.signal);
      const invocation = startInvocation(createInvocation({
        toolId: call.toolId,
        args: call.args,
        messageId: call.id,
        confirmed: true,
      }));
      const result = await this.scopedExecutor.execute(invocation, input.spec);
      const completed = completeInvocation(invocation, result);
      await input.onMessage?.({
        type: 'worker.tool_result',
        message: `${completed.toolId} ${completed.status}`,
        toolId: completed.toolId,
        data: {
          status: result.status,
          result: summarizeToolResult(result),
        },
      });
      results.push({ call, result });
    }
    return results;
  }

  private buildWorkerPrompt(input: AgentWorkerRunInput): string {
    const isResearch = classifyDurableAgentPrompt(input.prompt)?.mode === 'research';
    const { assignedNote } = input.spec;
    const priorResultsBlock = buildPriorResultsBlock(input.priorResults);
    const assignedNoteBlock = assignedNote ? buildAssignedNoteBlock(assignedNote) : [];
    const workedExample = isResearch && assignedNote ? buildWorkedExampleBlock() : [];

    return [
      `Parent user request: ${input.prompt}`,
      '',
      `Worker role: ${input.spec.role}`,
      `Worker title: ${input.spec.title}`,
      `Objective: ${input.spec.objective}`,
      `Input: ${input.spec.input}`,
      '',
      'Deliverables:',
      ...input.spec.deliverables.map((item) => `- ${item}`),
      ...assignedNoteBlock,
      ...priorResultsBlock,
      ...workedExample,
      '',
      'Return strict JSON in this shape when you have enough evidence:',
      '{"summary":"short","findings":["finding"],"artifactDrafts":[{"type":"note|summary|source|media|todo|diff","title":"title","path":"optional","url":"https://optional","mediaKind":"article|youtube|image|video|audio|dataset|other","content":"draft markdown","summary":"short","confidence":0.0}],"citations":[],"risks":["risk"],"nextActions":["action"],"confidence":0.0}',
      '',
      'Research quality rules:',
      '- Never return a generic artifact titled "Worker Summary".',
      '- Artifact titles and findings must be specific to the parent request.',
      ...(isResearch
        ? [
            '- Findings must be standalone subject statements of at least 12 words each — facts a reader could quote into a learning note. Not descriptions of what you searched.',
            '- Capture concrete content about what the topic is, what is new or special, the theme/scope, notable examples/items/mechanics, and why it matters.',
            '- For current or latest facts, use native web access or read-only research/search tools when available, and include citations with URLs for claims you present as sourced.',
            '- If a claim is not sourced, state it as a model-prior hypothesis (prefix the finding with "Model-prior:") rather than refusing the note.',
            '- If you have an assignedNote, you MUST call the note:create tool to author it. Do not just return JSON drafts.',
          ]
        : []),
      '- For useful articles, YouTube/videos, images, datasets, or audio, return type "media" with url and mediaKind.',
      '- If you cannot establish findings from context or tools, return risks/open questions and leave artifactDrafts empty.',
      '',
      ...workerToolPolicy(input.spec),
    ].join('\n');
  }

  private buildToolResultPrompt(
    input: AgentWorkerRunInput,
    toolResults: Array<{ call: ToolCall; result: ToolResult }>
  ): string {
    return [
      'Continue the same worker task and return the final strict JSON result.',
      '',
      `Parent request: ${input.prompt}`,
      `Worker objective: ${input.spec.objective}`,
      '',
      'Tool results:',
      ...toolResults.map(({ call, result }) => [
        `Tool: ${call.toolId}`,
        `Status: ${result.status}`,
        `Data: ${summarizeToolResult(result)}`,
      ].join('\n')),
    ].join('\n\n');
  }

  private buildStructuredRepairPrompt(input: AgentWorkerRunInput, previousText: string): string {
    return [
      'Your previous worker response was not structured enough for the orchestrator.',
      '',
      `Parent request: ${input.prompt}`,
      `Worker title: ${input.spec.title}`,
      `Worker objective: ${input.spec.objective}`,
      '',
      'Previous worker response:',
      previousText.trim() || '(empty)',
      '',
      'Do a fresh research-quality repair now. If native web access is available, use it mentally for this response; if read-only tool results are already present in the prompt, use them. The repaired result must be about the actual topic, not about the workflow.',
      '',
      'Return strict JSON only in this shape:',
      '{"summary":"short","findings":["specific finding or model-prior hypothesis"],"artifactDrafts":[{"type":"summary|note|media","title":"topic-specific title","url":"https://optional","mediaKind":"article|youtube|image|video|audio|dataset|other","content":"draft markdown","summary":"short","confidence":0.0}],"citations":[],"risks":["risk or missing evidence"],"nextActions":["action"],"confidence":0.0}',
      '',
      'If you still have no evidence, do not fabricate citations or facts. Return topic-specific open questions and source gaps; leave artifact drafts empty unless the content is explicitly labeled as a research seed.',
    ].join('\n');
  }

  private buildSystemPrompt(spec: AgentWorkerSpec, contextText: string): string {
    return [
      'You are a bounded Void worker agent.',
      'You report findings to the orchestrator. Any writes must stay inside your declared capability and target-resource scope.',
      'Return JSON only for final answers.',
      '',
      `Worker: ${spec.title}`,
      '',
      'Current app context:',
      contextText,
    ].join('\n');
  }

  private parseResult(
    input: AgentWorkerRunInput,
    text: string,
    responseCitations: ResearchCitation[],
    toolResults: WorkerToolCallResult[]
  ): AgentWorkerResult {
    const parsed = parseResultJson(text);
    const findings = sanitizeStringList(parsed?.findings)
      .filter((finding) => !looksLikeGenericCompletion(finding));
    const risks = sanitizeStringList(parsed?.risks);
    const nextActions = sanitizeStringList(parsed?.nextActions);
    const summary = parsed?.summary?.trim() || text.trim().slice(0, 700) || `Completed ${input.spec.title}.`;
    const artifactDrafts = dedupeDrafts([
      ...normalizeDrafts(input.spec.id, parsed?.artifactDrafts),
      ...normalizeToolDrafts(input.spec.id, toolResults),
    ]);
    const citations = [...responseCitations, ...normalizeCitations(parsed?.citations)];
    const isResearch = classifyDurableAgentPrompt(input.prompt)?.mode === 'research';
    const weakStructuredOutput = !parsed || looksLikeGenericCompletion(summary);
    const quality = assessWorkerQuality({
      isResearch,
      parsed,
      summary,
      findings,
      artifactDrafts,
      citations,
    });
    const evidenceLevel = isResearch
      ? workerEvidenceLevel({ findings, artifactDrafts, citations })
      : undefined;
    const finalRisks = [...risks];
    if (isResearch && (weakStructuredOutput || quality === 'insufficient') && finalRisks.length === 0) {
      finalRisks.push('Worker did not return structured research findings; no draft artifact was accepted from this worker.');
    }

    const result: AgentWorkerResult = {
      workerId: input.spec.id,
      title: input.spec.title,
      summary: summary.slice(0, 1200),
      findings: findings.slice(0, 12),
      artifactDrafts,
      citations,
      risks: finalRisks.slice(0, 8),
      nextActions: nextActions.slice(0, 8),
      confidence: clampConfidence(parsed?.confidence),
      quality,
      completedAt: new Date().toISOString(),
    };
    if (evidenceLevel !== undefined) result.evidenceLevel = evidenceLevel;
    return result;
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new Error('Worker cancelled');
    }
  }

  /**
   * If priorMessages contains a user.followup, build a conversationHistory and split off
   * the latest user.followup as the new request.message. Returns null for fresh runs.
   */
  private buildResumeContext(
    priorMessages: AgentWorkerMessage[] | undefined
  ): { newMessage: string; history: Message[] } | null {
    if (!priorMessages || priorMessages.length === 0) return null;
    const hasFollowup = priorMessages.some((m) => m.type === 'user.followup');
    if (!hasFollowup) return null;

    const sorted = [...priorMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const history: Message[] = [];
    for (const m of sorted) {
      if (m.type === 'worker.prompt') {
        const requestData = m.data?.['request'] as { message?: unknown } | undefined;
        const text = typeof requestData?.message === 'string' ? requestData.message : m.message;
        history.push(createUserMessage(text));
      } else if (m.type === 'worker.response') {
        const responseData = m.data?.['response'] as { chat?: unknown } | undefined;
        const text = typeof responseData?.chat === 'string' ? responseData.chat : m.message;
        history.push(createAssistantMessage({ text }));
      } else if (m.type === 'user.followup') {
        history.push(createUserMessage(m.message));
      }
    }

    const last = history.at(-1);
    if (!last || last.role !== 'user') return null;
    history.pop();
    return { newMessage: last.text, history };
  }
}

function parseResultJson(text: string): ParsedWorkerResult | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as ParsedWorkerResult;
  } catch {
    return null;
  }
}

function normalizeDrafts(
  workerId: string,
  drafts: ParsedWorkerResult['artifactDrafts']
): AgentArtifactDraft[] {
  if (!Array.isArray(drafts) || drafts.length === 0) return [];

  return drafts
    .filter((draft) => draft && typeof draft.title === 'string')
    .slice(0, 8)
    .map((draft, index) => {
      const quality = assessDraftQuality(draft);
      const type = normalizeDraftType(draft.type);
      const normalized: AgentArtifactDraft = {
        id: `draft_${workerId}_${index + 1}`,
        workerId,
        type,
        title: draft.title!.slice(0, 120),
        confidence: clampConfidence(draft.confidence),
        createdAt: new Date().toISOString(),
        metadata: { quality },
      };
      if (typeof draft.path === 'string') normalized.path = draft.path.slice(0, 240);
      const url = normalizeUrl(draft.url);
      if (url) normalized.url = url;
      const thumbnailUrl = normalizeUrl(draft.thumbnailUrl);
      if (thumbnailUrl) normalized.thumbnailUrl = thumbnailUrl;
      const mediaKind = type === 'media' ? normalizeMediaKind(draft.mediaKind, url) : undefined;
      if (mediaKind) normalized.mediaKind = mediaKind;
      if (typeof draft.content === 'string') normalized.content = draft.content.slice(0, 20_000);
      if (typeof draft.summary === 'string') normalized.summary = draft.summary.slice(0, 1000);
      return normalized;
    });
}

function normalizeToolDrafts(workerId: string, toolResults: WorkerToolCallResult[]): AgentArtifactDraft[] {
  const drafts: AgentArtifactDraft[] = [];
  for (const { result } of toolResults) {
    if (result.status !== 'success' && result.status !== 'partial') continue;
    const data = result.data;
    if (!data || typeof data !== 'object') continue;
    const record = data as Record<string, unknown>;
    const createdAt = new Date().toISOString();

    if (String(result.toolId) === 'note:create' && typeof record.noteId === 'string') {
      drafts.push({
        id: `draft_${workerId}_tool_${drafts.length + 1}`,
        workerId,
        type: 'note',
        title: typeof record.title === 'string' ? record.title.slice(0, 120) : record.noteId.split('/').pop() ?? record.noteId,
        path: record.noteId,
        summary: 'Staged worker draft written through the scoped tool lane.',
        confidence: 0.75,
        createdAt,
        metadata: {
          quality: 'substantive',
          staged: true,
          toolId: result.toolId,
        },
      });
    }

    if ((String(result.toolId) === 'editor:apply-note-patch' || String(result.toolId) === 'note:update') && typeof record.noteId === 'string') {
      drafts.push({
        id: `draft_${workerId}_tool_${drafts.length + 1}`,
        workerId,
        type: 'diff',
        title: `${record.noteId} proposed patch`,
        path: record.noteId,
        summary: 'Proposed patch applied through the scoped collaboration lane.',
        confidence: 0.7,
        createdAt,
        metadata: {
          quality: 'substantive',
          staged: true,
          toolId: result.toolId,
        },
      });
    }

    if (String(result.toolId) === 'todo:create' && typeof record.todoId === 'string') {
      drafts.push({
        id: `draft_${workerId}_tool_${drafts.length + 1}`,
        workerId,
        type: 'todo',
        title: typeof record.title === 'string' ? record.title.slice(0, 120) : record.todoId,
        summary: 'Scoped worker todo created through the tool lane.',
        confidence: 0.65,
        createdAt,
        metadata: {
          quality: 'substantive',
          staged: true,
          toolId: result.toolId,
          todoId: record.todoId,
        },
      });
    }
  }
  return drafts;
}

function dedupeDrafts(drafts: AgentArtifactDraft[]): AgentArtifactDraft[] {
  const seen = new Set<string>();
  const result: AgentArtifactDraft[] = [];
  for (const draft of drafts) {
    const key = `${draft.type}:${draft.path ?? draft.url ?? draft.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(draft);
  }
  return result;
}

function normalizeDraftType(value: unknown): AgentArtifactDraft['type'] {
  if (
    value === 'note' ||
    value === 'folder' ||
    value === 'source' ||
    value === 'media' ||
    value === 'summary' ||
    value === 'todo' ||
    value === 'diff'
  ) {
    return value;
  }
  return 'summary';
}

function normalizeMediaKind(value: unknown, url?: string): AgentMediaKind | undefined {
  if (
    value === 'article' ||
    value === 'youtube' ||
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'dataset' ||
    value === 'other'
  ) {
    return value;
  }
  if (!url) return undefined;
  const normalized = url.toLowerCase();
  if (/youtu\.be|youtube\.com/.test(normalized)) return 'youtube';
  if (/\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/.test(normalized)) return 'image';
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/.test(normalized)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)(?:[?#]|$)/.test(normalized)) return 'audio';
  if (/\.(csv|tsv|json|parquet|xlsx?|zip)(?:[?#]|$)/.test(normalized)) return 'dataset';
  return 'article';
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href.slice(0, 2000);
  } catch {
    return undefined;
  }
}

function normalizeCitations(value: unknown): ResearchCitation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ResearchCitation =>
    item &&
    typeof item === 'object' &&
    typeof (item as ResearchCitation).url === 'string' &&
    typeof (item as ResearchCitation).title === 'string'
  );
}

function serializePromptRequest(request: AIAssistantRequest): Record<string, unknown> {
  return {
    message: request.message,
    systemPrompt: request.systemPrompt ?? null,
    model: request.model ?? null,
    maxTokens: request.maxTokens ?? null,
    temperature: request.temperature ?? null,
    webAccess: request.webAccess ?? 'off',
    conversationHistoryCount: request.conversationHistory.length,
    tools: request.tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      requiresConfirmation: tool.requiresConfirmation,
      enabled: tool.enabled,
      parameters: tool.parameters,
    })),
  };
}

function serializePromptResponse(response: AIResponse): Record<string, unknown> {
  return {
    chat: response.chat,
    toolCalls: response.toolCalls,
    meta: response.meta,
    truncated: response.truncated,
    stopReason: response.stopReason,
  };
}

function responseTraceLabel(response: AIResponse, label: string): string {
  const toolCount = response.toolCalls.length;
  const toolText = toolCount > 0 ? ` / ${toolCount} tool call${toolCount === 1 ? '' : 's'}` : '';
  return `${label} response from ${response.meta.provider}/${response.meta.model}${toolText}`;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function assessWorkerQuality(input: {
  isResearch: boolean;
  parsed: ParsedWorkerResult | null;
  summary: string;
  findings: string[];
  artifactDrafts: AgentArtifactDraft[];
  citations: ResearchCitation[];
}): NonNullable<AgentWorkerResult['quality']> {
  if (!input.isResearch) {
    return input.parsed ? 'substantive' : 'weak';
  }

  const substantiveDraft = input.artifactDrafts.some((draft) => draft.metadata?.quality === 'substantive');
  const hasResearchEvidence = input.findings.length > 0 || input.citations.length > 0 || substantiveDraft;
  if (!input.parsed || looksLikeGenericCompletion(input.summary)) {
    return hasResearchEvidence ? 'substantive' : 'insufficient';
  }
  return hasResearchEvidence ? 'substantive' : 'insufficient';
}

function workerToolPolicy(spec: AgentWorkerSpec): string[] {
  const writeScope = spec.writeScope ?? 'read_only';
  const targetResources = spec.targetResources ?? [];
  const lines = [
    `Tool capability scope: ${writeScope}.`,
    `Capabilities: ${(spec.capabilities ?? ['read_context']).join(', ')}.`,
  ];

  if (targetResources.length > 0) {
    lines.push(
      'Target resources:',
      ...targetResources.map((resource) => `- ${resource.id}${resource.accessMode ? ` (${resource.accessMode})` : ''}`)
    );
  }

  switch (writeScope) {
    case 'read_only':
      lines.push('You may call read-only tools if useful. Do not write, update, delete, move, navigate, or mutate anything.');
      break;
    case 'staged_draft':
      lines.push(
        'You may create staged draft notes only inside your target resource scope.',
        'Use staged writes for worker-owned draft material, not final user-facing commits.',
        'Do not update existing notes, mutate todos, navigate, delete, move, or overwrite user content.'
      );
      break;
    case 'proposed_patch':
      lines.push(
        'You may apply proposed patches only to explicit target resources through collaboration-aware tools.',
        'Keep patches narrow, preserve existing content, and summarize the patch in your final JSON.',
        'Do not navigate, delete, move, or overwrite unrelated user content.'
      );
      break;
    case 'direct_scoped':
      lines.push(
        'You may use direct scoped writes only for the target resources listed above.',
        'Do not navigate, delete, move, or touch resources outside that scope.'
      );
      break;
  }

  return lines;
}

function needsStructuredRepair(prompt: string, text: string): boolean {
  if (classifyDurableAgentPrompt(prompt)?.mode !== 'research') return false;
  const parsed = parseResultJson(text);
  if (!parsed) return true;
  return looksLikeGenericCompletion(parsed.summary ?? text);
}

function workerEvidenceLevel(input: {
  findings: string[];
  artifactDrafts: AgentArtifactDraft[];
  citations: ResearchCitation[];
}): AgentResearchEvidenceLevel {
  if (input.citations.some((citation) => citation.status === 'verified')) return 'verified_sources';
  if (input.citations.length > 0) return 'unverified_leads';
  if (input.artifactDrafts.some((draft) => draft.type === 'media' && draft.url)) return 'unverified_leads';
  if (
    input.findings.length > 0 ||
    input.artifactDrafts.some((draft) => draft.metadata?.quality === 'substantive')
  ) {
    return 'model_prior';
  }
  return 'scaffold_only';
}

function assessDraftQuality(draft: NonNullable<ParsedWorkerResult['artifactDrafts']>[number]): 'substantive' | 'placeholder' | 'insufficient' {
  const title = typeof draft.title === 'string' ? draft.title : '';
  if (draft.type === 'media') {
    return normalizeUrl(draft.url) && !looksLikePlaceholderTitle(title) ? 'substantive' : 'insufficient';
  }
  const body = [draft.content, draft.summary]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .trim();
  if (looksLikePlaceholderTitle(title) || looksLikeGenericCompletion(body)) return 'placeholder';
  if (wordCount(body) < 12 && !hasResearchTitle(title)) return 'insufficient';
  return 'substantive';
}

function looksLikePlaceholderTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === 'worker summary' ||
    normalized === 'summary' ||
    normalized === 'draft' ||
    normalized.startsWith('worker ');
}

function looksLikeGenericCompletion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^completed\s+[\w\s-]+\.?$/i.test(normalized)) return true;
  const lines = normalized.split(/(?:\n|;|\.)/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^-?\s*completed\s+/i.test(line));
}

function hasResearchTitle(title: string): boolean {
  return /\b(research|overview|brief|findings|analysis|source|sources)\b/i.test(title);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function summarizeToolResult(result: ToolResult): string {
  if (result.status === 'success' || result.status === 'partial') {
    return JSON.stringify(result.data).slice(0, 6000);
  }
  if (result.status === 'failure') return result.error.message;
  return result.reason;
}

function buildAssignedNoteBlock(note: AgentAssignedNote): string[] {
  const lines = [
    '',
    'Note authorship:',
    `- You author EXACTLY ONE note. Call the note:create tool with these arguments:`,
    `    folder: "${note.folder}"`,
    `    title: "${note.title}"`,
    '    autoFocus: false',
    '    content: <substantive markdown body, see rules below>',
    '- The markdown body MUST contain real subject prose, not methodology. Aim for at least 4 distinct paragraphs.',
    '- Use a top-level "# {title}" heading. Use ## subheadings to organise.',
  ];
  if (note.siblingTitles.length > 0) {
    lines.push(
      '- Cross-link siblings using [[Sibling Title]] wikilinks. Valid sibling titles in this constellation:',
      ...note.siblingTitles.slice(0, 12).map((t) => `    - ${t}`)
    );
  }
  if (note.role) {
    const roleHint = {
      overview: 'You are the OVERVIEW worker. Synthesize the entire topic; cross-link every sibling. Use prior worker output as your primary source material.',
      aspect: 'You write ONE aspect of the topic. Stay narrow and concrete to your assigned facet.',
      sources: 'You catalogue citations. Group as Verified vs Unverified; include URL, title, fetched date, and a one-line excerpt per item.',
      media: 'You catalogue media leads (articles, videos, datasets). Include URL and media kind per item.',
      'further-reading': 'You catalogue follow-up topics and related vault notes. Use wikilinks where relevant.',
    }[note.role];
    if (roleHint) lines.push(`- Note role: ${roleHint}`);
  }
  lines.push(
    '- After the tool call succeeds, return your JSON result with summary including the created note path. The note path will also appear automatically in artifactDrafts.',
  );
  return lines;
}

function buildPriorResultsBlock(priorResults: AgentWorkerResult[] | undefined): string[] {
  if (!priorResults || priorResults.length === 0) return [];
  const lines: string[] = ['', 'Prior worker output to synthesize:'];
  for (const prior of priorResults.slice(0, 8)) {
    lines.push(`- Worker "${prior.title}" (summary): ${prior.summary.slice(0, 600)}`);
    if (prior.findings.length > 0) {
      lines.push(
        ...prior.findings.slice(0, 5).map((finding) => `    - finding: ${finding.slice(0, 400)}`)
      );
    }
    if (prior.citations.length > 0) {
      const topCitations = prior.citations.slice(0, 4);
      lines.push(
        ...topCitations.map((citation) =>
          `    - citation: ${citation.title}${citation.url ? ` <${citation.url}>` : ''}${citation.excerpt ? ` — ${citation.excerpt.slice(0, 300)}` : ''}`
        )
      );
    }
    const noteDrafts = prior.artifactDrafts.filter((draft) => draft.type === 'note' && draft.path);
    if (noteDrafts.length > 0) {
      lines.push(
        ...noteDrafts.slice(0, 4).map((draft) => `    - sibling note: ${draft.title} (${draft.path})`)
      );
    }
  }
  lines.push(
    '- Use these findings, citations, and sibling note titles as your primary source material.',
    '- Wikilink siblings by their title when they appear in your assignedNote.siblingTitles.',
  );
  return lines;
}

function buildWorkedExampleBlock(): string[] {
  return [
    '',
    'Worked example (illustrative only, do not copy verbatim):',
    'For a request "Research Rust ownership" with assignedNote.title = "Rust Ownership — Key Concepts" and siblings ["Rust Ownership — Borrowing", "Rust Ownership — Lifetimes"], a good note:create call body would be:',
    '',
    '"# Rust Ownership — Key Concepts',
    '',
    'Each value in Rust has a single owner, the variable bound to it. When ownership moves through assignment, function arguments, or return values, the source binding becomes invalid and cannot be used again. This compile-time discipline gives Rust memory safety without a garbage collector.',
    '',
    'Borrowing relaxes the single-owner rule by allowing temporary references: shared references (`&T`) for read-only aliasing and exclusive references (`&mut T`) for mutation. The compiler enforces that you never hold both kinds simultaneously.',
    '',
    'See also: [[Rust Ownership — Borrowing]], [[Rust Ownership — Lifetimes]]."',
    '',
    'Notice: substantive subject prose, multiple paragraphs, sibling wikilinks. Not "I searched for Rust ownership and found 3 sources".',
  ];
}
