<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { AlertCircle, Bot, Check, Copy, MessageSquare, PanelRightClose, Plus, RefreshCw, Settings, Sparkles, X } from '@lucide/svelte';
  import { aiStore, commandCenterStore, lineageStore, operationsStore, uiStore } from '$lib/stores';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { buildRefId } from '$lib/domain/values';
  import { AI_UNAVAILABLE_MESSAGE } from '$lib/domain/values/AIAvailability';
  import CommandComposer from './CommandComposer.svelte';
  import CommandHistoryPanel from './CommandHistoryPanel.svelte';
  import CommandInspector from './CommandInspector.svelte';
  import CommandTranscript from './CommandTranscript.svelte';
  import WorkerConversationView from './WorkerConversationView.svelte';

  interface Props {
    visible?: boolean;
    onClose?: () => void;
  }

  let { visible = false, onClose }: Props = $props();

  let transcriptRef: HTMLDivElement | null = $state(null);
  let idCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let retryingAsSwarm = $state(false);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let previousConversationId: string | null = null;

  let visibleMessageCount = $derived(
    (aiStore.currentConversation?.messages ?? []).filter((message) => message.visibility !== 'internal').length
  );
  let runVersion = $derived(
    [
      aiStore.agentRunState.currentRun?.id ?? '',
      aiStore.agentRunState.currentRun?.updatedAt ?? '',
      ...aiStore.agentRunState.runs.map((run) => `${run.id}:${run.updatedAt}`),
    ].join('|')
  );
  let isActive = $derived(aiStore.isRouting || aiStore.isProcessing || aiStore.isStreaming || aiStore.agentRunState.isRunning);
  let hasOpenConversation = $derived(aiStore.currentConversation !== null);
  let conversationTitle = $derived(aiStore.currentConversation?.title ?? 'New Command');
  let aiUnavailable = $derived(!aiStore.canStartAIWork);
  let availabilityChecking = $derived(aiStore.availabilityStatus === 'checking');
  let availabilityMessage = $derived(aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE);
  let commandTitle = $derived(aiUnavailable ? 'AI Command Center' : conversationTitle);
  let visibleConversationId = $derived(commandCenterStore.visibleConversationId);
  let conversationId = $derived(visibleConversationId?.id ?? null);
  let conversationIdLabel = $derived(visibleConversationId?.source === 'run' ? 'Run Ref' : 'Ref');
  let displayedConversationId = $derived.by(() => {
    if (!conversationId) return null;
    return conversationId.length > 18 ? `${conversationId.slice(0, 8)}...${conversationId.slice(-6)}` : conversationId;
  });
  let activeTask = $derived(
    aiStore.agentRunState.currentRun?.tasks.find((t) => t.status === 'running') ?? null
  );
  let statusLabel = $derived.by(() => {
    const run = aiStore.agentRunState.currentRun;
    if (run?.status === 'waiting_approval') return 'Waiting for approval';
    if (activeTask) {
      return activeTask.detail ? `${activeTask.title} — ${activeTask.detail}` : activeTask.title;
    }
    if (aiStore.isRouting) return 'Understanding request';
    if (aiStore.agentRunState.isRunning) return 'Agent working';
    if (aiStore.isStreaming) return 'Writing response';
    if (aiStore.isProcessing) return 'Thinking';
    if (aiUnavailable) return 'Local AI unavailable';
    if (aiStore.lastIntakeDecision) return `Last routed as ${aiStore.lastIntakeDecision.kind.replace(/_/g, ' ')}`;
    return 'Ready';
  });
  let workBadge = $derived(commandCenterStore.activeWorkCount);
  let inspectorVisible = $derived(commandCenterStore.hasInspectorContent || lineageStore.visible);
  let workerView = $derived(commandCenterStore.workerConversationVisible);
  let selectedWorkerDetail = $derived(commandCenterStore.selectedWorker);
  let retryableSwarmRun = $derived(commandCenterStore.retryableSwarmRun);
  let swarmRecoveryTitle = $derived(
    retryableSwarmRun?.kind === 'placeholder_repair'
      ? 'Research notes need repair'
      : 'Research answered as chat'
  );
  let swarmRecoveryCopy = $derived(
    retryableSwarmRun?.kind === 'placeholder_repair'
      ? 'The prior swarm only wrote a worker placeholder. Repair it into real research notes.'
      : 'Run it through the swarm to create notes and receipts.'
  );
  let swarmRecoveryButton = $derived(
    retryableSwarmRun?.kind === 'placeholder_repair'
      ? 'Repair Research Notes'
      : 'Retry as Swarm'
  );

  function scrollTranscriptToBottom() {
    if (!transcriptRef) return;
    transcriptRef.scrollTop = transcriptRef.scrollHeight;
  }

  function handleClose() {
    onClose?.();
  }

  function handleCloseConversationDetail() {
    commandCenterStore.hideConversationDetail();
  }

  async function handleNewConversation() {
    if (!aiStore.ensureAIAvailable()) return;
    await aiStore.newConversation();
    commandCenterStore.reset();
    requestAnimationFrame(scrollTranscriptToBottom);
  }

  async function handleCopyConversationId() {
    if (!conversationId) return;

    const refId = visibleConversationId?.source === 'run'
      ? buildRefId({ kind: 'run', runId: conversationId })
      : buildRefId({ kind: 'conversation', conversationId });
    idCopyState = (await copyTextToClipboard(refId)) ? 'copied' : 'failed';

    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      idCopyState = 'idle';
      copyResetTimer = null;
    }, 1600);
  }

  async function handleRetryAsSwarm() {
    const recovery = retryableSwarmRun;
    if (!recovery || retryingAsSwarm) return;
    if (!aiStore.ensureAIAvailable()) return;

    retryingAsSwarm = true;
    try {
      await aiStore.startAgentRun(recovery.prompt, {
        conversationId: recovery.conversationId,
        sourceMessageId: recovery.sourceMessageId,
        appendUserMessage: false,
        requireApproval: false,
        orchestrationMode: 'swarm',
        maxWorkers: 4,
        webAccess: recovery.suggestedMode === 'research' ? 'native' : 'off',
      });
      commandCenterStore.showNow();
    } finally {
      retryingAsSwarm = false;
    }
  }

  function handleConfirmTool(invocationId: string) {
    void aiStore.confirmTool(invocationId);
  }

  function handleRejectTool(invocationId: string) {
    void aiStore.rejectTool(invocationId, 'Rejected from command center');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!visible || event.key !== 'Escape') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[role="dialog"]')) return;
    if (commandCenterStore.workerConversationVisible) {
      event.preventDefault();
      commandCenterStore.closeWorkerConversation();
      return;
    }
    event.preventDefault();
    handleClose();
  }

  function handleBackFromWorker() {
    commandCenterStore.closeWorkerConversation();
  }

  function handleOpenSettings() {
    uiStore.openSettings();
  }

  function handleCheckAgain() {
    void aiStore.refreshAvailability();
  }

  $effect(() => {
    if (!visible) return;

    if (aiStore.availabilityStatus === 'unknown') {
      void aiStore.refreshAvailability();
    }
    void aiStore.loadAgentRuns();
    void aiStore.loadConversationHistory();

    requestAnimationFrame(scrollTranscriptToBottom);
  });

  // Auto-route the inspector to the most relevant view as state changes.
  // Reading these reactives wires the effect; selectAutoMode itself decides
  // whether to override a manual selection.
  $effect(() => {
    if (!visible) return;
    aiStore.currentConversation?.id;
    commandCenterStore.activeRun?.id;
    operationsStore.unappliedResultOperations.length;
    aiStore.isProcessing;
    aiStore.isStreaming;
    aiStore.isRouting;
    commandCenterStore.selectAutoMode();
  });

  $effect(() => {
    visibleMessageCount;
    runVersion;
    aiStore.streamingText;
    if (visible) {
      requestAnimationFrame(scrollTranscriptToBottom);
    }
  });

  $effect(() => {
    if (conversationId !== previousConversationId) {
      previousConversationId = conversationId;
      idCopyState = 'idle';
      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
        copyResetTimer = null;
      }
    }
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });
</script>

