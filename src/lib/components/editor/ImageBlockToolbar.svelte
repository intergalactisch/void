<script lang="ts">
  import {
    Copy,
    Download,
    Ellipsis,
    FolderSearch,
    ImagePlus,
    Info,
    Trash2,
    X,
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
    onClose: () => void;
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
    onClose,
  }: Props = $props();

  let menuOpen = $state(false);

  function toolbarStyle(): string {
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const width = 190;
    const left = Math.min(Math.max(image.rect.left + image.rect.width / 2 - width / 2, 12), Math.max(12, viewportWidth - width - 12));
    const top = Math.max(12, image.rect.top - 38);
    return `top: ${top}px; left: ${left}px; width: ${width}px;`;
  }
</script>

<div class="image-toolbar" style={toolbarStyle()} role="toolbar" aria-label="Image actions">
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
      onclick={() => { menuOpen = !menuOpen; }}
      aria-label="More image actions"
      aria-expanded={menuOpen}
      title="More"
    >
      <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
    </button>
    {#if menuOpen}
      <div class="image-toolbar-menu" role="menu">
        <button type="button" role="menuitem" onclick={() => { menuOpen = false; onCopyPath(); }}>
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
          <span>Copy Markdown path</span>
        </button>
        <button type="button" role="menuitem" disabled={!hasAttribution} onclick={() => { menuOpen = false; onCopyAttribution(); }}>
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
          <span>Copy attribution</span>
        </button>
        <button type="button" role="menuitem" disabled={!canReveal} onclick={() => { menuOpen = false; onReveal(); }}>
          <FolderSearch size={14} strokeWidth={2} aria-hidden="true" />
          <span>Show in Finder</span>
        </button>
        <button type="button" role="menuitem" class="danger" onclick={() => { menuOpen = false; onRemove(); }}>
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
          <span>Remove image block</span>
        </button>
      </div>
    {/if}
  </div>
  <button type="button" onclick={onClose} aria-label="Close image toolbar" title="Close">
    <X size={15} strokeWidth={2} aria-hidden="true" />
  </button>
</div>

<style>
  .image-toolbar {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-md);
  }

  .image-toolbar button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
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
  }

  .image-toolbar-menu {
    position: absolute;
    top: 34px;
    right: 0;
    width: 190px;
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

  .image-toolbar-menu button.danger {
    color: var(--color-error);
  }

  .image-toolbar-menu button.danger:hover {
    background: var(--color-error-bg);
  }
</style>
