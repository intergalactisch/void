<script lang="ts">
  /**
   * Single drag-and-drop overlay for the pane workspace.
   *
   * Reads the shared `paneDrag` controller and draws, scoped to the hovered pane:
   *  - a frame around the whole target pane,
   *  - a faint "stays here" half for the surviving content (edge drops),
   *  - a solid placeholder on the half where the dragged note/pane will land,
   *  - a label that follows the cursor.
   * Because the store now splits the target pane locally, this preview is truthful:
   * only the one pane changes.
   */
  import { paneDrag } from '$lib/components/dnd/paneDnd.svelte';
  import type { PaneRect } from './paneMove';

  const preview = $derived(paneDrag.preview);
  const visible = $derived(paneDrag.active && !!preview);

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  const chipTitle = $derived.by(() => {
    const source = paneDrag.source;
    if (!source) return '';
    if (source.title) return source.title;
    return source.notePath ? basename(source.notePath) : 'Empty pane';
  });

  function rectStyle(rect: PaneRect): string {
    return `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  }

  function labelStyle(): string {
    if (typeof window === 'undefined') return '';
    const left = Math.min(Math.max(paneDrag.pointer.x + 14, 8), window.innerWidth - 160);
    const top = Math.min(Math.max(paneDrag.pointer.y + 16, 8), window.innerHeight - 36);
    return `left:${left}px;top:${top}px;`;
  }
</script>

{#if visible && preview}
  <div class="pane-drop-overlay" aria-hidden="true">
    <div class="pane-drop-frame" style={rectStyle(preview.targetRect)}></div>

    {#if preview.survivorRect}
      <div class="pane-drop-survivor" style={rectStyle(preview.survivorRect)}>
        <span class="pane-drop-survivor-label">stays here</span>
      </div>
    {/if}

    <div
      class="pane-drop-insert"
      class:swap={paneDrag.swap}
      class:already-open={paneDrag.alreadyOpen}
      data-placement={preview.placement}
      style={rectStyle(preview.previewRect)}
    >
      <span class="pane-drop-chip">{chipTitle}</span>
    </div>

    <div class="pane-drop-cursor-label" style={labelStyle()}>{preview.label}</div>
  </div>
{/if}

<div class="pane-drop-live" role="status" aria-live="polite">{paneDrag.announcement}</div>

<style>
  .pane-drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    pointer-events: none;
  }

  .pane-drop-frame,
  .pane-drop-survivor,
  .pane-drop-insert {
    position: fixed;
    border-radius: var(--radius-sm);
    transition: left 140ms var(--ease-out-soft), top 140ms var(--ease-out-soft),
      width 140ms var(--ease-out-soft), height 140ms var(--ease-out-soft);
  }

  .pane-drop-frame {
    border: 1px solid color-mix(in srgb, var(--accent-primary) 48%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 16%, transparent);
  }

  .pane-drop-survivor {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed color-mix(in srgb, var(--accent-primary) 38%, var(--border-light));
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }

  .pane-drop-survivor-label {
    font-size: var(--text-micro, 10px);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-tertiary);
    text-transform: uppercase;
  }

  .pane-drop-insert {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: 1.5px solid var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .pane-drop-insert.swap {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .pane-drop-insert.already-open {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--accent-primary) 60%, transparent);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .pane-drop-chip {
    max-width: calc(100% - 16px);
    padding: 3px 9px;
    overflow: hidden;
    border-radius: var(--radius-full, 999px);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    color: var(--text-primary);
    font-size: var(--text-caption, 12px);
    font-weight: 650;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Visually-hidden polite live region announcing drop outcomes to assistive tech. */
  .pane-drop-live {
    position: fixed;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .pane-drop-cursor-label {
    position: fixed;
    max-width: 150px;
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 42%, var(--border-light));
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    color: var(--text-primary);
    font-size: var(--text-caption, 12px);
    font-weight: 650;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .pane-drop-frame,
    .pane-drop-survivor,
    .pane-drop-insert {
      transition: none;
    }
  }
</style>
