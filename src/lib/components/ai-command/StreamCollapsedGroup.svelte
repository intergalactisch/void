<script lang="ts">
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { StreamEntry } from '$lib/domain/values/StreamEntry';
  import StreamEntryRow from './StreamEntryRow.svelte';

  interface Props {
    entries: StreamEntry[];
    onConfirmTool?: ((invocationId: string) => void) | undefined;
    onRejectTool?: ((invocationId: string) => void) | undefined;
    onRetryTurn?: ((turnId: string) => void) | undefined;
  }

  let { entries, onConfirmTool, onRejectTool, onRetryTurn }: Props = $props();

  let expanded = $state(false);
</script>

<div class="collapsed-group" class:expanded>
  <button
    type="button"
    class="collapsed-toggle"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    {#if expanded}
      <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      <span>Hide {entries.length} step{entries.length === 1 ? '' : 's'}</span>
    {:else}
      <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
      <span>{entries.length} step{entries.length === 1 ? '' : 's'}</span>
    {/if}
  </button>

  {#if expanded}
    <div class="collapsed-body">
      {#each entries as entry (entry.id)}
        <StreamEntryRow {entry} {onConfirmTool} {onRejectTool} {onRetryTurn} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .collapsed-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-self: stretch;
  }

  .collapsed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 3px 10px 3px 7px;
    border: 1px dashed var(--border-medium);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .collapsed-toggle:hover {
    border-color: var(--ai-accent);
    color: var(--text-secondary);
  }

  .collapsed-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-left: 10px;
    border-left: 2px solid var(--border-light);
  }
</style>
