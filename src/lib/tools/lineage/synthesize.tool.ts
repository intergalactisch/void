import { defineTool } from '../define';
import { resolveLineageNoteId } from './helpers';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type {
  LineageAgentContext,
  LineageDeletedLine,
  LineageEditCluster,
} from '$lib/ports/inbound/LineageService';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { Branch } from '$lib/domain/entities/Branch';
import { assertProtectedAIReadAllowed } from '../protectionGuard';

type SynthesisOutput = 'answer' | 'draft' | 'both';

interface SynthesizeArgs {
  noteId?: string;
  question?: string;
  output?: SynthesisOutput;
  includeDeleted?: boolean;
  clusterLimit?: number;
}

interface ParsedSynthesis {
  answer?: string;
  draftMarkdown?: string;
  rationale?: unknown;
  historyInsights?: unknown;
  restoreCandidates?: unknown;
  confidence?: unknown;
}

interface SynthesisResult {
  noteId: string;
  question: string;
  output: SynthesisOutput;
  answer: string;
  draftMarkdown?: string;
  rationale: string[];
  historyInsights: string[];
  restoreCandidates: Array<{
    unitId?: string;
    versionId?: string;
    line?: number | null;
    content: string;
    reason: string;
  }>;
  confidence: number;
  evidence: {
    currentLineCount: number;
    clusterCount: number;
    deletedLineCount: number;
    warningCount: number;
    branchCount: number;
    importantClusters: Array<{
      id: string;
      createdAt: string;
      kind: string;
      summary: string;
      changeTypes: string[];
    }>;
  };
  summary: string;
}

const MAX_CURRENT_MARKDOWN_CHARS = 30_000;
const MAX_MODEL_CONTEXT_CHARS = 45_000;

export default defineTool<SynthesizeArgs, SynthesisResult>({
  id: 'lineage:synthesize',
  name: 'Synthesize From Lineage',
  description: 'Analyze note lineage, deleted lines, branches, and current markdown to answer history questions or propose the best current note draft',
  category: 'intelligence',
  args: {
    noteId: { type: 'string', description: 'Note path. If omitted, uses the currently selected note.' },
    question: {
      type: 'string',
      description: 'Question or goal for the lineage analysis. Examples: "Why did this note change?", "Create the strongest current version from its history."',
    },
    output: {
      type: 'string',
      description: 'Whether to return an answer, a full-note draft, or both',
      enum: ['answer', 'draft', 'both'],
      default: 'both',
    },
    includeDeleted: {
      type: 'boolean',
      description: 'Include deleted line history as possible recovery evidence',
      default: true,
    },
    clusterLimit: {
      type: 'number',
      description: 'Maximum recent edit clusters to inspect',
      minimum: 1,
      maximum: 30,
      default: 12,
    },
  },
  keywords: ['lineage', 'synthesize', 'best version', 'history', 'draft', 'restore'],
  examples: [
    'Answer what changed in this note from its lineage',
    'Create the best version of this note using its history',
    'Analyze deleted lines before drafting a cleaner note',
  ],
  estimatedDuration: 2500,
  accessMode: 'read',
  resourceId: (args) => args.noteId ?? 'active-note',

  async execute(args, { services, progress }) {
    progress(10, 'Resolving note...');
    const noteId = await resolveLineageNoteId(args.noteId, services);
    const output = normalizeOutput(args.output);
    const question = (args.question?.trim() || defaultQuestion(output)).slice(0, 1000);
    const clusterLimit = clampInteger(args.clusterLimit ?? 12, 1, 30);

    progress(25, 'Reading markdown and lineage...');
    const currentMarkdown = await readCurrentMarkdown(noteId, services);
    const context = await services.lineage.getAgentContext(noteId, { clusterLimit });
    if (!context.ok) throw context.error;

    const includeDeleted = args.includeDeleted !== false;
    const deleted = includeDeleted
      ? await readDeletedLines(noteId, services)
      : [];
    const branches = await readPendingBranches(noteId, services);

    progress(55, 'Analyzing note history...');
    const modelPrompt = buildSynthesisPrompt({
      noteId,
      question,
      output,
      currentMarkdown,
      context: context.value,
      deleted,
      branches,
    });

    const response = await services.ai.prompt({
      message: modelPrompt,
      context: createEmptyContext(),
      tools: [],
      conversationHistory: [],
      systemPrompt: [
        'You are Void lineage analyst.',
        'Use only the supplied markdown and lineage evidence.',
        'Return strict JSON only. Do not call tools from inside this response.',
      ].join('\n'),
      temperature: 0.2,
      maxTokens: 5000,
    });
    if (!response.ok) throw new Error(`Lineage synthesis failed: ${response.error.message}`);

    const parsed = parseSynthesisJson(response.value.chat);
    const answer = stringOrFallback(parsed?.answer, response.value.chat.trim() || 'No lineage synthesis was returned.');
    const draft = output === 'answer' ? '' : cleanDraft(parsed?.draftMarkdown);
    const rationale = sanitizeStringList(parsed?.rationale);
    const historyInsights = sanitizeStringList(parsed?.historyInsights);
    const restoreCandidates = sanitizeRestoreCandidates(parsed?.restoreCandidates);
    const confidence = clampConfidence(parsed?.confidence);

    const result: SynthesisResult = {
      noteId,
      question,
      output,
      answer,
      rationale,
      historyInsights,
      restoreCandidates,
      confidence,
      evidence: {
        currentLineCount: context.value.lineCount,
        clusterCount: context.value.clusters.length,
        deletedLineCount: deleted.length,
        warningCount: context.value.warnings.length,
        branchCount: branches.length,
        importantClusters: context.value.clusters.slice(0, 8).map(clusterSummary),
      },
      summary: summarizeResult(noteId, output, answer, draft),
    };
    if (draft) result.draftMarkdown = draft;

    progress(100, 'Lineage synthesis ready');
    return result;
  },

  summary: (_args, result) => result.summary,
});

