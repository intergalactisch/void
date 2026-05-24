<script lang="ts">
  import { PaneResizer } from 'paneforge';
  import type { NotePaneDirection } from '$lib/domain';

  interface Props {
    direction: NotePaneDirection;
    onBalance?: () => void;
  }

  let { direction, onBalance }: Props = $props();
  let dragging = $state(false);

  const label = $derived(direction === 'horizontal' ? 'Resize panes horizontally' : 'Resize panes vertically');

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onBalance?.();
  }
</script>

<PaneResizer
  class={`note-pane-resizer ${direction} ${dragging ? 'dragging' : ''}`}
  data-pane-resizer
  aria-label={label}
  title={label}
  onDraggingChange={(isDragging) => { dragging = isDragging; }}
  onkeydown={handleKeydown}
/>

<style>
  :global(.note-pane-resizer) {
    position: relative;
    z-index: 2;
    flex: 0 0 auto;
    background: transparent;
    outline: none;
  }

  :global(.note-pane-resizer.horizontal) {
    width: 1px;
    margin-inline: 0;
    cursor: col-resize;
  }

  :global(.note-pane-resizer.vertical) {
    height: 1px;
    margin-block: 0;
    cursor: row-resize;
  }

  :global(.note-pane-resizer::before) {
    content: '';
    position: absolute;
    background: var(--border-faint);
  }

  :global(.note-pane-resizer.horizontal::before) {
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
  }

  :global(.note-pane-resizer.vertical::before) {
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
  }

  :global(.note-pane-resizer::after) {
    content: '';
    position: absolute;
    opacity: 0;
    background: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  :global(.note-pane-resizer.horizontal::after) {
    top: 0;
    bottom: 0;
    left: -1px;
    width: 3px;
  }

  :global(.note-pane-resizer.vertical::after) {
    top: -1px;
    left: 0;
    right: 0;
    height: 3px;
  }

  :global(.note-pane-resizer.horizontal) {
    padding-inline: 4px;
    margin-inline: -4px;
  }

  :global(.note-pane-resizer.vertical) {
    padding-block: 4px;
    margin-block: -4px;
  }

  :global(.note-pane-resizer:hover::after),
  :global(.note-pane-resizer:focus-visible::after),
  :global(.note-pane-resizer.dragging::after),
  :global(.note-pane-resizer[data-active]::after) {
    opacity: 1;
  }

  :global(.note-pane-resizer[data-active='pointer']) {
    cursor: grabbing;
  }
</style>
