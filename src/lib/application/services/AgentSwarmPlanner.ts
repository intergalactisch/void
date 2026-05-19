/**
 * AgentSwarmPlanner - decomposes a command-center request into workers.
 */

import type {
  AgentAssignedNote,
  AgentAssignedNoteRole,
  AgentWorkerCapability,
  AgentWorkerSpec,
  AgentWorkerTargetResource,
  AgentWorkerWriteScope,
} from '$lib/domain/entities/AgentRun';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import { serializeContext } from '$lib/domain/values/PromptContext';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import { deriveResearchTopic } from '$lib/domain/values/ResearchTopic';
import { getLogger } from '$lib/logging';

const log = getLogger('AgentSwarmPlanner');

export interface AgentSwarmPlan {
  summary: string;
  rationale: string;
  mergeCriteria: string[];
  workers: AgentWorkerSpec[];
}

export interface AgentSwarmPlannerOptions {
  maxWorkers?: number;
  webAccess?: AIWebAccess;
}

interface ParsedWorker {
  title?: string;
  role?: string;
  objective?: string;
  input?: string;
  deliverables?: string[];
  dependencies?: string[];
  allowedTools?: string[];
  writeScope?: string;
  capabilities?: string[];
  targetResources?: Array<{ id?: string; accessMode?: string }>;
  assignedNote?: {
    title?: string;
    folder?: string;
    siblingTitles?: string[];
    role?: string;
  };
}

interface ParsedPlan {
  summary?: string;
  rationale?: string;
  mergeCriteria?: string[];
  workers?: ParsedWorker[];
}

const DEFAULT_WORKER_TOOLS = [
  'note:list',
  'note:read',
  'search:notes',
  'search:content',
  'search:media',
  'fs:read',
  'fs:summarize',
  'content:summarize',
  'content:outline',
  'intelligence:find-related',
  'lineage:actions',
  'lineage:context',
];

const STAGED_DRAFT_TOOLS = ['note:create'];
const PROPOSED_PATCH_TOOLS = ['editor:apply-note-patch', 'editor:insert-blocks', 'editor:replace-block', 'note:update'];

export class AgentSwarmPlanner {
  constructor(
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort
  ) {}

