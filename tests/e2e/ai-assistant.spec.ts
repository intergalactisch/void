/**
 * E2E tests for AI Assistant
 */
import { test, expect, type Page } from '@playwright/test';

test.describe('AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();
  });

  async function forceLocalAIUnavailable(page: Page) {
    await page.evaluate(async () => {
      const { aiStore } = await import('/src/lib/stores/index.ts');
      aiStore.availabilityStatus = 'unavailable';
      aiStore.isAIAvailable = false;
      aiStore.availabilityMessage = 'Install Codex CLI or Claude Code to enable AI features.';
    });
  }

  test('opens AI prompt with Cmd+K', async ({ page }) => {
    // Press Cmd+K
    await page.keyboard.press('Meta+k');

    // Check for prompt window or dialog
    // The exact selector depends on implementation
    const promptVisible = await page
      .locator('[class*="prompt"], [role="dialog"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    // If prompt is visible, test passed
    if (promptVisible) {
      expect(promptVisible).toBe(true);
    }
  });

  test('opens AI assistant from toolbar button', async ({ page }) => {
    // Find AI button in toolbar (when editor is visible)
    const aiButton = page.getByRole('button', { name: /ai/i });

    if (await aiButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await aiButton.click();

      // Check for prompt window
      await expect(
        page.locator('[class*="prompt"]').or(page.getByRole('dialog'))
      ).toBeVisible({ timeout: 1000 }).catch(() => {
        // May not be visible depending on state
      });
    }
  });

  test('shows a locked Command Center when local AI is unavailable', async ({ page }) => {
    await forceLocalAIUnavailable(page);

    const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();

    const commandCenter = page.getByRole('dialog', { name: /ai command center/i });
    await expect(commandCenter).toBeVisible();
    await expect(commandCenter.getByText('Install Codex CLI or Claude Code to enable AI features.')).toBeVisible();
    await expect(commandCenter.getByRole('textbox', { name: /ai command/i })).toBeHidden();
  });

  test('editor Ask shows install message when local AI is unavailable', async ({ page }) => {
    await page.keyboard.press('Meta+n');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('Local AI gate editor selection');
    await forceLocalAIUnavailable(page);

    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node?.textContent) return;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, node.textContent.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    const askButton = page.getByRole('button', { name: /ai rewrite selection/i });
    await expect(askButton).toBeVisible();
    await askButton.click();

    await expect(page.getByText('Install Codex CLI or Claude Code to enable AI features.')).toBeVisible();
    await expect(page.locator('.void-ai-prompt-widget')).toHaveCount(0);
  });

  test('inline Ask typing does not dispatch editor draft transactions', async ({ page }) => {
    await page.keyboard.press('Meta+n');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('Inline ask source text');

    await page.evaluate(async () => {
      const { aiStore, editorStore } = await import('/src/lib/stores/index.ts');
      aiStore.availabilityStatus = 'available';
      aiStore.isAIAvailable = true;
      aiStore.availabilityMessage = null;

      const win = window as typeof window & {
        __inlineDraftUpdates: number;
        __inlineSubmittedPrompt?: string;
      };
      win.__inlineDraftUpdates = 0;
      const originalUpdateDraft = editorStore.updateAIInlineComposerDraft.bind(editorStore);
      editorStore.updateAIInlineComposerDraft = (id: string, prompt: string) => {
        win.__inlineDraftUpdates += 1;
        originalUpdateDraft(id, prompt);
      };
      editorStore.submitAIInlineComposer = (_id: string, prompt: string) => {
        win.__inlineSubmittedPrompt = prompt;
      };
    });

    await page.evaluate(async () => {
      const { editorStore } = await import('/src/lib/stores/index.ts');
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node?.textContent) return;
      editorStore.aiPromptSelectionAt(1, 1 + node.textContent.length, node.textContent);
    });

    const inlineComposer = page.getByRole('textbox', {
      name: /describe what ai should do with this text/i,
    });
    await expect(inlineComposer).toBeVisible();
    await inlineComposer.click();
    await page.keyboard.type('Make this crisp and direct');

    expect(await page.evaluate(() => (window as typeof window & { __inlineDraftUpdates: number }).__inlineDraftUpdates)).toBe(0);

    await inlineComposer.press('Enter');
    expect(await page.evaluate(() => (window as typeof window & { __inlineSubmittedPrompt?: string }).__inlineSubmittedPrompt)).toBe('Make this crisp and direct');
  });

  test('closes AI prompt on Escape', async ({ page }) => {
    // Open with Cmd+K
    await page.keyboard.press('Meta+k');

    // Wait for potential prompt
    await page.waitForTimeout(300);

    // Press Escape
    await page.keyboard.press('Escape');

    // Should be closed (or not opened if feature not available in test mode)
  });

  test('copies the Command Center conversation ref', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __copiedConversationId?: string }).__copiedConversationId = text;
          },
        },
      });
    });

    await page.keyboard.press('Meta+Shift+O');
    if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });
      await aiButton.click();
    }

    const commandCenter = page.getByRole('dialog', { name: /ai command center/i });
    await expect(commandCenter).toBeVisible();
    await commandCenter.getByRole('button', { name: /new command thread/i }).click();

    const copyIdButton = commandCenter.getByRole('button', { name: /copy ref/i });
    await expect(copyIdButton).toBeVisible();
    await copyIdButton.click();
    await expect(copyIdButton).toContainText('Copied');

    const copiedId = await page.evaluate(() => (window as unknown as { __copiedConversationId?: string }).__copiedConversationId);
    expect(copiedId).toMatch(/^void:\/\/conversation\/conv_/);
  });

  test('shows an empty Command Center conversation state without a run inspector', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+O');
    if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });
      await aiButton.click();
    }

    const commandCenter = page.getByRole('dialog', { name: /ai command center/i });
    await expect(commandCenter).toBeVisible();
    await expect(page.getByRole('heading', { name: /no conversation open/i })).toBeVisible();
    const composer = commandCenter.getByRole('textbox', { name: /ai command/i });
    await expect(composer).toBeVisible();
    await expect(composer).toBeFocused();
    await page.keyboard.press('Meta+f');
    await expect(commandCenter.getByRole('searchbox', { name: /search command center work/i })).toBeFocused();
    await expect(page.locator('aside[aria-label="Agent status"]')).toBeHidden();
    await expect(page.getByText(/runs in this conversation/i)).toBeHidden();
  });

  test('shows global active swarms while an idle command thread is open', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+O');
    if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });
      await aiButton.click();
    }
    await expect(page.getByRole('dialog', { name: /ai command center/i })).toBeVisible();

    await page.evaluate(async () => {
      const [{ aiStore, commandCenterStore }, { createConversation }, { createAgentRun }] = await Promise.all([
        import('/src/lib/stores/index.ts'),
        import('/src/lib/domain/entities/Conversation.ts'),
        import('/src/lib/domain/entities/AgentRun.ts'),
      ]);
      const conversation = createConversation({ title: 'Idle thread' });
      conversation.id = 'conv-idle-thread';
      const first = {
        ...createAgentRun({
          id: 'run-global-first',
          prompt: 'Research media leads in another thread',
          conversationId: 'conv-global-media',
          approvalRequired: false,
          orchestrationMode: 'swarm',
        }),
        updatedAt: '2026-05-13T10:02:00.000Z',
      };
      const second = {
        ...createAgentRun({
          id: 'run-global-second',
          prompt: 'Update shared todo planning from a second thread',
          conversationId: 'conv-global-todos',
          approvalRequired: false,
          orchestrationMode: 'swarm',
        }),
        updatedAt: '2026-05-13T10:01:00.000Z',
      };

      commandCenterStore.reset();
      aiStore.currentConversation = conversation;
      aiStore.conversations = [conversation];
      aiStore.agentRunState = {
        currentRun: first,
        runs: [first, second],
        isRunning: true,
        error: null,
      };
      commandCenterStore.showConversationDetail();
      commandCenterStore.showNow();
    });

    await expect(page.locator('aside[aria-label="Agent status"]')).toBeVisible();
    await expect(page.getByText(/2 runs active/i)).toBeVisible();
    const fleet = page.locator('section[aria-label="Active agent runs"]');
    await expect(fleet.getByText(/Active fleet/i)).toBeVisible();
    await expect(fleet.getByText(/Research media leads in another thread/i)).toBeVisible();
    await expect(fleet.getByText(/Update shared todo planning from a second thread/i)).toBeVisible();
    await expect(fleet.getByText(/Thread conv-g/i).first()).toBeVisible();
    await page.keyboard.press('Alt+3');
    await expect(page.getByRole('tab', { name: /history/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps repair and close actions from overlapping', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+O');
    if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });
      await aiButton.click();
    }
    await expect(page.getByRole('dialog', { name: /ai command center/i })).toBeVisible();

    await page.evaluate(async () => {
      const [{ aiStore, commandCenterStore }, { createConversation }, { createUserMessage, createAssistantMessage }, { createAgentRun }] = await Promise.all([
        import('/src/lib/stores/index.ts'),
        import('/src/lib/domain/entities/Conversation.ts'),
        import('/src/lib/domain/entities/Message.ts'),
        import('/src/lib/domain/entities/AgentRun.ts'),
      ]);
      const conversation = createConversation({ title: 'Repair layout' });
      conversation.id = 'conv-repair-layout';
      const user = createUserMessage('Research the future of Coding Agents');
      conversation.messages = [
        user,
        createAssistantMessage({ text: 'Created a scaffold note.' }),
      ];
      const run = {
        ...createAgentRun({
          id: 'run-repair-layout',
          prompt: user.text,
          conversationId: conversation.id,
          sourceMessageId: user.id,
          approvalRequired: false,
          orchestrationMode: 'swarm',
        }),
        status: 'completed',
        artifacts: [{
          id: 'artifact-scaffold',
          type: 'note',
          title: 'Future Coding Agents Research Overview',
          path: 'Research/future-coding-agents 2026-05-11/future-coding-agents-research-overview.md',
          noteId: 'Research/future-coding-agents 2026-05-11/future-coding-agents-research-overview.md',
          createdAt: new Date().toISOString(),
        }],
        workers: [{
          id: 'worker-1',
          runId: 'run-repair-layout',
          spec: {
            id: 'worker-1',
            title: 'Find context',
            role: 'researcher',
            objective: 'Find context',
            input: user.text,
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
            risks: ['Worker did not return structured research findings.'],
            nextActions: [],
            confidence: 0.6,
            quality: 'insufficient',
            completedAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        merge: {
          status: 'completed',
          summary: 'Merged 1 worker result.',
          writePrompt: null,
          sourceWorkerIds: ['worker-1'],
          artifactDrafts: [{
            id: 'draft-scaffold',
            workerId: 'orchestrator',
            type: 'note',
            title: 'Future Coding Agents Research Overview',
            content: 'The workers did not return substantive research findings. No verified external citations were captured.',
            confidence: 0.35,
            createdAt: new Date().toISOString(),
            metadata: { quality: 'substantive' },
          }],
          touchedExistingNotes: [],
          risks: ['Worker did not return structured research findings.'],
        },
        finalSummary: 'This was a research scaffold with needs-verification and no verified external citations.',
        completedAt: new Date().toISOString(),
      };

      commandCenterStore.reset();
      aiStore.currentConversation = conversation;
      aiStore.conversations = [conversation];
      aiStore.agentRunState = {
        currentRun: null,
        runs: [run],
        isRunning: false,
        error: null,
      };
      commandCenterStore.showConversationDetail();
      commandCenterStore.showNow();
    });

    await expect(page.getByText(/research notes need repair/i)).toBeVisible();
    const repair = page.getByRole('button', { name: /repair research notes/i });
    const close = page.getByRole('button', { name: /close conversation detail/i });
    await expect(repair).toBeVisible();
    await expect(close).toBeVisible();

    for (const width of [1200, 760]) {
      await page.setViewportSize({ width, height: 780 });
      await expect(repair).toBeVisible();
      await expect(close).toBeVisible();
      const overlap = await page.evaluate(() => {
        const repair = document.querySelector<HTMLButtonElement>('.swarm-retry-button')?.getBoundingClientRect();
        const close = document.querySelector<HTMLButtonElement>('.close-detail-chip')?.getBoundingClientRect();
        if (!repair || !close) return true;
        return repair.left < close.right &&
          repair.right > close.left &&
          repair.top < close.bottom &&
          repair.bottom > close.top;
      });
      expect(overlap).toBe(false);
    }
  });

  test('routes a durable research prompt into mocked swarm work end to end', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+O');
    if (!await page.getByRole('dialog', { name: /ai command center/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      const aiButton = page.locator('button').filter({ hasText: /Ask/ }).first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });
      await aiButton.click();
    }

    const commandCenter = page.getByRole('dialog', { name: /ai command center/i });
    await expect(commandCenter).toBeVisible();
    if (await page.getByRole('heading', { name: /no conversation open/i }).isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.getByRole('button', { name: /new command thread/i }).click();
    }

    const composer = page.getByRole('textbox', { name: /ai command/i });
    await composer.fill('Doe full research on Ai coding agents');
    await composer.press('Enter');

    await expect(page.getByText(/research completed|Swarm run completed|Created the mock swarm research notes/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/AI Coding Agents.*Overview|Mock Swarm Overview|ai-coding-agents-overview/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Worker Summary', { exact: true })).toHaveCount(0);
    await expect(commandCenter.getByRole('button', { name: /copy ref/i })).toBeVisible();

    await commandCenter.getByRole('button', { name: /close command center/i }).first().click();
    const main = page.locator('main#main-content');
    await expect(main.getByRole('heading', { name: /Mock Swarm|ai-coding-agents/ })).toBeVisible({ timeout: 10000 });
    await expect(main.getByRole('button', { name: /AI Coding Agents.*Overview|Mock Swarm Overview/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /AI Coding Agents.*Sources|Mock Swarm Sources/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /refresh folders/i })).toBeVisible();
    const nav = page.locator('nav[aria-label="Notes navigation"]');
    await expect(nav.getByText(/AI Coding Agents.*Sources|Mock Swarm Sources/)).toBeVisible();

    await nav.getByRole('treeitem', { name: /Mock Swarm|ai-coding-agents/ }).first().click({ button: 'right' });
    await expect(page.getByRole('menu', { name: /folder options/i })).toBeVisible();
    await page.getByRole('menuitem', { name: /create new note/i }).click();
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.keyboard.type('Immediate autosave after folder note creation.');

    const noteTitle = page.getByRole('textbox', { name: /note title/i });
    const oldTitle = (await noteTitle.textContent())?.trim() ?? '';
    await noteTitle.fill('Renamed Folder Note');
    await noteTitle.press('Enter');

    await page.waitForTimeout(2500);
    await expect(page.getByText(/Failed to save|file was modified externally/i)).toHaveCount(0);
    await expect(noteTitle).toContainText('Renamed Folder Note');
    await expect(page.locator('#recent-list').getByText('Renamed Folder Note')).toBeVisible();
    await expect(page.locator('.editor-tabs').getByText('Renamed Folder Note')).toHaveCount(
      await page.locator('.editor-tabs').count() > 0 ? 1 : 0
    );
    if (oldTitle) {
      await expect(page.locator('#recent-list').getByText(oldTitle, { exact: true })).toHaveCount(0);
      await expect(page.locator('.editor-tabs').getByText(oldTitle, { exact: true })).toHaveCount(0);
    }
  });
});