{#if visible}
  <div class="command-backdrop" aria-hidden="true"></div>
  <section class="command-center" aria-label="AI Command Center">
    <header class="command-header">
      <div class="command-title">
        <span class="command-mark" aria-hidden="true">
          <Bot size={18} strokeWidth={1.8} />
        </span>
        <div class="command-heading">
          <h2>{commandTitle}</h2>
          <div class="command-meta">
            <span class:active={isActive}>{statusLabel}</span>
            {#if workBadge > 0}
              <span>{workBadge} active</span>
            {/if}
            {#if conversationId && displayedConversationId}
              <button
                type="button"
                class:copied={idCopyState === 'copied'}
                class:failed={idCopyState === 'failed'}
                class="conversation-id-copy"
                onclick={handleCopyConversationId}
                title="Copy Ref"
                aria-label={`Copy Ref ${conversationId}`}
                aria-live="polite"
              >
                <span class="conversation-id-label">{conversationIdLabel}</span>
                <span class="conversation-id-value">{idCopyState === 'copied' ? 'Copied' : displayedConversationId}</span>
                {#if idCopyState === 'copied'}
                  <Check size={13} strokeWidth={2} aria-hidden="true" />
                {:else}
                  <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
                {/if}
              </button>
            {/if}
          </div>
        </div>
      </div>

      <div class="command-header-actions" role="toolbar" aria-label="Command center actions">
        {#if aiUnavailable}
          <button type="button" class="header-icon" title="Check local AI again" aria-label="Check local AI again" onclick={handleCheckAgain} disabled={availabilityChecking}>
            <RefreshCw size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" class="header-icon" title="Open settings" aria-label="Open settings" onclick={handleOpenSettings}>
            <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        {:else}
          <button type="button" class="header-icon" title="Action templates" aria-label="Action templates" onclick={() => commandCenterStore.showTemplates()}>
            <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" class="header-icon" title="New command thread" aria-label="New command thread" onclick={handleNewConversation}>
            <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        {/if}
        <span class="header-divider" aria-hidden="true"></span>
        <button type="button" class="header-icon compact-toggle" title="Close command center" aria-label="Close command center" onclick={handleClose}>
          <PanelRightClose size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" class="header-icon close-button" title="Close" aria-label="Close command center" onclick={handleClose}>
          <X size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </header>

    <div
      class="command-body"
      data-inspector={!aiUnavailable && inspectorVisible ? 'visible' : 'hidden'}
      data-mode={aiUnavailable ? 'locked' : workerView ? 'worker' : 'normal'}
    >
      {#if aiUnavailable}
        <section class="ai-unavailable-panel" role="status" aria-live="polite">
          <span class="ai-unavailable-icon" aria-hidden="true">
            <AlertCircle size={24} strokeWidth={1.7} />
          </span>
          <div class="ai-unavailable-copy">
            <h3>Local AI is not installed</h3>
            <p>{availabilityMessage}</p>
          </div>
          <div class="ai-unavailable-actions">
            <button type="button" class="ai-unavailable-primary" onclick={handleOpenSettings}>
              <Settings size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>Open Settings</span>
            </button>
            <button type="button" class="ai-unavailable-secondary" onclick={handleCheckAgain} disabled={availabilityChecking}>
              <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{availabilityChecking ? 'Checking...' : 'Check again'}</span>
            </button>
          </div>
        </section>
      {:else if workerView && selectedWorkerDetail}
        <WorkerConversationView
          run={selectedWorkerDetail.run}
          worker={selectedWorkerDetail.worker}
          onBack={handleBackFromWorker}
        />
      {:else}
      <aside class="history-pane" aria-label="Conversation history">
        <CommandHistoryPanel />
      </aside>

      <section class="conversation-pane" aria-label="Command transcript">
        {#if hasOpenConversation && commandCenterStore.conversationDetailVisible}
          <div class="conversation-pane-chrome">
            <div class="conversation-detail-controls">
              <button
                type="button"
                class="close-detail-chip"
                onclick={handleCloseConversationDetail}
                title="Close conversation"
                aria-label="Close conversation detail"
              >
                <X size={13} strokeWidth={2} aria-hidden="true" />
                <span>Close</span>
              </button>
            </div>

            {#if retryableSwarmRun}
              <div class="swarm-retry-banner">
                <div class="swarm-retry-copy">
                  <strong>{swarmRecoveryTitle}</strong>
                  <span>{swarmRecoveryCopy}</span>
                </div>
                <button
                  type="button"
                  class="swarm-retry-button"
                  onclick={handleRetryAsSwarm}
                  disabled={retryingAsSwarm || isActive || aiUnavailable}
                >
                  <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />
                  <span>{retryingAsSwarm ? 'Starting' : swarmRecoveryButton}</span>
                </button>
              </div>
            {/if}
          </div>

          <div bind:this={transcriptRef} class="transcript-scroll scrollbar-thin">
            <CommandTranscript onConfirmTool={handleConfirmTool} onRejectTool={handleRejectTool} />
          </div>

          <footer class="command-footer">
            {#if aiStore.error}
              <div class="command-error" role="alert">{aiStore.error.message}</div>
            {/if}
            <CommandComposer {visible} />
          </footer>
        {:else}
          <div class="conversation-empty" role="status">
            <span class="conversation-empty-icon" aria-hidden="true">
              <MessageSquare size={22} strokeWidth={1.5} />
            </span>
            <h3>No conversation open</h3>
            <p>Pick a thread from history, or start a fresh command.</p>
            <div class="conversation-empty-actions">
              <button type="button" class="empty-action-primary" onclick={handleNewConversation}>
                <Plus size={13} strokeWidth={2} aria-hidden="true" />
                <span>New command</span>
              </button>
            </div>
          </div>
        {/if}
      </section>

      {#if inspectorVisible}
        <CommandInspector />
      {/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .command-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal) - 2);
    background: color-mix(in srgb, var(--bg-overlay) 30%, transparent);
    pointer-events: none;
  }

  .command-center {
    position: fixed;
    top: 12px;
    right: 12px;
    bottom: 34px;
    z-index: calc(var(--z-modal) - 1);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(1320px, calc(100vw - 24px));
    min-width: 940px;
    overflow: hidden;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-editor);
    box-shadow: var(--shadow-lg);
    -webkit-user-select: text;
    user-select: text;
  }

  .command-center button {
    -webkit-user-select: none;
    user-select: none;
  }

  .command-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 54px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .command-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .command-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 1px solid var(--ai-border);
    border-radius: var(--radius-md);
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .command-heading {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .command-heading h2 {
    overflow: hidden;
    margin: 0;
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.2;
    text-transform: capitalize;
  }

  .command-meta > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-meta > span.active {
    color: var(--ai-accent);
    font-weight: 650;
  }

  .conversation-id-copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 190px;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-tertiary);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
    font: inherit;
    text-transform: none;
  }

  .conversation-id-copy:hover {
    border-color: var(--border-medium);
    color: var(--text-secondary);
  }

  .conversation-id-copy:focus-visible {
    outline: 2px solid var(--ai-accent);
    outline-offset: 1px;
  }

  .conversation-id-copy.copied {
    border-color: color-mix(in srgb, var(--color-success) 42%, var(--border-light));
    color: var(--color-success);
  }

  .conversation-id-copy.failed {
    border-color: color-mix(in srgb, var(--color-error) 42%, var(--border-light));
    color: var(--color-error);
  }

  .conversation-id-label {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .conversation-id-value {
    min-width: 0;
    overflow: hidden;
    color: currentColor;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .header-icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .header-icon:hover {
    border-color: var(--border-light);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .header-icon:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .header-divider {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--border-light);
  }

  .close-button {
    display: none;
  }

  .command-body {
    display: grid;
    grid-template-columns: minmax(230px, 270px) minmax(360px, 1fr) minmax(318px, 372px);
    min-width: 0;
    min-height: 0;
  }

  .command-body[data-inspector='hidden'] {
    grid-template-columns: minmax(230px, 270px) minmax(0, 1fr);
  }

  .command-body[data-mode='worker'] {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }

  .command-body[data-mode='locked'] {
    grid-template-columns: 1fr;
  }

  .ai-unavailable-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-width: 0;
    min-height: 0;
    padding: 32px;
    text-align: center;
    background: var(--bg-editor);
  }

  .ai-unavailable-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    box-shadow: var(--shadow-xs);
  }

  .ai-unavailable-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 420px;
  }

  .ai-unavailable-copy h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
    line-height: 1.25;
  }

  .ai-unavailable-copy p {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .ai-unavailable-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .ai-unavailable-primary,
  .ai-unavailable-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 11px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }

  .ai-unavailable-primary {
    border: 0;
    background: var(--ai-accent);
    color: var(--text-inverse);
  }

  .ai-unavailable-secondary {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
  }

  .ai-unavailable-secondary:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  .history-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .conversation-pane {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    background: var(--bg-editor);
  }

  .conversation-pane-chrome {
    min-width: 0;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-editor);
  }

  .conversation-detail-controls {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
    padding: 8px 12px 6px;
  }

  /* ── Close-detail chip ─────────────────────────────────────────────── */
  .close-detail-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    padding: 4px 10px 4px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(10px) saturate(140%);
    -webkit-backdrop-filter: blur(10px) saturate(140%);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      transform var(--transition-fast);
  }

  .close-detail-chip:hover {
    background: var(--bg-card);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .close-detail-chip:active {
    transform: translateY(1px);
  }

  .close-detail-chip:focus-visible {
    outline: 2px solid var(--ai-accent);
    outline-offset: 1px;
  }

  /* ── Empty conversation state (after "Close detail") ───────────────── */
  .conversation-empty {
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 32px;
    text-align: center;
    color: var(--text-secondary);
  }

  .conversation-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--ai-tint);
    color: var(--ai-accent);
    margin-bottom: 4px;
  }

  .conversation-empty h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.005em;
  }

  .conversation-empty p {
    margin: 0;
    max-width: 280px;
    color: var(--text-tertiary);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .conversation-empty-actions {
    margin-top: 10px;
  }

  .empty-action-primary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 12px 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--ai-accent);
    color: var(--text-inverse);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(99, 102, 241, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition: background var(--transition-fast), transform var(--transition-fast);
  }

  .empty-action-primary:hover {
    background: var(--ai-accent-strong);
  }

  .empty-action-primary:active {
    transform: translateY(1px);
  }

  .empty-action-primary:focus-visible {
    outline: 2px solid var(--ai-accent);
    outline-offset: 2px;
  }

  .swarm-retry-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    padding: 10px 14px;
    border-top: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--ai-tint) 58%, var(--bg-editor));
  }

  .swarm-retry-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .swarm-retry-copy strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.25;
  }

  .swarm-retry-copy span {
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 11.5px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swarm-retry-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    flex: 0 0 auto;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--ai-border);
    border-radius: var(--radius-sm);
    background: var(--ai-accent);
    color: var(--text-inverse);
    font: inherit;
    font-size: 11.5px;
    font-weight: 650;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
  }

  .swarm-retry-button:hover:not(:disabled) {
    background: var(--ai-accent-strong);
  }

  .swarm-retry-button:disabled {
    cursor: default;
    opacity: 0.62;
  }

  @media (max-width: 700px) {
    .swarm-retry-banner {
      align-items: flex-start;
      flex-direction: column;
    }

    .swarm-retry-copy span {
      white-space: normal;
    }
  }

  .transcript-scroll {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 18px;
    -webkit-user-select: text;
    user-select: text;
  }

  .transcript-scroll :global(.message-text),
  .transcript-scroll :global(.pending-text),
  .transcript-scroll :global(.run-title),
  .transcript-scroll :global(.run-compact-outcome),
  .transcript-scroll :global(.run-plan-summary),
  .transcript-scroll :global(.run-summary),
  .transcript-scroll :global(.worker-summary) {
    -webkit-user-select: text;
    user-select: text;
  }

  .command-footer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .command-error {
    padding: 7px 9px;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 12px;
    line-height: 1.4;
  }

  @media (max-width: 1080px) {
    .command-center {
      left: 12px;
      min-width: 0;
      width: auto;
    }
  }

  @media (max-width: 1180px) {
    .command-body {
      grid-template-columns: minmax(210px, 238px) minmax(340px, 1fr) minmax(292px, 330px);
    }

    .command-body[data-inspector='hidden'] {
      grid-template-columns: minmax(210px, 238px) minmax(0, 1fr);
    }
  }

  @media (max-width: 900px) {
    .command-center {
      top: 8px;
      right: 8px;
      bottom: 30px;
      left: 8px;
    }

    .command-body {
      grid-template-columns: 1fr;
      grid-template-rows: 132px minmax(0, 1fr) minmax(220px, 38vh);
    }

    .command-body[data-inspector='hidden'] {
      grid-template-columns: 1fr;
      grid-template-rows: 132px minmax(0, 1fr);
    }

    .history-pane {
      border-right: 0;
      border-bottom: 1px solid var(--border-light);
    }

    .transcript-scroll {
      padding: 14px;
    }
  }

  @media (max-width: 560px) {
    .command-center {
      inset: 0;
      border-radius: 0;
    }

    .command-header {
      min-height: 50px;
      padding: 8px;
    }

    .command-mark,
    .command-meta {
      display: none;
    }

    .command-heading h2 {
      font-size: 13px;
    }

    .compact-toggle {
      display: none;
    }

    .close-button {
      display: inline-flex;
    }

    .command-body {
      grid-template-rows: 118px minmax(0, 1fr) minmax(210px, 40vh);
    }

    .command-body[data-inspector='hidden'] {
      grid-template-rows: 118px minmax(0, 1fr);
    }
  }
</style>
