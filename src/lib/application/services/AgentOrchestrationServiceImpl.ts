/**
 * AgentOrchestrationServiceImpl - durable, evented AI-led runs.
 */

import { ok, err, toError, type Result } from '$lib/core';
import type {
  AgentOrchestrationService,
  AgentRunState,
  StartAgentRunOptions,
  ContinueWorkerOptions,
} from '$lib/ports/inbound/AgentOrchestrationService';
import type { AgentLoopService } from '$lib/ports/inbound/AgentLoopService';
import type { AIAssistantService } from '$lib/ports/inbound/AIAssistantService';
import type { NotesService, NotesListItem } from '$lib/ports/inbound/NotesService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { NoteCollaborationService } from '$lib/ports/inbound/NoteCollaborationService';
import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import type { SessionService } from '$lib/ports/inbound/SessionService';
import type { ReferenceService } from '$lib/ports/inbound/ReferenceService';
import type { IndexService } from '$lib/ports/inbound/IndexService';
import type { LineageRecordOptions } from '$lib/ports/inbound/LineageService';
import type { ProtectionService } from '$lib/ports/inbound/ProtectionService';
import type { AgentRunStoragePort } from '$lib/ports/outbound/AgentRunStoragePort';
import type { AgentEventStreamPort } from '$lib/ports/outbound/AgentEventStreamPort';
import type { ResearchSourcePort } from '$lib/ports/outbound/ResearchSourcePort';
import type { ApplicationNavigationPort } from '$lib/ports/outbound/ApplicationNavigationPort';
import type {
  AgentArtifact,
  AgentArtifactDraft,
  AgentExistingNoteEvidence,
  AgentMergeState,
  AgentResearchEvidenceBundle,
  AgentResearchEvidenceLevel,
  AgentRun,
  AgentRunPlan,
  AgentTask,
  AgentWorker,
  AgentWorkerMessage,
  AgentWorkerResult,
  AgentWorkerSpec,
  AgentWorkerTargetResource,
  AgentWorkerWriteScope,
  ResearchCitation,
} from '$lib/domain/entities/AgentRun';
import {
  createAgentRun,
  createAgentTask,
  createAgentWorker,
  isActiveAgentRunStatus,
  setAgentTaskStatus,
  setAgentWorkerStatus,
} from '$lib/domain/entities/AgentRun';
import { AgentRunEngine } from './AgentRunEngine';
import { AgentSwarmPlanner, shouldUseSwarmForPrompt } from './AgentSwarmPlanner';
import { AgentWorkerRunner } from './AgentWorkerRunner';
import { AgentWorkerBus } from './AgentWorkerBus';
import { AgentWorkerScheduler } from './AgentWorkerScheduler';
import { AgentMergeService, isSubstantiveDraft } from './AgentMergeService';
import { promptReferencesSection } from './ReferenceServiceImpl';
import type { DeepResearchPipeline } from './DeepResearchPipeline';
import { wikiLinkForNoteTitle } from './NoteLinkResolver';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import { deriveResearchTopic } from '$lib/domain/values/ResearchTopic';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';
import { getLogger } from '$lib/logging';

const log = getLogger('AgentOrchestration');

type VaultMatch = AgentExistingNoteEvidence;

interface AgentRunBlueprint {
  summary?: string;
  suggestedFolder?: string;
  starterNotes?: string[];
  tasks: Array<{
    title: string;
    kind: AgentTask['kind'];
    detail?: string;
  }>;
}

interface SwarmNoteWrite {
  title: string;
  folder: string;
  content: string;
  summary: string;
}

interface SwarmDirectWriteResult {
  run: AgentRun;
  paths: string[];
  summary: string;
}

interface ResearchRecoveryResult {
  run: AgentRun;
  results: AgentWorkerResult[];
  usedModelPrior: boolean;
}

interface SwarmResearchContext {
  existingNotes: VaultMatch[];
  citations: ResearchCitation[];
}