async function readCurrentMarkdown(noteId: string, services: ToolServices): Promise<string> {
  await assertProtectedAIReadAllowed(services, noteId, 'history.read');
  const content = await services.documents.readContent(noteId);
  if (content.ok) return content.value;

  const materialized = await services.lineage.materialize(noteId);
  if (materialized.ok) return materialized.value;

  throw new Error(`Failed to read ${noteId}: ${content.error.message}`);
}

async function readDeletedLines(
  noteId: string,
  services: ToolServices,
): Promise<LineageDeletedLine[]> {
  const deleted = await services.lineage.getDeletedLines(noteId);
  if (!deleted.ok) throw deleted.error;
  return deleted.value;
}

async function readPendingBranches(
  noteId: string,
  services: ToolServices,
): Promise<Branch[]> {
  if (typeof services.branches.getPendingBranches !== 'function') return [];
  const branches = await services.branches.getPendingBranches(noteId);
  return branches.ok ? branches.value : [];
}

function buildSynthesisPrompt(input: {
  noteId: string;
  question: string;
  output: SynthesisOutput;
  currentMarkdown: string;
  context: LineageAgentContext;
  deleted: LineageDeletedLine[];
  branches: Branch[];
}): string {
  const evidence = truncate([
    'Lineage summary:',
    input.context.summary,
    '',
    'Current active lines:',
    ...input.context.lines.map((line) => {
      const intent = line.intent
        ? `${line.intent.kind}: ${line.intent.summary}`
        : 'unknown intent';
      const actor = line.actor.model || line.actor.name || line.actor.kind;
      return `${line.line}. [${line.unitId}/${line.versionId}] ${actor} | ${intent} | ${line.content}`;
    }),
    '',
    'Recent edit clusters:',
    ...input.context.clusters.map(formatClusterForPrompt),
    '',
    input.deleted.length > 0 ? 'Deleted lines available for possible recovery:' : 'Deleted lines available for possible recovery: none',
    ...input.deleted.slice(0, 30).map(formatDeletedForPrompt),
    '',
    input.branches.length > 0 ? 'Pending lineage branches:' : 'Pending lineage branches: none',
    ...input.branches.slice(0, 8).map(formatBranchForPrompt),
    '',
    input.context.warnings.length > 0 ? 'Open reconciliation warnings:' : 'Open reconciliation warnings: none',
    ...input.context.warnings.slice(0, 12).map((warning) => `- ${warning.id}: ${warning.message}`),
  ].join('\n'), MAX_MODEL_CONTEXT_CHARS);

  return [
    'Analyze this Void note using its line-level lineage sidecar.',
    '',
    `Note: ${input.noteId}`,
    `Requested output: ${input.output}`,
    `User question or goal: ${input.question}`,
    '',
    'Lineage model:',
    '- The markdown is the current portable projection.',
    '- Lineage records stable line units, versions, actors, intents, source links, deleted lines, branches, and repair warnings.',
    '- "Best note" means the strongest current markdown informed by history: preserve useful current work, recover valuable deleted/superseded ideas when they improve the note, and omit clutter or rejected detours.',
    '',
    'Return strict JSON only:',
    '{"answer":"direct answer","draftMarkdown":"full markdown when requested","rationale":["why this synthesis is best"],"historyInsights":["specific lineage insight"],"restoreCandidates":[{"unitId":"optional","versionId":"optional","line":1,"content":"line","reason":"why it matters"}],"confidence":0.0}',
    '',
    'Rules:',
    '- Do not invent actors, edits, versions, branches, or facts not present in the evidence.',
    '- If draftMarkdown is requested, return the complete markdown document, not a patch.',
    '- Preserve YAML frontmatter from the current markdown unless the history clearly supports a metadata change.',
    '- Use deleted lines only when they strengthen the note; mention them in restoreCandidates if relevant.',
    '- Keep the answer concise, but make the draft polished and directly usable.',
    '',
    'Current markdown:',
    truncate(input.currentMarkdown, MAX_CURRENT_MARKDOWN_CHARS),
    '',
    'Lineage evidence:',
    evidence,
  ].join('\n');
}

