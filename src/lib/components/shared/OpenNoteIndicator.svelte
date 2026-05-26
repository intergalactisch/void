<script lang="ts">
  import { PanelsTopLeft } from '@lucide/svelte';
  import type { OpenNoteDisplayState } from '$lib/stores/noteWorkspace.svelte';

  interface Props {
    state: OpenNoteDisplayState | null;
    showLabel?: boolean;
  }

  let { state, showLabel = false }: Props = $props();
</script>

{#if state?.isOpen}
  <span
    class="open-note-indicator"
    class:focused={state.isFocused}
    title={state.tooltip}
    aria-label={state.tooltip}
    data-open-note-state={state.isFocused ? 'focused' : 'open'}
  >
    <PanelsTopLeft size={13} strokeWidth={1.8} aria-hidden="true" />
    {#if showLabel}
      <span class="open-note-label">{state.label}</span>
    {/if}
  </span>
{/if}

<style>
  .open-note-indicator {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 3px;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    line-height: 1;
    white-space: nowrap;
  }

  .open-note-indicator.focused {
    color: var(--accent-primary);
  }

  .open-note-indicator :global(svg) {
    flex: 0 0 auto;
  }

  .open-note-label {
    font-size: var(--text-micro);
    letter-spacing: 0;
  }
</style>
