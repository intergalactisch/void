import { afterEach, describe, expect, it } from 'vitest';
import { createAgentRun, createAgentWorker } from '$lib/domain/entities/AgentRun';
import { createConversation } from '$lib/domain/entities/Conversation';
import { completeOperation, createOperation } from '$lib/domain/entities/Operation';
import { aiStore } from '$lib/stores/ai.svelte';
import { commandCenterStore } from '$lib/stores/commandCenter.svelte';
import { operationsStore } from '$lib/stores/operations.svelte';
import { createAssistantMessage, createUserMessage } from '$lib/domain/entities/Message';
import { resourceLock } from '$lib/events';

describe('commandCenterStore pending user turns', () => {
  afterEach(() => {
    commandCenterStore.reset();
    aiStore.currentConversation = null;
    aiStore.conversations = [];
    aiStore.isProcessing = false;
    aiStore.isRouting = false;
    aiStore.isStreaming = false;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [],
      isRunning: false,
      error: null,
    };
    operationsStore.operations = [];
    operationsStore.selectedOperation = null;
    resourceLock.clear();
  });

  it('adds an optimistic turn synchronously', () => {
    const turn = commandCenterStore.createPendingUserTurn('Create a note', 'conv-1');

    expect(turn.text).toBe('Create a note');
    expect(turn.conversationId).toBe('conv-1');
    expect(turn.status).toBe('routing');
    expect(commandCenterStore.pendingUserTurns).toHaveLength(1);
    expect(commandCenterStore.hasRoutingPendingTurn).toBe(true);
  });

  it('reconciles by clientTurnId', () => {
    const turn = commandCenterStore.createPendingUserTurn('Create a note', 'conv-1');
    const persisted = createUserMessage('Create a note', { clientTurnId: turn.id });

    commandCenterStore.reconcilePendingUserTurns([persisted], 'conv-1');

    expect(commandCenterStore.isPendingUserTurnMatched(turn.id)).toBe(true);
    expect(commandCenterStore.getVisiblePendingUserTurns([persisted], 'conv-1')).toHaveLength(0);
  });

  it('falls back to close text and timestamp matching', () => {
    const turn = commandCenterStore.createPendingUserTurn('Do research on OpenAI', 'conv-1');
    const persisted = createUserMessage('Do research on OpenAI');

    commandCenterStore.reconcilePendingUserTurns([persisted], 'conv-1');

    expect(commandCenterStore.isPendingUserTurnMatched(turn.id)).toBe(true);
    expect(commandCenterStore.getVisiblePendingUserTurns([persisted], 'conv-1')).toHaveLength(0);
  });

  it('marks a pending turn failed without removing the text', () => {
    const turn = commandCenterStore.createPendingUserTurn('Create a note', 'conv-1');

    commandCenterStore.failPendingUserTurn(turn.id, 'intake failed');

    const visible = commandCenterStore.getVisiblePendingUserTurns([], 'conv-1');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.status).toBe('failed');
    expect(visible[0]?.text).toBe('Create a note');
    expect(visible[0]?.error).toBe('intake failed');
  });

  it('does not show a stale completed run as current work', () => {
    aiStore.currentConversation = openConversation('conv-1');
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-old',
            prompt: 'Do research on Anthropic',
            conversationId: 'conv-1',
            approvalRequired: false,
          }),
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    expect(commandCenterStore.latestRun?.prompt).toBe('Do research on Anthropic');
    expect(commandCenterStore.selectedRun).toBeNull();
  });

  it('does not treat historical runs as current conversation content when no conversation is open', () => {
    aiStore.currentConversation = null;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-old',
            prompt: 'Research old topic',
            conversationId: 'conv-old',
            approvalRequired: false,
          }),
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    expect(commandCenterStore.runs).toEqual([]);
    expect(commandCenterStore.latestRun).toBeNull();
    expect(commandCenterStore.hasInspectorContent).toBe(false);
  });

  it('keeps live work visible when no conversation is open', () => {
    const run = createAgentRun({
      id: 'run-live',
      prompt: 'Research a live topic',
      conversationId: 'conv-live',
      approvalRequired: false,
    });
    aiStore.currentConversation = null;
    aiStore.agentRunState = {
      currentRun: run,
      runs: [run],
      isRunning: true,
      error: null,
    };

    expect(commandCenterStore.runs).toEqual([]);
    expect(commandCenterStore.activeRun?.id).toBe('run-live');
    expect(commandCenterStore.activeWorkCount).toBe(1);
    expect(commandCenterStore.hasInspectorContent).toBe(true);
  });

  it('keeps loaded active runs visible when no conversation is open', () => {
    const run = createAgentRun({
      id: 'run-loaded-live',
      prompt: 'Loaded live work',
      conversationId: 'conv-live',
      approvalRequired: false,
    });
    aiStore.currentConversation = null;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [run],
      isRunning: true,
      error: null,
    };

    expect(commandCenterStore.runs).toEqual([]);
    expect(commandCenterStore.activeRun?.id).toBe('run-loaded-live');
    expect(commandCenterStore.activeWorkCount).toBe(1);
    expect(commandCenterStore.hasInspectorContent).toBe(true);
  });

  it('returns global active runs even when a command conversation is open', () => {
    aiStore.currentConversation = openConversation('conv-1');
    const first = {
      ...createAgentRun({
        id: 'run-first',
        prompt: 'Research first topic',
        conversationId: 'conv-1',
        approvalRequired: false,
      }),
      updatedAt: '2026-05-13T10:00:00.000Z',
    };
    const second = {
      ...createAgentRun({
        id: 'run-second',
        prompt: 'Research second topic',
        conversationId: 'conv-1',
        approvalRequired: false,
      }),
      updatedAt: '2026-05-13T10:02:00.000Z',
    };
    const other = {
      ...createAgentRun({
        id: 'run-other',
        prompt: 'Research other conversation',
        conversationId: 'conv-2',
        approvalRequired: false,
      }),
      updatedAt: '2026-05-13T10:01:00.000Z',
    };
    aiStore.agentRunState = {
      currentRun: second,
      runs: [first, second, other],
      isRunning: true,
      error: null,
    };

    expect(commandCenterStore.runs.map((run) => run.id)).toEqual(['run-first', 'run-second']);
    expect(commandCenterStore.activeRuns.map((run) => run.id)).toEqual(['run-second', 'run-other', 'run-first']);
    expect(commandCenterStore.globalActiveRuns.map((run) => run.id)).toEqual(['run-second', 'run-other', 'run-first']);
    expect(commandCenterStore.activeWorkCount).toBe(3);
  });

  it('keeps unrelated live swarms visible from an open idle conversation', () => {
    aiStore.currentConversation = openConversation('conv-idle');
    const other = {
      ...createAgentRun({
        id: 'run-other-live',
        prompt: 'Research another thread',
        conversationId: 'conv-other',
        approvalRequired: false,
        orchestrationMode: 'swarm',
      }),
      updatedAt: '2026-05-13T10:01:00.000Z',
    };
    aiStore.agentRunState = {
      currentRun: null,
      runs: [other],
      isRunning: true,
      error: null,
    };

    expect(commandCenterStore.runs).toEqual([]);
    expect(commandCenterStore.activeRun?.id).toBe('run-other-live');
    expect(commandCenterStore.activeRuns.map((run) => run.id)).toEqual(['run-other-live']);
    expect(commandCenterStore.activeWorkCount).toBe(1);
    expect(commandCenterStore.hasInspectorContent).toBe(true);
  });

  it('tracks resource lock write lanes for live contention visibility', async () => {
    const release = await resourceLock.acquire('note:shared.md');
    const queued = resourceLock.acquire('note:shared.md');

    expect(commandCenterStore.writeLanes).toEqual([
      { resourceId: 'note:shared.md', held: true, queued: 1 },
    ]);

    release();
    const releaseQueued = await queued;
    releaseQueued();

    expect(commandCenterStore.writeLanes).toEqual([]);
  });

  it('aggregates resource locks into collaboration surfaces', async () => {
    const releaseNote = await resourceLock.acquire('note:shared.md', {
      id: 'inv-note-1',
      kind: 'tool',
      label: 'note:update',
      toolId: 'note:update',
    });
    const queuedNote = resourceLock.acquire('note:shared.md', {
      id: 'inv-note-2',
      kind: 'tool',
      label: 'note:create',
      toolId: 'note:create',
    });
    const releaseBlock = await resourceLock.acquire('block:shared.md:block-1');
    const releaseTodo = await resourceLock.acquire('todo:item:Tasks/today.md:12');

    expect(commandCenterStore.collaborationSurfaces).toEqual([
      expect.objectContaining({
        id: 'note:shared.md',
        kind: 'note',
        title: 'shared.md',
        activeLanes: 2,
        queuedWrites: 1,
        laneCount: 2,
        laneKinds: ['note', 'block'],
        holders: ['note:update'],
        waiters: ['note:create'],
        pressure: 'contended',
      }),
      expect.objectContaining({
        id: 'todo:Tasks/today.md',
        kind: 'todo',
        title: 'Tasks/today.md',
        activeLanes: 1,
        queuedWrites: 0,
        laneCount: 1,
        laneKinds: ['item'],
        pressure: 'active',
      }),
    ]);

    releaseNote();
    const releaseQueuedNote = await queuedNote;
    releaseQueuedNote();
    releaseBlock();
    releaseTodo();

    expect(commandCenterStore.collaborationSurfaces).toEqual([]);
  });

  it('keeps collaboration hotspot telemetry after contention clears', async () => {
    const releaseNote = await resourceLock.acquire('note:shared.md', {
      id: 'writer-a',
      kind: 'agent',
      label: 'Writer A',
      runId: 'run-a',
    });
    const queuedB = resourceLock.acquire('note:shared.md', {
      id: 'writer-b',
      kind: 'agent',
      label: 'Writer B',
      runId: 'run-b',
    });
    const queuedC = resourceLock.acquire('note:shared.md', {
      id: 'writer-c',
      kind: 'agent',
      label: 'Writer C',
      runId: 'run-c',
    });

    expect(commandCenterStore.collaborationHotspots).toEqual([
      expect.objectContaining({
        id: 'note:shared.md',
        kind: 'note',
        title: 'shared.md',
        incidentCount: 1,
        maxQueuedWrites: 2,
        maxActiveLanes: 1,
        laneKinds: ['note'],
        runIds: ['run-a', 'run-b', 'run-c'],
        lastOwners: ['Writer A', 'Writer B', 'Writer C'],
        lastPressure: 'contended',
        currentlyActive: true,
      }),
    ]);

    releaseNote();
    const releaseB = await queuedB;
    releaseB();
    const releaseC = await queuedC;
    releaseC();

    expect(commandCenterStore.collaborationSurfaces).toEqual([]);
    expect(commandCenterStore.collaborationHotspots).toEqual([
      expect.objectContaining({
        id: 'note:shared.md',
        incidentCount: 1,
        maxQueuedWrites: 2,
        currentlyActive: false,
      }),
    ]);
  });

  it('keeps the current command run visible even after fast completion', () => {
    aiStore.currentConversation = openConversation('conv-1');
    commandCenterStore.createPendingUserTurn('Do research on OpenAI', 'conv-1');
    const run = createAgentRun({
      id: 'run-openai',
      prompt: 'Do research on OpenAI',
      conversationId: 'conv-1',
      approvalRequired: false,
    });
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...run,
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    expect(commandCenterStore.selectedRun?.id).toBe('run-openai');
  });

  it('keeps a run conversation ID visible when the conversation object is not open', () => {
    const run = {
      ...createAgentRun({
        id: 'run-selected',
        prompt: 'Research the future of Coding Agents',
        conversationId: 'conv_1778509816198_1guanc',
        approvalRequired: false,
        orchestrationMode: 'swarm',
      }),
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
    };
    aiStore.currentConversation = null;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [run],
      isRunning: false,
      error: null,
    };

    commandCenterStore.selectRun('run-selected');

    expect(commandCenterStore.visibleConversationId).toEqual({
      id: 'conv_1778509816198_1guanc',
      source: 'run',
    });
  });

  it('offers retry-as-swarm for durable research conversations that only received chat', () => {
    const conversation = openConversation('conv_1778500574705_goiies');
    const userMessage = createUserMessage('Doe full research on Ai coding agents');
    const assistantMessage = createAssistantMessage({ text: 'Here is a direct answer.' });
    conversation.messages = [userMessage, assistantMessage];
    aiStore.currentConversation = conversation;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [],
      isRunning: false,
      error: null,
    };

    const retry = commandCenterStore.retryableSwarmRun;

    expect(retry).not.toBeNull();
    expect(retry?.kind).toBe('chat_retry');
    expect(retry?.conversationId).toBe('conv_1778500574705_goiies');
    expect(retry?.sourceMessageId).toBe(userMessage.id);
    expect(retry?.prompt).toBe('Doe full research on Ai coding agents');
    expect(retry?.suggestedMode).toBe('research');
  });

  it('offers repair when a completed research swarm only produced Worker Summary', () => {
    const conversation = openConversation('conv_1778506989280_jq1ip2');
    const userMessage = createUserMessage('Do research on Bonsai trees');
    conversation.messages = [
      userMessage,
      createAssistantMessage({ text: 'Created or updated 1 note: Worker Summary' }),
    ];
    aiStore.currentConversation = conversation;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-placeholder',
            prompt: userMessage.text,
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            approvalRequired: false,
            orchestrationMode: 'swarm',
          }),
          status: 'completed',
          artifacts: [
            {
              id: 'artifact-worker-summary',
              type: 'note',
              title: 'Worker Summary',
              path: 'Research/bonsai-trees 2026-05-11/worker-summary.md',
              noteId: 'Research/bonsai-trees 2026-05-11/worker-summary.md',
              createdAt: new Date().toISOString(),
            },
          ],
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    const retry = commandCenterStore.retryableSwarmRun;

    expect(retry).not.toBeNull();
    expect(retry?.kind).toBe('placeholder_repair');
    expect(retry?.runId).toBe('run-placeholder');
    expect(retry?.prompt).toBe('Do research on Bonsai trees');
  });

  it('offers repair when a completed research swarm only produced a scaffold note', () => {
    const conversation = openConversation('conv_1778509816198_1guanc');
    const userMessage = createUserMessage('Research the future of Coding Agents');
    conversation.messages = [
      userMessage,
      createAssistantMessage({ text: 'Created or updated 1 note: Future Coding Agents Research Overview' }),
    ];
    aiStore.currentConversation = conversation;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-scaffold',
            prompt: userMessage.text,
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            approvalRequired: false,
            orchestrationMode: 'swarm',
          }),
          status: 'completed',
          artifacts: [
            {
              id: 'artifact-scaffold',
              type: 'note',
              title: 'Future Coding Agents Research Overview',
              path: 'Research/future-coding-agents 2026-05-11/future-coding-agents-research-overview.md',
              noteId: 'Research/future-coding-agents 2026-05-11/future-coding-agents-research-overview.md',
              createdAt: new Date().toISOString(),
            },
          ],
          workers: [
            {
              id: 'worker-1',
              runId: 'run-scaffold',
              spec: {
                id: 'worker-1',
                title: 'Find context',
                role: 'researcher',
                objective: 'Find context',
                input: userMessage.text,
                deliverables: ['Findings'],
                dependencies: [],
                allowedTools: [],
              },
              status: 'completed',
              progress: 100,
              result: {
                workerId: 'worker-1',
                title: 'Find context',
                summary: 'Completed Find context.',
                findings: [],
                artifactDrafts: [],
                citations: [],
                risks: ['Worker did not return structured research findings; no draft artifact was accepted from this worker.'],
                nextActions: [],
                confidence: 0.6,
                quality: 'insufficient',
                completedAt: new Date().toISOString(),
              },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          merge: {
            status: 'completed',
            summary: 'Merged 1 worker result.',
            writePrompt: null,
            sourceWorkerIds: ['worker-1'],
            artifactDrafts: [
              {
                id: 'draft-scaffold',
                workerId: 'orchestrator',
                type: 'note',
                title: 'Future Coding Agents Research Overview',
                content: 'The workers did not return substantive research findings. No verified external citations were captured.',
                confidence: 0.35,
                createdAt: new Date().toISOString(),
                metadata: { quality: 'substantive' },
              },
            ],
            touchedExistingNotes: [],
            risks: ['Worker did not return structured research findings; no draft artifact was accepted from this worker.'],
          },
          finalSummary: 'This was a research scaffold with needs-verification and no verified external citations.',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    const retry = commandCenterStore.retryableSwarmRun;

    expect(retry).not.toBeNull();
    expect(retry?.kind).toBe('placeholder_repair');
    expect(retry?.runId).toBe('run-scaffold');
  });

  it('does not repair best-effort research notes with explicit model-prior evidence', () => {
    const conversation = openConversation('conv-best-effort');
    const userMessage = createUserMessage('Research the future of Coding Agents');
    conversation.messages = [
      userMessage,
      createAssistantMessage({ text: 'Created Future of Coding Agents Research Overview' }),
    ];
    aiStore.currentConversation = conversation;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-best-effort',
            prompt: userMessage.text,
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            approvalRequired: false,
            orchestrationMode: 'swarm',
          }),
          status: 'completed',
          artifacts: [
            {
              id: 'artifact-best-effort',
              type: 'note',
              title: 'Future of Coding Agents Research Overview',
              path: 'Research/future-of-coding-agents 2026-05-11/future-of-coding-agents-research-overview.md',
              noteId: 'Research/future-of-coding-agents 2026-05-11/future-of-coding-agents-research-overview.md',
              createdAt: new Date().toISOString(),
            },
          ],
          merge: {
            status: 'completed',
            summary: 'Merged best-available research output.',
            writePrompt: null,
            sourceWorkerIds: ['orchestrator-model-prior'],
            artifactDrafts: [],
            touchedExistingNotes: [],
            risks: ['Research output includes model-prior synthesis without verified external citations.'],
            evidenceLevel: 'model_prior',
          },
          finalSummary: 'Evidence level: model_prior. No verified external citations were captured.',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    expect(commandCenterStore.retryableSwarmRun).toBeNull();
  });

  it('does not offer retry-as-swarm once a durable prompt has a linked run', () => {
    const conversation = openConversation('conv-recovered');
    const userMessage = createUserMessage('Doe full research on Ai coding agents');
    conversation.messages = [
      userMessage,
      createAssistantMessage({ text: 'Here is a direct answer.' }),
    ];
    aiStore.currentConversation = conversation;
    aiStore.agentRunState = {
      currentRun: null,
      runs: [
        {
          ...createAgentRun({
            id: 'run-recovered',
            prompt: userMessage.text,
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            approvalRequired: false,
          }),
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      ],
      isRunning: false,
      error: null,
    };

    expect(commandCenterStore.retryableSwarmRun).toBeNull();
  });

  it('tracks minimized run cards separately from selected work', () => {
    commandCenterStore.toggleRunCollapsed('run-1');

    expect(commandCenterStore.isRunCollapsed('run-1')).toBe(true);
    expect(commandCenterStore.isRunCollapsed('run-2')).toBe(false);

    commandCenterStore.selectRun('run-1');
    expect(commandCenterStore.selectedRunId).toBe('run-1');
    expect(commandCenterStore.isRunCollapsed('run-1')).toBe(true);

    commandCenterStore.toggleRunCollapsed('run-1');
    expect(commandCenterStore.isRunCollapsed('run-1')).toBe(false);
  });

  it('selects a concrete worker as the command center detail target', () => {
    aiStore.currentConversation = openConversation('conv-workers');
    const run = createAgentRun({
      id: 'run-workers',
      prompt: 'Research worker transparency',
      conversationId: 'conv-workers',
      approvalRequired: false,
      orchestrationMode: 'swarm',
    });
    run.workers = [
      createAgentWorker({
        runId: run.id,
        spec: {
          id: 'worker-source',
          title: 'Source scout',
          role: 'researcher',
          objective: 'Find source context',
          input: 'Worker transparency',
          deliverables: ['Findings'],
          dependencies: [],
          allowedTools: ['search:content'],
        },
      }),
    ];
    aiStore.agentRunState = {
      currentRun: run,
      runs: [run],
      isRunning: true,
      error: null,
    };

    commandCenterStore.selectWorker('run-workers', 'worker-source');

    expect(commandCenterStore.inspectorMode).toBe('now');
    expect(commandCenterStore.selectedRunId).toBe('run-workers');
    expect(commandCenterStore.selectedAgentTarget).toEqual({
      kind: 'worker',
      runId: 'run-workers',
      workerId: 'worker-source',
    });
    expect(commandCenterStore.selectedWorker?.worker.spec.title).toBe('Source scout');
    expect(commandCenterStore.isWorkerSelected('run-workers', 'worker-source')).toBe(true);

    commandCenterStore.selectRun('run-workers');

    expect(commandCenterStore.selectedAgentTarget).toBeNull();
    expect(commandCenterStore.selectedWorker).toBeNull();
  });

  it('clears minimized run cards when the command session resets', () => {
    commandCenterStore.toggleRunCollapsed('run-1');
    commandCenterStore.reset();

    expect(commandCenterStore.isRunCollapsed('run-1')).toBe(false);
  });

  it('opens workspace results without making them part of the conversation reset', () => {
    const operation = createCompletedOperation('Draft summary');
    operationsStore.operations = [operation];

    commandCenterStore.showResults();

    expect(commandCenterStore.inspectorMode).toBe('inbox');
    expect(commandCenterStore.selectedResultOperation?.id).toBe(operation.id);
    expect(operationsStore.unappliedResultOperations).toHaveLength(1);

    commandCenterStore.reset();

    expect(commandCenterStore.inspectorMode).toBe('now');
    expect(commandCenterStore.selectedResultOperationId).toBeNull();
    expect(operationsStore.unappliedResultOperations).toHaveLength(1);
  });

  it('tracks selected unapplied result in command center state', () => {
    const first = createCompletedOperation('First draft');
    const second = createCompletedOperation('Second draft');
    operationsStore.operations = [first, second];

    commandCenterStore.selectResultOperation(first.id);

    expect(commandCenterStore.inspectorMode).toBe('inbox');
    expect(commandCenterStore.selectedRunId).toBeNull();
    expect(commandCenterStore.selectedResultOperation?.id).toBe(first.id);
  });

  it('clears selected detail state for a deleted conversation', () => {
    aiStore.currentConversation = openConversation('conv-other');
    const deletedRun = {
      ...createAgentRun({
        id: 'run-deleted',
        prompt: 'Create a deleted conversation note',
        conversationId: 'conv-deleted',
        approvalRequired: false,
      }),
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
    };
    const otherRun = {
      ...createAgentRun({
        id: 'run-other',
        prompt: 'Keep this conversation',
        conversationId: 'conv-other',
        approvalRequired: false,
      }),
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
    };
    aiStore.agentRunState = {
      currentRun: null,
      runs: [deletedRun, otherRun],
      isRunning: false,
      error: null,
    };

    commandCenterStore.selectRun('run-deleted');
    commandCenterStore.toggleRunCollapsed('run-deleted');
    commandCenterStore.createPendingUserTurn('Create a deleted conversation note', 'conv-deleted');

    commandCenterStore.handleConversationDeleted('conv-deleted');

    expect(commandCenterStore.selectedRunId).toBeNull();
    expect(commandCenterStore.selectedRun).toBeNull();
    expect(commandCenterStore.isRunCollapsed('run-deleted')).toBe(false);
    expect(commandCenterStore.pendingUserTurns).toHaveLength(0);
    expect(commandCenterStore.runs).toHaveLength(1);
    expect(commandCenterStore.runs[0]?.id).toBe('run-other');
  });

  it('does not auto-select an active run from a deleted conversation', () => {
    const deletedRun = createAgentRun({
      id: 'run-active-deleted',
      prompt: 'Keep working after delete',
      conversationId: 'conv-deleted',
      approvalRequired: false,
    });
    aiStore.agentRunState = {
      currentRun: deletedRun,
      runs: [deletedRun],
      isRunning: true,
      error: null,
    };

    expect(commandCenterStore.activeRun?.id).toBe('run-active-deleted');

    commandCenterStore.handleConversationDeleted('conv-deleted');

    expect(commandCenterStore.activeRun).toBeNull();
    expect(commandCenterStore.selectedRun).toBeNull();
  });
});

function createCompletedOperation(label: string) {
  return completeOperation(
    createOperation({
      type: 'single',
      label,
      prompt: label,
    }),
    {
      status: 'completed',
      outputs: [{ type: 'content', content: `${label} content` }],
      rawResponse: `${label} content`,
      durationMs: 25,
      metadata: {},
    }
  );
}

function openConversation(id: string) {
  const conversation = createConversation({ title: id });
  return { ...conversation, id };
}