export class AgentOrchestrationServiceImpl implements AgentOrchestrationService {
  private state: AgentRunState = {
    currentRun: null,
    runs: [],
    isRunning: false,
    error: null,
  };
  private readonly subscribers = new Set<(state: AgentRunState) => void>();
  private readonly agentLoopAbortControllers = new Map<string, AbortController>();
  private readonly engine: AgentRunEngine;
  private readonly swarmAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly agentLoop: AgentLoopService,
    private readonly storage: AgentRunStoragePort,
    eventStream: AgentEventStreamPort | null,
    private readonly researchSources: ResearchSourcePort,
    private readonly notes: NotesService,
    private readonly documents: DocumentService,
    private readonly navigation: ApplicationNavigationPort,
    private readonly provenance?: ProvenanceService | null,
    private readonly index?: IndexService | null,
    private readonly aiAssistant?: AIAssistantService | null,
    private readonly swarmPlanner?: AgentSwarmPlanner | null,
    private readonly workerRunner?: AgentWorkerRunner | null,
    private readonly workerBus?: AgentWorkerBus | null,
    private readonly workerScheduler?: AgentWorkerScheduler | null,
    private readonly mergeService?: AgentMergeService | null,
    private readonly collaboration?: NoteCollaborationService | null,
    private readonly deepResearchPipeline?: DeepResearchPipeline | null,
    private readonly sessionService?: SessionService | null,
    private readonly referenceService?: ReferenceService | null,
    private readonly protection?: ProtectionService | null
  ) {
    this.engine = new AgentRunEngine(storage, eventStream);
  }

  private async promptWithResolvedReferences(prompt: string): Promise<string> {
    if (!this.referenceService) return prompt;
    const references = await this.referenceService.resolvePrompt(prompt);
    if (!references.ok || references.value.length === 0) return prompt;
    return `${prompt}\n\n${promptReferencesSection(references.value)}`;
  }

  /**
   * Create a session that groups every note this run touched.
   * Idempotent via SessionServiceImpl's recent-match dedup keyed on agentRunId.
   */
  private async createRunSession(
    run: AgentRun,
    kind: 'deep-research' | 'swarm',
    notePaths: string[],
  ): Promise<void> {
    if (!this.sessionService) return;
    const uniquePaths = Array.from(new Set(notePaths.filter((p): p is string => !!p)));
    if (uniquePaths.length === 0) return;

    const topic = deriveResearchTopic(run.prompt);
    const title = kind === 'deep-research'
      ? `Research — ${topic.displayTitle}`
      : `Swarm — ${topic.displayTitle}`;

    try {
      const result = await this.sessionService.create({
        type: kind === 'deep-research' ? 'research-session' : 'ai-batch',
        kind,
        title,
        topic: topic.displayTitle,
        agentRunId: run.id,
        ...(run.conversationId ? { conversationId: run.conversationId } : {}),
        toolId: kind === 'deep-research' ? 'deep-research' : 'swarm',
        createdBy: 'ai-agent',
        members: uniquePaths.map((path) => ({ notePath: path, role: 'derived' as const })),
      });
      if (!result.ok) {
        log.warn('Failed to create run session', { error: String(result.error), runId: run.id });
      }
    } catch (error) {
      log.warn('Run session creation threw', { error: String(error), runId: run.id });
    }
  }

  async startRun(prompt: string, options?: StartAgentRunOptions): Promise<Result<AgentRun, Error>> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return err(new Error('Agent run prompt cannot be empty'));
    }

    let conversationId = options?.conversationId ?? null;
    if (this.aiAssistant && options?.appendUserMessage !== false) {
      const appendOptions: { clientTurnId?: string } = {};
      if (options?.clientTurnId !== undefined) {
        appendOptions.clientTurnId = options.clientTurnId;
      }
      const conversation = await this.aiAssistant.appendUserMessage(
        trimmedPrompt,
        conversationId ?? undefined,
        appendOptions
      );
      if (!conversation.ok) return err(conversation.error);
      conversationId = conversation.value.id;
    }

    const executionPrompt = await this.promptWithResolvedReferences(trimmedPrompt);
    const webAccess = options?.webAccess ?? (shouldUseNativeWebForRun(trimmedPrompt) ? 'native' : 'off');
    const isDeepResearch = isResearchRunPrompt(trimmedPrompt) && !!this.deepResearchPipeline;
    const useSwarm = isDeepResearch || this.shouldRunAsSwarm(trimmedPrompt, options);

    const runParams: Parameters<typeof createAgentRun>[0] = {
      prompt: trimmedPrompt,
      conversationId,
      approvalRequired: options?.requireApproval ?? false,
      webAccess,
      orchestrationMode: useSwarm ? 'swarm' : 'single',
    };
    if (options?.sourceMessageId !== undefined) {
      runParams.sourceMessageId = options.sourceMessageId;
    }
    let run = createAgentRun(runParams);
    run.tasks = isDeepResearch
      ? []
      : useSwarm
        ? this.createInitialSwarmTasks(run.id)
        : this.createInitialTasks(run.id);

    await this.commitRun(run);
    run = await this.must(this.engine.appendEvent(run, 'run.started', {
      message: `Started AI-led work for "${trimmedPrompt}"`,
      data: {
        approvalRequired: run.approval.required,
        conversationId,
        sourceMessageId: options?.sourceMessageId,
        webAccess,
        orchestrationMode: run.orchestrationMode,
      },
    }));
    for (const task of run.tasks) {
      run = await this.must(this.engine.appendEvent(run, 'task.created', {
        taskId: task.id,
        message: task.title,
        data: { kind: task.kind, dependencies: task.dependencies },
      }));
    }
    await this.commitRun(run);
    await this.appendRunActivity(run, {
      id: 'run',
      label: 'Started AI-led work',
      status: 'running',
      detail: 'Preparing the task graph',
    });

    if (useSwarm) {
      return this.startSwarmRun(run, executionPrompt, options, webAccess, isDeepResearch);
    }

    try {
      log.info('Agent run started', { runId: run.id });

      run = await this.updateTask(run, 'plan', 'running', {
        progress: 15,
        detail: 'Asking the model to shape an AI-only task graph...',
      });

      const blueprint = await this.createModelBlueprint(executionPrompt, webAccess);
      for (const task of blueprint.tasks) {
        const taskParams: {
          title: string;
          kind: AgentTask['kind'];
          dependencies: string[];
          detail?: string;
        } = {
          title: task.title,
          kind: task.kind,
          dependencies: ['plan'],
        };
        if (task.detail !== undefined) taskParams.detail = task.detail;
        run = await this.must(this.engine.createTask(run, taskParams));
      }
      await this.commitRun(run);

      const suggestedFolder = blueprint.suggestedFolder ?? this.suggestResearchFolder(trimmedPrompt);
      const suggestedNotes = blueprint.starterNotes?.length
        ? blueprint.starterNotes
        : this.suggestStarterNotes(trimmedPrompt);
      run = await this.updateTask(run, 'plan', 'completed', {
        result: blueprint.summary ?? `Prepared an AI-led cluster workflow for ${suggestedFolder}`,
      });
      if (await this.wasCancelled(run.id)) return ok(await this.latestRunOr(run));

      run = await this.must(this.engine.setStatus(run, 'searching', 'Searching notes and verifying sources'));
      await this.commitRun(run);

      run = await this.updateTask(run, 'vault-search', 'running', {
        progress: 20,
        detail: 'Searching existing notes for related material...',
      });
      const existingNotes = await this.searchVault(trimmedPrompt);
      run = await this.updateTask(run, 'vault-search', 'completed', {
        result: existingNotes.length === 0
          ? 'No strong existing-note matches found'
          : `Found ${existingNotes.length} related note${existingNotes.length === 1 ? '' : 's'}`,
      });
      if (await this.wasCancelled(run.id)) return ok(await this.latestRunOr(run));

      run = await this.updateTask(run, 'web-research', 'running', {
        progress: 20,
        detail: 'Gathering current web research sources...',
      });
      const citationResult = await this.researchSources.search(trimmedPrompt, {
        limit: 8,
        requireVerified: true,
      });
      const citations = citationResult.ok ? citationResult.value : [];
      run = await this.updateTask(
        run,
        'web-research',
        citationResult.ok ? 'completed' : 'failed',
        citationResult.ok
          ? { result: `Verified ${citations.length} citeable source${citations.length === 1 ? '' : 's'}` }
          : { error: citationResult.error.message }
      );
      if (await this.wasCancelled(run.id)) return ok(await this.latestRunOr(run));

      run.plan = this.buildPlan(trimmedPrompt, suggestedFolder, suggestedNotes, existingNotes, citations);
      for (const citation of citations) {
        const artifact: AgentArtifact = {
          id: `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'source',
          title: citation.title,
          url: citation.url,
          citation,
          createdAt: new Date().toISOString(),
        };
        if (citation.excerpt) artifact.summary = citation.excerpt;
        run = await this.must(this.engine.addArtifact(run, artifact));
      }

      if (run.approval.required) {
        run = await this.must(this.engine.setStatus(run, 'waiting_approval', 'Waiting for approval before batch writes'));
        run.approval = {
          ...run.approval,
          status: 'pending',
          requestedAt: new Date().toISOString(),
        };
        run = await this.updateTask(run, 'approval', 'blocked', {
          detail: 'Approval required before creating or updating notes.',
        });
        await this.appendRunActivity(run, {
          id: 'task:approval',
          label: 'Waiting for write approval',
          status: 'running',
          detail: 'Review the proposed write scope in the Command Center',
          text: this.buildApprovalMessage(run),
        });
      } else {
        run.approval = { required: false, status: 'not_required' };
        run = await this.updateTask(run, 'approval', 'completed', {
          result: 'Autonomous non-destructive run; no approval required',
        });
        await this.commitRun(run);
        const approved = await this.approveRun(run.id);
        if (!approved.ok) return err(approved.error);
        const latest = await this.getRun(run.id);
        return latest.ok ? ok(latest.value ?? run) : err(latest.error);
      }

      await this.commitRun(run);
      return ok(run);
    } catch (e) {
      run = await this.must(this.engine.setStatus(run, 'failed', toError(e).message));
      run.error = toError(e).message;
      run.completedAt = new Date().toISOString();
      run = await this.must(this.engine.appendEvent(run, 'run.failed', {
        message: run.error,
      }));
      await this.commitRun(run, toError(e));
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Run failed',
        status: 'failed',
        detail: run.error ?? toError(e).message,
        text: `I hit a problem while running "${run.prompt}": ${run.error ?? toError(e).message}`,
      });
      return err(toError(e));
    }
  }

  async approveRun(runId: string): Promise<Result<void, Error>> {
    const runResult = await this.storage.get(runId);
    if (!runResult.ok) return err(runResult.error);
    const storedRun = runResult.value;
    if (!storedRun) return err(new Error(`Agent run not found: ${runId}`));
    let run: AgentRun = storedRun;
    if (run.orchestrationMode === 'swarm') {
      return this.approveSwarmRun(run);
    }
    const isPendingApproval = run.status === 'waiting_approval' && run.approval.status === 'pending';
    const isApprovalBypassed = run.status === 'searching' && run.approval.status === 'not_required';
    if (!isPendingApproval && !isApprovalBypassed) {
      return err(new Error(`Agent run cannot be approved from ${run.status}`));
    }

    const abortController = new AbortController();
    this.agentLoopAbortControllers.set(run.id, abortController);
    if (isPendingApproval) {
      run.approval = {
        ...run.approval,
        status: 'approved',
        decidedAt: new Date().toISOString(),
      };
    }
    run = await this.must(this.engine.setStatus(run, 'executing', 'Executing AI-led note work'));
    await this.appendRunActivity(run, {
      id: 'run',
      label: 'Writing notes and links',
      status: 'running',
      detail: 'Executing the approved research plan',
    });
    run = await this.updateTask(run, 'approval', 'completed', {
      result: isPendingApproval ? 'Approved by user' : 'Approval not required',
    });
    run = await this.updateTask(run, 'execute', 'running', {
      progress: 10,
      detail: 'Executing the approved research plan with app tools...',
    });

    try {
      const result = await this.agentLoop.run(this.buildExecutionPrompt(run), {
        maxTurns: 15,
        maxConcurrency: 5,
        hideInternalMessages: true,
        displayMessage: null,
        onToolCompleted: async (invocation) => {
          const liveArtifacts = this.inferArtifacts(run, [invocation]);
          run = await this.addArtifacts(run, liveArtifacts);
          run = await this.must(this.engine.appendEvent(run, 'narration', {
            message: `${invocation.toolId} ${invocation.status}`,
            data: {
              toolId: invocation.toolId,
              status: invocation.status,
            },
          }));
          await this.commitRun(run);
        },
        ...(run.conversationId ? { conversationId: run.conversationId } : {}),
        webAccess: run.webAccess ?? (shouldUseNativeWebForRun(run.prompt) ? 'native' : 'off'),
        signal: abortController.signal,
      });

      if (result.error) {
        throw result.error;
      }

      if (result.conversationId) {
        run.conversationId = result.conversationId;
      }

      run = await this.addArtifacts(run, [
        ...this.inferArtifacts(run, result.toolInvocations),
        ...this.collectSwarmSourceArtifacts(run),
        ...this.collectSwarmMediaArtifacts(run),
      ]);
      run = await this.updateTask(run, 'execute', result.cancelled ? 'cancelled' : 'completed', {
        result: result.cancelled
          ? 'Execution cancelled'
          : `Executed ${result.toolInvocations.length} tool${result.toolInvocations.length === 1 ? '' : 's'}`,
      });

      if (result.cancelled) {
        run = await this.must(this.engine.setStatus(run, 'cancelled', 'Execution cancelled'));
        run.completedAt = new Date().toISOString();
        run = await this.must(this.engine.appendEvent(run, 'run.cancelled', {
          message: 'Agent run cancelled',
        }));
        await this.commitRun(run);
        await this.appendRunActivity(run, {
          id: 'run',
          label: 'Run cancelled',
          status: 'completed',
          detail: 'Execution was cancelled',
          text: `I stopped the run for "${run.prompt}".`,
        });
        return ok(undefined);
      }

      run = await this.must(this.engine.setStatus(run, 'reviewing', 'Reviewing links, provenance, and index'));
      await this.commitRun(run);
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Reviewing changes',
        status: 'running',
        detail: 'Checking links, provenance, and index updates',
      });
      run = await this.updateTask(run, 'review', 'running', {
        progress: 40,
        detail: 'Recording provenance and refreshing the note index...',
      });

      run.finalSummary = this.buildFinalSummary(run, result.finalResponse);
      await this.recordRunProvenance(run);
      await this.index?.indexAll();
      await this.refreshNotesTree();
      await this.openBestResult(run);

      run = await this.updateTask(run, 'review', 'completed', {
        result: 'Provenance recorded and index refreshed',
      });
      run = await this.must(this.engine.setStatus(run, 'completed', 'Agent run completed'));
      run.completedAt = new Date().toISOString();
      run = await this.must(this.engine.appendEvent(run, 'run.completed', {
        message: run.finalSummary ?? 'Agent run completed',
      }));
      await this.commitRun(run);
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Run completed',
        status: 'completed',
        detail: 'Opened the best result note',
        text: run.finalSummary ?? 'Agent run completed.',
      });
      return ok(undefined);
    } catch (e) {
      abortController.abort();
      run = await this.must(this.engine.setStatus(run, 'failed', toError(e).message));
      run.error = toError(e).message;
      run.completedAt = new Date().toISOString();
      run = await this.updateTask(run, 'execute', 'failed', { error: run.error });
      run = await this.must(this.engine.appendEvent(run, 'run.failed', {
        message: run.error ?? 'Agent run failed',
      }));
      await this.commitRun(run, toError(e));
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Run failed',
        status: 'failed',
        detail: run.error ?? toError(e).message,
        text: `I hit a problem while running "${run.prompt}": ${run.error ?? toError(e).message}`,
      });
      return err(toError(e));
    } finally {
      this.agentLoopAbortControllers.delete(run.id);
    }
  }

  async cancelRun(runId: string): Promise<Result<void, Error>> {
    const runResult = await this.storage.get(runId);
    if (!runResult.ok) return err(runResult.error);
    let run = runResult.value;
    if (!run) return err(new Error(`Agent run not found: ${runId}`));

    this.agentLoopAbortControllers.get(runId)?.abort();
    this.agentLoopAbortControllers.delete(runId);
    this.swarmAbortControllers.get(runId)?.abort();
    this.swarmAbortControllers.delete(runId);

    const now = new Date().toISOString();
    run = {
      ...run,
      status: 'cancelled',
      completedAt: now,
      updatedAt: now,
      workers: run.workers.map((worker) =>
        worker.status === 'running' || worker.status === 'pending'
          ? setAgentWorkerStatus(worker, 'cancelled', { error: 'Cancelled by user' })
          : worker
      ),
      tasks: run.tasks.map((task) =>
        task.status === 'running' || task.status === 'pending' || task.status === 'blocked'
          ? setAgentTaskStatus(task, 'cancelled', { error: 'Cancelled by user' })
          : task
      ),
    };
    run = await this.must(this.engine.appendEvent(run, 'run.cancelled', {
      message: 'Cancelled by user',
    }));
    await this.commitRun(run);
    await this.appendRunActivity(run, {
      id: 'run',
      label: 'Run cancelled',
      status: 'completed',
      detail: 'Cancelled by user',
      text: `I stopped the run for "${run.prompt}".`,
    });
    return ok(undefined);
  }

  async continueWorker(options: ContinueWorkerOptions): Promise<Result<AgentRun, Error>> {
    const runResult = await this.storage.get(options.runId);
    if (!runResult.ok) return err(runResult.error);
    let run = runResult.value;
    if (!run) return err(new Error(`Agent run not found: ${options.runId}`));
    if (run.status === 'cancelled') {
      return err(new Error('Cannot continue a cancelled run'));
    }
    const worker = run.workers.find((w) => w.id === options.workerId);
    if (!worker) return err(new Error(`Worker not found: ${options.workerId}`));

    const messageType = options.target === 'worker' ? 'user.followup' : 'user.directive';
    run = await this.addWorkerMessage(run, {
      type: messageType,
      workerId: options.workerId,
      message: options.message,
      data: { target: options.target },
    });

    if (options.target === 'orchestrator') {
      await this.commitRun(run);
      return ok(run);
    }

    if (!this.workerRunner) {
      await this.commitRun(run);
      return err(new Error('Worker runner is not configured for follow-ups'));
    }

    if (worker.status === 'completed' || worker.status === 'failed' || worker.status === 'cancelled') {
      run = this.setWorker(run, options.workerId, (w) =>
        setAgentWorkerStatus(w, 'running', { progress: 5 })
      );
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      run = await this.must(this.engine.setStatus(run, 'executing', 'Worker resumed by user follow-up'));
    }
    await this.commitRun(run);

    const abortController = new AbortController();
    this.swarmAbortControllers.set(run.id, abortController);

    try {
      let currentRun: AgentRun = run;
      const priorMessages = currentRun.workerMessages.filter((m) => m.workerId === options.workerId);
      const runArgs: Parameters<typeof this.workerRunner.run>[0] = {
        runId: currentRun.id,
        prompt: currentRun.prompt,
        spec: worker.spec,
        signal: abortController.signal,
        priorMessages,
        onMessage: async (message) => {
          currentRun = await this.addWorkerMessage(currentRun, {
            ...message,
            workerId: options.workerId,
          });
          await this.commitRun(currentRun);
        },
      };
      if (currentRun.webAccess !== undefined) runArgs.webAccess = currentRun.webAccess;
      const result = await this.workerRunner.run(runArgs);

      currentRun = this.setWorker(currentRun, options.workerId, (w) =>
        setAgentWorkerStatus(w, 'completed', { result })
      );
      await this.commitRun(currentRun);
      return ok(currentRun);
    } catch (error) {
      const workerError = toError(error);
      run = this.setWorker(run, options.workerId, (w) =>
        setAgentWorkerStatus(w, 'failed', { error: workerError.message })
      );
      run = await this.addWorkerMessage(run, {
        type: 'worker.failed',
        workerId: options.workerId,
        message: workerError.message,
        data: { title: worker.spec.title, source: 'continuation' },
      });
      await this.commitRun(run);
      return err(workerError);
    } finally {
      this.swarmAbortControllers.delete(run.id);
    }
  }

  async resumeRun(runId: string): Promise<Result<AgentRun, Error>> {
    const runResult = await this.storage.get(runId);
    if (!runResult.ok) return err(runResult.error);
    let run = runResult.value;
    if (!run) return err(new Error(`Agent run not found: ${runId}`));
    if (run.status !== 'waiting_approval' && !isTerminalStatus(run.status)) {
      const interruptedError = 'Run was interrupted before a durable resume checkpoint. Start a fresh run to continue this work.';
      run = {
        ...run,
        status: 'failed',
        error: interruptedError,
        completedAt: new Date().toISOString(),
        tasks: run.tasks.map((task) =>
          task.status === 'running' || task.status === 'pending' || task.status === 'blocked'
            ? setAgentTaskStatus(task, 'failed', { error: interruptedError })
            : task
        ),
      };
      run = await this.must(this.engine.appendEvent(run, 'run.failed', {
        message: interruptedError,
      }));
    }
    await this.commitRun(run);
    return ok(run);
  }

  async getRun(runId: string): Promise<Result<AgentRun | null, Error>> {
    return this.storage.get(runId);
  }

  async reconcileStuckRuns(): Promise<void> {
    const list = await this.storage.list();
    if (!list.ok) return;
    const STALE_MS = 15 * 60 * 1000;
    const now = Date.now();
    for (const run of list.value) {
      if (!isActiveAgentRunStatus(run.status)) continue;
      const last = Date.parse(run.updatedAt);
      if (!Number.isFinite(last) || now - last < STALE_MS) continue;
      let updated = run;
      for (const task of updated.tasks) {
        if (task.status !== 'running') continue;
        const result = await this.engine.updateTask(updated, task.id, 'failed', {
          error: 'Run was interrupted before completing this task (reconciled at startup).',
        });
        if (result.ok) updated = result.value;
      }
      const status = await this.engine.setStatus(updated, 'failed', 'Reconciled stuck run on startup');
      if (status.ok) updated = status.value;
      updated.error = 'Run was interrupted; reconciled on startup.';
      updated.completedAt = new Date().toISOString();
      await this.commitRun(updated);
    }
  }

  async listRuns(): Promise<Result<AgentRun[], Error>> {
    const result = await this.storage.list();
    if (result.ok) {
      this.state = {
        ...this.state,
        runs: result.value,
        currentRun: this.pickCurrentRun(result.value),
        isRunning: result.value.some((run) => isActiveAgentRunStatus(run.status)),
      };
      this.notify();
    }
    return result;
  }

  async listRunSummaries(
    query?: Parameters<AgentOrchestrationService['listRunSummaries']>[0]
  ): ReturnType<AgentOrchestrationService['listRunSummaries']> {
    return this.storage.listSummaries(query);
  }

  getState(): AgentRunState {
    return {
      currentRun: this.state.currentRun,
      runs: [...this.state.runs],
      isRunning: this.state.isRunning,
      error: this.state.error,
    };
  }

  subscribe(callback: (state: AgentRunState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  private shouldRunAsSwarm(prompt: string, options?: StartAgentRunOptions): boolean {
    if (options?.orchestrationMode === 'single') return false;
    const servicesAvailable = !!(
      this.swarmPlanner &&
      this.workerRunner &&
      this.workerBus &&
      this.workerScheduler &&
      this.mergeService
    );
    if (!servicesAvailable) return false;
    if (options?.orchestrationMode === 'swarm') return true;
    return shouldUseSwarmForPrompt(prompt);
  }

  private async startSwarmRun(
    initialRun: AgentRun,
    prompt: string,
    options: StartAgentRunOptions | undefined,
    webAccess: AIWebAccess,
    researchMode: boolean
  ): Promise<Result<AgentRun, Error>> {
    if (researchMode && this.deepResearchPipeline) {
      return this.runDeepResearchPath(initialRun, prompt, options, webAccess);
    }
    if (!this.swarmPlanner || !this.workerRunner || !this.workerBus || !this.workerScheduler || !this.mergeService) {
      return err(new Error('Swarm services are not configured'));
    }

    let run = initialRun;
    const abortController = new AbortController();
    this.swarmAbortControllers.set(run.id, abortController);

    try {
      run = await this.updateTask(run, 'plan', 'running', {
        progress: 15,
        detail: 'Decomposing the request into bounded worker agents...',
      });

      const plannerOptions: { maxWorkers?: number; webAccess?: AIWebAccess } = { webAccess };
      if (options?.maxWorkers !== undefined) plannerOptions.maxWorkers = options.maxWorkers;
      const swarmPlan = await this.swarmPlanner.plan(prompt, plannerOptions);
      const researchContext = researchMode
        ? await this.prepareSwarmResearchContext(prompt, abortController.signal)
        : { existingNotes: [], citations: [] };
      let workerSpecs = researchMode
        ? this.enrichResearchWorkerSpecs(swarmPlan.workers, researchContext)
        : swarmPlan.workers;
      workerSpecs = this.enrichWorkerResourceScopes(workerSpecs, prompt, run.id);

      run.plan = this.buildSwarmRunPlan(prompt, workerSpecs, swarmPlan.summary, swarmPlan.mergeCriteria);
      if (researchMode) {
        const researchEvidence = buildResearchEvidenceBundle(researchContext, 'preflight');
        run.plan = {
          ...run.plan,
          existingNotes: researchContext.existingNotes,
          citations: researchContext.citations,
          researchEvidence,
        };
      }
      run.workers = workerSpecs.map((spec) => createAgentWorker({ runId: run.id, spec }));
      run.merge = {
        status: 'pending',
        summary: null,
        writePrompt: null,
        sourceWorkerIds: [],
        artifactDrafts: [],
        touchedExistingNotes: [],
        risks: [],
      };
      for (const spec of workerSpecs) {
        run = await this.must(this.engine.createTask(run, {
          id: `worker:${spec.id}`,
          title: spec.title,
          kind: 'worker',
          dependencies: spec.dependencies.length > 0
            ? spec.dependencies.map((dependency) => `worker:${dependency}`)
            : ['plan'],
          detail: spec.objective,
          parentId: 'workers',
        }));
        run = await this.addWorkerMessage(run, {
          type: 'orchestrator.instruction',
          workerId: spec.id,
          message: spec.objective,
          data: {
            role: spec.role,
            deliverables: spec.deliverables,
            allowedTools: spec.allowedTools,
            writeScope: spec.writeScope ?? 'read_only',
            capabilities: spec.capabilities ?? ['read_context'],
            targetResources: spec.targetResources ?? [],
          },
        });
      }
      await this.commitRun(run);

      run = await this.updateTask(run, 'plan', 'completed', {
        result: swarmPlan.rationale,
      });
      run = await this.must(this.engine.setStatus(run, 'coordinating', 'Running bounded worker agents'));
      run = await this.updateTask(run, 'workers', 'running', {
        progress: 5,
        detail: `Running up to ${Math.min(options?.maxWorkers ?? workerSpecs.length, workerSpecs.length)} workers in parallel...`,
      });

      let runState = run;
      let mutationQueue = Promise.resolve();
      const mutateRun = async (mutator: (current: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
        const next = mutationQueue.then(async () => {
          runState = await mutator(runState);
          await this.commitRun(runState);
          return runState;
        });
        mutationQueue = next.then(() => undefined, () => undefined);
        return next;
      };

      const completedResults = new Map<string, AgentWorkerResult>();
      const schedule = await this.workerScheduler.run<AgentWorkerResult>(
        workerSpecs,
        Math.min(options?.maxWorkers ?? workerSpecs.length, workerSpecs.length),
        async (spec) => {
          await mutateRun(async (current) => {
            let next = this.setWorker(current, spec.id, (worker) =>
              setAgentWorkerStatus(worker, 'running', { progress: 10 })
            );
            next = await this.must(this.engine.appendEvent(next, 'worker.started', {
              taskId: `worker:${spec.id}`,
              message: spec.title,
              data: { role: spec.role },
            }));
            next = await this.must(this.engine.updateTask(next, `worker:${spec.id}`, 'running', {
              progress: 10,
              detail: spec.objective,
            }));
            return next;
          });

          try {
            const priorResults = spec.dependencies
              .map((dependencyId) => completedResults.get(dependencyId))
              .filter((value): value is AgentWorkerResult => !!value);
            const result = await this.workerRunner!.run({
              runId: run.id,
              prompt,
              spec,
              webAccess,
              signal: abortController.signal,
              ...(priorResults.length > 0 ? { priorResults } : {}),
              onMessage: async (message) => {
                await mutateRun(async (current) =>
                  this.addWorkerMessage(current, {
                    ...message,
                    workerId: spec.id,
                  })
                );
              },
            });
            completedResults.set(spec.id, result);

            await mutateRun(async (current) => {
              let next = this.setWorker(current, spec.id, (worker) =>
                setAgentWorkerStatus(worker, 'completed', { result })
              );
              next = await this.must(this.engine.updateTask(next, `worker:${spec.id}`, 'completed', {
                result: result.summary,
              }));
              return next;
            });
            return result;
          } catch (error) {
            const workerError = toError(error);
            await mutateRun(async (current) => {
              let next = this.setWorker(current, spec.id, (worker) =>
                setAgentWorkerStatus(worker, 'failed', { error: workerError.message })
              );
              next = await this.addWorkerMessage(next, {
                type: 'worker.failed',
                workerId: spec.id,
                message: workerError.message,
                data: { title: spec.title },
              });
              next = await this.must(this.engine.updateTask(next, `worker:${spec.id}`, 'failed', {
                error: workerError.message,
              }));
              return next;
            });
            throw workerError;
          }
        }
      );
      await mutationQueue;
      run = runState;

      if (schedule.results.length === 0) {
        throw new Error('All worker agents failed or were blocked');
      }

      let workerResults = schedule.results;
      if (isResearchRunPrompt(prompt)) {
        const recovered = await this.recoverBestAvailableResearch(run, prompt, workerResults, abortController.signal);
        run = recovered.run;
        if (recovered.results.length > 0) {
          workerResults = [...workerResults, ...recovered.results];
          run = await this.addWorkerMessage(run, {
            type: 'orchestrator.merge_decision',
            message: recovered.results.map((result) => result.summary).join(' '),
            data: {
              sourceWorkerIds: recovered.results.map((result) => result.workerId),
              citationCount: recovered.results.reduce((sum, result) => sum + result.citations.length, 0),
              recovery: true,
              modelPrior: recovered.usedModelPrior,
            },
          });
          await this.commitRun(run);
        }
      }

      const completedWorkers = schedule.results.length;
      run = await this.updateTask(run, 'workers', schedule.failures.length > 0 ? 'completed' : 'completed', {
        result: schedule.failures.length > 0
          ? `${completedWorkers} worker${completedWorkers === 1 ? '' : 's'} completed; ${schedule.failures.length} failed or were blocked`
          : `${completedWorkers} worker${completedWorkers === 1 ? '' : 's'} completed`,
      });

      run = await this.must(this.engine.setStatus(run, 'merging', 'Merging worker outputs'));
      run = await this.updateTask(run, 'merge', 'running', {
        progress: 20,
        detail: 'Synthesizing worker outputs into one orchestrator write plan...',
      });

      const merge = this.mergeService.merge({
        run,
        workerResults,
        workerFailures: schedule.failures,
      });
      run.merge = merge;
      run = await this.addWorkerMessage(run, {
        type: 'orchestrator.merge_decision',
        message: merge.summary ?? 'Merged worker outputs',
        data: {
          sourceWorkerIds: merge.sourceWorkerIds,
          draftCount: merge.artifactDrafts.length,
          risks: merge.risks,
        },
      });
      run = await this.updateTask(run, 'merge', 'completed', {
        result: merge.summary ?? 'Merged worker outputs',
      });

      const approvalNeeded = run.approval.required || merge.touchedExistingNotes.length > 1;
      if (approvalNeeded) {
        run.approval = {
          ...run.approval,
          required: true,
          status: 'pending',
          requestedAt: new Date().toISOString(),
        };
        run.merge = { ...merge, status: 'waiting_approval' };
        run = await this.must(this.engine.setStatus(run, 'waiting_approval', 'Waiting for approval before orchestrator writes'));
        run = await this.updateTask(run, 'approval', 'blocked', {
          detail: 'Approval required before the orchestrator applies merged worker output.',
        });
        await this.appendRunActivity(run, {
          id: 'task:approval',
          label: 'Waiting for swarm write approval',
          status: 'running',
          detail: `${merge.artifactDrafts.length} draft artifacts ready`,
          text: this.buildSwarmApprovalMessage(run),
        });
        await this.commitRun(run);
        return ok(run);
      }

      run.approval = { required: false, status: 'not_required' };
      run = await this.updateTask(run, 'approval', 'completed', {
        result: 'No approval required before orchestrator writes',
      });
      await this.commitRun(run);
      const written = await this.executeSwarmWrites(run);
      if (!written.ok) return err(written.error);
      const latest = await this.getRun(run.id);
      return latest.ok ? ok(latest.value ?? run) : err(latest.error);
    } catch (error) {
      run = await this.must(this.engine.setStatus(run, 'failed', toError(error).message));
      run.error = toError(error).message;
      run.completedAt = new Date().toISOString();
      run = await this.updateTask(run, 'workers', 'failed', { error: run.error });
      run = await this.must(this.engine.appendEvent(run, 'run.failed', {
        message: run.error ?? 'Swarm run failed',
      }));
      await this.commitRun(run, toError(error));
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Swarm run failed',
        status: 'failed',
        detail: run.error ?? toError(error).message,
        text: `I hit a problem while coordinating workers for "${run.prompt}": ${run.error ?? toError(error).message}`,
      });
      return err(toError(error));
    } finally {
      this.swarmAbortControllers.delete(run.id);
    }
  }

  private async runDeepResearchPath(
    initialRun: AgentRun,
    prompt: string,
    options: StartAgentRunOptions | undefined,
    webAccess: AIWebAccess
  ): Promise<Result<AgentRun, Error>> {
    if (!this.deepResearchPipeline) {
      return err(new Error('Deep research pipeline is not configured'));
    }
    void options;

    let run = initialRun;
    const abortController = new AbortController();
    this.swarmAbortControllers.set(run.id, abortController);

    try {
      run = await this.must(this.engine.setStatus(run, 'coordinating', 'Running deep research pipeline'));
      await this.commitRun(run);

      let runState = run;
      let mutationQueue = Promise.resolve();
      const mutateRun = async (mutator: (current: AgentRun) => Promise<AgentRun>): Promise<AgentRun> => {
        const next = mutationQueue.then(async () => {
          runState = await mutator(runState);
          await this.commitRun(runState);
          return runState;
        });
        mutationQueue = next.then(() => undefined, () => undefined);
        return next;
      };

      const pipelineInput: Parameters<DeepResearchPipeline['run']>[0] = {
        run: runState,
        prompt,
        webAccess,
        mutateRun,
      };
      if (abortController.signal) pipelineInput.signal = abortController.signal;

      const pipelineResult = await this.deepResearchPipeline.run(pipelineInput);
      await mutationQueue;
      run = runState;

      if (!pipelineResult.ok) {
        for (const stuck of run.tasks) {
          if (stuck.status !== 'running') continue;
          run = await this.must(this.engine.updateTask(run, stuck.id, 'failed', {
            error: pipelineResult.error.message,
          }));
        }
        run = await this.must(this.engine.setStatus(run, 'failed', pipelineResult.error.message));
        run.error = pipelineResult.error.message;
        run.completedAt = new Date().toISOString();
        run = await this.must(this.engine.appendEvent(run, 'run.failed', { message: run.error }));
        await this.commitRun(run);
        await this.appendRunActivity(run, {
          id: 'run',
          label: 'Deep research failed',
          status: 'failed',
          detail: run.error ?? 'Deep research failed',
          text: `Deep research run for "${run.prompt}" failed: ${run.error}`,
        });
        return err(pipelineResult.error);
      }

      // Surface created notes as artifacts so the run summary, UI, and
      // provenance recording see them.
      for (const path of pipelineResult.value.createdNotePaths) {
        run = await this.must(this.engine.addArtifact(run, {
          id: `artifact_${run.id}_${path}`,
          type: 'note',
          title: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
          path,
          summary: 'Created by the deep research pipeline.',
          createdAt: new Date().toISOString(),
        }));
      }

      run.finalSummary = pipelineResult.value.finalSummary;
      run = await this.must(this.engine.setStatus(run, 'completed', 'Deep research completed'));
      run.completedAt = new Date().toISOString();
      run = await this.must(this.engine.appendEvent(run, 'run.completed', {
        message: run.finalSummary ?? 'Deep research completed',
      }));
      await this.commitRun(run);
      await this.createRunSession(run, 'deep-research', pipelineResult.value.createdNotePaths);
      await this.recordRunProvenance(run);
      await this.refreshNotesTree();
      await this.openBestResult(run);
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Deep research completed',
        status: 'completed',
        detail: `${pipelineResult.value.createdNotePaths.length} notes written`,
        text: pipelineResult.value.finalSummary,
      });
      return ok(run);
    } catch (error) {
      const message = toError(error).message;
      for (const stuck of run.tasks) {
        if (stuck.status !== 'running') continue;
        run = await this.must(this.engine.updateTask(run, stuck.id, 'failed', { error: message }));
      }
      run = await this.must(this.engine.setStatus(run, 'failed', message));
      run.error = message;
      run.completedAt = new Date().toISOString();
      run = await this.must(this.engine.appendEvent(run, 'run.failed', { message }));
      await this.commitRun(run, toError(error));
      return err(toError(error));
    } finally {
      this.swarmAbortControllers.delete(run.id);
    }
  }

  private async approveSwarmRun(run: AgentRun): Promise<Result<void, Error>> {
    if (run.status !== 'waiting_approval' || run.approval.status !== 'pending') {
      return err(new Error(`Swarm run cannot be approved from ${run.status}`));
    }

    run.approval = {
      ...run.approval,
      status: 'approved',
      decidedAt: new Date().toISOString(),
    };
    if (run.merge) {
      run.merge = { ...run.merge, status: 'completed' };
    }
    run = await this.updateTask(run, 'approval', 'completed', {
      result: 'Approved by user',
    });
    await this.commitRun(run);
    return this.executeSwarmWrites(run);
  }

  private async recoverBestAvailableResearch(
    run: AgentRun,
    prompt: string,
    workerResults: AgentWorkerResult[],
    signal?: AbortSignal
  ): Promise<ResearchRecoveryResult> {
    let next = run;
    const results: AgentWorkerResult[] = [];
    let usedModelPrior = false;

    if ((next.plan?.existingNotes.length ?? 0) === 0) {
      const existingNotes = await this.searchVault(prompt);
      if (existingNotes.length > 0 && next.plan) {
        next = {
          ...next,
          plan: {
            ...next.plan,
            existingNotes,
            researchEvidence: mergeResearchEvidence(next.plan.researchEvidence, {
              existingNotes,
              citations: next.plan.citations,
              collectedAt: new Date().toISOString(),
              source: 'recovery',
            }),
          },
        };
      }
    }

    const verified = await this.searchResearchSources(prompt, true, signal);
    if (verified.ok && verified.value.length > 0) {
      const citations = verified.value
        .filter((citation) => citation.status === undefined || citation.status === 'verified')
        .map((citation) => ({ ...citation, status: 'verified' as const }));
      if (citations.length > 0) {
        results.push(this.createResearchRecoveryResult({
          workerId: 'orchestrator-research-recovery',
          title: 'Source-backed research recovery',
          summary: `Recovered ${citations.length} verified source${citations.length === 1 ? '' : 's'} before writing notes.`,
          citations,
          evidenceLevel: 'verified_sources',
          findings: citations.map((citation) =>
            citation.excerpt
              ? `${citation.title}: ${citation.excerpt}`
              : `Verified source identified for review: ${citation.title}`
          ),
          risks: ['Recovered sources still need human review before treating claims as settled.'],
          nextActions: ['Review recovered sources and deepen the research note where needed.'],
          quality: 'substantive',
          confidence: 0.65,
        }));
        const learningDraft = await this.recoverSourceBackedLearningDraft(prompt, citations, signal);
        if (learningDraft) {
          results.push(learningDraft);
        }
        if (next.plan) {
          const mergedCitations = uniqueCitations([...next.plan.citations, ...citations]);
          next = {
            ...next,
            plan: {
              ...next.plan,
              citations: mergedCitations,
              researchEvidence: mergeResearchEvidence(next.plan.researchEvidence, {
                existingNotes: next.plan.existingNotes,
                citations: mergedCitations,
                collectedAt: new Date().toISOString(),
                source: 'recovery',
              }),
            },
          };
        }
      }
    } else if (!verified.ok) {
      results.push(this.createResearchRecoveryResult({
        workerId: 'orchestrator-source-recovery-risk',
        title: 'Source recovery risk',
        summary: 'Verified source recovery failed before writing notes.',
        citations: [],
        evidenceLevel: 'scaffold_only',
        findings: [],
        risks: [`Verified source lookup failed: ${verified.error.message}`],
        nextActions: ['Retry source-backed research when the source provider is available.'],
        quality: 'insufficient',
        confidence: 0.25,
      }));
    }

    if (!hasVerifiedResearchEvidence(next, [...workerResults, ...results])) {
      const leads = await this.searchResearchSources(prompt, false, signal);
      if (leads.ok && leads.value.length > 0) {
        const sourceLeads = leads.value
          .filter((citation) => !isVerifiedCitation(citation))
          .map((citation) => ({ ...citation, status: citation.status ?? 'unverified' as const }));
        if (sourceLeads.length > 0) {
          results.push(this.createResearchRecoveryResult({
            workerId: 'orchestrator-source-leads',
            title: 'Unverified source leads',
            summary: `Captured ${sourceLeads.length} unverified source lead${sourceLeads.length === 1 ? '' : 's'} for follow-up.`,
            citations: sourceLeads,
            evidenceLevel: 'unverified_leads',
            findings: [],
            risks: ['Source leads were not verified and must not be treated as citations yet.'],
            nextActions: ['Open and verify each source lead before relying on any claims.'],
            quality: 'weak',
            confidence: 0.45,
          }));
        }
      } else if (!leads.ok) {
        results.push(this.createResearchRecoveryResult({
          workerId: 'orchestrator-source-leads-risk',
          title: 'Source lead recovery risk',
          summary: 'Unverified source lead recovery failed before writing notes.',
          citations: [],
          evidenceLevel: 'scaffold_only',
          findings: [],
          risks: [`Source lead lookup failed: ${leads.error.message}`],
          nextActions: ['Retry source discovery with native web access enabled.'],
          quality: 'insufficient',
          confidence: 0.25,
        }));
      }
    }

    const combined = [...workerResults, ...results];
    if (!hasAnyResearchFindings(combined) && collectWorkerCitations(next, combined).length === 0) {
      const modelPrior = await this.recoverModelPriorResearch(prompt, signal);
      results.push(modelPrior);
      usedModelPrior = true;
    }

    return { run: next, results, usedModelPrior };
  }

  private async searchResearchSources(
    prompt: string,
    requireVerified: boolean,
    signal?: AbortSignal
  ): Promise<Result<ResearchCitation[], Error>> {
    const options: { limit: number; requireVerified: boolean; signal?: AbortSignal } = {
      limit: 8,
      requireVerified,
    };
    if (signal !== undefined) options.signal = signal;
    return this.researchSources.search(prompt, options);
  }

  private async recoverSourceBackedLearningDraft(
    prompt: string,
    citations: ResearchCitation[],
    signal?: AbortSignal
  ): Promise<AgentWorkerResult | null> {
    const assistantPrompt = this.aiAssistant?.prompt?.bind(this.aiAssistant);
    if (!assistantPrompt || signal?.aborted || citations.length === 0) return null;

    const topic = deriveResearchTopic(prompt);
    const sourceBlock = citations.slice(0, 8).map((citation, index) => [
      `Source ${index + 1}: ${citation.title}`,
      `URL: ${citation.url}`,
      citation.fetchedAt ? `Fetched: ${citation.fetchedAt}` : '',
      citation.excerpt ? `Excerpt: ${citation.excerpt}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');

    const result = await assistantPrompt([
      'Write a source-backed learning note from the supplied source snippets.',
      '',
      `Original user request: ${prompt}`,
      `Topic title: ${topic.displayTitle}`,
      'Write in the same language as the original user request unless the request explicitly asks otherwise.',
      '',
      'Sources:',
      sourceBlock,
      '',
      'Return strict JSON only:',
      '{"summary":"short","findings":["specific topic finding"],"noteTitle":"title","noteContentMarkdown":"# title\\n\\n## section\\n...","risks":["topic caveat"],"nextActions":["topic follow-up"],"confidence":0.0}',
      '',
      'Rules:',
      '- Write about the topic itself, not about the research process.',
      '- Do not mention workers, runs, orchestration, evidence levels, source recovery, methodology, or run receipts.',
      '- Use the sources as learning material. Do not invent URLs, quotes, statistics, dates, names, or facts not supported by the snippets.',
      '- Make the note useful to read end-to-end: explanatory paragraphs first, source list at the bottom.',
      '- Include only topic caveats or learning questions in risks and nextActions; never include process diagnostics.',
    ].join('\n'), {
      autoExecuteTools: false,
      displayMessage: null,
      persistAssistantMessage: false,
      webAccess: 'off',
    });

    if (!result.ok) {
      log.warn('Source-backed learning draft recovery failed', {
        error: result.error.message,
      });
      return null;
    }

    const parsed = parseSourceLearningDraftJson(result.value.chat);
    if (!parsed?.noteContentMarkdown || wordCount(parsed.noteContentMarkdown) < 80) {
      return null;
    }

    const noteTitle = parsed.noteTitle || topic.overviewTitle;
    const noteContent = ensureMarkdownHeading(parsed.noteContentMarkdown, noteTitle);
    return this.createResearchRecoveryResult({
      workerId: 'orchestrator-source-synthesis',
      title: 'Source-backed learning synthesis',
      summary: parsed.summary || `Synthesized a source-backed learning note for ${topic.displayTitle}.`,
      citations,
      evidenceLevel: 'verified_sources',
      findings: parsed.findings,
      risks: parsed.risks.filter((risk) => !isProcessResearchDiagnostic(risk)),
      nextActions: parsed.nextActions.filter((action) => !isProcessResearchDiagnostic(action)),
      quality: 'substantive',
      confidence: parsed.confidence,
      artifactDrafts: [{
        id: `draft_orchestrator_source_synthesis_${Date.now()}`,
        workerId: 'orchestrator-source-synthesis',
        type: 'note',
        title: noteTitle,
        content: noteContent,
        summary: parsed.summary || `Source-backed learning note for ${topic.displayTitle}`,
        confidence: parsed.confidence,
        createdAt: new Date().toISOString(),
        metadata: {
          quality: 'substantive',
          researchStatus: 'source_backed',
          evidenceLevel: 'verified_sources',
          citations,
        },
      }],
    });
  }

  private async recoverModelPriorResearch(
    prompt: string,
    signal?: AbortSignal
  ): Promise<AgentWorkerResult> {
    const assistantPrompt = this.aiAssistant?.prompt?.bind(this.aiAssistant);
    if (assistantPrompt && !signal?.aborted) {
      const result = await assistantPrompt([
        'Create a best-effort research seed for this request.',
        '',
        `Request: ${prompt}`,
        '',
        'Return strict JSON only:',
        '{"summary":"short","findings":["model-prior hypothesis, clearly phrased"],"risks":["risk or caveat"],"nextActions":["action"],"confidence":0.0}',
        '',
        'Rules:',
        '- Do not invent URLs, citations, dates, quotes, statistics, or named sources.',
        '- Write useful topic-specific research seeds that a human can verify later.',
        '- Cover what the topic is, what is new or special, notable examples/items/mechanics, and why it matters when those angles fit.',
        '- Keep every finding phrased as a hypothesis or synthesis seed, not as a verified fact.',
      ].join('\n'), {
        autoExecuteTools: false,
        displayMessage: null,
        persistAssistantMessage: false,
        webAccess: shouldUseNativeWebForRun(prompt) ? 'native' : 'off',
      });
      if (result.ok) {
        const parsed = parseModelPriorJson(result.value.chat);
        if (parsed && parsed.findings.length > 0) {
          return this.createResearchRecoveryResult({
            workerId: 'orchestrator-model-prior',
            title: 'Model-prior synthesis recovery',
            summary: parsed.summary || 'Created model-prior research hypotheses for verification.',
            citations: [],
            evidenceLevel: 'model_prior',
            findings: parsed.findings,
            risks: parsed.risks.length > 0 ? parsed.risks : ['Model-prior findings require source verification.'],
            nextActions: parsed.nextActions.length > 0 ? parsed.nextActions : ['Verify each hypothesis against sources.'],
            quality: 'weak',
            confidence: parsed.confidence,
          });
        }
      }
    }

    const topic = deriveResearchTopic(prompt).displayTitle;
    return this.createResearchRecoveryResult({
      workerId: 'orchestrator-research-seed',
      title: 'Deterministic research seed',
      summary: 'Created a deterministic research seed because workers and source recovery did not produce findings.',
      citations: [],
      evidenceLevel: 'model_prior',
      findings: [
        `Research seed: identify the current highest-authority facts for ${topic}, including names, dates, scope, and what changed.`,
        `Research seed: capture what is special about ${topic}, notable examples, products, cards/mechanics or domain-specific changes, and why it matters, with every factual claim verified before use.`,
      ],
      risks: ['No verified external citations were captured; treat these findings as hypotheses until sources are added.'],
      nextActions: ['Verify the hypotheses with current sources and update this note with citations.'],
      quality: 'weak',
      confidence: 0.35,
    });
  }

  private createResearchRecoveryResult(input: {
    workerId: string;
    title: string;
    summary: string;
    citations: ResearchCitation[];
    evidenceLevel: AgentResearchEvidenceLevel;
    findings: string[];
    risks: string[];
    nextActions: string[];
    quality: NonNullable<AgentWorkerResult['quality']>;
    confidence: number;
    artifactDrafts?: AgentArtifactDraft[];
  }): AgentWorkerResult {
    return {
      workerId: input.workerId,
      title: input.title,
      summary: input.summary,
      findings: input.findings,
      artifactDrafts: input.artifactDrafts ?? [],
      citations: input.citations,
      risks: input.risks,
      nextActions: input.nextActions,
      confidence: input.confidence,
      quality: input.quality,
      evidenceLevel: input.evidenceLevel,
      completedAt: new Date().toISOString(),
    };
  }

  private async executeSwarmWrites(run: AgentRun): Promise<Result<void, Error>> {
    const merge = run.merge;
    if (!merge?.writePrompt) {
      return err(new Error('Swarm run has no merge write prompt'));
    }
    let abortController: AbortController | null = null;

    try {
      run = await this.must(this.engine.setStatus(run, 'executing', 'Orchestrator applying merged worker output'));
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Applying swarm output',
        status: 'running',
        detail: 'The orchestrator is writing notes from merged worker drafts',
      });
      run = await this.updateTask(run, 'apply', 'running', {
        progress: 15,
        detail: 'Writing merged worker output through app tools...',
      });

      if (isResearchRunPrompt(run.prompt)) {
        const directWrite = await this.writeMergedSwarmNotes(run, '');
        if (!directWrite.ok) throw directWrite.error;
        run = directWrite.value.run;

        if (!hasValidSwarmNoteArtifacts(run)) {
          throw new Error('Research swarm write completed without creating or updating any notes');
        }

        run = await this.updateTask(run, 'apply', 'completed', {
          result: directWrite.value.summary,
        });
        await this.completeSwarmWriteReview(run, '');
        return ok(undefined);
      }

      const writePrompt = merge.writePrompt;
      abortController = new AbortController();
      this.agentLoopAbortControllers.set(run.id, abortController);
      const result = await this.agentLoop.run(writePrompt, {
        maxTurns: 15,
        maxConcurrency: 5,
        hideInternalMessages: true,
        displayMessage: null,
        onToolCompleted: async (invocation) => {
          const liveArtifacts = this.inferArtifacts(run, [invocation]);
          run = await this.addArtifacts(run, liveArtifacts);
          run = await this.must(this.engine.appendEvent(run, 'narration', {
            message: `${invocation.toolId} ${invocation.status}`,
            data: {
              toolId: invocation.toolId,
              status: invocation.status,
              orchestrationMode: 'swarm',
            },
          }));
          await this.commitRun(run);
        },
        ...(run.conversationId ? { conversationId: run.conversationId } : {}),
        webAccess: run.webAccess ?? (shouldUseNativeWebForRun(run.prompt) ? 'native' : 'off'),
        signal: abortController.signal,
      });

      if (result.error) throw result.error;
      if (result.conversationId) run.conversationId = result.conversationId;

      run = await this.addArtifacts(run, [
        ...this.inferArtifacts(run, result.toolInvocations),
        ...this.collectSwarmSourceArtifacts(run),
        ...this.collectSwarmMediaArtifacts(run),
      ]);

      if (result.cancelled) {
        run = await this.updateTask(run, 'apply', 'cancelled', {
          result: 'Swarm write cancelled',
        });
        run = await this.must(this.engine.setStatus(run, 'cancelled', 'Swarm write cancelled'));
        run.completedAt = new Date().toISOString();
        run = await this.must(this.engine.appendEvent(run, 'run.cancelled', {
          message: 'Swarm run cancelled',
        }));
        await this.commitRun(run);
        return ok(undefined);
      }

      let directWriteSummary: string | null = null;
      if (!hasValidSwarmNoteArtifacts(run)) {
        const directWrite = await this.writeMergedSwarmNotes(run, result.finalResponse);
        if (!directWrite.ok) throw directWrite.error;
        run = directWrite.value.run;
        directWriteSummary = directWrite.value.summary;
      }

      if (!hasValidSwarmNoteArtifacts(run)) {
        throw new Error('Swarm write completed without creating or updating any notes');
      }

      run = await this.updateTask(run, 'apply', 'completed', {
        result: directWriteSummary
          ?? `Orchestrator executed ${result.toolInvocations.length} tool${result.toolInvocations.length === 1 ? '' : 's'}`,
      });

      await this.completeSwarmWriteReview(run, result.finalResponse);
      return ok(undefined);
    } catch (error) {
      abortController?.abort();
      run = await this.must(this.engine.setStatus(run, 'failed', toError(error).message));
      run.error = toError(error).message;
      run.completedAt = new Date().toISOString();
      run = await this.updateTask(run, 'apply', 'failed', { error: run.error });
      run = await this.must(this.engine.appendEvent(run, 'run.failed', {
        message: run.error ?? 'Swarm write failed',
      }));
      await this.commitRun(run, toError(error));
      await this.appendRunActivity(run, {
        id: 'run',
        label: 'Swarm run failed',
        status: 'failed',
        detail: run.error ?? toError(error).message,
        text: `I hit a problem while applying the swarm output for "${run.prompt}": ${run.error ?? toError(error).message}`,
      });
      return err(toError(error));
    } finally {
      this.agentLoopAbortControllers.delete(run.id);
    }
  }

  private async completeSwarmWriteReview(run: AgentRun, finalResponse: string): Promise<void> {
    run = await this.must(this.engine.setStatus(run, 'reviewing', 'Reviewing swarm writes'));
    run = await this.updateTask(run, 'review', 'running', {
      progress: 50,
      detail: 'Recording provenance and refreshing the note index...',
    });

    run.finalSummary = this.buildSwarmFinalSummary(run, finalResponse);
    await this.recordRunProvenance(run);
    await this.index?.indexAll();
    await this.refreshNotesTree();
    await this.openBestResult(run);

    run = await this.updateTask(run, 'review', 'completed', {
      result: 'Swarm provenance recorded and index refreshed',
    });
    run = await this.must(this.engine.setStatus(run, 'completed', 'Swarm run completed'));
    run.completedAt = new Date().toISOString();
    run = await this.must(this.engine.appendEvent(run, 'run.completed', {
      message: run.finalSummary ?? 'Swarm run completed',
    }));
    await this.commitRun(run);
    const swarmNotePaths = run.artifacts
      .filter((artifact) => artifact.type === 'note' && typeof artifact.path === 'string')
      .map((artifact) => artifact.path as string);
    await this.createRunSession(run, 'swarm', swarmNotePaths);
    await this.appendRunActivity(run, {
      id: 'run',
      label: 'Swarm run completed',
      status: 'completed',
      detail: 'Merged worker output has been applied',
      text: run.finalSummary ?? 'Swarm run completed.',
    });
  }

  private createInitialSwarmTasks(runId: string): AgentTask[] {
    return [
      createAgentTask({ id: 'plan', runId, title: 'Plan swarm and worker scopes', kind: 'plan' }),
      createAgentTask({ id: 'workers', runId, title: 'Run bounded worker agents', kind: 'worker', dependencies: ['plan'] }),
      createAgentTask({ id: 'merge', runId, title: 'Merge worker outputs into a write plan', kind: 'merge', status: 'blocked', dependencies: ['workers'] }),
      createAgentTask({ id: 'approval', runId, title: 'Check whether merged writes need approval', kind: 'approval', status: 'blocked', dependencies: ['merge'] }),
      createAgentTask({ id: 'apply', runId, title: 'Orchestrator applies merged note work', kind: 'create', status: 'blocked', dependencies: ['approval'] }),
      createAgentTask({ id: 'review', runId, title: 'Review provenance, artifacts, and index', kind: 'review', status: 'blocked', dependencies: ['apply'] }),
    ];
  }

  private createInitialTasks(runId: string): AgentTask[] {
    return [
      createAgentTask({ id: 'plan', runId, title: 'Understand request and shape AI task graph', kind: 'plan' }),
      createAgentTask({ id: 'vault-search', runId, title: 'Search existing notes for reusable context', kind: 'search', dependencies: ['plan'] }),
      createAgentTask({ id: 'web-research', runId, title: 'Verify current external sources', kind: 'web', dependencies: ['plan'] }),
      createAgentTask({ id: 'approval', runId, title: 'Check whether human approval is needed', kind: 'approval', dependencies: ['vault-search', 'web-research'] }),
      createAgentTask({ id: 'execute', runId, title: 'Create clustered notes and links in realtime', kind: 'create', status: 'blocked', dependencies: ['approval'] }),
      createAgentTask({ id: 'review', runId, title: 'Review links, provenance, and index updates', kind: 'review', status: 'blocked', dependencies: ['execute'] }),
    ];
  }

  private buildSwarmRunPlan(
    prompt: string,
    workers: AgentWorkerSpec[],
    summary: string,
    mergeCriteria: string[]
  ): AgentRunPlan {
    const suggestedFolder = this.suggestResearchFolder(prompt);
    return {
      summary,
      steps: [
        `Coordinate ${workers.length} bounded worker agents.`,
        ...workers.map((worker) => `${worker.title} [${worker.writeScope ?? 'read_only'}]: ${worker.objective}`),
        'Merge worker outputs and staged artifacts into one orchestrator-owned write plan.',
        ...mergeCriteria.map((criterion) => `Acceptance: ${criterion}`),
        'Apply writes through resource-scoped collaboration/lock lanes, then record provenance and refresh the index.',
      ],
      suggestedFolder,
      suggestedNotes: this.suggestStarterNotes(prompt),
      existingNotes: [],
      citations: [],
    };
  }

  private async prepareSwarmResearchContext(
    prompt: string,
    signal?: AbortSignal
  ): Promise<SwarmResearchContext> {
    const existingNotes = await this.searchVault(prompt);
    let citations: ResearchCitation[] = [];

    const verified = await this.searchResearchSources(prompt, true, signal);
    if (verified.ok) {
      citations = verified.value;
    } else {
      log.warn('Swarm verified source preflight failed', {
        error: verified.error.message,
      });
    }

    if (citations.length === 0) {
      const leads = await this.searchResearchSources(prompt, false, signal);
      if (leads.ok) {
        citations = leads.value;
      } else {
        log.warn('Swarm source-lead preflight failed', {
          error: leads.error.message,
        });
      }
    }

    return {
      existingNotes,
      citations: uniqueCitations(citations).slice(0, 8),
    };
  }

  private enrichResearchWorkerSpecs(
    workers: AgentWorkerSpec[],
    context: SwarmResearchContext
  ): AgentWorkerSpec[] {
    if (context.existingNotes.length === 0 && context.citations.length === 0) {
      return workers;
    }

    const contextBlock = formatResearchWorkerContext(context);
    return workers.map((worker) => ({
      ...worker,
      input: [worker.input, contextBlock].filter(hasText).join('\n\n').slice(0, 6000),
      deliverables: unique([
        ...worker.deliverables,
        'Concrete topic-specific findings',
        'Draft material for the final research note',
      ]).slice(0, 10),
    }));
  }

  private enrichWorkerResourceScopes(
    workers: AgentWorkerSpec[],
    prompt: string,
    runId: string
  ): AgentWorkerSpec[] {
    const folder = this.suggestResearchFolder(prompt);
    return workers.map((worker) => {
      const writeScope = worker.writeScope ?? inferWorkerWriteScope(worker);
      const targetResources = worker.targetResources && worker.targetResources.length > 0
        ? worker.targetResources
        : defaultWorkerTargets(worker, writeScope, folder);
      const allowedTools = allowedToolsForWorkerScope(worker.allowedTools, writeScope);
      const input = appendWorkerScopeContext(worker.input, worker.id, runId, writeScope, targetResources);

      return {
        ...worker,
        writeScope,
        targetResources,
        allowedTools,
        input,
        capabilities: worker.capabilities && worker.capabilities.length > 0
          ? worker.capabilities
          : defaultWorkerCapabilities(worker, writeScope),
      };
    });
  }

  private setWorker(
    run: AgentRun,
    workerId: string,
    update: (worker: AgentWorker) => AgentWorker
  ): AgentRun {
    return {
      ...run,
      workers: run.workers.map((worker) => worker.id === workerId ? update(worker) : worker),
      updatedAt: new Date().toISOString(),
    };
  }

  private async addWorkerMessage(
    run: AgentRun,
    input: {
      type: AgentWorkerMessage['type'];
      message: string;
      workerId?: string;
      progress?: number;
      toolId?: string;
      artifactDraft?: AgentWorkerMessage['artifactDraft'];
      result?: AgentWorkerResult;
      data?: Record<string, unknown>;
    }
  ): Promise<AgentRun> {
    if (!this.workerBus) return run;
    const messageInput: Parameters<AgentWorkerBus['createMessage']>[0] = {
      runId: run.id,
      type: input.type,
      message: input.message,
    };
    if (input.workerId !== undefined) messageInput.workerId = input.workerId;
    if (input.progress !== undefined) messageInput.progress = input.progress;
    if (input.toolId !== undefined) messageInput.toolId = input.toolId;
    if (input.artifactDraft !== undefined) messageInput.artifactDraft = input.artifactDraft;
    if (input.result !== undefined) messageInput.result = input.result;
    if (input.data !== undefined) messageInput.data = input.data;
    const message = this.workerBus.createMessage(messageInput);
    const appended = await this.storage.appendWorkerMessage(run.id, message);
    if (!appended.ok) {
      log.warn('Failed to persist worker message', { error: String(appended.error), runId: run.id });
    }
    const next: AgentRun = {
      ...run,
      workerMessages: [...run.workerMessages, message],
      updatedAt: message.createdAt,
    };
    const data: Record<string, unknown> = {
      messageType: message.type,
      workerId: message.workerId,
      progress: message.progress,
      toolId: message.toolId,
      data: message.data,
    };
    if (message.artifactDraft) data.artifactDraft = message.artifactDraft;
    if (message.result) data.result = {
      workerId: message.result.workerId,
      title: message.result.title,
      summary: message.result.summary,
      confidence: message.result.confidence,
      findingCount: message.result.findings.length,
      draftCount: message.result.artifactDrafts.length,
    };

    const eventParams: {
      taskId?: string;
      message: string;
      data: Record<string, unknown>;
    } = {
      message: message.message,
      data,
    };
    if (message.workerId) eventParams.taskId = `worker:${message.workerId}`;

    return this.must(this.engine.appendEvent(next, this.workerBus.eventTypeFor(message), eventParams));
  }

  private buildSwarmApprovalMessage(run: AgentRun): string {
    const merge = run.merge;
    const completedWorkers = run.workers.filter((worker) => worker.status === 'completed').length;
    const failedWorkers = run.workers.filter((worker) => worker.status === 'failed').length;
    return [
      `I coordinated ${completedWorkers} worker${completedWorkers === 1 ? '' : 's'} for "${run.prompt}" and paused before writing files.`,
      failedWorkers > 0
        ? `${failedWorkers} worker${failedWorkers === 1 ? '' : 's'} failed or were blocked; their errors are preserved in the run.`
        : 'All worker outputs are ready for merge.',
      `Draft artifacts: ${merge?.artifactDrafts.length ?? 0}. Risks: ${merge?.risks.length ?? 0}.`,
      'Approve when the merged write scope looks right.',
    ].join('\n');
  }

  private buildSwarmFinalSummary(run: AgentRun, finalResponse: string): string {
    const response = finalResponse.trim();
    const researchRun = isResearchRunPrompt(run.prompt);
    const completedWorkers = run.workers.filter((worker) => worker.status === 'completed').length;
    const failedWorkers = run.workers.filter((worker) => worker.status === 'failed').length;
    const notes = run.artifacts.filter((artifact) =>
      artifact.type === 'note' &&
      (!researchRun || !isPlaceholderResearchArtifact(artifact))
    );
    const noteList = notes.slice(0, 6)
      .map((artifact) => `- ${artifact.title}${artifact.path ? ` (${artifact.path})` : ''}`)
      .join('\n');
    const mediaCount = run.artifacts.filter((artifact) => artifact.type === 'media').length;
    const modelSummary = hasText(response) && !looksLikeUnbackedCreationClaim(response)
      ? `\nModel summary:\n${response}`
      : '';

    if (researchRun) {
      const findings = researchFindingPreview(run).slice(0, 4);
      const caveats = (run.merge?.risks ?? [])
        .filter((risk) => !isProcessResearchDiagnostic(risk))
        .slice(0, 5);
      return [
        `Research completed for "${run.prompt}".`,
        '',
        notes.length > 0
          ? `I created or updated ${notes.length} note${notes.length === 1 ? '' : 's'}:\n${noteList}`
          : 'I could not confirm any note artifacts from the write pass.',
        run.merge?.evidenceLevel
          ? `Evidence level: ${run.merge.evidenceLevel}.`
          : '',
        `Workers: ${completedWorkers} completed${failedWorkers > 0 ? `, ${failedWorkers} failed or blocked` : ''}.`,
        mediaCount > 0
          ? `Captured ${mediaCount} media lead${mediaCount === 1 ? '' : 's'} for review.`
          : '',
        findings.length > 0
          ? `\nKey findings captured:\n${findings.map((finding) => `- ${finding}`).join('\n')}`
          : '',
        caveats.length > 0
          ? `\nOpen caveats:\n${caveats.map((risk) => `- ${risk}`).join('\n')}`
          : '',
        modelSummary,
      ].filter(Boolean).join('\n');
    }

    return [
      `Swarm run completed for "${run.prompt}".`,
      '',
      `Workers: ${completedWorkers} completed${failedWorkers > 0 ? `, ${failedWorkers} failed or blocked` : ''}.`,
      isResearchRunPrompt(run.prompt) && run.merge?.evidenceLevel
        ? `Evidence level: ${run.merge.evidenceLevel}.`
        : '',
      notes.length > 0
        ? `Created or updated ${notes.length} note${notes.length === 1 ? '' : 's'}:\n${noteList}`
        : 'No note artifacts were reported by the orchestrator write pass.',
      mediaCount > 0
        ? `Captured ${mediaCount} media lead${mediaCount === 1 ? '' : 's'} for review.`
        : '',
      run.merge?.risks.length
        ? `\nRisks preserved from worker review:\n${run.merge.risks.slice(0, 5).map((risk) => `- ${risk}`).join('\n')}`
        : '',
      modelSummary,
    ].filter(Boolean).join('\n');
  }

  private async updateTask(
    run: AgentRun,
    taskId: string,
    status: AgentTask['status'],
    params: { progress?: number; detail?: string; result?: string; error?: string } = {}
  ): Promise<AgentRun> {
    const next = await this.must(this.engine.updateTask(run, taskId, status, params));
    await this.commitRun(next);
    await this.appendTaskRunActivity(next, taskId, status, params);
    return next;
  }

  private async must<T>(promise: Promise<Result<T, Error>>): Promise<T> {
    const result = await promise;
    if (!result.ok) throw result.error;
    return result.value;
  }

  private async commitRun(run: AgentRun, error: Error | null = null): Promise<void> {
    if (run.status !== 'cancelled' && await this.wasCancelled(run.id)) {
      const latest = await this.storage.get(run.id);
      if (latest.ok && latest.value) {
        const cancelledRun = latest.value;
        const runs = [cancelledRun, ...this.state.runs.filter((item) => item.id !== cancelledRun.id)]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        this.state = {
          currentRun: this.pickCurrentRun(runs, cancelledRun),
          runs,
          isRunning: runs.some((item) => isActiveAgentRunStatus(item.status)),
          error: null,
        };
        this.notify();
      }
      return;
    }

    const save = await this.storage.save(run);
    const runs = [run, ...this.state.runs.filter((item) => item.id !== run.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.state = {
      currentRun: this.pickCurrentRun(runs, run),
      runs,
      isRunning: runs.some((item) => isActiveAgentRunStatus(item.status)),
      error: error ?? (save.ok ? null : save.error),
    };
    this.notify();
  }

  private pickCurrentRun(runs: AgentRun[], preferred?: AgentRun | null): AgentRun | null {
    if (preferred && isActiveAgentRunStatus(preferred.status)) {
      return runs.find((run) => run.id === preferred.id) ?? preferred;
    }

    if (this.state.currentRun && isActiveAgentRunStatus(this.state.currentRun.status)) {
      const existing = runs.find((run) => run.id === this.state.currentRun?.id);
      if (existing && isActiveAgentRunStatus(existing.status)) return existing;
    }

    return runs.find((run) => isActiveAgentRunStatus(run.status)) ?? null;
  }

  private async wasCancelled(runId: string): Promise<boolean> {
    const existing = await this.storage.get(runId);
    return existing.ok && existing.value?.status === 'cancelled';
  }

  private async latestRunOr(run: AgentRun): Promise<AgentRun> {
    const latest = await this.storage.get(run.id);
    return latest.ok && latest.value ? latest.value : run;
  }

  private async appendRunMessage(run: AgentRun, message: string): Promise<void> {
    if (!this.aiAssistant || !run.conversationId || !message.trim()) return;
    const appended = await this.aiAssistant.appendAssistantMessage(message, run.conversationId);
    if (appended.ok) {
      run.conversationId = appended.value.id;
    } else {
      log.warn('Failed to append agent run message', {
        runId: run.id,
        error: appended.error.message,
      });
    }
  }

  private async appendTaskRunActivity(
    run: AgentRun,
    taskId: string,
    status: AgentTask['status'],
    params: { detail?: string; result?: string; error?: string }
  ): Promise<void> {
    if (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
      return;
    }

    const task = run.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const detail = params.error ?? params.result ?? params.detail ?? task.result ?? task.detail;
    await this.appendRunActivity(run, {
      id: `task:${taskId}`,
      label: task.title,
      status: status === 'failed' ? 'failed' : status === 'running' ? 'running' : 'completed',
      ...(detail !== undefined ? { detail } : {}),
      text: this.buildTaskChatUpdate(run, taskId, status, detail),
    });
  }

  private async appendRunActivity(
    run: AgentRun,
    params: {
      id: string;
      label: string;
      status: 'running' | 'completed' | 'failed';
      detail?: string;
      text?: string;
    }
  ): Promise<void> {
    if (!this.aiAssistant || !run.conversationId) return;

    const detail = compactDetail(params.detail);
    const text = params.text ?? this.buildLiveRunMessage(run, detail);
    await this.appendRunMessage(run, text);
  }

  private buildLiveRunMessage(run: AgentRun, latestDetail?: string): string {
    if (isResearchRunPrompt(run.prompt)) {
      return this.buildResearchLiveMessage(run, latestDetail);
    }

    const completed = run.tasks.filter((task) => task.status === 'completed').length;
    const activeTask =
      run.tasks.find((task) => task.status === 'running') ??
      run.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ??
      null;
    const noteCount = run.artifacts.filter((artifact) => artifact.type === 'note').length;
    const sourceCount = run.artifacts.filter((artifact) => artifact.type === 'source').length;
    const mediaCount = run.artifacts.filter((artifact) => artifact.type === 'media').length;
    const artifactLine = noteCount > 0 || sourceCount > 0 || mediaCount > 0
      ? ` Artifacts: ${noteCount} note${noteCount === 1 ? '' : 's'}, ${sourceCount} source${sourceCount === 1 ? '' : 's'}, ${mediaCount} media.`
      : '';

    return [
      `I'm working on "${run.prompt}".`,
      `Status: ${formatRunStatus(run.status)}. ${completed}/${run.tasks.length} tasks complete.${artifactLine}`,
      activeTask
        ? `I’m on: ${activeTask.title}.`
        : latestDetail
          ? `Latest update: ${latestDetail}.`
          : 'I’ll keep the detailed process in the Command Center.',
    ].join('\n');
  }

  private buildResearchLiveMessage(run: AgentRun, latestDetail?: string): string {
    const noteCount = run.artifacts.filter((artifact) => artifact.type === 'note').length;
    const sourceCount = collectWorkerCitations(
      run,
      run.workers.map((worker) => worker.result).filter((result): result is AgentWorkerResult => !!result)
    ).length;
    const activeTask =
      run.tasks.find((task) => task.status === 'running') ??
      run.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ??
      null;

    if (run.status === 'planning') {
      return `I’m starting the research on "${run.prompt}" and splitting it into source, media, vault, and synthesis work so the notes contain findings, not just a process receipt.`;
    }
    if (run.status === 'coordinating') {
      return `I’m gathering material for "${run.prompt}". The worker lanes are looking for sources, local context, and draftable findings in parallel.`;
    }
    if (run.status === 'merging') {
      return `I’ve got the worker outputs. Now I’m merging them into the research brief and separating sourced findings from open caveats.`;
    }
    if (run.status === 'executing') {
      const sourceText = sourceCount > 0 ? ` ${sourceCount} source${sourceCount === 1 ? '' : 's'} are attached to the write plan.` : '';
      return `Now I’m writing the findings into notes.${sourceText}`;
    }
    if (run.status === 'reviewing') {
      return noteCount > 0
        ? `I created ${noteCount} research note${noteCount === 1 ? '' : 's'} and I’m doing the final review, links, provenance, and index refresh.`
        : 'I’m doing the final review and checking whether the research notes were written correctly.';
    }
    if (activeTask) {
      return `I’m working on "${run.prompt}". Current step: ${activeTask.title}.`;
    }
    return latestDetail
      ? `Latest research update for "${run.prompt}": ${latestDetail}.`
      : `I’m working on "${run.prompt}" and will keep this chat focused on the useful research updates.`;
  }

  private buildTaskChatUpdate(
    run: AgentRun,
    taskId: string,
    status: AgentTask['status'],
    detail?: string
  ): string {
    if (!isResearchRunPrompt(run.prompt)) {
      return this.buildLiveRunMessage(run, detail);
    }

    if (status === 'failed') {
      return `I hit a problem while researching "${run.prompt}": ${detail ?? 'the current step failed'}.`;
    }
    if (status === 'cancelled') {
      return `I stopped the research run for "${run.prompt}".`;
    }
    if (taskId === 'plan' && status === 'running') {
      return `I’m planning the research pass for "${run.prompt}" and assigning source, media, vault, and synthesis lanes.`;
    }
    if (taskId === 'workers' && status === 'running') {
      return `I’m sending the workers out to gather actual findings for "${run.prompt}" now.`;
    }
    if (taskId === 'merge' && status === 'running') {
      return 'The workers are back. I’m turning their material into a write plan for the research notes.';
    }
    if (taskId === 'apply' && status === 'running') {
      return 'Now I’m starting the write-down of the findings into notes.';
    }
    if (taskId === 'review' && status === 'running') {
      return 'The notes are written; I’m checking links, provenance, and the index before calling the research complete.';
    }
    if (taskId === 'review' && status === 'completed') {
      return `Research completed for "${run.prompt}". I’m opening the main note now.`;
    }

    return this.buildResearchLiveMessage(run, detail);
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch {
        // Subscriber errors should not break orchestration.
      }
    }
  }

  private async searchVault(prompt: string): Promise<VaultMatch[]> {
    await this.index?.indexAll();

    let items = flattenNotes(this.notes.getState().items).filter((item) => !item.isFolder);
    if (items.length === 0) {
      const refreshed = await this.notes.refresh();
      if (refreshed.ok) {
        items = flattenNotes(refreshed.value).filter((item) => !item.isFolder);
      }
    }

    const terms = extractTerms(prompt);
    if (terms.length === 0) return [];

    const candidates = items.slice(0, 200);
    const batches = chunk(candidates, 12);
    const matches: VaultMatch[] = [];

    for (const batch of batches) {
      const batchMatches = await Promise.all(batch.map(async (item): Promise<VaultMatch | null> => {
        if (item.protection?.level === 'protected') {
          if (item.protection.lockState === 'locked') return null;
          const policy = this.protection?.currentPolicy();
          if (
            policy?.requireAIApprovalForProtectedReads !== false &&
            !this.protection?.hasAIContextAuthorization(item.protection.noteId, 'note.read')
          ) {
            return null;
          }
        }
        const contentResult = await this.documents.readContent(item.path);
        if (!contentResult.ok) return null;
        const content = contentResult.value.slice(0, 75_000);
        const haystack = `${item.title}\n${item.path}\n${content}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + countOccurrences(haystack, term), 0);
        if (score <= 0) return null;
        return {
          path: item.path,
          title: item.title,
          excerpt: excerptFor(content, terms),
          score,
        };
      }));

      matches.push(...batchMatches.filter((match): match is VaultMatch => match !== null));
      if (matches.length >= 24) break;
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  private async createModelBlueprint(
    prompt: string,
    webAccess: AIWebAccess = 'off'
  ): Promise<AgentRunBlueprint> {
    const assistantPrompt = this.aiAssistant?.prompt?.bind(this.aiAssistant);
    if (!assistantPrompt) return fallbackBlueprint();

    const result = await assistantPrompt([
      'Create a concise AI-only task graph for this Void run.',
      '',
      'Return strict JSON only:',
      '{"summary":"short","suggestedFolder":"optional relative folder","starterNotes":["optional note title"],"tasks":[{"title":"verb phrase","kind":"plan|search|web|create|update|navigate|link|review|tool|other","detail":"optional"}]}',
      '',
      'Rules:',
      '- Tasks are for the AI run only, not user todos.',
      '- Choose tasks from the user request and available note/research workflow.',
      '- Prefer evidence gathering, clustering, note writing, cross-linking, and final review when relevant.',
      '- Keep tasks specific, user-visible, and useful to follow.',
      '- Do not include destructive actions unless the user explicitly asked for them.',
      '',
      'User request:',
      prompt,
    ].join('\n'), {
      autoExecuteTools: false,
      displayMessage: null,
      persistAssistantMessage: false,
      webAccess,
    });

    if (!result.ok) {
      log.warn('Model blueprint generation failed', { error: result.error.message });
      return fallbackBlueprint();
    }

    return parseBlueprint(result.value.chat) ?? fallbackBlueprint();
  }

  private buildPlan(
    prompt: string,
    suggestedFolder: string,
    starterNotes: string[],
    existingNotes: VaultMatch[],
    citations: ResearchCitation[]
  ): AgentRunPlan {
    const sourceStep = citations.length > 0
      ? 'Collect current citeable sources and keep citations with fetched dates.'
      : 'No verified web citations were collected; create an uncited scaffold with a clear Sources Needed section.';

    return {
      summary: citations.length > 0
        ? `Research "${prompt}" using existing notes and ${citations.length} verified source${citations.length === 1 ? '' : 's'}, then let the agent choose evidence-based note clusters.`
        : `Plan clustered research notes for "${prompt}" using existing notes only; no verified web citations are available yet.`,
      steps: [
        'Search the vault for relevant prior notes and concepts.',
        sourceStep,
        `Create a dated research folder: ${suggestedFolder}.`,
        `Create starter structure: ${starterNotes.join(', ')}; add or skip cluster notes based on evidence.`,
        'Write cluster notes incrementally as themes become clear, with realtime artifacts.',
        'Cross-link new notes with each other and with clearly related existing notes.',
        'Record provenance, refresh the index, and open the overview note.',
      ],
      suggestedFolder,
      suggestedNotes: starterNotes,
      existingNotes,
      citations,
    };
  }

  private buildExecutionPrompt(run: AgentRun): string {
    const plan = run.plan;
    const existing = plan?.existingNotes
      .map((note) => `- [[${note.path}]] ${note.title}: ${note.excerpt}`)
      .join('\n') || '- No strong related notes found.';
    const citations = plan?.citations
      .map((source) => `- ${source.title}: ${source.url} (${source.fetchedAt}) ${source.excerpt ?? ''}`)
      .join('\n') || '- No web sources were available from the source adapter.';
    const starterNotes = plan?.suggestedNotes ?? this.suggestStarterNotes(run.prompt);
    const sourcePolicy = plan?.citations.length
      ? [
          'Use only the approved research sources listed above for web-backed claims.',
          'When writing source sections, keep each source on one flat line: "- Source: Title | URL: https://... | Fetched: ISO date | Note: excerpt".',
        ]
      : [
          'No verified web citations are available. Do not invent current facts, URLs, dates, citations, or source titles.',
          'Create an uncited research scaffold and a Sources Needed section instead of presenting web-backed conclusions.',
        ];

    return [
      'Execute this approved Void research run using the available application tools.',
      '',
      `Original user request: ${run.prompt}`,
      `Target research folder: ${plan?.suggestedFolder ?? this.suggestResearchFolder(run.prompt)}`,
      `Starter notes that should usually exist: ${starterNotes.join(', ')}`,
      '',
      'Existing related notes:',
      existing,
      '',
      'Current research sources to cite:',
      citations,
      '',
      ...sourcePolicy,
      '',
      'Execution constraints:',
      '- Use your own reasoning to choose the best note clusters from the prompt, existing notes, and verified evidence.',
      '- Create a dated folder first, then create notes incrementally as clusters become clear.',
      '- Default output should include an overview note, focused cluster notes, a sources note, and an open questions or follow-ups note when useful.',
      '- Use note:create with autoFocus false for background cluster notes; do not steal focus for every file.',
      '- Use todo:create only for real human follow-up work. Keep AI-only execution tasks inside this run, not in the user todo list.',
      '- Use editor/block tools for active-note line or block edits whenever possible instead of replacing full notes.',
      '- Include wiki links between related new notes. Link to existing notes only when the match is clearly relevant.',
      '- Avoid deleting notes, destructive overwrites, or moving existing user content unless the user explicitly requested that exact destructive action.',
      '- Run a final review pass for missing links, duplicate notes, broken references, source sections, provenance, and index refresh.',
      '- Open the final overview note at completion unless the user explicitly asked for a different final focus.',
      '- After writing, provide concise narrative updates and a final completion summary focused on created clusters, links, sources, and real follow-ups.',
    ].join('\n');
  }

  private inferArtifacts(run: AgentRun, invocations: ToolInvocation[]): AgentArtifact[] {
    const artifacts: AgentArtifact[] = [];
    const now = () => new Date().toISOString();

    for (const inv of invocations) {
      if (inv.status !== 'completed' || !inv.result || inv.result.status !== 'success') continue;
      const data = inv.result.data as Record<string, unknown>;

      if (inv.toolId === 'note:create' && typeof data.noteId === 'string') {
        artifacts.push({
          id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'note',
          title: typeof data.title === 'string' ? data.title : data.noteId,
          path: data.noteId,
          noteId: data.noteId,
          summary: 'Created by approved agent run',
          createdAt: now(),
        });
      }

      if (inv.toolId === 'note:update' && typeof inv.args.noteId === 'string') {
        const noteId = typeof data.noteId === 'string' ? data.noteId : inv.args.noteId;
        artifacts.push({
          id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'note',
          title: noteId,
          path: noteId,
          noteId,
          summary: 'Updated by approved agent run',
          createdAt: now(),
        });
      }

      if (inv.toolId === 'note:move' && typeof data.newPath === 'string') {
        artifacts.push({
          id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'note',
          title: data.newPath,
          path: data.newPath,
          noteId: data.newPath,
          summary: 'Moved by approved agent run',
          createdAt: now(),
        });
      }
    }

    if (artifacts.length === 0 && run.plan?.suggestedFolder) {
      artifacts.push({
        id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'folder',
        title: run.plan.suggestedFolder,
        path: run.plan.suggestedFolder,
        summary: 'Approved target folder for the research run',
        createdAt: now(),
      });
    }

    return artifacts;
  }

  private async writeMergedSwarmNotes(
    run: AgentRun,
    finalResponse: string
  ): Promise<Result<SwarmDirectWriteResult, Error>> {
    const workerAuthoredNotes = collectWorkerAuthoredNotes(run);
    if (workerAuthoredNotes.length > 0) {
      return this.commitWorkerConstellation(run, workerAuthoredNotes);
    }

    const writes = this.buildMergedSwarmNoteWrites(run, finalResponse);
    if (writes.length === 0) {
      return err(new Error('Swarm merge did not produce any note content to write'));
    }

    let next = run;
    const updateDrafts = (run.merge?.artifactDrafts ?? []).filter((draft) =>
      isSubstantiveDraft(draft) &&
      draft.type === 'diff' &&
      hasText(draft.path) &&
      (hasText(draft.content) || hasText(draft.summary))
    );

    const updateResults = await Promise.all(updateDrafts.map(async (draft): Promise<Result<AgentArtifact | null, Error>> => {
      const path = draft.path!;
      const sectionTitle = draft.title.trim() || 'Swarm Update';
      const updateContent = draft.content ?? draft.summary ?? '';
      const updateMarkdown = [`## ${sectionTitle}`, '', updateContent.trim()].join('\n');
      const lineage = {
        actor: { kind: 'ai-agent' as const },
        intentKind: 'rewrite' as const,
        summary: `Swarm update from ${draft.workerId}`,
        commandId: 'agent:swarm',
        agentRunId: run.id,
        agentTaskId: 'apply',
        operationId: run.id,
        prompt: run.prompt,
        source: { type: 'tool' as const },
      };

      const updateResult = await this.appendSwarmDraftThroughCollaboration(path, updateMarkdown, sectionTitle, lineage);
      if (!updateResult.ok) return err(updateResult.error);
      if (!updateResult.value) return ok(null);

      return ok<AgentArtifact>({
        id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'note',
        title: sectionTitle,
        path,
        noteId: path,
        summary: 'Updated directly from merged swarm output',
        createdAt: new Date().toISOString(),
      });
    }));

    const updatedArtifacts: AgentArtifact[] = [];
    for (const result of updateResults) {
      if (!result.ok) return err(result.error);
      if (result.value) updatedArtifacts.push(result.value);
    }

    const createResults = await Promise.all(writes.map(async (write, index): Promise<Result<AgentArtifact, Error>> => {
      const createResult = await this.createSwarmNoteThroughCollaboration(run, write);

      if (!createResult.ok) return err(createResult.error);

      const path = createResult.value.path;
      return ok<AgentArtifact>({
        id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'note',
        title: createResult.value.title,
        path,
        noteId: path,
        summary: index === 0
          ? 'Created through collaboration from merged swarm output'
          : 'Created through collaboration as a linked swarm support note',
        createdAt: new Date().toISOString(),
      });
    }));

    const createdArtifacts: AgentArtifact[] = [];
    for (const result of createResults) {
      if (!result.ok) return err(result.error);
      createdArtifacts.push(result.value);
    }

    const noteArtifacts = [
      ...updatedArtifacts,
      ...createdArtifacts,
    ];
    const paths = noteArtifacts.map((artifact) => artifact.path).filter((path): path is string => !!path);
    next = await this.addArtifacts(next, noteArtifacts);

    next = await this.addArtifacts(next, [
      ...this.collectSwarmSourceArtifacts(next),
      ...this.collectSwarmMediaArtifacts(next),
    ]);
    await this.notes.refresh();

    return ok({
      run: next,
      paths,
      summary: `Orchestrator directly wrote ${paths.length} merged note${paths.length === 1 ? '' : 's'} from worker drafts`,
    });
  }

  private async appendSwarmDraftThroughCollaboration(
    path: string,
    markdown: string,
    label: string,
    lineage: LineageRecordOptions
  ): Promise<Result<boolean, Error>> {
    if (!this.collaboration) {
      return err(new Error('NoteCollaborationService is required for swarm note mutations'));
    }

    if (!this.collaboration.isActiveNote(path)) {
      const existing = await this.documents.readContent(path);
      if (!existing.ok) return ok(false);
    }

    const updateResult = await this.collaboration.appendNoteContent(path, markdown, label, lineage);
    return updateResult.ok ? ok(true) : err(updateResult.error);
  }

  private async createSwarmNoteThroughCollaboration(
    run: AgentRun,
    write: SwarmNoteWrite
  ): Promise<Result<{ path: string; title: string }, Error>> {
    if (!this.collaboration) {
      return err(new Error('NoteCollaborationService is required for swarm note mutations'));
    }

    return this.collaboration.createNote({
      folder: write.folder,
      title: write.title,
      content: write.content,
      autoFocus: false,
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'import',
        summary: write.summary,
        commandId: 'agent:swarm',
        agentRunId: run.id,
        agentTaskId: 'apply',
        operationId: run.id,
        prompt: run.prompt,
        source: { type: 'tool' },
      },
    });
  }

  private async commitWorkerConstellation(
    run: AgentRun,
    workerAuthoredNotes: AgentArtifactDraft[]
  ): Promise<Result<SwarmDirectWriteResult, Error>> {
    const noteArtifacts: AgentArtifact[] = workerAuthoredNotes.map((draft) => ({
      id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'note',
      title: draft.title,
      path: draft.path!,
      noteId: draft.path!,
      summary: draft.summary ?? `Authored by worker ${draft.workerId}`,
      createdAt: new Date().toISOString(),
    }));

    let next = await this.addArtifacts(run, noteArtifacts);
    next = await this.addArtifacts(next, [
      ...this.collectSwarmSourceArtifacts(next),
      ...this.collectSwarmMediaArtifacts(next),
    ]);
    await this.notes.refresh();

    const plannedTitles = run.workers
      .map((worker) => worker.spec.assignedNote?.title)
      .filter((title): title is string => !!title);
    const actualTitles = new Set(workerAuthoredNotes.map((draft) => draft.title));
    const missing = plannedTitles.filter((title) => !actualTitles.has(title));
    const summary = missing.length === 0
      ? `Authored ${noteArtifacts.length} cross-linked note${noteArtifacts.length === 1 ? '' : 's'} via worker tool calls`
      : `Authored ${noteArtifacts.length} of ${plannedTitles.length} planned notes; ${missing.length} missing`;

    return ok({
      run: next,
      paths: noteArtifacts.map((artifact) => artifact.path!).filter(Boolean),
      summary,
    });
  }

  private buildMergedSwarmNoteWrites(run: AgentRun, finalResponse: string): SwarmNoteWrite[] {
    const merge = run.merge;
    const folder = run.plan?.suggestedFolder ?? this.suggestResearchFolder(run.prompt);
    const topic = deriveResearchTopic(run.prompt).displayTitle;
    const drafts = (merge?.artifactDrafts ?? []).filter(isSubstantiveDraft);
    const workerResults = run.workers
      .map((worker) => worker.result)
      .filter((result): result is AgentWorkerResult => !!result);
    const noteDrafts = drafts.filter((draft) =>
      (draft.type === 'note' || draft.type === 'summary') &&
      (hasText(draft.content) || hasText(draft.summary))
    );
    const primaryDraft = noteDrafts.find((draft) => draft.type === 'note' && /overview|brief|research/i.test(draft.title))
      ?? noteDrafts.find((draft) => draft.type === 'note')
      ?? noteDrafts.find((draft) => /overview|brief|summary|research/i.test(draft.title))
      ?? noteDrafts[0]
      ?? null;

    const usedTitles = new Set<string>();
    const overviewTitle = uniqueNoteTitle(primaryDraft?.title ?? `Brief - ${topic}`, usedTitles);
    const overviewLink = wikiLinkForNoteTitle(overviewTitle);
    const supportWrites = noteDrafts
      .filter((draft) => draft !== primaryDraft)
      .slice(0, 3)
      .map((draft): SwarmNoteWrite => {
        const pathParts = draft.path ? splitDraftPath(draft.path) : null;
        const title = uniqueNoteTitle(draft.title || pathParts?.title || `${topic} Notes`, usedTitles);
        return {
          title,
          folder: pathParts?.folder ?? folder,
          content: [
            ensureMarkdownHeading(draft.content ?? draft.summary ?? '', title),
            '',
            '## Connections',
            `- Part of ${overviewLink}`,
          ].join('\n'),
          summary: `Swarm support note from ${draft.workerId}`,
        };
      });

    const citations = collectWorkerCitations(run, workerResults);
    const mediaDrafts = collectMediaDrafts(run);
    if (citations.length > 0 && !supportWrites.some((write) => /source/i.test(write.title))) {
      const sourceTitle = uniqueNoteTitle(`${topic} Sources`, usedTitles);
      const verifiedSources = citations.filter(isVerifiedCitation);
      const sourceLeads = citations.filter((citation) => !isVerifiedCitation(citation));
      supportWrites.push({
        title: sourceTitle,
        folder,
        content: [
          `# ${sourceTitle}`,
          '',
          `Related note: ${overviewLink}`,
          '',
          '## Verified Sources',
          ...(verifiedSources.length > 0
            ? verifiedSources.map((citation) =>
                `- ${citation.title} | ${citation.url} | Fetched: ${citation.fetchedAt}${citation.excerpt ? ` | ${citation.excerpt}` : ''}`
              )
            : ['- No verified sources captured.']),
          ...(sourceLeads.length > 0
            ? [
                '',
                '## Source Leads',
                ...sourceLeads.map((citation) =>
                  `- ${citation.title} | ${citation.url} | Fetched: ${citation.fetchedAt}${citation.excerpt ? ` | ${citation.excerpt}` : ''}`
                ),
              ]
            : []),
        ].join('\n'),
        summary: 'Swarm source note',
      });
    }

    if (mediaDrafts.length > 0 && !supportWrites.some((write) => /media/i.test(write.title))) {
      const mediaTitle = uniqueNoteTitle(`${topic} Media`, usedTitles);
      supportWrites.push({
        title: mediaTitle,
        folder,
        content: [
          `# ${mediaTitle}`,
          '',
          `Related note: ${overviewLink}`,
          '',
          '## Media Leads',
          ...mediaDrafts.slice(0, 20).map((draft) => mediaDraftLine(draft)),
          '',
          '## Verification Notes',
          '- Confirm availability, source credibility, permissions, and relevance before embedding or quoting.',
        ].join('\n'),
        summary: 'Swarm media note',
      });
    }

    const risks = unique([
      ...(merge?.risks ?? []),
      ...workerResults.flatMap((result) => result.risks),
    ])
      .filter(hasText)
      .filter((risk) => !isProcessResearchDiagnostic(risk));
    const nextActions = unique(workerResults.flatMap((result) => result.nextActions))
      .filter(hasText)
      .filter((action) => !isProcessResearchDiagnostic(action));
    if ((risks.length > 0 || nextActions.length > 0) && supportWrites.length < 5) {
      const followUpTitle = uniqueNoteTitle(`${topic} Follow-ups`, usedTitles);
      const lines = [
        `# ${followUpTitle}`,
        '',
        `Related note: ${overviewLink}`,
      ];
      if (risks.length > 0) {
        lines.push('', '## Risks And Caveats', ...risks.map((risk) => `- ${risk}`));
      }
      if (nextActions.length > 0) {
        lines.push('', '## Next Actions', ...nextActions.map((action) => `- ${action}`));
      }
      supportWrites.push({
        title: followUpTitle,
        folder,
        content: lines.join('\n'),
        summary: 'Swarm follow-up note',
      });
    }

    const overviewPathParts = primaryDraft?.path ? splitDraftPath(primaryDraft.path) : null;
    const overviewContent = this.buildSwarmOverviewContent({
      run,
      title: overviewTitle,
      baseContent: primaryDraft?.content ?? primaryDraft?.summary ?? '',
      supportTitles: supportWrites.map((write) => write.title),
      workerResults,
      citations,
      mediaDrafts,
      finalResponse,
    });

    return [
      {
        title: overviewTitle,
        folder: overviewPathParts?.folder ?? folder,
        content: overviewContent,
        summary: 'Swarm overview note from merged worker output',
      },
      ...supportWrites,
    ];
  }

  private buildSwarmOverviewContent(input: {
    run: AgentRun;
    title: string;
    baseContent: string;
    supportTitles: string[];
    workerResults: AgentWorkerResult[];
    citations: ResearchCitation[];
    mediaDrafts: AgentArtifactDraft[];
    finalResponse: string;
  }): string {
    const researchRun = isResearchRunPrompt(input.run.prompt);
    const findings = unique([
      ...input.workerResults.flatMap((result) => result.findings),
      ...citationBackedFindings(input.citations),
    ])
      .filter(hasText)
      .filter((finding) => !looksLikeGenericWorkerCompletion(finding))
      .filter((finding) => !isProcessResearchDiagnostic(finding))
      .slice(0, 16);
    const summaries = input.workerResults
      .map((result) => result.summary)
      .filter(hasText)
      .filter((summary) => !looksLikeGenericWorkerCompletion(summary))
      .slice(0, 6);
    const existingNotes = input.run.plan?.existingNotes ?? [];
    const safeFinalResponse = hasText(input.finalResponse) && !looksLikeUnbackedCreationClaim(input.finalResponse)
      ? input.finalResponse.trim()
      : '';
    const base = ensureMarkdownHeading(input.baseContent, input.title);
    if (researchRun) {
      if (looksLikeSubstantiveLearningNote(base)) {
        const lines = [base.trim()];
        if (input.supportTitles.length > 0 || existingNotes.length > 0) {
          lines.push(
            '',
            '## Connections',
            ...input.supportTitles.map((title) => `- ${wikiLinkForNoteTitle(title)}`),
            ...existingNotes.slice(0, 8).map((note) => `- [[${note.path}]] ${note.title}`)
          );
        }
        if (input.mediaDrafts.length > 0 && !/^##\s+Media Leads\b/im.test(base)) {
          lines.push(
            '',
            '## Media Leads',
            ...input.mediaDrafts.slice(0, 12).map((draft) => mediaDraftLine(draft))
          );
        }
        return lines.join('\n');
      }
      const risks = unique([
        ...(input.run.merge?.risks ?? []),
        ...input.workerResults.flatMap((result) => result.risks),
      ])
        .filter(hasText)
        .filter((risk) => !isProcessResearchDiagnostic(risk))
        .slice(0, 10);
      const nextActions = unique(input.workerResults.flatMap((result) => result.nextActions))
        .filter(hasText)
        .filter((action) => !isProcessResearchDiagnostic(action))
        .slice(0, 8);
      const verifiedSources = input.citations.filter(isVerifiedCitation);
      const sourceLeads = input.citations.filter((citation) => !isVerifiedCitation(citation));
      const overviewBody = stripMarkdownHeading(base, input.title);
      const topic = deriveResearchTopic(input.run.prompt).displayTitle;
      const lines: string[] = [
        `# ${input.title}`,
        '',
        '## Learning Note',
        overviewBody && !isProcessResearchDiagnostic(overviewBody) && !looksLikeResearchReceiptMarkdown(overviewBody)
          ? overviewBody
          : `${topic} is treated here as a learning topic: what it is, which concepts matter, and what to study next.`,
        '',
        '## Key Takeaways',
        ...(findings.length > 0
          ? findings.map((finding) => `${finding}${/[.!?]$/.test(finding) ? '' : '.'}`)
          : ['*No substantive findings yet. Rerun with web access or rephrase the prompt.*']),
        '',
        '## Sources',
        ...(verifiedSources.length > 0
          ? verifiedSources.slice(0, 12).map((citation) => sourceReferenceLine(citation))
          : ['- No verified sources captured yet.']),
      ];

      if (sourceLeads.length > 0) {
        lines.push(
          '',
          '## Source Leads To Verify',
          ...sourceLeads.slice(0, 12).map((citation) => sourceReferenceLine(citation))
        );
      }
      if (input.mediaDrafts.length > 0) {
        lines.push(
          '',
          '## Media To Review',
          ...input.mediaDrafts.slice(0, 12).map((draft) => mediaDraftLine(draft))
        );
      }

      lines.push(
        '',
        '## Further Learning',
        ...(risks.length > 0 || nextActions.length > 0
          ? [
              ...risks.map((risk) => `- ${risk}`),
              ...nextActions.map((action) => `- ${action}`),
            ]
          : [
              `- Which examples make ${topic} concrete and easy to remember?`,
              '- Which claims still need primary or authoritative source checks?',
            ])
      );

      if (input.supportTitles.length > 0 || existingNotes.length > 0) {
        lines.push(
          '',
          '## Connections',
          ...input.supportTitles.map((title) => `- ${wikiLinkForNoteTitle(title)}`),
          ...existingNotes.slice(0, 8).map((note) => `- [[${note.path}]] ${note.title}`)
        );
      }

      return lines.join('\n');
    }

    const lines = [
      base,
      '',
      '## Orchestration Summary',
      `Created by Void's multi-agent orchestrator from ${input.workerResults.length} worker result${input.workerResults.length === 1 ? '' : 's'}.`,
    ];

    if (safeFinalResponse) lines.push('', safeFinalResponse);
    if (summaries.length > 0) lines.push('', 'Worker summaries:', ...summaries.map((summary) => `- ${summary}`));
    if (findings.length > 0) lines.push('', '## Key Findings', ...findings.map((finding) => `- ${finding}`));
    if (input.supportTitles.length > 0 || existingNotes.length > 0) {
      lines.push(
        '',
        '## Connections',
        ...input.supportTitles.map((title) => `- ${wikiLinkForNoteTitle(title)}`),
        ...existingNotes.slice(0, 8).map((note) => `- [[${note.path}]] ${note.title}`)
      );
    }
    if (input.citations.length > 0) {
      lines.push(
        '',
        '## Sources',
        ...input.citations.slice(0, 12).map((citation) =>
          `- ${citation.title} | ${citation.url} | Fetched: ${citation.fetchedAt}${citation.excerpt ? ` | ${citation.excerpt}` : ''}`
        )
      );
    }

    return lines.join('\n');
  }

  private collectSwarmSourceArtifacts(run: AgentRun): AgentArtifact[] {
    const workerResults = run.workers
      .map((worker) => worker.result)
      .filter((result): result is AgentWorkerResult => !!result);
    return collectWorkerCitations(run, workerResults).map((citation) => {
      const artifact: AgentArtifact = {
        id: `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'source',
        title: citation.title,
        url: citation.url,
        citation,
        createdAt: new Date().toISOString(),
      };
      if (citation.excerpt) artifact.summary = citation.excerpt;
      return artifact;
    });
  }

  private collectSwarmMediaArtifacts(run: AgentRun): AgentArtifact[] {
    return collectMediaDrafts(run).map((draft) => {
      const artifact: AgentArtifact = {
        id: `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'media',
        title: draft.title,
        url: draft.url!,
        createdAt: new Date().toISOString(),
      };
      if (draft.summary) artifact.summary = draft.summary;
      if (draft.mediaKind) artifact.mediaKind = draft.mediaKind;
      if (draft.thumbnailUrl) artifact.thumbnailUrl = draft.thumbnailUrl;
      if (draft.citation) artifact.citation = draft.citation;
      return artifact;
    });
  }

  private async addArtifacts(run: AgentRun, artifacts: AgentArtifact[]): Promise<AgentRun> {
    let next = run;
    for (const artifact of artifacts) {
      if (this.hasArtifact(next, artifact)) continue;
      next = await this.must(this.engine.addArtifact(next, artifact));
      if (artifact.type === 'note' || artifact.type === 'folder') {
        const detail = artifact.path ?? artifact.summary;
        await this.appendRunActivity(next, {
          id: `artifact:${artifact.id}`,
          label: artifact.type === 'note' ? `Created or updated ${artifact.title}` : `Created folder ${artifact.title}`,
          status: 'completed',
          ...(detail !== undefined ? { detail } : {}),
          text: this.buildArtifactChatUpdate(next, artifact),
        });
      }
    }
    return next;
  }

  private buildArtifactChatUpdate(run: AgentRun, artifact: AgentArtifact): string {
    if (!isResearchRunPrompt(run.prompt)) {
      return this.buildLiveRunMessage(run, artifact.path ?? artifact.summary);
    }

    if (artifact.type === 'folder') {
      return `I created the research folder "${artifact.title}" for "${run.prompt}".`;
    }

    const pathLine = artifact.path ? `\n\n${artifact.path}` : '';
    const lower = artifact.title.toLowerCase();
    if (/source/.test(lower)) {
      return `I created "${artifact.title}" to keep the research sources and leads separate from the main brief.${pathLine}`;
    }
    if (/follow|open question|next/.test(lower)) {
      return `I created "${artifact.title}" for topic-specific caveats and follow-up questions.${pathLine}`;
    }
    if (/media|image|video|youtube/.test(lower)) {
      return `I created "${artifact.title}" for media leads that may help illustrate or verify the research.${pathLine}`;
    }
    return `I created "${artifact.title}" as the main learning note for "${run.prompt}". It focuses on the topic findings and what to study next.${pathLine}`;
  }

  private hasArtifact(run: AgentRun, artifact: AgentArtifact): boolean {
    return run.artifacts.some((existing) => {
      if (artifact.path && existing.path === artifact.path && existing.type === artifact.type) return true;
      if (artifact.url && existing.url === artifact.url && existing.type === artifact.type) return true;
      return existing.id === artifact.id;
    });
  }

  private async recordRunProvenance(run: AgentRun): Promise<void> {
    if (!this.provenance) return;
    const notePaths = unique(run.artifacts
      .filter((artifact) => artifact.type === 'note' && artifact.path)
      .map((artifact) => artifact.path!));
    const sourceArtifacts = run.artifacts.filter((artifact) => artifact.type === 'source');
    const verifiedSourceCount = sourceArtifacts.filter((artifact) => artifact.citation?.status === 'verified').length;
    const sourceLeadCount = sourceArtifacts.filter((artifact) => artifact.citation?.status !== 'verified').length;
    const mediaLeadCount = run.artifacts.filter((artifact) => artifact.type === 'media').length;
    const completedWorkers = run.workers.filter((worker) => worker.status === 'completed').length;
    const failedWorkers = run.workers.filter((worker) => worker.status === 'failed').length;
    const provenanceSummary = [
      run.finalSummary ?? 'Agent research run wrote or reviewed this note.',
      '',
      `Run ID: ${run.id}`,
      run.merge?.evidenceLevel ? `Evidence level: ${run.merge.evidenceLevel}` : '',
      `Workers completed: ${completedWorkers}`,
      `Workers failed or blocked: ${failedWorkers}`,
      `Verified sources: ${verifiedSourceCount}`,
      `Source leads: ${sourceLeadCount}`,
      `Media leads: ${mediaLeadCount}`,
      run.workerMessages.some((message) => message.data?.modelPrior === true)
        ? 'Synthesis recovery: model-prior'
        : '',
    ].filter(Boolean).join('\n');

    for (const path of notePaths) {
      await this.provenance.record(noteNameFromPath(path), {
        type: 'ai_action',
        blocks: [],
        prompt: run.prompt,
        action: 'agent_run',
        result: provenanceSummary,
        accepted: true,
        operationId: run.id,
        relatedNotes: notePaths.filter((other) => other !== path),
      });
    }
  }

  private async openBestResult(run: AgentRun): Promise<void> {
    const noteArtifacts = run.artifacts.filter((artifact) => artifact.type === 'note' && artifact.path);
    const folderFocusPath = noteArtifacts.length > 1 ? folderFocusPathForArtifacts(noteArtifacts) : null;
    if (folderFocusPath) {
      await this.navigation.openFolder(folderFocusPath);
      return;
    }

    const note = noteArtifacts.find((artifact) =>
      artifact.type === 'note' &&
      artifact.path &&
      /overview|summary|research/i.test(artifact.title)
    ) ?? noteArtifacts[0];

    if (note?.path) {
      await this.navigation.openNote(note.path);
      return;
    }

    const folder = run.artifacts.find((artifact) => artifact.type === 'folder' && artifact.path);
    if (folder?.path) {
      await this.navigation.openFolder(folder.path);
    }
  }

  private async refreshNotesTree(): Promise<void> {
    const result = await this.notes.refresh();
    if (!result.ok) {
      log.warn('Failed to refresh notes tree after agent run', { error: result.error.message });
    }
  }

  private buildFinalSummary(run: AgentRun, finalResponse: string): string {
    const noteArtifacts = run.artifacts.filter((artifact) => artifact.type === 'note');
    const notes = noteArtifacts.length;
    const sources = run.artifacts.filter((artifact) => artifact.type === 'source').length;
    const media = run.artifacts.filter((artifact) => artifact.type === 'media').length;
    const response = finalResponse.trim();
    if (isUsefulCompletionResponse(response)) return response;

    const noteList = noteArtifacts
      .slice(0, 6)
      .map((artifact) => `- ${artifact.title}${artifact.path ? ` (${artifact.path})` : ''}`)
      .join('\n');
    const sourceText = sources > 0
      ? `${sources} source${sources === 1 ? '' : 's'} attached to the run.`
      : 'No verified web sources were available, so the notes should be treated as an uncited scaffold until sources are added.';
    const mediaText = media > 0
      ? `${media} media lead${media === 1 ? '' : 's'} attached to the run.`
      : '';

    return [
      `Research run completed for "${run.prompt}".`,
      '',
      notes > 0
        ? `Created or updated ${notes} note${notes === 1 ? '' : 's'}:\n${noteList}`
        : 'No note artifacts were reported by the tool run.',
      '',
      sourceText,
      mediaText,
    ].filter(Boolean).join('\n');
  }

  private buildApprovalMessage(run: AgentRun): string {
    const plan = run.plan;
    const noteCount = plan?.suggestedNotes.length ?? 0;
    const sourceCount = plan?.citations.length ?? 0;
    const existingCount = plan?.existingNotes.length ?? 0;
    const sourceLine = sourceCount > 0
      ? `${sourceCount} verified source${sourceCount === 1 ? '' : 's'} ready to cite.`
      : 'No verified web sources were collected, so approval will create an uncited scaffold with a Sources Needed section.';

    return [
      `I drafted a research plan for "${run.prompt}" and paused before writing files.`,
      `Folder: ${plan?.suggestedFolder ?? this.suggestResearchFolder(run.prompt)}`,
      `Approved note count: ${noteCount}. Existing-note matches: ${existingCount}. ${sourceLine}`,
      'Review the Command Center and approve when the write scope looks right.',
    ].join('\n');
  }

  private suggestResearchFolder(prompt: string): string {
    const date = new Date().toISOString().slice(0, 10);
    return `Research/${deriveResearchTopic(prompt).slug} ${date}`;
  }

  private suggestStarterNotes(prompt: string): string[] {
    const topic = deriveResearchTopic(prompt);
    return [
      topic.overviewTitle,
      topic.sourcesTitle,
      topic.openQuestionsTitle,
    ];
  }
}

