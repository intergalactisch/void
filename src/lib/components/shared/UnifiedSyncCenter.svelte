<script lang="ts">
  import { Bot, CheckCircle2, GitBranch, Laptop, Radio, ShieldCheck } from '@lucide/svelte';
  import {
    aiJobQueueStore,
    deviceTrustStore,
    platformStore,
    syncStore,
    workspaceV2Store,
  } from '$lib/stores';

  const workspaceReady = $derived(!!workspaceV2Store.manifest);
  const trustedCount = $derived(deviceTrustStore.devices.filter((device) => device.status === 'trusted').length);
  const queuedJobs = $derived(aiJobQueueStore.jobs.filter((job) => job.status === 'queued').length);
  const syncLabel = $derived(syncStore.status.kind === 'disabled' ? 'Local' : syncStore.status.kind);
  const shellLabel = $derived(platformStore.capabilities.preferredShell);
</script>

<section class="sync-center" aria-label="Unified Sync Center">
  <div class="sync-center-head">
    <div>
      <p class="eyebrow">Sync Center</p>
      <h2>Workspace, peers, GitHub, and AI relay</h2>
    </div>
    <span class="shell-pill">{shellLabel}</span>
  </div>

  <div class="sync-grid">
    <div class="sync-tile">
      <ShieldCheck size={18} strokeWidth={1.8} />
      <div>
        <strong>{workspaceReady ? 'Workspace V2 ready' : 'Migration ready'}</strong>
        <span>{workspaceV2Store.migration.message ?? (workspaceReady ? 'Hidden internal Git enabled' : 'Upgrade this workspace when ready')}</span>
      </div>
    </div>

    <div class="sync-tile">
      <Radio size={18} strokeWidth={1.8} />
      <div>
        <strong>{syncLabel}</strong>
        <span>{syncStore.status.message ?? `${syncStore.status.ahead} ahead, ${syncStore.status.behind} behind`}</span>
      </div>
    </div>

    <div class="sync-tile">
      <Laptop size={18} strokeWidth={1.8} />
      <div>
        <strong>{trustedCount} trusted device{trustedCount === 1 ? '' : 's'}</strong>
        <span>LAN-first peer mesh foundation</span>
      </div>
    </div>

    <div class="sync-tile">
      <Bot size={18} strokeWidth={1.8} />
      <div>
        <strong>{queuedJobs} queued AI job{queuedJobs === 1 ? '' : 's'}</strong>
        <span>Desktop relay only, encrypted envelopes</span>
      </div>
    </div>
  </div>

  <div class="sync-foot">
    <span><CheckCircle2 size={14} strokeWidth={1.8} /> Selective encryption</span>
    <span><GitBranch size={14} strokeWidth={1.8} /> Embedded sync core</span>
  </div>
</section>

<style>
  .sync-center {
    display: grid;
    gap: 16px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    padding: 18px;
    box-shadow: var(--shadow-sm);
  }

  .sync-center-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .eyebrow {
    margin: 0 0 4px;
    color: var(--text-tertiary);
    font: 600 var(--text-label)/1 var(--font-sans);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    color: var(--text-primary);
    font: 650 18px/1.25 var(--font-sans);
  }

  .shell-pill {
    flex: 0 0 auto;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    padding: 5px 9px;
    color: var(--text-secondary);
    background: var(--bg-subtle);
    font: 600 12px/1 var(--font-sans);
    text-transform: capitalize;
  }

  .sync-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .sync-tile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 12px;
    color: var(--text-secondary);
    background: var(--bg-subtle);
  }

  .sync-tile strong,
  .sync-tile span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-tile strong {
    color: var(--text-primary);
    font: 650 13px/1.25 var(--font-sans);
  }

  .sync-tile span {
    margin-top: 3px;
    color: var(--text-tertiary);
    font: 13px/1.35 var(--font-sans);
  }

  .sync-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    color: var(--text-tertiary);
    font: 13px/1.4 var(--font-sans);
  }

  .sync-foot span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  @media (max-width: 879px) {
    .sync-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 639px) {
    .sync-center {
      padding: 14px;
    }

    .sync-center-head {
      align-items: stretch;
      flex-direction: column;
      gap: 10px;
    }

    h2 {
      font-size: 17px;
    }

    .sync-grid {
      grid-template-columns: 1fr;
    }

    .sync-tile {
      min-height: 56px;
    }

    .sync-tile strong,
    .sync-tile span,
    .sync-foot {
      font-size: 14px;
    }
  }
</style>
