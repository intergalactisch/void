import { test, expect } from '@playwright/test';

test('opens worker detail with prompt traces and interaction targets', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();

  await page.keyboard.press('Meta+Shift+O');
  if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
    const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();
  }

  await page.evaluate(async () => {
    const [
      { aiStore, commandCenterStore },
      { createConversation },
      { createAgentRun, createAgentWorker, createAgentWorkerMessage, setAgentWorkerStatus },
    ] = await Promise.all([
      import('/src/lib/stores/index.ts'),
      import('/src/lib/domain/entities/Conversation.ts'),
      import('/src/lib/domain/entities/AgentRun.ts'),
    ]);

    const conversation = createConversation({ title: 'Worker inspection' });
    conversation.id = 'conv-worker-detail-smoke';
    aiStore.currentConversation = conversation;
    aiStore.conversations = [conversation];

    const run = createAgentRun({
      id: 'run-worker-detail-smoke',
      prompt: 'Research transparent workers',
      conversationId: conversation.id,
      approvalRequired: false,
      orchestrationMode: 'swarm',
    });
    const worker = setAgentWorkerStatus(
      createAgentWorker({
        runId: run.id,
        spec: {
          id: 'worker-source',
          title: 'Source scout',
          role: 'researcher',
          objective: 'Find source context',
          input: 'transparent workers',
          deliverables: ['Findings'],
          dependencies: [],
          allowedTools: ['note:read'],
        },
      }),
      'completed',
      {
        result: {
          workerId: 'worker-source',
          title: 'Source scout',
          summary: 'Worker found source context.',
          findings: ['Workers now expose prompt and response traces.'],
          artifactDrafts: [],
          citations: [],
          risks: [],
          nextActions: [],
          confidence: 0.8,
          completedAt: new Date().toISOString(),
        },
      }
    );

    run.workers = [worker];
    run.workerMessages = [
      createAgentWorkerMessage({
        runId: run.id,
        workerId: 'worker-source',
        type: 'orchestrator.instruction',
        message: 'Find source context',
      }),
      createAgentWorkerMessage({
        runId: run.id,
        workerId: 'worker-source',
        type: 'worker.prompt',
        message: 'Initial worker prompt',
        data: {
          phase: 'worker.initial',
          request: {
            message: 'Parent user request: Research transparent workers',
            systemPrompt: 'You are a bounded Void worker agent.',
            tools: [{ id: 'note:read', name: 'Read note' }],
            conversationHistoryCount: 0,
          },
        },
      }),
      createAgentWorkerMessage({
        runId: run.id,
        workerId: 'worker-source',
        type: 'worker.response',
        message: 'Initial worker prompt response from test/test-model',
        data: {
          phase: 'worker.initial',
          response: {
            chat: '{"summary":"Worker found the source context"}',
            toolCalls: [],
            meta: { provider: 'test', model: 'test-model', latencyMs: 1 },
            stopReason: 'end_turn',
            truncated: false,
          },
        },
      }),
    ];
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    aiStore.agentRunState = {
      currentRun: null,
      runs: [run],
      isRunning: false,
      error: null,
    };
    (window as unknown as { __workerFollowup?: unknown }).__workerFollowup = null;
    aiStore.continueWorker = async (options: Record<string, unknown>) => {
      (window as unknown as { __workerFollowup?: unknown }).__workerFollowup = { options };
      return run;
    };
    commandCenterStore.selectRun(run.id);
  });

  await page.getByRole('tab', { name: /now/i }).click();
  await expect(page.getByRole('button', { name: /source scout/i })).toBeVisible();
  await page.getByRole('button', { name: /source scout/i }).click();
  await expect(page.getByText(/Worker found the source context/)).toBeVisible();
  await page.getByLabel('Show prompt traces').check();
  await page.getByText('Prompt trace', { exact: true }).click();
  await expect(page.getByText('Parent user request: Research transparent workers')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /message worker/i })).toBeVisible();
  await page.getByRole('button', { name: /@orchestrator/i }).click();
  await expect(page.getByRole('textbox', { name: /message orchestrator/i })).toBeVisible();
  await page.getByRole('button', { name: /@worker/i }).click();
  await page.getByRole('textbox', { name: /message worker/i }).fill('What evidence did you use?');
  await page.getByRole('button', { name: /send message/i }).click();
  const followup = await page.evaluate(() => (window as unknown as {
    __workerFollowup?: { options: Record<string, unknown> };
  }).__workerFollowup);
  expect(followup?.options).toMatchObject({
    runId: 'run-worker-detail-smoke',
    workerId: 'worker-source',
    message: 'What evidence did you use?',
    target: 'worker',
  });
});