function collectWorkerAuthoredNotes(run: AgentRun): AgentArtifactDraft[] {
  const seen = new Set<string>();
  const result: AgentArtifactDraft[] = [];
  for (const worker of run.workers) {
    const drafts = worker.result?.artifactDrafts ?? [];
    for (const draft of drafts) {
      if (draft.type !== 'note') continue;
      if (draft.metadata?.toolId !== 'note:create') continue;
      if (draft.metadata?.staged !== true) continue;
      const path = draft.path;
      if (!path) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      result.push(draft);
    }
  }
  return result;
}

function fallbackBlueprint(): AgentRunBlueprint {
  return {
    tasks: [
      { title: 'Identify research clusters from the request', kind: 'plan' },
      { title: 'Compare existing notes with the requested topic', kind: 'search' },
      { title: 'Write linked notes and review the source map', kind: 'create' },
    ],
  };
}

function parseBlueprint(text: string): AgentRunBlueprint | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Partial<AgentRunBlueprint>;
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .map((task): AgentRunBlueprint['tasks'][number] | null => {
            if (!task || typeof task.title !== 'string') return null;
            const kind = isAgentTaskKind(task.kind) ? task.kind : 'other';
            const item: AgentRunBlueprint['tasks'][number] = {
              title: task.title.slice(0, 120),
              kind,
            };
            if (typeof task.detail === 'string') item.detail = task.detail.slice(0, 240);
            return item;
          })
          .filter((task): task is AgentRunBlueprint['tasks'][number] => task !== null)
          .slice(0, 8)
      : [];
    if (tasks.length === 0) return null;

    const blueprint: AgentRunBlueprint = { tasks };
    if (typeof parsed.summary === 'string') blueprint.summary = parsed.summary.slice(0, 500);
    if (typeof parsed.suggestedFolder === 'string') blueprint.suggestedFolder = parsed.suggestedFolder.slice(0, 160);
    if (Array.isArray(parsed.starterNotes)) {
      blueprint.starterNotes = parsed.starterNotes
        .filter((note): note is string => typeof note === 'string')
        .map((note) => note.slice(0, 100))
        .slice(0, 8);
    }
    return blueprint;
  } catch {
    return null;
  }
}

