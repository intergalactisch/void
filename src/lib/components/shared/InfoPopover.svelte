<script module lang="ts">
  let nextId = 0;
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Info, X } from '@lucide/svelte';

  interface Props {
    title: string;
    body: string;
    items?: string[];
    label?: string;
    align?: 'start' | 'end';
  }

  let {
    title,
    body,
    items = [],
    label,
    align = 'end',
  }: Props = $props();

  let root: HTMLSpanElement | null = $state(null);
  let panel: HTMLSpanElement | null = $state(null);
  let open = $state(false);
  let placement: 'bottom' | 'top' = $state('bottom');
  let panelStyle = $state('');
  let panelReady = $state(false);
  let openedByFocus = false;
  const panelId = `info-popover-${++nextId}`;

  function close() {
    open = false;
    placement = 'bottom';
    panelStyle = '';
    panelReady = false;
    openedByFocus = false;
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);

    return {
      destroy() {
        node.remove();
      },
    };
  }

  function containsPopoverNode(node: Node | null) {
    return !!node && (root?.contains(node) || panel?.contains(node));
  }

  async function repositionPanel() {
    if (!open || !root || !panel || typeof window === 'undefined') return;

    await tick();
    if (!panel) return;

    const margin = 12;
    const gap = 8;

    if (window.innerWidth <= 480) {
      placement = 'bottom';
      panelStyle = '';
      panelReady = true;
      return;
    }

    const triggerRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(panelRect.width || 280, window.innerWidth - margin * 2);
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap - margin;
    const spaceAbove = triggerRect.top - gap - margin;
    const nextPlacement = spaceBelow < panelRect.height && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const availableHeight = Math.max(96, nextPlacement === 'top' ? spaceAbove : spaceBelow);
    const panelHeight = Math.min(panelRect.height || availableHeight, availableHeight);

    placement = nextPlacement;
    const rawLeft = align === 'start' ? triggerRect.left : triggerRect.right - panelWidth;
    const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - margin - panelWidth));
    const rawTop = nextPlacement === 'top'
      ? triggerRect.top - gap - panelHeight
      : triggerRect.bottom + gap;
    const top = Math.max(margin, Math.min(rawTop, window.innerHeight - margin - panelHeight));

    panelStyle = [
      `--info-panel-left: ${Math.round(left)}px`,
      `--info-panel-top: ${Math.round(top)}px`,
      `--info-panel-max-height: ${Math.round(availableHeight)}px`,
    ].join('; ');
    panelReady = true;
  }

  function handleFocus() {
    if (!open) {
      open = true;
      openedByFocus = true;
      void repositionPanel();
    }
  }

  function handleFocusOut() {
    window.setTimeout(() => {
      if (!containsPopoverNode(document.activeElement)) close();
    });
  }

  function handleClick(event: MouseEvent) {
    event.stopPropagation();
    if (openedByFocus) {
      openedByFocus = false;
      return;
    }
    open = !open;
    if (open) void repositionPanel();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!open) return;
    const target = event.target;
    if (target instanceof Node && containsPopoverNode(target)) return;
    close();
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  });

  onDestroy(() => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  });

  $effect(() => {
    if (!open || typeof window === 'undefined') return;

    const reposition = () => {
      void repositionPanel();
    };

    void repositionPanel();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  });
</script>

<span
  bind:this={root}
  class="info-popover"
  class:align-start={align === 'start'}
  onfocusout={handleFocusOut}
>
  <button
    type="button"
    class="info-trigger"
    aria-label={label ?? `About ${title}`}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={handleClick}
    onfocus={handleFocus}
    onkeydown={handleKeydown}
  >
    <Info size={13} strokeWidth={1.9} aria-hidden="true" />
  </button>

  {#if open}
    <span
      use:portal
      bind:this={panel}
      id={panelId}
      class="info-panel"
      class:place-top={placement === 'top'}
      class:positioned={panelReady}
      role="dialog"
      aria-label={title}
      tabindex="-1"
      style={panelStyle}
      onkeydown={handleKeydown}
      onfocusout={handleFocusOut}
    >
      <span class="info-panel-head">
        <strong>{title}</strong>
        <button type="button" class="info-close" onclick={close} aria-label="Close help">
          <X size={12} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </span>
      <span class="info-body">{body}</span>
      {#if items.length > 0}
        <span class="info-list">
          {#each items as item}
            <span>{item}</span>
          {/each}
        </span>
      {/if}
    </span>
  {/if}
</span>

<style>
  .info-popover {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    line-height: 1;
  }

  .info-trigger,
  .info-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .info-trigger {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
  }

  .info-trigger:hover,
  .info-trigger:focus-visible,
  .info-trigger[aria-expanded='true'] {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .info-panel {
    position: fixed;
    top: var(--info-panel-top, 12px);
    left: var(--info-panel-left, 12px);
    z-index: var(--z-tooltip);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(280px, calc(100vw - 28px));
    max-width: calc(100vw - 28px);
    max-height: min(360px, var(--info-panel-max-height, calc(100vh - 28px)));
    padding: 11px 12px 12px;
    overflow: auto;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
    visibility: hidden;
  }

  .info-panel.positioned {
    visibility: visible;
  }

  .info-panel.place-top {
    transform-origin: bottom center;
  }

  .info-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--text-primary);
  }

  .info-panel-head strong {
    min-width: 0;
    font-size: var(--text-caption);
    font-weight: 700;
    line-height: 1.25;
  }

  .info-close {
    width: 20px;
    height: 20px;
    margin: -4px -5px -4px 0;
    border-radius: var(--radius-sm);
  }

  .info-close:hover,
  .info-close:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .info-body,
  .info-list,
  .info-list span {
    display: block;
  }

  .info-body {
    color: var(--text-secondary);
  }

  .info-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 2px;
  }

  .info-list span {
    position: relative;
    padding-left: 12px;
    color: var(--text-tertiary);
  }

  .info-list span::before {
    content: '';
    position: absolute;
    top: 0.72em;
    left: 1px;
    width: 4px;
    height: 4px;
    border-radius: var(--radius-full);
    background: currentColor;
    transform: translateY(-50%);
    opacity: 0.7;
  }

  @media (max-width: 480px) {
    .info-panel,
    .align-start .info-panel {
      position: fixed;
      top: auto;
      right: 12px;
      bottom: 12px;
      left: 12px;
      width: auto;
      max-width: none;
      max-height: min(62vh, 360px);
      visibility: visible;
    }
  }
</style>