function formatClusterForPrompt(cluster: LineageEditCluster): string {
  const versions = cluster.versions
    .slice(0, 8)
    .map((version) => {
      const line = version.line === null ? '?' : String(version.line);
      const actor = version.actor.model || version.actor.name || version.actor.kind;
      return `    line ${line} ${version.unitId}/${version.versionId} ${actor}: ${version.content}`;
    })
    .join('\n');
  const deleted = cluster.deletedLines.length > 0
    ? `\n    deleted: ${cluster.deletedLines.slice(0, 5).map((line) => line.content).join(' | ')}`
    : '';
  return [
    `- ${cluster.id} ${cluster.createdAt} ${cluster.kind} (${cluster.changeTypes.join(', ')}): ${cluster.summary}`,
    versions,
    deleted,
  ].filter(Boolean).join('\n');
}

function formatDeletedForPrompt(line: LineageDeletedLine): string {
  const actor = line.actor.model || line.actor.name || line.actor.kind;
  const intent = line.intent ? `${line.intent.kind}: ${line.intent.summary}` : 'unknown intent';
  const lastKnownLine = line.lastKnownLine === null ? '?' : String(line.lastKnownLine);
  return `- [${line.unitId}/${line.versionId}] last line ${lastKnownLine}, deleted ${line.deletedAt}, ${actor}, ${intent}: ${line.content}`;
}

function formatBranchForPrompt(branch: Branch): string {
  return [
    `- ${branch.id} (${branch.status}) created ${branch.created}`,
    `  prompt: ${branch.prompt}`,
    `  content: ${truncate(branch.content, 1200)}`,
  ].join('\n');
}

function clusterSummary(cluster: LineageEditCluster): SynthesisResult['evidence']['importantClusters'][number] {
  return {
    id: cluster.id,
    createdAt: cluster.createdAt,
    kind: cluster.kind,
    summary: cluster.summary,
    changeTypes: cluster.changeTypes,
  };
}

function parseSynthesisJson(text: string): ParsedSynthesis | null {
  const candidates = [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    text.match(/\{[\s\S]*\}/)?.[0],
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ParsedSynthesis;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeRestoreCandidates(value: unknown): SynthesisResult['restoreCandidates'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SynthesisResult['restoreCandidates'][number] | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!content) return null;
      const candidate: SynthesisResult['restoreCandidates'][number] = {
        content,
        reason: typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim()
          : 'Historically relevant line.',
      };
      if (typeof record.unitId === 'string') candidate.unitId = record.unitId;
      if (typeof record.versionId === 'string') candidate.versionId = record.versionId;
      if (typeof record.line === 'number') candidate.line = record.line;
      return candidate;
    })
    .filter((item): item is SynthesisResult['restoreCandidates'][number] => item !== null)
    .slice(0, 12);
}

function normalizeOutput(value: unknown): SynthesisOutput {
  return value === 'answer' || value === 'draft' || value === 'both' ? value : 'both';
}

function defaultQuestion(output: SynthesisOutput): string {
  if (output === 'answer') return 'Explain what the lineage history says about this note.';
  if (output === 'draft') return 'Create the strongest current version of this note from its lineage history.';
  return 'Explain this note history and propose the strongest current version of the note.';
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanDraft(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function summarizeResult(noteId: string, output: SynthesisOutput, answer: string, draft: string): string {
  const hasDraft = draft.trim().length > 0;
  const prefix = output === 'answer'
    ? `Answered lineage question for ${noteId}`
    : hasDraft
      ? `Drafted lineage-informed note for ${noteId}`
      : `Analyzed lineage for ${noteId}`;
  const preview = answer.replace(/\s+/g, ' ').slice(0, 140);
  return preview ? `${prefix}: ${preview}` : prefix;
}