function isAgentTaskKind(value: unknown): value is AgentTask['kind'] {
  return (
    value === 'plan' ||
    value === 'search' ||
    value === 'web' ||
    value === 'approval' ||
    value === 'create' ||
    value === 'update' ||
    value === 'navigate' ||
    value === 'link' ||
    value === 'review' ||
    value === 'tool' ||
    value === 'other'
  );
}

function shouldUseNativeWebForRun(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    /\b(research|investigate|study|deep dive|current|latest|today|recent|newest|up-to-date|web|internet)\b/.test(normalized) ||
    /\b(onderzoek|onderzoeken|vandaag|laatste|recent|actueel|internet)\b/.test(normalized)
  );
}

function flattenNotes(items: NotesListItem[]): NotesListItem[] {
  const result: NotesListItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenNotes(item.children));
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractTerms(input: string): string[] {
  const stop = new Set([
    'about', 'after', 'best', 'create', 'current', 'doing', 'folder', 'good',
    'great', 'interesting', 'make', 'made', 'note', 'notes', 'please',
    'research', 'separate', 'their', 'there', 'these', 'thing', 'topics',
    'using', 'want', 'with', 'write',
  ]);
  return unique(input.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => (term.length > 3 || term === 'ai' || term === 'ml') && !stop.has(term)));
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count++;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function excerptFor(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const firstIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 120);
  const end = Math.min(content.length, firstIndex + 240);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function titleCase(input: string): string {
  return input.replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasValidSwarmNoteArtifacts(run: AgentRun): boolean {
  const noteArtifacts = run.artifacts.filter((artifact) => artifact.type === 'note' && !!artifact.path);
  if (noteArtifacts.length === 0) return false;
  if (!isResearchRunPrompt(run.prompt)) return true;
  return noteArtifacts.some((artifact) => !isPlaceholderResearchArtifact(artifact));
}

function hasVerifiedResearchEvidence(run: AgentRun, workerResults: AgentWorkerResult[]): boolean {
  return [
    ...(run.plan?.citations ?? []),
    ...workerResults.flatMap((result) => result.citations),
  ].some(isVerifiedCitation);
}

function hasAnyResearchFindings(workerResults: AgentWorkerResult[]): boolean {
  return workerResults.some((result) =>
    result.findings.some((finding) => hasText(finding) && !looksLikeGenericWorkerCompletion(finding))
  );
}

function isVerifiedCitation(citation: ResearchCitation): boolean {
  return citation.status === 'verified';
}

function parseModelPriorJson(text: string): {
  summary: string;
  findings: string[];
  risks: string[];
  nextActions: string[];
  confidence: number;
} | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      summary?: unknown;
      findings?: unknown;
      risks?: unknown;
      nextActions?: unknown;
      confidence?: unknown;
    };
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      findings: sanitizeStringList(parsed.findings).filter((finding) => !looksLikeGenericWorkerCompletion(finding)),
      risks: sanitizeStringList(parsed.risks),
      nextActions: sanitizeStringList(parsed.nextActions),
      confidence: typeof parsed.confidence === 'number' && !Number.isNaN(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.45,
    };
  } catch {
    return null;
  }
}

