/**
 * DeepResearchPipeline - multi-phase orchestrator for research runs.
 *
 * Phases:
 *   1. outline    — decompose topic into 4–7 aspects with research questions
 *   2. discover   — per-aspect candidate URL discovery (parallel)
 *   3. ingest     — fetch + extract claims/quotes from each URL (parallel)
 *   4. synthesize — per-aspect note grounded in extracted evidence (parallel)
 *   5. overview   — single overview note that cross-links every aspect note
 *   6. sources    — bibliography note aggregating every verified citation
 *
 * Locks (ResourceLock keyed on the note creation path) serialise writes so two
 * workers cannot race a single note.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type {
  AgentRun,
  AgentTask,
  AgentTaskKind,
  AgentWorker,
  AgentWorkerMessage,
  AgentWorkerSpec,
  AgentWorkerResult,
  AgentMergeState,
  AgentArtifactDraft,
  ResearchCitation,
} from '$lib/domain/entities/AgentRun';
import {
  createAgentWorkerMessage,
  createAgentWorker,
  setAgentWorkerStatus,
} from '$lib/domain/entities/AgentRun';
import type {
  AspectEvidence,
  DeepResearchPhase,
  DeepResearchState,
  IngestedSource,
  ResearchAspect,
} from '$lib/domain/values/DeepResearchPhase';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { AIAssistantRequest } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { ResearchSourcePort } from '$lib/ports/outbound/ResearchSourcePort';
import type { NoteCollaborationService } from '$lib/ports/inbound/NoteCollaborationService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import { deriveResearchTopic } from '$lib/domain/values/ResearchTopic';
import { resourceLock } from '$lib/events/queue/ResourceLock';
import { containsMethodologyLanguage } from '$lib/domain/values/MethodologyGuard';
import { AgentRunEngine } from './AgentRunEngine';
import { DeepResearchEvidence, formatEvidenceForSynthesis, citationsForSources } from './DeepResearchEvidence';
import { DEFAULT_PHASE_TIMEOUTS, withWatchdog, type PhaseTimeouts } from './PhaseWatchdog';
import { PhaseNarrator, type PhaseNarrationMap } from './PhaseNarrator';
import { getLogger } from '$lib/logging';

const log = getLogger('DeepResearchPipeline');

const DEFAULT_ASPECT_COUNT = 5;
const MAX_ASPECT_COUNT = 7;
const MIN_ASPECT_COUNT = 4;
const MAX_URLS_PER_ASPECT = 4;
const INGEST_CONCURRENCY = 4;
const SYNTHESIS_CONCURRENCY = 3;

export interface DeepResearchPipelineInput {
  run: AgentRun;
  prompt: string;
  targetFolder?: string;
  webAccess?: AIWebAccess;
  signal?: AbortSignal;
  mutateRun: (mutator: (current: AgentRun) => Promise<AgentRun>) => Promise<AgentRun>;
}

export interface DeepResearchPipelineResult {
  run: AgentRun;
  finalSummary: string;
  createdNotePaths: string[];
}

export interface DeepResearchPipelineOptions {
  timeouts?: Partial<PhaseTimeouts>;
}

interface ParsedOutline {
  aspects?: Array<{ slug?: string; title?: string; questions?: unknown[] }>;
}

interface ParsedSynthesisDraft {
  title?: string;
  content?: string;
  summary?: string;
  citationIndexes?: number[];
}

type DeepResearchWorkerTraceMessage = {
  type: Extract<AgentWorkerMessage['type'], 'worker.prompt' | 'worker.response'>;
  message: string;
  data?: Record<string, unknown>;
};

export class DeepResearchPipeline {
  constructor(
    private readonly engine: AgentRunEngine,
    private readonly provider: AIAssistantProviderPort,
    private readonly contextProvider: ContextProviderPort,
    private readonly researchSources: ResearchSourcePort,
    private readonly evidence: DeepResearchEvidence,
    private readonly collaboration: NoteCollaborationService,
    private readonly documents: DocumentService,
    private readonly narrator: PhaseNarrator,
    private readonly options: DeepResearchPipelineOptions = {}
  ) {}

  async run(input: DeepResearchPipelineInput): Promise<Result<DeepResearchPipelineResult, Error>> {
    const startedAt = new Date().toISOString();
    const topic = deriveResearchTopic(input.prompt);
    const folder = input.targetFolder?.trim() || `Research/${topic.slug} ${startedAt.slice(0, 10)}`;
    const webAccess = input.webAccess ?? 'off';
    const hasWebAccess = webAccess === 'native';
    const createdNotePaths: string[] = [];
    const timeouts: PhaseTimeouts = { ...DEFAULT_PHASE_TIMEOUTS, ...this.options.timeouts };

    const locale = detectLocale(input.prompt);
    const fallbackNarration: PhaseNarrationMap = new Map([
      ['outline', { title: 'Outline research aspects', detail: `Outlining "${topic.displayTitle}"` }],
      ['discover', { title: 'Discover citeable sources', detail: hasWebAccess ? `Discovering sources for the aspects` : 'Web access disabled — skipping discovery' }],
      ['ingest', { title: 'Read sources and extract claims', detail: hasWebAccess ? 'Reading sources and extracting claims' : 'No web access — skipping ingest' }],
      ['synthesize', { title: 'Write aspect notes', detail: 'Writing aspect notes from the evidence' }],
      ['overview', { title: 'Write overview note', detail: `Synthesising "${topic.displayTitle}" overview` }],
      ['sources', { title: 'Write sources note', detail: 'Writing Sources note' }],
    ]);

    try {
      let current = await input.mutateRun(async (run) => {
        const next: AgentRun = {
          ...run,
          deepResearch: {
            topic: topic.displayTitle,
            topicSlug: topic.slug,
            folder,
            phase: 'outline',
            aspects: [],
            evidence: [],
            startedAt,
          },
        };
        return next;
      });

      const narrationOpenings = await this.narrator.narrateOpenings({
        topic: topic.displayTitle,
        prompt: input.prompt,
        locale,
        fallback: fallbackNarration,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      current = await this.createPhaseTasks(current, input, narrationOpenings);

      const openingDetail = (phase: DeepResearchPhase, fallback: string) =>
        narrationOpenings.get(phase)?.detail ?? fallback;

      // Phase 1: outline
      current = await this.setPhaseStart(current, input, 'outline', openingDetail('outline', `Outlining "${topic.displayTitle}"`));
      let aspects: ResearchAspect[];
      try {
        aspects = await withWatchdog(
          'outline',
          timeouts.outline,
          (signal) => this.planOutline(input.prompt, topic.displayTitle, webAccess, signal),
          input.signal,
          async () => { current = await this.setPhaseComplete(current, input, 'outline', 'Phase timed out', true); }
        );
      } catch (error) {
        const message = toError(error).message;
        if (current.tasks.find((t) => t.id === 'phase:outline')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'outline', message, true);
        }
        return err(toError(error));
      }
      if (input.signal?.aborted) {
        current = await this.setPhaseComplete(current, input, 'outline', 'Cancelled before outline finished', true);
        return err(new Error('Deep research cancelled'));
      }
      current = await input.mutateRun(async (run) => mergeDeepResearch(run, { aspects, evidence: aspects.map((aspect) => ({ aspectId: aspect.id, candidateUrls: [], sources: [] })) }));
      current = await this.attachAspectWorkers(current, input, aspects);
      {
        const fallback = `Outlined ${aspects.length} aspect${aspects.length === 1 ? '' : 's'}`;
        const detail = await this.narrator.narrateCompletion({
          phase: 'outline',
          topic: topic.displayTitle,
          locale,
          outcomes: { aspects_outlined: aspects.length },
          fallbackDetail: fallback,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        current = await this.setPhaseComplete(current, input, 'outline', detail);
      }

      // Phase 2: discover (parallel per aspect)
      current = await this.setPhaseStart(current, input, 'discover', openingDetail('discover', hasWebAccess ? `Discovering sources for ${aspects.length} aspects` : 'Web access disabled — skipping discovery'));
      if (hasWebAccess) {
        try {
          await withWatchdog(
            'discover',
            timeouts.discover,
            (signal) => this.runParallel(aspects, DEFAULT_ASPECT_COUNT, async (aspect) => {
              if (signal.aborted) {
                await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'discover', 'cancelled', 'Cancelled before discovery'));
                return;
              }
              await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'discover', 'running'));
              try {
                const query = buildAspectDiscoveryQuery(topic.displayTitle, aspect);
                const result = await this.researchSources.search(query, {
                  limit: MAX_URLS_PER_ASPECT,
                  requireVerified: false,
                  signal,
                });
                const candidates = result.ok ? result.value : [];
                await input.mutateRun(async (run) => {
                  const updated = setAspectCandidates(run, aspect.id, candidates);
                  return updateAspectTask(updated, aspect.id, 'discover', 'completed', `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`);
                });
              } catch (error) {
                const message = toError(error).message;
                log.warn('discover aspect failed', { aspectId: aspect.id, error: message });
                await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'discover', 'failed', message));
              }
            }),
            input.signal,
            async () => { current = await this.setPhaseComplete(current, input, 'discover', 'Phase timed out', true); }
          );
        } catch (error) {
          const message = toError(error).message;
          if (current.tasks.find((t) => t.id === 'phase:discover')?.status === 'running') {
            current = await this.setPhaseComplete(current, input, 'discover', message, true);
          }
          return err(toError(error));
        }
      } else {
        for (const aspect of aspects) {
          current = await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'discover', 'completed', 'Skipped — no web access'));
        }
      }
      if (current.tasks.find((t) => t.id === 'phase:discover')?.status === 'running') {
        const fallback = hasWebAccess ? 'Source discovery done' : 'Skipped — no web access';
        const candidateCount = current.deepResearch?.evidence.reduce((sum, entry) => sum + entry.candidateUrls.length, 0) ?? 0;
        const detail = hasWebAccess
          ? await this.narrator.narrateCompletion({
              phase: 'discover',
              topic: topic.displayTitle,
              locale,
              outcomes: { candidate_sources_found: candidateCount, aspects_searched: aspects.length },
              fallbackDetail: fallback,
              ...(input.signal ? { signal: input.signal } : {}),
            })
          : fallback;
        current = await this.setPhaseComplete(current, input, 'discover', detail);
      }

      // Phase 3: ingest
      current = await this.setPhaseStart(current, input, 'ingest', openingDetail('ingest', hasWebAccess ? 'Reading sources and extracting claims' : 'No web access — skipping ingest'));
      if (hasWebAccess) {
        try {
          await withWatchdog(
            'ingest',
            timeouts.ingest,
            async (signal) => {
              const aspectsWithCandidates = current.deepResearch?.evidence.filter((entry) => entry.candidateUrls.length > 0) ?? [];
              for (const entry of aspectsWithCandidates) {
                const aspect = aspects.find((a) => a.id === entry.aspectId);
                if (!aspect) continue;
                if (signal.aborted) return;
                try {
                  const sources = await this.evidence.extractAll(topic.displayTitle, aspect, entry.candidateUrls, {
                    webAccess,
                    maxConcurrency: INGEST_CONCURRENCY,
                    signal,
                  });
                  await input.mutateRun(async (run) => setAspectSources(run, aspect.id, sources));
                } catch (error) {
                  log.warn('ingest aspect failed', { aspectId: aspect.id, error: toError(error).message });
                  await input.mutateRun(async (run) => setAspectSources(run, aspect.id, []));
                }
              }
            },
            input.signal,
            async () => { current = await this.setPhaseComplete(current, input, 'ingest', 'Phase timed out', true); }
          );
        } catch (error) {
          const message = toError(error).message;
          if (current.tasks.find((t) => t.id === 'phase:ingest')?.status === 'running') {
            current = await this.setPhaseComplete(current, input, 'ingest', message, true);
          }
          return err(toError(error));
        }
      }
      if (current.tasks.find((t) => t.id === 'phase:ingest')?.status === 'running') {
        const fallback = hasWebAccess ? 'Evidence extracted' : 'Skipped — no web access';
        const verifiedSources = current.deepResearch?.evidence.reduce(
          (sum, entry) => sum + entry.sources.filter((s) => s.status === 'verified').length,
          0
        ) ?? 0;
        const detail = hasWebAccess
          ? await this.narrator.narrateCompletion({
              phase: 'ingest',
              topic: topic.displayTitle,
              locale,
              outcomes: { verified_sources: verifiedSources, aspects_ingested: aspects.length },
              fallbackDetail: fallback,
              ...(input.signal ? { signal: input.signal } : {}),
            })
          : fallback;
        current = await this.setPhaseComplete(current, input, 'ingest', detail);
      }

      // Phase 4: synthesize
      current = await this.setPhaseStart(current, input, 'synthesize', openingDetail('synthesize', `Writing ${aspects.length} aspect note${aspects.length === 1 ? '' : 's'}`));
      const synthRisks: string[] = [];
      try {
        await withWatchdog(
          'synthesize',
          timeouts.synthesize,
          (signal) => this.runParallel(aspects, SYNTHESIS_CONCURRENCY, async (aspect) => {
        if (signal.aborted) {
          await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'synthesize', 'cancelled', 'Cancelled before synthesis'));
          return;
        }
        await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'synthesize', 'running'));
        const evidence = current.deepResearch?.evidence.find((entry) => entry.aspectId === aspect.id);
        const sources = evidence?.sources ?? [];
        try {
          const synthesisParams: Parameters<DeepResearchPipeline['synthesizeAspect']>[0] = {
            topic: topic.displayTitle,
            aspect,
            folder,
            sources,
            hasWebAccess,
            siblingTitles: aspects.filter((other) => other.id !== aspect.id).map((other) => other.noteTitle),
            runId: input.run.id,
            webAccess,
            signal,
            onTrace: async (message) => {
              await input.mutateRun(async (run) => appendDeepResearchWorkerMessage(run, aspect.id, message));
            },
          };
          const written = await this.synthesizeAspect(synthesisParams);
          createdNotePaths.push(written.path);
          await input.mutateRun(async (run) => {
            const updated = setAspectNotePath(run, aspect.id, written.path);
            const next = recordAspectWorkerResult(updated, aspect.id, {
              workerId: aspect.id,
              title: aspect.noteTitle,
              summary: written.summary,
              findings: written.findings,
              artifactDrafts: [{
                id: `draft_${aspect.id}_note`,
                workerId: aspect.id,
                type: 'note',
                title: aspect.noteTitle,
                path: written.path,
                summary: written.summary,
                confidence: 0.8,
                createdAt: new Date().toISOString(),
                metadata: { quality: 'substantive', staged: true, evidence: written.evidenceCount },
              }],
              citations: written.citations,
              risks: written.risks,
              nextActions: [],
              confidence: 0.8,
              quality: 'substantive',
              ...(written.evidenceLevel ? { evidenceLevel: written.evidenceLevel } : {}),
              completedAt: new Date().toISOString(),
            });
            return updateAspectTask(next, aspect.id, 'synthesize', 'completed', written.summary);
          });
          if (written.risks.length > 0) synthRisks.push(...written.risks);
        } catch (error) {
          const message = toError(error).message;
          synthRisks.push(`Aspect "${aspect.title}" failed: ${message}`);
          await input.mutateRun(async (run) => updateAspectTask(run, aspect.id, 'synthesize', 'failed', message));
        }
          }),
          input.signal,
          async () => { current = await this.setPhaseComplete(current, input, 'synthesize', 'Phase timed out', true); }
        );
      } catch (error) {
        const message = toError(error).message;
        if (current.tasks.find((t) => t.id === 'phase:synthesize')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'synthesize', message, true);
        }
        return err(toError(error));
      }
      if (current.tasks.find((t) => t.id === 'phase:synthesize')?.status === 'running') {
        const fallback = `${createdNotePaths.length} aspect note${createdNotePaths.length === 1 ? '' : 's'} written`;
        const detail = await this.narrator.narrateCompletion({
          phase: 'synthesize',
          topic: topic.displayTitle,
          locale,
          outcomes: { notes_written: createdNotePaths.length, aspects_attempted: aspects.length, risks: synthRisks.length },
          fallbackDetail: fallback,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        current = await this.setPhaseComplete(current, input, 'synthesize', detail);
      }

      // Phase 5: overview
      current = await this.setPhaseStart(current, input, 'overview', openingDetail('overview', `Synthesising "${topic.displayTitle}" overview`));
      let overviewResult: Awaited<ReturnType<DeepResearchPipeline['writeOverviewNote']>>;
      try {
        overviewResult = await withWatchdog(
          'overview',
          timeouts.overview,
          (signal) => this.writeOverviewNote({
            topic,
            folder,
            aspects,
            hasWebAccess,
            runId: input.run.id,
            webAccess,
            signal,
          }),
          input.signal,
          async () => { current = await this.setPhaseComplete(current, input, 'overview', 'Phase timed out', true); }
        );
      } catch (error) {
        const message = toError(error).message;
        if (current.tasks.find((t) => t.id === 'phase:overview')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'overview', message, true);
        }
        overviewResult = err(toError(error));
      }
      if (overviewResult.ok) {
        createdNotePaths.push(overviewResult.value.path);
        current = await input.mutateRun(async (run) => setOverviewPath(run, overviewResult.value.path));
        if (current.tasks.find((t) => t.id === 'phase:overview')?.status === 'running') {
          const detail = await this.narrator.narrateCompletion({
            phase: 'overview',
            topic: topic.displayTitle,
            locale,
            outcomes: { overview_path: overviewResult.value.path, aspects_linked: aspects.length },
            fallbackDetail: 'Overview written',
            ...(input.signal ? { signal: input.signal } : {}),
          });
          current = await this.setPhaseComplete(current, input, 'overview', detail);
        }
      } else {
        synthRisks.push(`Overview write failed: ${overviewResult.error.message}`);
        if (current.tasks.find((t) => t.id === 'phase:overview')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'overview', `Failed: ${overviewResult.error.message}`, true);
        }
      }

      // Phase 6: sources
      current = await this.setPhaseStart(current, input, 'sources', openingDetail('sources', 'Writing Sources note'));
      let sourcesResult: Awaited<ReturnType<DeepResearchPipeline['writeSourcesNote']>>;
      try {
        sourcesResult = await withWatchdog(
          'sources',
          timeouts.sources,
          () => this.writeSourcesNote({
            topic,
            folder,
            aspects,
            evidence: current.deepResearch?.evidence ?? [],
            hasWebAccess,
          }),
          input.signal,
          async () => { current = await this.setPhaseComplete(current, input, 'sources', 'Phase timed out', true); }
        );
      } catch (error) {
        const message = toError(error).message;
        if (current.tasks.find((t) => t.id === 'phase:sources')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'sources', message, true);
        }
        sourcesResult = err(toError(error));
      }
      if (sourcesResult.ok) {
        createdNotePaths.push(sourcesResult.value.path);
        current = await input.mutateRun(async (run) => setSourcesPath(run, sourcesResult.value.path));
        if (current.tasks.find((t) => t.id === 'phase:sources')?.status === 'running') {
          const totalVerified = current.deepResearch?.evidence.reduce(
            (sum, entry) => sum + entry.sources.filter((s) => s.status === 'verified').length,
            0
          ) ?? 0;
          const detail = await this.narrator.narrateCompletion({
            phase: 'sources',
            topic: topic.displayTitle,
            locale,
            outcomes: { citations_listed: totalVerified, sources_path: sourcesResult.value.path },
            fallbackDetail: 'Sources note written',
            ...(input.signal ? { signal: input.signal } : {}),
          });
          current = await this.setPhaseComplete(current, input, 'sources', detail);
        }
      } else {
        synthRisks.push(`Sources note failed: ${sourcesResult.error.message}`);
        if (current.tasks.find((t) => t.id === 'phase:sources')?.status === 'running') {
          current = await this.setPhaseComplete(current, input, 'sources', `Failed: ${sourcesResult.error.message}`, true);
        }
      }

      // Build merge state for UI compatibility
      const aspectArtifactDrafts: AgentArtifactDraft[] = current.workers
        .flatMap((worker) => worker.result?.artifactDrafts ?? [])
        .filter((draft) => draft.type === 'note');
      const overviewDraft = overviewResult.ok ? buildOrchestratorNoteDraft(overviewResult.value.path, `${topic.displayTitle} — Overview`, 'Cross-linked overview of the constellation.') : null;
      const sourcesDraft = sourcesResult.ok ? buildOrchestratorNoteDraft(sourcesResult.value.path, `${topic.displayTitle} — Sources`, 'Verified bibliography for this research run.') : null;
      const allDrafts = [...aspectArtifactDrafts, ...(overviewDraft ? [overviewDraft] : []), ...(sourcesDraft ? [sourcesDraft] : [])];
      const finalSummary = buildFinalSummary(topic.displayTitle, createdNotePaths, hasWebAccess, synthRisks);
      const evidenceLevel = deriveEvidenceLevel(current);
      const merge: AgentMergeState = {
        status: 'completed',
        summary: `Deep research written: ${createdNotePaths.length} note${createdNotePaths.length === 1 ? '' : 's'}.`,
        writePrompt: null,
        sourceWorkerIds: aspects.map((aspect) => aspect.id),
        artifactDrafts: allDrafts,
        touchedExistingNotes: [],
        risks: synthRisks,
        startedAt,
        completedAt: new Date().toISOString(),
        ...(evidenceLevel ? { evidenceLevel } : {}),
      };
      current = await input.mutateRun(async (run) => ({ ...run, merge, finalSummary }));

      return ok({ run: current, finalSummary, createdNotePaths });
    } catch (error) {
      return err(toError(error));
    }
  }

  private async createPhaseTasks(initialRun: AgentRun, input: DeepResearchPipelineInput, narration: PhaseNarrationMap): Promise<AgentRun> {
    const titleFor = (phase: DeepResearchPhase, fallback: string) => narration.get(phase)?.title ?? fallback;
    const phases: Array<{ id: string; title: string; kind: AgentTaskKind; deps: string[] }> = [
      { id: 'phase:outline', title: titleFor('outline', 'Outline research aspects'), kind: 'plan', deps: [] },
      { id: 'phase:discover', title: titleFor('discover', 'Discover citeable sources'), kind: 'search', deps: ['phase:outline'] },
      { id: 'phase:ingest', title: titleFor('ingest', 'Read sources and extract claims'), kind: 'web', deps: ['phase:discover'] },
      { id: 'phase:synthesize', title: titleFor('synthesize', 'Write aspect notes'), kind: 'worker', deps: ['phase:ingest'] },
      { id: 'phase:overview', title: titleFor('overview', 'Write overview note'), kind: 'merge', deps: ['phase:synthesize'] },
      { id: 'phase:sources', title: titleFor('sources', 'Write sources note'), kind: 'create', deps: ['phase:overview'] },
    ];
    let next = initialRun;
    for (const phase of phases) {
      next = await this.must(this.engine.createTask(next, {
        id: phase.id,
        title: phase.title,
        kind: phase.kind,
        dependencies: phase.deps,
      }));
    }
    return await input.mutateRun(async () => next);
  }

  private async attachAspectWorkers(initialRun: AgentRun, input: DeepResearchPipelineInput, aspects: ResearchAspect[]): Promise<AgentRun> {
    let next = initialRun;
    const folder = next.deepResearch?.folder ?? '';
    const newWorkers: AgentWorker[] = [];
    for (const aspect of aspects) {
      const spec: AgentWorkerSpec = {
        id: aspect.id,
        title: aspect.title,
        role: 'drafter',
        objective: `Write the "${aspect.title}" aspect note for "${aspect.noteTitle}". Use only the ingested evidence — no methodology, no process narration.`,
        input: aspect.questions.join('\n'),
        deliverables: ['Aspect note grounded in evidence', 'Inline [n] citations', 'Sibling wikilinks'],
        dependencies: [],
        allowedTools: [],
        writeScope: 'staged_draft',
        capabilities: ['read_context', 'research', 'draft_artifact', 'stage_note'],
        targetResources: [{ id: folder, accessMode: 'create' }],
        assignedNote: {
          title: aspect.noteTitle,
          folder,
          siblingTitles: aspects.filter((other) => other.id !== aspect.id).map((other) => other.noteTitle),
          role: 'aspect',
        },
      };
      newWorkers.push(createAgentWorker({ runId: next.id, spec }));
      next = await this.must(this.engine.createTask(next, {
        id: `aspect:${aspect.id}:discover`,
        title: `${aspect.title} — discover sources`,
        kind: 'search',
        dependencies: ['phase:outline'],
        parentId: 'phase:discover',
        detail: aspect.questions[0] ?? aspect.title,
      }));
      next = await this.must(this.engine.createTask(next, {
        id: `aspect:${aspect.id}:synthesize`,
        title: `${aspect.title} — write note`,
        kind: 'worker',
        dependencies: ['phase:ingest'],
        parentId: 'phase:synthesize',
        detail: aspect.noteTitle,
      }));
    }
    next = { ...next, workers: [...next.workers, ...newWorkers] };
    return await input.mutateRun(async () => next);
  }

  private async planOutline(prompt: string, topic: string, webAccess: AIWebAccess, signal?: AbortSignal): Promise<ResearchAspect[]> {
    if (signal?.aborted) throw new Error('Deep research cancelled');
    const context = await this.contextProvider.getContext();
    const message = [
      `Decompose this research request into ${MIN_ASPECT_COUNT}–${MAX_ASPECT_COUNT} aspects (default ${DEFAULT_ASPECT_COUNT}).`,
      '',
      `Topic: ${topic}`,
      `User request: ${prompt}`,
      '',
      'Return strict JSON only in this shape:',
      '{"aspects":[{"slug":"short-kebab","title":"Human Title","questions":["Specific research question?","Another question?"]}]}',
      '',
      'Rules:',
      '- Each aspect is a distinct FACET of the subject (history, mechanics, reception, examples, etc.), not a stage of research.',
      '- Titles must be specific to the topic, not generic ("Background" is bad; "Origins and Setting" is good).',
      '- Questions must be answerable from web sources, not internal opinions.',
      '- Do not include "Sources" or "Overview" — those are produced automatically.',
    ].join('\n');
    const request: Parameters<typeof this.provider.prompt>[0] = {
      message,
      context,
      tools: [],
      conversationHistory: [],
      systemPrompt: 'You are Void deep research outliner. Return strict JSON only.',
      temperature: 0.2,
      maxTokens: 1200,
    };
    if (webAccess !== undefined) Object.assign(request, { webAccess });
    const response = await this.provider.prompt(request);
    if (!response.ok) {
      log.warn('Outline planner failed; using deterministic outline', { error: response.error.message });
      return deterministicOutline(prompt, topic);
    }
    const parsed = parseOutlineJson(response.value.chat);
    const aspects = normalizeOutline(parsed, topic);
    if (aspects.length === 0) return deterministicOutline(prompt, topic);
    return aspects;
  }

  private async synthesizeAspect(params: {
    topic: string;
    aspect: ResearchAspect;
    folder: string;
    sources: IngestedSource[];
    hasWebAccess: boolean;
    siblingTitles: string[];
    runId: string;
    webAccess: AIWebAccess;
    signal?: AbortSignal;
    onTrace?: (message: DeepResearchWorkerTraceMessage) => Promise<void>;
  }): Promise<{ path: string; summary: string; findings: string[]; citations: ResearchCitation[]; risks: string[]; evidenceCount: number; evidenceLevel?: 'verified_sources' | 'model_prior' | 'unverified_leads' }> {
    if (params.signal?.aborted) throw new Error('Deep research cancelled');
    const verifiedSources = params.sources.filter((source) => source.status === 'verified' && (source.claims.length > 0 || source.quotes.length > 0));
    const evidenceText = formatEvidenceForSynthesis(params.topic, params.aspect, verifiedSources);
    const wikilinkLine = params.siblingTitles.length > 0
      ? `Cross-link siblings inline where useful with [[Sibling Title]] — exact valid titles: ${params.siblingTitles.map((t) => `"${t}"`).join(', ')}.`
      : '';

    const baseMessage = buildSynthesisPrompt({
      topic: params.topic,
      aspect: params.aspect,
      evidenceText,
      wikilinkLine,
      verifiedCount: verifiedSources.length,
    });
    let attempt = 0;
    let lastDraft: ParsedSynthesisDraft | null = null;
    let lastMethodologyHit = false;
    while (attempt < 2) {
      attempt++;
      const message = attempt === 1 ? baseMessage : buildSynthesisRepairPrompt({
        baseMessage,
        previousDraft: lastDraft,
        topic: params.topic,
        aspect: params.aspect,
      });
      const request: AIAssistantRequest = {
        message,
        context: await this.contextProvider.getContext(),
        tools: [],
        conversationHistory: [],
        systemPrompt: 'You are Void deep research synthesizer. Write substantive subject prose grounded in evidence. Return strict JSON only.',
        temperature: attempt === 1 ? 0.3 : 0.15,
        maxTokens: 2400,
      };
      if (params.webAccess !== undefined) Object.assign(request, { webAccess: params.webAccess });
      await params.onTrace?.({
        type: 'worker.prompt',
        message: attempt === 1 ? 'Deep research synthesis prompt' : 'Deep research synthesis repair prompt',
        data: {
          phase: attempt === 1 ? 'worker.deep_research_synthesis' : 'worker.deep_research_repair',
          request: serializeDeepResearchPromptRequest(request),
        },
      });
      const response = await this.provider.prompt(request);
      if (response.ok) {
        await params.onTrace?.({
          type: 'worker.response',
          message: deepResearchResponseTraceLabel(
            response.value,
            attempt === 1 ? 'Deep research synthesis prompt' : 'Deep research synthesis repair prompt'
          ),
          data: {
            phase: attempt === 1 ? 'worker.deep_research_synthesis' : 'worker.deep_research_repair',
            response: serializeDeepResearchResponse(response.value),
          },
        });
      } else {
        await params.onTrace?.({
          type: 'worker.response',
          message: `Deep research synthesis prompt failed: ${response.error.message}`,
          data: {
            phase: attempt === 1 ? 'worker.deep_research_synthesis' : 'worker.deep_research_repair',
            error: response.error.message,
          },
        });
        throw response.error;
      }
      const parsed = parseSynthesisJson(response.value.chat);
      if (!parsed?.content) {
        lastDraft = parsed;
        continue;
      }
      const methodologyHit = containsMethodologyLanguage(parsed.content);
      lastMethodologyHit = methodologyHit;
      lastDraft = parsed;
      if (!methodologyHit) break;
    }

    const risks: string[] = [];
    let content: string;
    if (lastDraft?.content && !lastMethodologyHit) {
      content = lastDraft.content.trim();
    } else {
      risks.push(`Aspect "${params.aspect.title}" fell back to a transparent stub because synthesis kept producing methodology language or no valid output.`);
      content = buildInsufficientStub(params.aspect, verifiedSources.length);
    }

    if (!params.hasWebAccess && verifiedSources.length === 0) {
      content = prependOfflineBanner(content);
      risks.push(`Aspect "${params.aspect.title}" was written without web access — claims are unverified.`);
    }

    const path = await this.createNoteLocked({
      folder: params.folder,
      title: params.aspect.noteTitle,
      content,
      runId: params.runId,
      taskId: `aspect:${params.aspect.id}:synthesize`,
      label: `Deep research aspect: ${params.aspect.title}`,
    });

    const citations = citationsForSources(verifiedSources);
    const findings = verifiedSources.flatMap((source) => source.claims.slice(0, 2)).slice(0, 6);
    const summary = lastDraft?.summary?.trim() || `${params.aspect.title} written from ${verifiedSources.length} verified source${verifiedSources.length === 1 ? '' : 's'}.`;
    const result: { path: string; summary: string; findings: string[]; citations: ResearchCitation[]; risks: string[]; evidenceCount: number; evidenceLevel?: 'verified_sources' | 'model_prior' | 'unverified_leads' } = {
      path,
      summary,
      findings,
      citations,
      risks,
      evidenceCount: verifiedSources.length,
    };
    if (verifiedSources.length > 0) result.evidenceLevel = 'verified_sources';
    else if (params.hasWebAccess) result.evidenceLevel = 'unverified_leads';
    else result.evidenceLevel = 'model_prior';
    return result;
  }

  private async writeOverviewNote(params: {
    topic: ReturnType<typeof deriveResearchTopic>;
    folder: string;
    aspects: ResearchAspect[];
    hasWebAccess: boolean;
    runId: string;
    webAccess: AIWebAccess;
    signal?: AbortSignal;
  }): Promise<Result<{ path: string }, Error>> {
    if (params.signal?.aborted) return err(new Error('Deep research cancelled'));
    const overviewTitle = `${params.topic.displayTitle} — Overview`;
    const aspectBodies: Array<{ title: string; content: string }> = [];
    for (const aspect of params.aspects) {
      const noteRead = await this.documents.readContent(`${params.folder}/${aspect.noteTitle}.md`);
      if (noteRead.ok) {
        aspectBodies.push({ title: aspect.noteTitle, content: noteRead.value.slice(0, 4000) });
      }
    }
    const message = buildOverviewPrompt({
      topic: params.topic.displayTitle,
      overviewTitle,
      aspectBodies,
      siblingTitles: params.aspects.map((aspect) => aspect.noteTitle),
    });
    const request: Parameters<typeof this.provider.prompt>[0] = {
      message,
      context: await this.contextProvider.getContext(),
      tools: [],
      conversationHistory: [],
      systemPrompt: 'You are Void deep research overview writer. Return strict JSON only.',
      temperature: 0.2,
      maxTokens: 2000,
    };
    if (params.webAccess !== undefined) Object.assign(request, { webAccess: params.webAccess });

    let attempt = 0;
    let content: string | null = null;
    let lastDraft: ParsedSynthesisDraft | null = null;
    while (attempt < 2 && !content) {
      attempt++;
      const draftRequest = attempt === 1
        ? request
        : { ...request, message: buildOverviewRepairPrompt(message, lastDraft) };
      const response = await this.provider.prompt(draftRequest);
      if (!response.ok) return err(response.error);
      const parsed = parseSynthesisJson(response.value.chat);
      lastDraft = parsed;
      if (parsed?.content && !containsMethodologyLanguage(parsed.content)) {
        content = parsed.content.trim();
      }
    }

    if (!content) {
      content = buildOverviewStub(params.topic.displayTitle, params.aspects.map((aspect) => aspect.noteTitle));
    }
    if (!params.hasWebAccess) {
      content = prependOfflineBanner(content);
    }

    try {
      const path = await this.createNoteLocked({
        folder: params.folder,
        title: overviewTitle,
        content,
        runId: params.runId,
        taskId: 'phase:overview',
        label: 'Deep research overview',
      });
      return ok({ path });
    } catch (error) {
      return err(toError(error));
    }
  }

  private async writeSourcesNote(params: {
    topic: ReturnType<typeof deriveResearchTopic>;
    folder: string;
    aspects: ResearchAspect[];
    evidence: AspectEvidence[];
    hasWebAccess: boolean;
  }): Promise<Result<{ path: string }, Error>> {
    const title = `${params.topic.displayTitle} — Sources`;
    const lines: string[] = [
      `# ${title}`,
      '',
      `Verified citations gathered while researching ${params.topic.displayTitle}, grouped by aspect.`,
      '',
    ];
    if (!params.hasWebAccess) {
      lines.push('*Web access was off for this run — no external sources were captured.*', '');
    }
    let totalSources = 0;
    for (const aspect of params.aspects) {
      const entry = params.evidence.find((e) => e.aspectId === aspect.id);
      const verified = (entry?.sources ?? []).filter((source) => source.status === 'verified');
      if (verified.length === 0) continue;
      lines.push(`## ${aspect.title}`, '');
      for (const source of verified) {
        const url = source.finalUrl ?? source.url;
        lines.push(`- [${source.title}](${url}) — fetched ${source.fetchedAt.slice(0, 10)}`);
        if (source.excerpt) lines.push(`  ${source.excerpt.slice(0, 240).replace(/\s+/g, ' ').trim()}`);
        totalSources++;
      }
      lines.push('');
    }
    if (totalSources === 0 && params.hasWebAccess) {
      lines.push('*No verified sources were captured during this run.*');
    }

    try {
      const path = await this.createNoteLocked({
        folder: params.folder,
        title,
        content: lines.join('\n'),
        runId: params.aspects[0]?.id ?? title,
        taskId: 'phase:sources',
        label: 'Deep research sources note',
      });
      return ok({ path });
    } catch (error) {
      return err(toError(error));
    }
  }

  private async createNoteLocked(params: {
    folder: string;
    title: string;
    content: string;
    runId: string;
    taskId: string;
    label: string;
  }): Promise<string> {
    const lockKey = `note:create:${params.folder}/${params.title}`;
    return await resourceLock.withLock(lockKey, async () => {
      const result = await this.collaboration.createNote({
        folder: params.folder,
        title: params.title,
        content: params.content,
        autoFocus: false,
        lineage: {
          actor: { kind: 'ai-agent' },
          intentKind: 'import',
          summary: params.label,
          agentRunId: params.runId,
          agentTaskId: params.taskId,
          source: { type: 'tool' },
        },
      });
      if (!result.ok) throw result.error;
      return result.value.path;
    }, { id: params.runId, kind: 'agent', label: params.label, runId: params.runId });
  }

  private async runParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const concurrency = Math.max(1, Math.min(limit, queue.length));
    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) return;
          await fn(item);
        }
      })());
    }
    await Promise.all(workers);
  }

  private async setPhaseStart(run: AgentRun, input: DeepResearchPipelineInput, phase: DeepResearchPhase, detail: string): Promise<AgentRun> {
    const taskId = `phase:${phase}`;
    return await input.mutateRun(async (current) => {
      const next: AgentRun = current.deepResearch
        ? { ...current, deepResearch: { ...current.deepResearch, phase } }
        : current;
      const withTask = await this.must(this.engine.updateTask(next, taskId, 'running', { progress: 10, detail }));
      return withTask;
    });
  }

  private async setPhaseComplete(run: AgentRun, input: DeepResearchPipelineInput, phase: DeepResearchPhase, result: string, failed = false): Promise<AgentRun> {
    const taskId = `phase:${phase}`;
    return await input.mutateRun(async (current) =>
      this.must(this.engine.updateTask(current, taskId, failed ? 'failed' : 'completed', failed ? { error: result } : { result }))
    );
  }

  private async must<T>(promise: Promise<Result<T, Error>>): Promise<T> {
    const result = await promise;
    if (!result.ok) throw result.error;
    return result.value;
  }
}

function buildSynthesisPrompt(params: {
  topic: string;
  aspect: ResearchAspect;
  evidenceText: string;
  wikilinkLine: string;
  verifiedCount: number;
}): string {
  return [
    `Write the aspect note "${params.aspect.noteTitle}" about ${params.topic}.`,
    '',
    'Evidence (the ONLY allowed source of factual claims):',
    params.evidenceText,
    '',
    'Return strict JSON only in this shape:',
    '{"title":"the note title","content":"# Title\\n\\nMarkdown body here...","summary":"one-line abstract","citationIndexes":[1,2]}',
    '',
    'Writing rules — read carefully:',
    '- Begin the body with `# ${params.aspect.noteTitle}` and use `## subheadings` to organise.'.replace('${params.aspect.noteTitle}', params.aspect.noteTitle),
    '- Write 4–7 substantive paragraphs of subject prose. Each paragraph should advance the reader\'s understanding of the topic.',
    '- Ground every factual sentence in the evidence above. Cite inline as [1], [2], etc. Each [n] refers to the source number above.',
    '- Do NOT narrate the research process. Do NOT write "I searched", "I found", "after gathering sources", "the research process", "as the worker", "this aspect was written by", or any equivalent phrasing.',
    '- Do NOT list sources by name as findings ("Source 1 says X"). Instead, state the fact and append [n] as the citation.',
    params.wikilinkLine,
    params.verifiedCount === 0
      ? '- No verified sources are available. Write from prior model knowledge. Prefix every factual sentence with "*Unverified:*" so the reader knows.'
      : '- Where evidence contradicts itself, surface the disagreement directly in prose (cite both sources). Do not paper over conflict.',
    '- The note must read like an encyclopaedia entry about the subject. A reader who has never heard of this topic should learn something concrete.',
  ].filter(Boolean).join('\n');
}

function buildSynthesisRepairPrompt(params: { baseMessage: string; previousDraft: ParsedSynthesisDraft | null; topic: string; aspect: ResearchAspect }): string {
  return [
    'Your previous response contained research-process language or methodology framing, which is forbidden in this note. Rewrite it as direct subject prose.',
    '',
    `Topic: ${params.topic}`,
    `Aspect: ${params.aspect.title}`,
    '',
    params.previousDraft?.content
      ? ['Previous draft (do not copy verbatim; rewrite to remove process narration):', '', params.previousDraft.content.slice(0, 2000), ''].join('\n')
      : '',
    '',
    params.baseMessage,
    '',
    'IMPORTANT: any sentence that starts with "I ", "We ", "After ", or references searching/finding/gathering/methodology must be removed or rewritten. The note must read as a neutral encyclopaedia entry about the subject, not a report of what was done.',
  ].filter(Boolean).join('\n');
}

function buildOverviewPrompt(params: { topic: string; overviewTitle: string; aspectBodies: Array<{ title: string; content: string }>; siblingTitles: string[] }): string {
  const aspectBlocks = params.aspectBodies.map((body) => [
    `## Aspect: ${body.title}`,
    body.content,
  ].join('\n')).join('\n\n');
  return [
    `Write the overview note "${params.overviewTitle}" for ${params.topic}.`,
    '',
    'Aspect notes (read these — they are the canonical source for the overview):',
    aspectBlocks || '(no aspect content available)',
    '',
    'Return strict JSON only:',
    '{"title":"the overview title","content":"# Title\\n\\nMarkdown body here...","summary":"one-line abstract"}',
    '',
    'Rules:',
    `- Begin the body with \`# ${params.overviewTitle}\` and use \`## subheadings\` if useful.`,
    '- 4–6 paragraphs synthesising the entire topic for someone new.',
    `- Cross-link every aspect via wikilinks: ${params.siblingTitles.map((t) => `[[${t}]]`).join(', ')}.`,
    '- Do not narrate research. No "I searched", no "the research", no "this overview was created", no worker references.',
    '- The text must read like a published encyclopaedia overview. Concrete subject prose only.',
  ].join('\n');
}

function buildOverviewRepairPrompt(baseMessage: string, previous: ParsedSynthesisDraft | null): string {
  return [
    'Your previous overview contained methodology language. Rewrite as direct subject prose.',
    '',
    previous?.content ? `Previous draft (do not copy verbatim):\n\n${previous.content.slice(0, 2000)}\n\n` : '',
    baseMessage,
    '',
    'No process narration. No worker references. Only subject prose with wikilinks.',
  ].filter(Boolean).join('\n');
}

function buildInsufficientStub(aspect: ResearchAspect, evidenceCount: number): string {
  return [
    `# ${aspect.noteTitle}`,
    '',
    evidenceCount === 0
      ? `*Evidence was insufficient to write a grounded note about "${aspect.title}". No verified sources were captured. Sources gathered (if any) are listed in the Sources note for follow-up.*`
      : `*Synthesis kept producing research-process language. The fallback stub is in place. ${evidenceCount} verified source${evidenceCount === 1 ? '' : 's'} are listed in the Sources note.*`,
    '',
    'Research questions left unresolved:',
    ...aspect.questions.map((question) => `- ${question}`),
  ].join('\n');
}

function buildOverviewStub(topic: string, aspectTitles: string[]): string {
  return [
    `# ${topic} — Overview`,
    '',
    `*Overview synthesis failed. The aspect notes below contain the substantive material for this run.*`,
    '',
    ...aspectTitles.map((title) => `- [[${title}]]`),
  ].join('\n');
}

function prependOfflineBanner(content: string): string {
  return [
    '> *This note was written without web access. Factual claims are unverified and should be checked against primary sources before reuse.*',
    '',
    content,
  ].join('\n');
}

function buildFinalSummary(topic: string, paths: string[], hasWebAccess: boolean, risks: string[]): string {
  const lines = [
    `Deep research completed for "${topic}".`,
    '',
    paths.length > 0
      ? `Created ${paths.length} note${paths.length === 1 ? '' : 's'}:`
      : 'No notes were created.',
    ...paths.map((path) => `- ${path}`),
  ];
  if (!hasWebAccess) {
    lines.push('', 'Web access was off for this run; aspect notes are unverified.');
  }
  if (risks.length > 0) {
    lines.push('', 'Caveats:', ...risks.slice(0, 6).map((risk) => `- ${risk}`));
  }
  return lines.join('\n');
}

function buildOrchestratorNoteDraft(path: string, title: string, summary: string): AgentArtifactDraft {
  return {
    id: `draft_pipeline_${path}`,
    workerId: 'deep-research-pipeline',
    type: 'note',
    title,
    path,
    summary,
    confidence: 0.85,
    createdAt: new Date().toISOString(),
    metadata: { quality: 'substantive', staged: true, deepResearch: true },
  };
}

function buildAspectDiscoveryQuery(topic: string, aspect: ResearchAspect): string {
  return [
    `${topic} — ${aspect.title}`,
    ...aspect.questions,
  ].join('\n');
}

function deterministicOutline(prompt: string, topic: string): ResearchAspect[] {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'topic';
  const templates: Array<{ slug: string; title: string; questions: string[] }> = [
    { slug: 'overview-and-definition', title: 'Origins and Definition', questions: [`What is ${topic} and where did it come from?`, `Who created or popularised ${topic}?`, `What is the most authoritative definition?`] },
    { slug: 'themes-and-scope', title: 'Themes and Scope', questions: [`What themes or domains does ${topic} cover?`, `How is ${topic} typically organised?`, `What are its boundaries?`] },
    { slug: 'mechanics-and-examples', title: 'Mechanics and Notable Examples', questions: [`What are the key mechanics, features, or components of ${topic}?`, `What are the most notable examples or instances?`] },
    { slug: 'reception-and-impact', title: 'Reception and Impact', questions: [`How has ${topic} been received?`, `What is its impact on its field?`, `Are there notable critiques?`] },
    { slug: 'current-state', title: 'Current State and Future', questions: [`What is the current state of ${topic} as of today?`, `What developments are expected?`] },
  ];
  return templates.slice(0, DEFAULT_ASPECT_COUNT).map((template) => ({
    id: `aspect:${slug}:${template.slug}`,
    slug: template.slug,
    title: template.title,
    questions: template.questions,
    noteTitle: `${topic} — ${template.title}`,
  }));
}

function detectLocale(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(de|het|een|naar|onderzoek|doe|maak|wat|hoe|waar|waarom|wel|geen|niet|over|voor|met|van|aan)\b/.test(lower)) {
    return 'nl';
  }
  return 'en';
}

function parseOutlineJson(text: string): ParsedOutline | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as ParsedOutline;
  } catch {
    return null;
  }
}

function parseSynthesisJson(text: string): ParsedSynthesisDraft | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as ParsedSynthesisDraft;
  } catch {
    return null;
  }
}

function normalizeOutline(parsed: ParsedOutline | null, topic: string): ResearchAspect[] {
  if (!parsed || !Array.isArray(parsed.aspects)) return [];
  const seen = new Set<string>();
  const aspects: ResearchAspect[] = [];
  for (let i = 0; i < Math.min(parsed.aspects.length, MAX_ASPECT_COUNT); i++) {
    const raw = parsed.aspects[i];
    if (!raw) continue;
    const title = (raw.title ?? '').trim();
    if (!title) continue;
    const slug = (raw.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `aspect-${i + 1}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const questions = Array.isArray(raw.questions)
      ? raw.questions.filter((item): item is string => typeof item === 'string').map((q) => q.trim()).filter(Boolean).slice(0, 4)
      : [];
    aspects.push({
      id: `aspect:${slug}`,
      slug,
      title: title.slice(0, 120),
      questions: questions.length > 0 ? questions : [`What should the reader know about ${title} (${topic})?`],
      noteTitle: `${topic} — ${title}`.slice(0, 180),
    });
  }
  return aspects;
}

function mergeDeepResearch(run: AgentRun, patch: Partial<DeepResearchState>): AgentRun {
  if (!run.deepResearch) return run;
  return { ...run, deepResearch: { ...run.deepResearch, ...patch } };
}

function setAspectCandidates(run: AgentRun, aspectId: string, candidates: ResearchCitation[]): AgentRun {
  if (!run.deepResearch) return run;
  return {
    ...run,
    deepResearch: {
      ...run.deepResearch,
      evidence: run.deepResearch.evidence.map((entry) => entry.aspectId === aspectId ? { ...entry, candidateUrls: candidates } : entry),
    },
  };
}

function setAspectSources(run: AgentRun, aspectId: string, sources: IngestedSource[]): AgentRun {
  if (!run.deepResearch) return run;
  return {
    ...run,
    deepResearch: {
      ...run.deepResearch,
      evidence: run.deepResearch.evidence.map((entry) => entry.aspectId === aspectId ? { ...entry, sources } : entry),
    },
  };
}

function setAspectNotePath(run: AgentRun, aspectId: string, notePath: string): AgentRun {
  if (!run.deepResearch) return run;
  return {
    ...run,
    deepResearch: {
      ...run.deepResearch,
      evidence: run.deepResearch.evidence.map((entry) => entry.aspectId === aspectId ? { ...entry, notePath } : entry),
    },
  };
}

function setOverviewPath(run: AgentRun, path: string): AgentRun {
  if (!run.deepResearch) return run;
  return { ...run, deepResearch: { ...run.deepResearch, overviewPath: path } };
}

function setSourcesPath(run: AgentRun, path: string): AgentRun {
  if (!run.deepResearch) return run;
  return { ...run, deepResearch: { ...run.deepResearch, sourcesPath: path } };
}

function recordAspectWorkerResult(run: AgentRun, aspectId: string, result: AgentWorkerResult): AgentRun {
  return {
    ...run,
    workers: run.workers.map((worker) => worker.id === aspectId
      ? setAgentWorkerStatus(worker, 'completed', { result })
      : worker),
  };
}

function appendDeepResearchWorkerMessage(
  run: AgentRun,
  workerId: string,
  input: DeepResearchWorkerTraceMessage
): AgentRun {
  const message = createAgentWorkerMessage({
    runId: run.id,
    workerId,
    type: input.type,
    message: input.message,
    ...(input.data ? { data: input.data } : {}),
  });
  return {
    ...run,
    workerMessages: [...run.workerMessages, message],
    updatedAt: message.createdAt,
  };
}

function serializeDeepResearchPromptRequest(request: AIAssistantRequest): Record<string, unknown> {
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

function serializeDeepResearchResponse(response: AIResponse): Record<string, unknown> {
  return {
    chat: response.chat,
    toolCalls: response.toolCalls,
    meta: response.meta,
    truncated: response.truncated,
    stopReason: response.stopReason,
  };
}

function deepResearchResponseTraceLabel(response: AIResponse, label: string): string {
  const toolCount = response.toolCalls.length;
  const toolText = toolCount > 0 ? ` / ${toolCount} tool call${toolCount === 1 ? '' : 's'}` : '';
  return `${label} response from ${response.meta.provider}/${response.meta.model}${toolText}`;
}

function updateAspectTask(run: AgentRun, aspectId: string, phase: 'discover' | 'synthesize', status: AgentTask['status'], result?: string): AgentRun {
  const taskId = `aspect:${aspectId}:${phase}`;
  return {
    ...run,
    tasks: run.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const next: AgentTask = {
        ...task,
        status,
        updatedAt: new Date().toISOString(),
        progress: status === 'completed' ? 100 : status === 'running' ? 30 : task.progress,
      };
      if (result) {
        if (status === 'failed') next.error = result;
        else next.result = result;
      }
      if (status === 'running' && !next.startedAt) next.startedAt = next.updatedAt;
      if ((status === 'completed' || status === 'failed') && !next.completedAt) next.completedAt = next.updatedAt;
      return next;
    }),
  };
}

function deriveEvidenceLevel(run: AgentRun): AgentMergeState['evidenceLevel'] {
  if (!run.deepResearch) return 'scaffold_only';
  const verifiedTotal = run.deepResearch.evidence.reduce((acc, entry) => acc + entry.sources.filter((s) => s.status === 'verified').length, 0);
  if (verifiedTotal > 0) return 'verified_sources';
  const anyLeads = run.deepResearch.evidence.some((entry) => entry.candidateUrls.length > 0);
  if (anyLeads) return 'unverified_leads';
  const anyNote = run.deepResearch.evidence.some((entry) => entry.notePath);
  return anyNote ? 'model_prior' : 'scaffold_only';
}
