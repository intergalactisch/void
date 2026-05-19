<script lang="ts">
  /**
   * GraphView — local 1-hop graph for the active note.
   *
   * Renders a modal SVG visualization with the current note at center and
   * its backlinks + outgoing-link neighbors arranged in a ring. Click any
   * node to navigate to that note.
   *
   * Uses the existing `relationsStore` (already populated for the active
   * note) so this component holds no data of its own.
   */

  import { onMount, onDestroy } from 'svelte';
  import { relationsStore, notesStore, uiStore } from '$lib/stores';
  import { events } from '$lib/events';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import type { NoteLink } from '$lib/ports/inbound/RelationsService';

  interface Node {
    id: string;
    label: string;
    direction: 'self' | 'backlink' | 'outgoing' | 'mutual';
    x: number;
    y: number;
  }

  let dialogRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;

  const RADIUS = 160;
  const CENTER_X = 220;
  const CENTER_Y = 220;
  const NODE_R = 22;

  let nodes = $derived.by(() => {
    if (!uiStore.graphViewOpen) return [] as Node[];
    const center: Node = {
      id: notesStore.selectedPath ?? 'self',
      label: currentTitle(),
      direction: 'self',
      x: CENTER_X,
      y: CENTER_Y,
    };

    // Combine backlinks and outgoing into a unique-by-path set.
    const seen = new Map<string, { back: NoteLink | null; out: NoteLink | null }>();
    for (const back of relationsStore.backlinks) {
      const entry = seen.get(back.path) ?? { back: null, out: null };
      entry.back = back;
      seen.set(back.path, entry);
    }
    for (const out of relationsStore.outgoing) {
      const entry = seen.get(out.path) ?? { back: null, out: null };
      entry.out = out;
      seen.set(out.path, entry);
    }

    const ids = Array.from(seen.keys());
    const count = ids.length;
    const ring: Node[] = ids.map((id, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1) - Math.PI / 2;
      const entry = seen.get(id)!;
      const direction: Node['direction'] = entry.back && entry.out
        ? 'mutual'
        : entry.back
          ? 'backlink'
          : 'outgoing';
      const label = entry.back?.title ?? entry.out?.title ?? id;
      return {
        id,
        label,
        direction,
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
      };
    });

    return [center, ...ring];
  });

  function currentTitle(): string {
    const path = notesStore.selectedPath;
    if (!path) return 'No note';
    const items = notesStore.allNotes;
    const match = items.find((n) => n.path === path);
    if (match) return match.title;
    return path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
  }

  function navigate(node: Node) {
    if (node.direction === 'self') return;
    notesStore.selectNote(node.id);
    events.emit('app:navigate', { view: 'note', path: node.id });
    close();
  }

  function close() {
    uiStore.closeGraphView();
  }

  $effect(() => {
    if (uiStore.graphViewOpen && dialogRef) {
      focusTrapCleanup = createFocusTrap({
        container: dialogRef,
        onEscape: close,
      });
    } else if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
  });

  onDestroy(() => {
    focusTrapCleanup?.();
  });

  function colorFor(direction: Node['direction']): string {
    switch (direction) {
      case 'self':
        return 'var(--accent-primary)';
      case 'mutual':
        return 'var(--color-success, #2c8a4d)';
      case 'backlink':
        return 'var(--text-secondary)';
      case 'outgoing':
        return 'var(--accent-primary)';
    }
  }
</script>

{#if uiStore.graphViewOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="graph-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    role="presentation"
  >
    <div
      bind:this={dialogRef}
      class="graph-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Note graph"
    >
      <header class="graph-header">
        <span class="graph-title">Local graph</span>
        <span class="graph-count">{Math.max(0, nodes.length - 1)} neighbour{nodes.length === 2 ? '' : 's'}</span>
        <button type="button" class="graph-close" onclick={close} aria-label="Close graph view">×</button>
      </header>

      {#if nodes.length <= 1}
        <div class="graph-empty">
          <p>No connected notes yet.</p>
          <p class="graph-hint">Add a [[wikilink]] or [markdown](path) link to see relationships here.</p>
        </div>
      {:else}
        <div class="graph-canvas-wrap">
          <svg viewBox="0 0 440 440" class="graph-canvas" aria-hidden="true">
            {#each nodes.slice(1) as node (node.id)}
              <line
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={node.x}
                y2={node.y}
                stroke={colorFor(node.direction)}
                stroke-width="1"
                opacity="0.4"
              />
            {/each}
            {#each nodes as node (node.id)}
              <g
                class="graph-node"
                class:graph-node-self={node.direction === 'self'}
                role="button"
                tabindex="0"
                onclick={() => navigate(node)}
                onkeydown={(e) => { if (e.key === 'Enter') navigate(node); }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.direction === 'self' ? NODE_R + 4 : NODE_R}
                  fill="var(--bg-card)"
                  stroke={colorFor(node.direction)}
                  stroke-width={node.direction === 'self' ? 2 : 1.5}
                />
                <text
                  x={node.x}
                  y={node.y + NODE_R + 14}
                  text-anchor="middle"
                  font-size="11"
                  fill="var(--text-primary)"
                >
                  {trim(node.label, 20)}
                </text>
              </g>
            {/each}
          </svg>
        </div>
      {/if}

      <footer class="graph-footer">
        <span class="graph-legend">
          <span class="dot dot-backlink"></span> backlink
          <span class="dot dot-outgoing"></span> outgoing
          <span class="dot dot-mutual"></span> mutual
        </span>
      </footer>
    </div>
  </div>
{/if}

<script module lang="ts">
  function trim(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '…';
  }
</script>

<style>
  .graph-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .graph-panel {
    width: 480px;
    max-width: 92vw;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-dialog);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .graph-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-faint);
    gap: 12px;
  }

  .graph-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .graph-count {
    flex: 1;
    text-align: center;
    font-size: 12px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .graph-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 20px;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    line-height: 1;
  }

  .graph-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .graph-empty {
    padding: 36px 24px;
    text-align: center;
  }

  .graph-empty p {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .graph-hint {
    color: var(--text-tertiary) !important;
  }

  .graph-canvas-wrap {
    padding: 12px;
  }

  .graph-canvas {
    width: 100%;
    height: auto;
  }

  :global(.graph-node) {
    cursor: pointer;
  }

  :global(.graph-node:hover circle) {
    fill: var(--bg-hover);
  }

  :global(.graph-node:focus-visible circle) {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  :global(.graph-node-self) {
    cursor: default;
  }

  .graph-footer {
    padding: 10px 14px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-app);
  }

  .graph-legend {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 3px;
    vertical-align: -1px;
  }

  .dot-backlink {
    background: var(--text-secondary);
  }

  .dot-outgoing {
    background: var(--accent-primary);
  }

  .dot-mutual {
    background: var(--color-success, #2c8a4d);
  }
</style>
