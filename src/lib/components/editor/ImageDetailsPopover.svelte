<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { RotateCcw, SlidersHorizontal, X } from '@lucide/svelte';
  import type { ImageBlockAttrsUpdate, ImageBlockToolbarRequest } from '$lib/adapters/prosemirror/views/BlockNodeView';

  interface Props {
    image: ImageBlockToolbarRequest;
    onClose: () => void;
    onSave: (attrs: ImageBlockAttrsUpdate) => void | Promise<void>;
  }

  let { image, onClose, onSave }: Props = $props();

  let alt = $state('');
  let title = $state('');
  let caption = $state('');
  let width = $state('');

  $effect(() => {
    alt = image.alt ?? '';
    title = image.title ?? '';
    caption = image.caption ?? '';
    width = image.width ? String(image.width) : '';
  });

  // Close on Escape, captured so the editor's own key handling doesn't run.
  $effect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const parsedWidth = Number.parseInt(width, 10);
    void onSave({
      alt: alt.trim() || null,
      title: title.trim() || null,
      caption: caption.trim() || null,
      width: Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : null,
    });
  }

  function scrimStyle(): string {
    const r = image.rect;
    return `top: ${r.top}px; left: ${r.left}px; width: ${r.width}px; height: ${r.height}px;`;
  }

  function cardStyle(): string {
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const halfWidth = 160;
    const left = Math.min(
      Math.max(image.rect.left + image.rect.width / 2, halfWidth + 16),
      Math.max(halfWidth + 16, viewportWidth - halfWidth - 16),
    );
    const top = Math.min(
      Math.max(image.rect.top + image.rect.height / 2, 130),
      Math.max(130, viewportHeight - 130),
    );
    return `left: ${left}px; top: ${top}px;`;
  }
</script>

<div class="image-overlay-backdrop" role="presentation" onclick={onClose} transition:fade={{ duration: 110 }}></div>
<div class="image-overlay-scrim" style={scrimStyle()} aria-hidden="true" transition:fade={{ duration: 110 }}></div>
<div
  class="image-details-popover"
  style={cardStyle()}
  role="dialog"
  aria-modal="true"
  aria-label="Image details"
  transition:scale={{ duration: 120, start: 0.96 }}
>
  <form onsubmit={submit}>
    <header>
      <div>
        <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />
        <h2>Image details</h2>
      </div>
      <button type="button" class="image-details-icon" onclick={onClose} aria-label="Close image details" title="Close">
        <X size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </header>

    <label>
      <span>Alt text</span>
      <input bind:value={alt} type="text" />
    </label>

    <label>
      <span>Caption</span>
      <input bind:value={caption} type="text" />
    </label>

    <label>
      <span>Title</span>
      <input bind:value={title} type="text" />
    </label>

    <label>
      <span>Width</span>
      <div class="image-width-row">
        <input bind:value={width} type="number" min="1" inputmode="numeric" />
        <button type="button" onclick={() => { width = ''; }} aria-label="Reset image width" title="Reset width">
          <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </label>

    <footer>
      <button type="button" class="secondary" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </footer>
  </form>
</div>

<style>
  .image-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    background: color-mix(in srgb, var(--bg-primary) 35%, transparent);
  }

  /* Highlights the image being edited; clicks fall through to the backdrop. */
  .image-overlay-scrim {
    position: fixed;
    z-index: var(--z-popover);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 45%, transparent);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    pointer-events: none;
  }

  .image-details-popover {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    width: min(320px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
    transform: translate(-50%, -50%);
  }

  .image-details-popover header,
  .image-details-popover header > div,
  .image-details-popover footer,
  .image-width-row {
    display: flex;
    align-items: center;
  }

  .image-details-popover header {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .image-details-popover header > div {
    gap: 8px;
    min-width: 0;
  }

  .image-details-popover h2 {
    margin: 0;
    font-size: var(--text-body);
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1.2;
  }

  .image-details-icon,
  .image-width-row button {
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

  .image-details-icon:hover,
  .image-width-row button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-details-popover label {
    display: grid;
    gap: 5px;
    margin-top: 8px;
  }

  .image-details-popover label span {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 500;
  }

  .image-details-popover input {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    outline: none;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
  }

  .image-details-popover input:focus {
    border-color: var(--accent-primary);
  }

  .image-width-row {
    gap: 6px;
  }

  .image-details-popover footer {
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .image-details-popover footer button {
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-caption);
    font-weight: 600;
    cursor: pointer;
  }

  .image-details-popover footer .secondary {
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-secondary);
  }

  .image-details-popover footer .secondary:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-details-popover footer .primary {
    border: 0;
    background: var(--accent-primary);
    color: white;
  }
</style>