function parseSourceLearningDraftJson(text: string): {
  summary: string;
  findings: string[];
  noteTitle: string;
  noteContentMarkdown: string;
  risks: string[];
  nextActions: string[];
  confidence: number;
} | null {
  const json = text.trim().startsWith('{')
    ? text.trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      summary?: unknown;
      findings?: unknown;
      noteTitle?: unknown;
      noteContentMarkdown?: unknown;
      risks?: unknown;
      nextActions?: unknown;
      confidence?: unknown;
    };
    const noteContentMarkdown = typeof parsed.noteContentMarkdown === 'string'
      ? parsed.noteContentMarkdown.trim()
      : '';
    if (!noteContentMarkdown) return null;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      findings: sanitizeStringList(parsed.findings)
        .filter((finding) => !looksLikeGenericWorkerCompletion(finding))
        .filter((finding) => !isProcessResearchDiagnostic(finding)),
      noteTitle: typeof parsed.noteTitle === 'string' ? parsed.noteTitle.trim().slice(0, 120) : '',
      noteContentMarkdown,
      risks: sanitizeStringList(parsed.risks),
      nextActions: sanitizeStringList(parsed.nextActions),
      confidence: typeof parsed.confidence === 'number' && !Number.isNaN(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7,
    };
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

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isProcessResearchDiagnostic(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(draft artifact|source recovery|source lookup|source lead recovery|native web|tool result)\b/.test(normalized) ||
    /did not return structured|no draft artifact|recovered sources still need human review|review recovered sources|verify each source lead|run a deeper source-backed pass|transparent seed note|worker did not return/.test(normalized);
}

