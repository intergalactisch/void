<script lang="ts">
  import type { AgentRun, AgentWorker } from '$lib/domain/entities/AgentRun';
  import { aiStore } from '$lib/stores';
  import WorkerComposer from './WorkerComposer.svelte';
  import WorkerInfoRail from './WorkerInfoRail.svelte';
  import WorkerSubheader from './WorkerSubheader.svelte';
  import WorkerTimeline from './WorkerTimeline.svelte';

  interface Props {
    run: AgentRun;
    worker: AgentWorker;
    onBack: () => void;
  }

  let { run, worker, onBack }: Props = $props();

  let railOpen = $state(true);
  let showPromptTraces = $state(false);

  async function handleSend(text: string, target: 'worker' | 'orchestrator') {
    const result = await aiStore.continueWorker({
      runId: run.id,
      workerId: worker.id,
      message: text,
      target,
    });
    if (!result) {
      throw aiStore.error ?? new Error('Failed to send message');
    }
  }
</script>

<div class="worker-view" data-rail={railOpen ? 'open' : 'closed'}>
  <WorkerSubheader
    {run}
    {worker}
    {railOpen}
    {onBack}
    onToggleRail={() => (railOpen = !railOpen)}
  />

  <div class="worker-view-body">
    <div class="worker-view-main">
      {#if worker.status === 'failed' && worker.error}
        <div class="worker-failed-banner" role="alert">
          <strong>Worker failed:</strong>
          <span>{worker.error}</span>
          <em>Sending a message will resume the worker with the new context.</em>
        </div>
      {/if}

      <WorkerTimeline {run} {worker} {showPromptTraces} />

      <WorkerComposer {worker} onSend={handleSend} />
    </div>

    {#if railOpen}
      <WorkerInfoRail
        {run}
        {worker}
        {showPromptTraces}
        onTogglePromptTraces={(value) => (showPromptTraces = value)}
      />
    {/if}
  </div>
</div>

<style>
  .worker-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    background: var(--bg-editor);
  }

  .worker-view-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  .worker-view[data-rail='open'] .worker-view-body {
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  .worker-view-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
  }

  .worker-failed-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-error) 32%, var(--border-light));
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 12px;
    line-height: 1.45;
  }

  .worker-failed-banner strong {
    font-weight: 700;
  }

  .worker-failed-banner em {
    flex-basis: 100%;
    color: color-mix(in srgb, var(--color-error) 80%, var(--text-primary));
    font-style: normal;
    font-size: 11.5px;
  }

  @media (max-width: 1100px) {
    .worker-view[data-rail='open'] .worker-view-body {
      grid-template-columns: minmax(0, 1fr) 260px;
    }
  }
</style>