  async plan(prompt: string, options: AgentSwarmPlannerOptions = {}): Promise<AgentSwarmPlan> {
    const isResearch = classifyDurableAgentPrompt(prompt)?.mode === 'research';
    const defaultMaxWorkers = isResearch ? 8 : 4;
    const maxWorkers = clampWorkerCount(options.maxWorkers ?? defaultMaxWorkers);
    const fallback = fallbackPlan(prompt, maxWorkers);

    try {
      if (!(await this.provider.isAvailable())) {
        return fallback;
      }

      const context = await this.contextProvider.getContext();
      const researchFolderHint = isResearch ? suggestConstellationFolder(prompt) : '';
      const constellationRules = isResearch
        ? [
            '',
            'Research constellation rules (ALWAYS apply when the request is research):',
            `- Decompose the topic into ${Math.max(5, Math.min(maxWorkers - 1, 9))}-${maxWorkers} named subject notes plus one Overview note.`,
            '- Every worker authors EXACTLY ONE note via the note:create tool. Assign each worker a unique assignedNote.title.',
            '- The Overview worker has role:"overview" and depends on every other worker; aspect workers have role:"aspect" and no dependencies. A Sources worker (role:"sources") and Further Reading worker (role:"further-reading") are also typical.',
            `- Use a single shared folder for the constellation. Suggested folder: "${researchFolderHint}". Set assignedNote.folder to that exact folder for every worker.`,
            '- Aspect notes describe ONE distinct facet of the topic (history, themes, key examples, mechanics, reception, current state, etc.) in substantive prose.',
            '- Sources/Further Reading notes catalogue citations or media leads.',
            '- The Overview cross-links every sibling via [[Sibling Title]] wikilinks.',
            '- Each note title must be unique within the constellation. Titles must be short, human-readable, and topic-specific (e.g. "Secrets of Strixhaven — Themes & Setting" not "Aspect 1").',
            '- Draft workers must use writeScope:"staged_draft" with allowedTools including "note:create". Read-only workers may not author notes.',
            '- siblingTitles for each worker should list every OTHER worker\'s assignedNote.title in the constellation.',
          ]
        : [];

      const request = {
        message: [
          'Decompose this Void command-center request into bounded in-app worker agents.',
          '',
          'Return strict JSON only in this shape:',
          '{"summary":"short","rationale":"why workers help","mergeCriteria":["criterion"],"workers":[{"title":"short","role":"researcher|analyst|drafter|reviewer","objective":"bounded objective","input":"context to inspect","deliverables":["deliverable"],"dependencies":["worker-id"],"allowedTools":["tool:id"],"writeScope":"read_only|staged_draft|proposed_patch","capabilities":["read_context"],"targetResources":[{"id":"resource-prefix","accessMode":"create|write|read"}],"assignedNote":{"title":"sibling-unique title","folder":"run folder","siblingTitles":["..."],"role":"overview|aspect|sources|media|further-reading"}}]}',
          '',
          'Rules:',
          `- Create between 2 and ${maxWorkers} workers.`,
          '- Workers must declare capabilities. Most workers are read_only.',
          '- Source, media, vault, and reviewer workers should be read_only.',
          '- Draft/synthesis workers may use staged_draft only for worker-owned draft notes; patch workers may use proposed_patch only for explicit target resources.',
          '- Workers must never navigate, delete, move, or perform destructive writes.',
          '- The orchestrator remains responsible for final merge/commit.',
          '- Use dependency IDs only when one worker truly needs another worker first.',
          '- Keep worker scopes independent when possible.',
          '- For research or media requests, prefer these lanes: source scout, media scout, vault/context scout, domain synthesizer, critique/editor.',
          '- Research workers must produce concrete, topic-specific findings and draft material, not methodology summaries about how they searched.',
          '- Media scouts should use search:media when available, then report useful articles, YouTube/videos, images, datasets, or audio as media drafts with URL and mediaKind.',
          ...constellationRules,
          '',
          'Current app context:',
          serializeContext(context),
          '',
          'User request:',
          prompt,
        ].join('\n'),
        context,
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You are Void swarm planner. Return JSON only.',
        temperature: 0.1,
        maxTokens: 1200,
      };
      if (options.webAccess !== undefined) {
        Object.assign(request, { webAccess: options.webAccess });
      }
      const result = await this.provider.prompt(request);

      if (!result.ok) {
        log.warn('Swarm planner provider failed', { error: result.error.message });
        return fallback;
      }

      return normalizeParsedPlan(prompt, parsePlanJson(result.value.chat), maxWorkers) ?? fallback;
    } catch (error) {
      log.warn('Swarm planner fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }
}

export function shouldUseSwarmForPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (/\b(parallel|multi-agent|swarm|several agents|multiple agents)\b/.test(normalized)) return true;
  if (/\b(research|investigate|deep dive|synthesize|compare|map out|create|update|organize)\b/.test(normalized) && wordCount >= 6) {
    return true;
  }
  return /\b(and|plus|also)\b/.test(normalized) && wordCount >= 10;
}

function normalizeParsedPlan(
  prompt: string,
  parsed: ParsedPlan | null,
  maxWorkers: number
): AgentSwarmPlan | null {
  if (!parsed || !Array.isArray(parsed.workers)) return null;
  const isResearch = classifyDurableAgentPrompt(prompt)?.mode === 'research';
  const constellationFolder = isResearch ? suggestConstellationFolder(prompt) : '';

  const workers = parsed.workers
    .map((worker, index) => normalizeWorker(worker, index, prompt, isResearch, constellationFolder))
    .filter((worker): worker is AgentWorkerSpec => worker !== null)
    .slice(0, maxWorkers);

  if (workers.length < 2) return null;
  const workerIds = new Set(workers.map((worker) => worker.id));
  const dedupedTitles = dedupeAssignedNoteTitles(workers);
  const allTitles = dedupedTitles
    .map((w) => w.assignedNote?.title)
    .filter((title): title is string => !!title);
  const safeWorkers: AgentWorkerSpec[] = dedupedTitles.map((worker) => {
    const next: AgentWorkerSpec = {
      ...worker,
      dependencies: worker.dependencies.filter((id) => workerIds.has(id) && id !== worker.id),
    };
    if (worker.assignedNote) {
      next.assignedNote = {
        ...worker.assignedNote,
        siblingTitles: allTitles.filter((t) => t !== worker.assignedNote!.title),
      };
    } else {
      delete next.assignedNote;
    }
    return next;
  });

  return {
    summary: parsed.summary?.slice(0, 500) || `Coordinate ${safeWorkers.length} workers for "${prompt}".`,
    rationale: parsed.rationale?.slice(0, 500) || 'The request has enough breadth to benefit from parallel evidence gathering.',
    mergeCriteria: sanitizeStringList(parsed.mergeCriteria).slice(0, 8),
    workers: safeWorkers,
  };
}

function normalizeWorker(
  worker: ParsedWorker,
  index: number,
  prompt: string,
  isResearch: boolean,
  constellationFolder: string
): AgentWorkerSpec | null {
  const title = worker.title?.trim() || defaultWorkerTitle(index);
  const role = (worker.role?.trim() || defaultWorkerRole(index)).slice(0, 60);
  const objective = worker.objective?.trim() || `${title} for: ${prompt}`;
  const deliverables = sanitizeStringList(worker.deliverables);
  const writeScope = normalizeWriteScope(worker.writeScope, role, title, objective, deliverables);
  const assignedNote = normalizeAssignedNote(worker.assignedNote, {
    title,
    role,
    prompt,
    isResearch,
    constellationFolder,
    writeScope,
  });
  const targetResources = normalizeTargetResources(worker.targetResources);
  if (assignedNote && !targetResources.some((target) => target.id === assignedNote.folder)) {
    targetResources.push({ id: assignedNote.folder, accessMode: 'create' });
  }
  return {
    id: `worker-${index + 1}`,
    title: title.slice(0, 100),
    role,
    objective: objective.slice(0, 600),
    input: (worker.input?.trim() || prompt).slice(0, 1200),
    deliverables: deliverables.length > 0 ? deliverables.slice(0, 8) : ['Findings', 'Draft material', 'Risks'],
    dependencies: sanitizeStringList(worker.dependencies).slice(0, 6),
    allowedTools: normalizeAllowedTools(worker.allowedTools, writeScope),
    writeScope,
    capabilities: normalizeCapabilities(worker.capabilities, writeScope, role),
    targetResources,
    ...(assignedNote ? { assignedNote } : {}),
  };
}

function normalizeAssignedNote(
  raw: ParsedWorker['assignedNote'],
  context: {
    title: string;
    role: string;
    prompt: string;
    isResearch: boolean;
    constellationFolder: string;
    writeScope: AgentWorkerWriteScope;
  }
): AgentAssignedNote | undefined {
  const isAuthoringScope = context.writeScope === 'staged_draft' || context.writeScope === 'direct_scoped';
  const rawTitle = raw?.title?.trim();
  const rawFolder = raw?.folder?.trim();
  const rawRole = raw?.role?.trim();
  if (!rawTitle && !context.isResearch) return undefined;
  if (!rawTitle && !isAuthoringScope) return undefined;

  const topic = deriveResearchTopic(context.prompt).displayTitle;
  const fallbackTitle = context.title.includes(topic)
    ? context.title
    : `${topic} — ${context.title}`;
  const noteTitle = (rawTitle || fallbackTitle).slice(0, 120);
  const folder = (rawFolder || context.constellationFolder || suggestConstellationFolder(context.prompt)).slice(0, 240);
  const role: AgentAssignedNoteRole | undefined =
    rawRole === 'overview' ||
    rawRole === 'aspect' ||
    rawRole === 'sources' ||
    rawRole === 'media' ||
    rawRole === 'further-reading'
      ? rawRole
      : inferAssignedNoteRole(context.title, context.role);
  return {
    title: noteTitle,
    folder,
    siblingTitles: Array.isArray(raw?.siblingTitles)
      ? raw!.siblingTitles!.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [],
    ...(role ? { role } : {}),
  };
}

function inferAssignedNoteRole(workerTitle: string, role: string): AgentAssignedNoteRole | undefined {
  const text = `${workerTitle} ${role}`.toLowerCase();
  if (/\boverview|synthesi[sz]e|brief\b/.test(text)) return 'overview';
  if (/\bsources?|citations?\b/.test(text)) return 'sources';
  if (/\bmedia|video|youtube\b/.test(text)) return 'media';
  if (/\bfurther|reading|follow-?up\b/.test(text)) return 'further-reading';
  if (/\bdraft|aspect|theme|history|concept|example|reception\b/.test(text)) return 'aspect';
  return undefined;
}

function dedupeAssignedNoteTitles(workers: AgentWorkerSpec[]): AgentWorkerSpec[] {
  const seen = new Map<string, number>();
  return workers.map((worker) => {
    if (!worker.assignedNote) return worker;
    const baseTitle = worker.assignedNote.title;
    const key = baseTitle.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return worker;
    return {
      ...worker,
      assignedNote: {
        ...worker.assignedNote,
        title: `${baseTitle} (${count})`,
      },
    };
  });
}

function fallbackPlan(prompt: string, maxWorkers: number): AgentSwarmPlan {
  if (classifyDurableAgentPrompt(prompt)?.mode === 'research') {
    return researchFallbackPlan(prompt, maxWorkers);
  }

  const baseWorkers: AgentWorkerSpec[] = [
    {
      id: 'worker-1',
      title: 'Find relevant notes and context',
      role: 'researcher',
      objective: 'Search the vault and summarize the most relevant existing material.',
      input: prompt,
      deliverables: ['Relevant notes', 'Important excerpts', 'Context gaps'],
      dependencies: [],
      allowedTools: DEFAULT_WORKER_TOOLS,
      writeScope: 'read_only',
      capabilities: ['read_context', 'research'],
      targetResources: [],
    },
    {
      id: 'worker-2',
      title: 'Analyze themes and structure',
      role: 'analyst',
      objective: 'Identify themes, contradictions, missing context, and a useful note structure.',
      input: prompt,
      deliverables: ['Themes', 'Risks', 'Suggested structure'],
      dependencies: [],
      allowedTools: DEFAULT_WORKER_TOOLS,
      writeScope: 'read_only',
      capabilities: ['read_context', 'research'],
      targetResources: [],
    },
    {
      id: 'worker-3',
      title: 'Draft artifact material',
      role: 'drafter',
      objective: 'Draft reusable note sections and source-aware summaries for the orchestrator.',
      input: prompt,
      deliverables: ['Draft sections', 'Potential note titles', 'Follow-ups'],
      dependencies: [],
      allowedTools: [...DEFAULT_WORKER_TOOLS, ...STAGED_DRAFT_TOOLS],
      writeScope: 'staged_draft',
      capabilities: ['read_context', 'draft_artifact', 'stage_note'],
      targetResources: [],
    },
    {
      id: 'worker-4',
      title: 'Review merge quality',
      role: 'reviewer',
      objective: 'Review the proposed direction for duplicate notes, weak evidence, and unsafe assumptions.',
      input: prompt,
      deliverables: ['Review notes', 'Quality risks', 'Acceptance checks'],
      dependencies: [],
      allowedTools: DEFAULT_WORKER_TOOLS,
      writeScope: 'read_only',
      capabilities: ['read_context'],
      targetResources: [],
    },
  ];

  const workers = baseWorkers.slice(0, Math.max(2, maxWorkers));
  return {
    summary: `Coordinate ${workers.length} workers for "${prompt}".`,
    rationale: 'Fallback decomposition uses independent context, analysis, drafting, and review lanes.',
    mergeCriteria: [
      'Use worker findings only as drafts until merged by the orchestrator.',
      'Prefer app-tool writes through the orchestrator.',
      'Surface risks and missing evidence in the final notes.',
    ],
    workers,
  };
}

function researchFallbackPlan(prompt: string, maxWorkers: number): AgentSwarmPlan {
  const topic = deriveResearchTopic(prompt).displayTitle;
  const folder = suggestConstellationFolder(prompt);
  const aspectTemplates: Array<{
    suffix: string;
    role: AgentAssignedNoteRole;
    objective: (t: string) => string;
    deliverables: string[];
    writeScope: AgentWorkerWriteScope;
  }> = [
    {
      suffix: 'Release & Format',
      role: 'aspect',
      objective: (t) => `Author the "${t} — Release & Format" note: when it was released, who released it, the format/structure, packaging, and how to obtain it. Substantive prose, not methodology.`,
      deliverables: ['Concrete release timing and format facts', 'Distribution details', 'Wikilinks to siblings'],
      writeScope: 'staged_draft',
    },
    {
      suffix: 'Themes & Setting',
      role: 'aspect',
      objective: (t) => `Author the "${t} — Themes & Setting" note: the world, themes, narrative hooks, factions or schools, lore, and visual identity. Substantive prose.`,
      deliverables: ['Theme/lore prose', 'Setting summary', 'Sibling wikilinks'],
      writeScope: 'staged_draft',
    },
    {
      suffix: 'Notable Examples & Mechanics',
      role: 'aspect',
      objective: (t) => `Author the "${t} — Notable Examples & Mechanics" note: standout cards, mechanics, characters, items, gameplay loops, or technical features unique to the subject.`,
      deliverables: ['List of notable items with prose explanations', 'Sibling wikilinks'],
      writeScope: 'staged_draft',
    },
    {
      suffix: 'Reception & Reviews',
      role: 'aspect',
      objective: (t) => `Author the "${t} — Reception & Reviews" note: critical and community reception, sales/popularity signals, competitive impact, controversies.`,
      deliverables: ['Reception summary', 'Notable reviewer/community quotes', 'Sibling wikilinks'],
      writeScope: 'staged_draft',
    },
    {
      suffix: 'Sources',
      role: 'sources',
      objective: (t) => `Author the "${t} — Sources" note: catalogue verified citations and source leads with title, URL, and a one-line excerpt. Group by verified vs unverified.`,
      deliverables: ['Bulleted citation list', 'Verified/unverified groupings', 'Sibling wikilinks'],
      writeScope: 'staged_draft',
    },
    {
      suffix: 'Further Reading',
      role: 'further-reading',
      objective: (t) => `Author the "${t} — Further Reading" note: media leads (articles, YouTube/videos, datasets), follow-up topics, and related vault notes worth exploring next.`,
      deliverables: ['Media leads', 'Suggested follow-ups', 'Vault wikilinks'],
      writeScope: 'staged_draft',
    },
  ];

  const aspectCount = Math.max(1, Math.min(aspectTemplates.length, Math.max(2, maxWorkers - 1)));
  const aspects = aspectTemplates.slice(0, aspectCount);

  const aspectWorkers: AgentWorkerSpec[] = aspects.map((aspect, index) => {
    const noteTitle = `${topic} — ${aspect.suffix}`;
    return {
      id: `worker-${index + 1}`,
      title: aspect.suffix,
      role: aspect.role === 'sources' || aspect.role === 'further-reading' ? 'researcher' : 'drafter',
      objective: aspect.objective(topic),
      input: prompt,
      deliverables: aspect.deliverables,
      dependencies: [],
      allowedTools: [...DEFAULT_WORKER_TOOLS, ...STAGED_DRAFT_TOOLS],
      writeScope: aspect.writeScope,
      capabilities: ['read_context', 'research', 'draft_artifact', 'stage_note'],
      targetResources: [{ id: folder, accessMode: 'create' }],
      assignedNote: {
        title: noteTitle,
        folder,
        siblingTitles: [],
        role: aspect.role,
      },
    };
  });

  const overviewWorker: AgentWorkerSpec = {
    id: `worker-${aspectWorkers.length + 1}`,
    title: 'Overview',
    role: 'drafter',
    objective: `Author the "${topic} — Overview" note: synthesize the entire constellation into a single learning-oriented brief. Cross-link to every sibling note via [[Sibling Title]] wikilinks. Use prior worker findings, summaries, and citation excerpts to produce substantive prose, not methodology.`,
    input: prompt,
    deliverables: ['Synthesized overview prose', 'Cross-links to every sibling', 'Evidence-level callout'],
    dependencies: aspectWorkers.map((w) => w.id),
    allowedTools: [...DEFAULT_WORKER_TOOLS, ...STAGED_DRAFT_TOOLS],
    writeScope: 'staged_draft',
    capabilities: ['read_context', 'research', 'draft_artifact', 'stage_note'],
    targetResources: [{ id: folder, accessMode: 'create' }],
    assignedNote: {
      title: `${topic} — Overview`,
      folder,
      siblingTitles: [],
      role: 'overview',
    },
  };

  const allWorkers = [...aspectWorkers, overviewWorker];
  const allTitles = allWorkers.map((w) => w.assignedNote!.title);
  const workers: AgentWorkerSpec[] = allWorkers
    .map((w): AgentWorkerSpec => {
      if (!w.assignedNote) return w;
      return {
        ...w,
        assignedNote: { ...w.assignedNote, siblingTitles: allTitles.filter((t) => t !== w.assignedNote!.title) },
      };
    })
    .slice(0, Math.max(2, maxWorkers));

  return {
    summary: `Coordinate ${workers.length} research workers to author a ${workers.length}-note constellation for "${topic}".`,
    rationale: 'Research mode authors a constellation of cross-linked subject notes. Each worker writes one note via note:create; the overview synthesizes the rest.',
    mergeCriteria: [
      `Each of the ${workers.length} planned notes must exist in ${folder}.`,
      'Notes must contain substantive subject prose, not methodology.',
      'Overview cross-links every sibling via [[Title]] wikilinks.',
      'Sources/Further Reading notes catalogue citations and media.',
    ],
    workers,
  };
}

function suggestConstellationFolder(prompt: string): string {
  const slug = deriveResearchTopic(prompt).slug;
  const date = new Date().toISOString().slice(0, 10);
  return `Research/${slug} ${date}`;
}

function parsePlanJson(text: string): ParsedPlan | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;

  try {
    return JSON.parse(json) as ParsedPlan;
  } catch {
    return null;
  }
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAllowedTools(value: unknown, writeScope: AgentWorkerWriteScope): string[] {
  const requested = sanitizeStringList(value);
  const scopeWriteTools = writeScope === 'staged_draft'
    ? STAGED_DRAFT_TOOLS
    : writeScope === 'proposed_patch'
      ? PROPOSED_PATCH_TOOLS
      : [];
  const allowedPool = new Set([...DEFAULT_WORKER_TOOLS, ...scopeWriteTools]);
  return unique([
    ...requested.filter((tool) => allowedPool.has(tool)),
    ...scopeWriteTools,
  ]);
}

function normalizeWriteScope(
  value: unknown,
  role: string,
  title: string,
  objective: string,
  deliverables: string[]
): AgentWorkerWriteScope {
  if (
    value === 'read_only' ||
    value === 'staged_draft' ||
    value === 'proposed_patch' ||
    value === 'direct_scoped'
  ) {
    return value;
  }

  const text = [role, title, objective, ...deliverables].join(' ').toLowerCase();
  if (/\b(patch|diff|update existing|existing-note|existing note)\b/.test(text)) return 'proposed_patch';
  if (/\b(draft|synthesi[sz]e|synthesis|write brief|brief section)\b/.test(text)) return 'staged_draft';
  return 'read_only';
}

function normalizeCapabilities(
  value: unknown,
  writeScope: AgentWorkerWriteScope,
  role: string
): AgentWorkerCapability[] {
  const parsed = sanitizeStringList(value)
    .filter((item): item is AgentWorkerCapability =>
      item === 'read_context' ||
      item === 'research' ||
      item === 'draft_artifact' ||
      item === 'stage_note' ||
      item === 'propose_patch' ||
      item === 'direct_write'
    );
  const inferred: AgentWorkerCapability[] = ['read_context'];
  if (/research|analyst/i.test(role)) inferred.push('research');
  if (writeScope === 'staged_draft') inferred.push('draft_artifact', 'stage_note');
  if (writeScope === 'proposed_patch') inferred.push('draft_artifact', 'propose_patch');
  if (writeScope === 'direct_scoped') inferred.push('direct_write');
  return unique([...parsed, ...inferred]);
}

function normalizeTargetResources(value: ParsedWorker['targetResources']): AgentWorkerTargetResource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AgentWorkerTargetResource | null => {
      const id = item?.id?.trim();
      if (!id) return null;
      const target: AgentWorkerTargetResource = { id: id.slice(0, 240) };
      if (
        item.accessMode === 'read' ||
        item.accessMode === 'write' ||
        item.accessMode === 'create'
      ) {
        target.accessMode = item.accessMode;
      }
      return target;
    })
    .filter((item): item is AgentWorkerTargetResource => item !== null)
    .slice(0, 8);
}

function clampWorkerCount(value: number): number {
  return Math.max(2, Math.min(12, Math.floor(value)));
}

function unique<T>(items: T[]): T[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function defaultWorkerTitle(index: number): string {
  return ['Find context', 'Analyze themes', 'Draft material', 'Review quality'][index] ?? `Worker ${index + 1}`;
}

function defaultWorkerRole(index: number): string {
  return ['researcher', 'analyst', 'drafter', 'reviewer'][index] ?? 'worker';
}