function looksLikeResearchReceiptMarkdown(markdown: string): boolean {
  return /^##\s+(Evidence Status|Run Receipt|Worker Notes|Run Notes)\b/im.test(markdown) ||
    /This note captures the research run/i.test(markdown);
}

function isPlaceholderResearchArtifact(artifact: AgentArtifact): boolean {
  const title = artifact.title.trim().toLowerCase();
  const path = artifact.path?.trim().toLowerCase() ?? '';
  return title === 'worker summary' ||
    title === 'summary' ||
    path.endsWith('/worker-summary.md') ||
    path === 'worker-summary.md';
}

function folderFocusPathForArtifacts(artifacts: AgentArtifact[]): string | null {
  const grouped = new Map<string, AgentArtifact[]>();

  for (const artifact of artifacts) {
    if (!artifact.path) continue;
    const folder = folderKeyForArtifactPath(artifact.path);
    if (!folder) continue;
    const group = grouped.get(folder) ?? [];
    group.push(artifact);
    grouped.set(folder, group);
  }

  const bestGroup = [...grouped.values()].sort((a, b) => b.length - a.length)[0];
  if (!bestGroup || bestGroup.length < 2) return null;
  return bestGroup[0]?.path ?? null;
}

function folderKeyForArtifactPath(path: string): string | null {
  const normalized = path
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^file:\/\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (!normalized) return null;

  if (!/\.(md|markdown)$/i.test(normalized)) {
    return normalized.replace(/^\/+/, '');
  }

  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/') || null;
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueNoteTitle(title: string, used: Set<string>): string {
  const base = title.trim() || 'Research Note';
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} ${index}`;
    index++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function splitDraftPath(path: string): { folder: string; title: string } {
  const withoutExtension = path.replace(/\.md$/i, '').replace(/^\/+/, '');
  const parts = withoutExtension.split('/').filter(Boolean);
  const file = parts.pop() ?? 'research-note';
  return {
    folder: parts.join('/'),
    title: titleCase(file.replace(/[-_]+/g, ' ')),
  };
}

function ensureMarkdownHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `# ${title}`;
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return [`# ${title}`, '', trimmed].join('\n');
}

function stripMarkdownHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  const withoutHeading = trimmed.replace(new RegExp(`^#\\s+${escapeRegExp(title)}\\s*\\n*`, 'i'), '').trim();
  return withoutHeading.replace(/^#\s+.+\n*/i, '').trim();
}

function looksLikeSubstantiveLearningNote(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (!trimmed || looksLikeResearchReceiptMarkdown(trimmed)) return false;
  const words = wordCount(trimmed);
  if (words < 60) return false;
  const sectionCount = (trimmed.match(/^##\s+\S.+$/gm) ?? []).length;
  const paragraphCount = trimmed
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => wordCount(part) >= 18).length;
  return sectionCount >= 2 || paragraphCount >= 3;
}

function formatResearchWorkerContext(context: SwarmResearchContext): string {
  const lines = ['Pre-collected research context for this worker:'];
  if (context.citations.length > 0) {
    lines.push(
      '',
      'Sources and leads:',
      ...context.citations.slice(0, 8).map((citation) => [
        `- ${citation.title}`,
        citation.status ? `Status: ${citation.status}` : '',
        `URL: ${citation.url}`,
        citation.excerpt ? `Note: ${citation.excerpt}` : '',
      ].filter(Boolean).join(' | '))
    );
  }
  if (context.existingNotes.length > 0) {
    lines.push(
      '',
      'Related local notes:',
      ...context.existingNotes.slice(0, 8).map((note) =>
        `- [[${note.path}]] ${note.title}: ${note.excerpt}`
      )
    );
  }
  lines.push(
    '',
    'Use this context to write concrete topic findings. Preserve uncertainty when a source is only a lead or local context.'
  );
  return lines.join('\n');
}

function buildResearchEvidenceBundle(
  context: SwarmResearchContext,
  source: AgentResearchEvidenceBundle['source']
): AgentResearchEvidenceBundle {
  return {
    existingNotes: context.existingNotes,
    citations: uniqueCitations(context.citations),
    collectedAt: new Date().toISOString(),
    source,
  };
}

function mergeResearchEvidence(
  current: AgentResearchEvidenceBundle | undefined,
  next: AgentResearchEvidenceBundle
): AgentResearchEvidenceBundle {
  if (!current) return next;
  return {
    existingNotes: uniqueBy(
      [...current.existingNotes, ...next.existingNotes],
      (note) => note.path
    ),
    citations: uniqueCitations([...current.citations, ...next.citations]),
    collectedAt: next.collectedAt,
    source: current.source === next.source ? current.source : 'mixed',
  };
}

function inferWorkerWriteScope(worker: AgentWorkerSpec): AgentWorkerWriteScope {
  const text = [worker.role, worker.title, worker.objective, ...worker.deliverables].join(' ').toLowerCase();
  if (/\b(patch|diff|update existing|existing-note|existing note)\b/.test(text)) return 'proposed_patch';
  if (/\b(draft|synthesi[sz]e|synthesis|write brief|brief section)\b/.test(text)) return 'staged_draft';
  return 'read_only';
}

function defaultWorkerTargets(
  worker: AgentWorkerSpec,
  writeScope: AgentWorkerWriteScope,
  folder: string
): AgentWorkerTargetResource[] {
  if (writeScope === 'read_only') return [];
  if (writeScope === 'staged_draft') {
    return [{
      id: `note:create:${folder}/_worker-drafts/${worker.id}/`,
      accessMode: 'create',
    }];
  }
  if (writeScope === 'proposed_patch') {
    const targets = extractLikelyNoteTargets([worker.input, worker.objective, ...worker.deliverables].join('\n'));
    return targets.map((id) => ({ id, accessMode: 'write' as const }));
  }
  return [];
}

function allowedToolsForWorkerScope(allowedTools: string[], writeScope: AgentWorkerWriteScope): string[] {
  const extras = writeScope === 'staged_draft'
    ? ['note:create']
    : writeScope === 'proposed_patch'
      ? ['editor:apply-note-patch', 'editor:insert-blocks', 'editor:insert-code-block', 'editor:replace-block', 'editor:update-code-block', 'note:update']
      : writeScope === 'direct_scoped'
        ? ['note:create', 'note:update', 'editor:apply-note-patch', 'editor:insert-code-block', 'editor:update-code-block', 'todo:create', 'todo:update', 'todo:toggle']
        : [];
  return unique([...allowedTools, ...extras]);
}

function appendWorkerScopeContext(
  input: string,
  workerId: string,
  runId: string,
  writeScope: AgentWorkerWriteScope,
  targetResources: AgentWorkerTargetResource[]
): string {
  if (writeScope === 'read_only') return input;
  const lines = [
    input,
    '',
    'Worker write lane:',
    `- Run: ${runId}`,
    `- Worker: ${workerId}`,
    `- Write scope: ${writeScope}`,
    ...targetResources.map((resource) => `- Target: ${resource.id}${resource.accessMode ? ` (${resource.accessMode})` : ''}`),
  ];
  if (writeScope === 'staged_draft') {
    lines.push(
      '- If you use note:create, set the folder to the target _worker-drafts folder and autoFocus false.',
      '- Treat staged notes as worker-owned draft artifacts for the orchestrator to review and merge.'
    );
  }
  if (writeScope === 'proposed_patch') {
    lines.push(
      '- Only patch explicitly listed target notes.',
      '- Prefer append-style patches that preserve existing user content.'
    );
  }
  return lines.join('\n').slice(0, 6000);
}

function defaultWorkerCapabilities(worker: AgentWorkerSpec, writeScope: AgentWorkerWriteScope): NonNullable<AgentWorkerSpec['capabilities']> {
  const capabilities: NonNullable<AgentWorkerSpec['capabilities']> = ['read_context'];
  if (/research|analyst/i.test(worker.role)) capabilities.push('research');
  if (writeScope === 'staged_draft') capabilities.push('draft_artifact', 'stage_note');
  if (writeScope === 'proposed_patch') capabilities.push('draft_artifact', 'propose_patch');
  if (writeScope === 'direct_scoped') capabilities.push('direct_write');
  return unique(capabilities);
}

function extractLikelyNoteTargets(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9 _./-]+\.md\b/g) ?? [];
  return unique(matches.map((item) => item.trim().replace(/^\/+/, ''))).slice(0, 4);
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collectWorkerCitations(run: AgentRun, workerResults: AgentWorkerResult[]): ResearchCitation[] {
  const citations = [
    ...(run.plan?.researchEvidence?.citations ?? []),
    ...(run.plan?.citations ?? []),
    ...workerResults.flatMap((result) => result.citations),
    ...(run.merge?.artifactDrafts ?? [])
      .map((draft) => draft.citation)
      .filter((citation): citation is ResearchCitation => !!citation),
    ...(run.merge?.artifactDrafts ?? []).flatMap(draftMetadataCitations),
  ];
  const seen = new Set<string>();
  const result: ResearchCitation[] = [];
  for (const citation of citations) {
    const key = citation.url || citation.title;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function citationBackedFindings(citations: ResearchCitation[]): string[] {
  return citations
    .map((citation) => {
      const title = citation.title.trim();
      const excerpt = citation.excerpt?.trim();
      if (excerpt) return `${title}: ${excerpt}`;
      return title ? `Source identified for review: ${title}` : '';
    })
    .filter(hasText)
    .filter((finding) => !looksLikeGenericWorkerCompletion(finding));
}

function researchFindingPreview(run: AgentRun): string[] {
  const workerFindings = run.workers
    .flatMap((worker) => worker.result?.findings ?? [])
    .filter(hasText)
    .filter((finding) => !looksLikeGenericWorkerCompletion(finding));
  const citationFindings = citationBackedFindings(collectWorkerCitations(
    run,
    run.workers.map((worker) => worker.result).filter((result): result is AgentWorkerResult => !!result)
  ));
  return unique([...workerFindings, ...citationFindings])
    .filter((finding) => !isProcessResearchDiagnostic(finding))
    .slice(0, 8);
}

function collectMediaDrafts(run: AgentRun): AgentArtifactDraft[] {
  const drafts = [
    ...(run.merge?.artifactDrafts ?? []),
    ...run.workers.flatMap((worker) => worker.result?.artifactDrafts ?? []),
  ];
  const seen = new Set<string>();
  const result: AgentArtifactDraft[] = [];
  for (const draft of drafts) {
    if (draft.type !== 'media' || !hasText(draft.url) || !isSubstantiveDraft(draft)) continue;
    const key = draft.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(draft);
  }
  return result;
}

function mediaDraftLine(draft: AgentArtifactDraft): string {
  return [
    `- ${draft.title}`,
    draft.mediaKind ? `Kind: ${draft.mediaKind}` : '',
    draft.url ? `URL: ${draft.url}` : '',
    draft.summary ? `Note: ${draft.summary}` : '',
  ].filter(Boolean).join(' | ');
}

function sourceReferenceLine(citation: ResearchCitation): string {
  return [
    `- [${citation.title}](${citation.url})`,
    citation.fetchedAt ? `Fetched: ${citation.fetchedAt}` : '',
    citation.excerpt ? `Note: ${citation.excerpt}` : '',
  ].filter(Boolean).join(' | ');
}

function draftMetadataCitations(draft: { metadata?: Record<string, unknown> }): ResearchCitation[] {
  const citations = draft.metadata?.citations;
  if (!Array.isArray(citations)) return [];
  return citations.filter((citation): citation is ResearchCitation =>
    citation &&
    typeof citation === 'object' &&
    typeof (citation as ResearchCitation).title === 'string' &&
    typeof (citation as ResearchCitation).url === 'string' &&
    typeof (citation as ResearchCitation).fetchedAt === 'string'
  );
}

function researchEvidenceLevel(run: AgentRun, workerResults: AgentWorkerResult[]): AgentResearchEvidenceLevel {
  const citations = collectWorkerCitations(run, workerResults);
  if (citations.some(isVerifiedCitation)) return 'verified_sources';
  if (citations.length > 0) return 'unverified_leads';
  if ((run.plan?.existingNotes.length ?? 0) > 0) return 'vault_context';
  if (hasAnyResearchFindings(workerResults)) return 'model_prior';
  return 'scaffold_only';
}

function evidenceStatusText(
  level: AgentResearchEvidenceLevel,
  verifiedCount: number,
  leadCount: number
): string {
  switch (level) {
    case 'verified_sources':
      return `Source-backed: ${verifiedCount} verified source${verifiedCount === 1 ? '' : 's'} captured for review.`;
    case 'unverified_leads':
      return `Needs verification: ${leadCount} source lead${leadCount === 1 ? '' : 's'} captured, but no source was verified.`;
    case 'vault_context':
      return 'Vault-context only: related local notes were available, but no verified external citations were captured.';
    case 'model_prior':
      return 'Model-prior synthesis: no verified external citations were captured, so findings must be verified before use.';
    case 'scaffold_only':
      return 'Scaffold only: no verified sources, source leads, vault matches, or substantive worker findings were captured.';
  }
}

function uniqueCitations(citations: ResearchCitation[]): ResearchCitation[] {
  const seen = new Set<string>();
  const result: ResearchCitation[] = [];
  for (const citation of citations) {
    const key = citation.url || citation.title;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function looksLikeUnbackedCreationClaim(response: string): boolean {
  return /\b(created|updated|wrote|gemaakt|bijgewerkt|aangemaakt)\b/i.test(response);
}

function looksLikeGenericWorkerCompletion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^completed\s+[\w\s-]+\.?$/i.test(normalized)) return true;
  const lines = normalized.split(/(?:\n|;|\.)/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^-?\s*completed\s+/i.test(line));
}

function isResearchRunPrompt(prompt: string): boolean {
  return classifyDurableAgentPrompt(prompt)?.mode === 'research';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatRunStatus(status: AgentRun['status']): string {
  return status.replace(/_/g, ' ');
}

function compactDetail(detail: string | undefined): string | undefined {
  const compact = detail?.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length > 140 ? `${compact.slice(0, 137).trim()}...` : compact;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isTerminalStatus(status: AgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isUsefulCompletionResponse(response: string): boolean {
  if (response.length < 20) return false;
  const lower = response.toLowerCase();
  const vagueClosers = [
    'tell me what you want',
    'zeg maar',
    'current note',
    'huidige note',
    'what would you like',
    'wat je ermee wilt',
  ];
  if (vagueClosers.some((phrase) => lower.includes(phrase))) return false;
  return /\b(created|updated|wrote|linked|sources?|citations?|notes?|folder|completed|gemaakt|bijgewerkt)\b/i.test(response);
}
