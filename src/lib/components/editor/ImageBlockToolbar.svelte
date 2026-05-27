<script lang="ts">
  import { fade } from 'svelte/transition';
  import {
    Copy,
    Download,
    Ellipsis,
    FolderSearch,
    ImagePlus,
    Info,
    Trash2,
  } from '@lucide/svelte';
  import type { ImageBlockToolbarRequest } from '$lib/adapters/prosemirror/views/BlockNodeView';

  interface Props {
    image: ImageBlockToolbarRequest;
    canReveal?: boolean;
    hasAttribution?: boolean;
    onReplace: () => void;
    onDetails: () => void;
    onDownload: () => void;
    onCopyPath: () => void;
    onCopyAttribution: () => void;
    onReveal: () => void;
    onRemove: () => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onMenuOpenChange: (open: boolean) => void;
  }

  let {
    image,
    canReveal = true,
    hasAttribution = false,
    onReplace,
    onDetails,
    onDownload,
    onCopyPath,
    onCopyAttribution,
    onReveal,
    onRemove,
    onPointerEnter,
    onPointerLeave,
    onMenuOpenChange,
  }: Props = $props();

  let menuOpen = $state(false);

  function setMenu(open: boolean): void {
    menuOpen = open;
    onMenuOpenChange(open);
  }

  function runMenuItem(action: () => void): void {
    setMenu(false);
    action();
  }

  // Close the More menu on Escape; keep the listener scoped to when it is open.
  $effect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Pin the toolbar to the image's top-right corner, just inside the edge.
  function toolbarStyle(): string {
    const margin = 10;
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const right = Math.max(8, viewportWidth - image.rect.right + margin);
    const top = Math.max(8, image.rect.top + margin);
    return `top: ${top}px; right: ${right}px;`;
  }
</script>

{#if menuOpen}
  <div class="image-toolbar-menu-backdrop" role="presentation" onclick={() => setMenu(false)}></div>
{/if}

<div
  class="image-toolbar"
  style={toolbarStyle()}
  role="toolbar"
  tabindex="-1"
  aria-label="Image actions"
  transition:fade={{ duration: 90 }}
  onpointerenter={onPointerEnter}
  onpointerleave={onPointerLeave}
>
  <button type="button" onclick={onReplace} aria-label="Replace image" title="Replace image">
    <ImagePlus size={15} strokeWidth={2} aria-hidden="true" />
  </button>
  <button type="button" onclick={onDetails} aria-label="Image details" title="Image details">
    <Info size={15} strokeWidth={2} aria-hidden="true" />
  </button>
  <button type="button" onclick={onDownload} aria-label="Download copy" title="Download copy">
    <Download size={15} strokeWidth={2} aria-hidden="true" />
  </button>
  <div class="image-toolbar-menu-wrap">
    <button
      type="button"
      class:active={menuOpen}
      onclick={() => setMenu(!menuOpen)}
      aria-label="More image actions"
      aria-expanded={menuOpen}
      title="More"
    >
      <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
    </button>
    {#if menuOpen}
      <div class="image-toolbar-menu" role="menu" transition:fade={{ duration: 80 }}>
        <button type="button" role="menuitem" onclick={() => runMenuItem(onCopyPath)}>
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
          <span>Copy Markdown path</span>
        </button>
        <button type="button" role="menuitem" disabled={!hasAttribution} onclick={() => runMenuItem(onCopyAttribution)}>
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
          <span>Copy attribution</span>
        </button>
        <button type="button" role="menuitem" disabled={!canReveal} onclick={() => runMenuItem(onReveal)}>
          <FolderSearch size={14} strokeWidth={2} aria-hidden="true" />
          <span>Show in Finder</span>
        </button>
        <div class="image-toolbar-menu-sep" role="separator"></div>
        <button type="button" role="menuitem" class="danger" onclick={() => runMenuItem(onRemove)}>
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
          <span>Remove image block</span>
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .image-toolbar-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    background: transparent;
  }

  .image-toolbar {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 3px;
    border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
    box-shadow: var(--shadow-md);
    -webkit-backdrop-filter: blur(10px) saturate(1.4);
    backdrop-filter: blur(10px) saturate(1.4);
  }

  .image-toolbar button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }

  .image-toolbar button:hover,
  .image-toolbar button.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-toolbar button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .image-toolbar button:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
  }

  .image-toolbar-menu-wrap {
    position: relative;
    display: inline-flex;
  }

  .image-toolbar-menu {
    position: absolute;
    top: 34px;
    right: 0;
    width: 200px;
    padding: 4px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
  }

  .image-toolbar-menu button {
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    font-size: var(--text-caption);
    white-space: nowrap;
  }

  .image-toolbar-menu button span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .image-toolbar-menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border-light);
  }

  .image-toolbar-menu button.danger {
    color: var(--color-error);
  }

  .image-toolbar-menu button.danger:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }
</style>
