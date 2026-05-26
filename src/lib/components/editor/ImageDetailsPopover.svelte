<script lang="ts">
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

  function popoverStyle(): string {
    const viewportWidth = typeof window === 'undefined' ? 360 : window.innerWidth;
    const left = Math.min(Math.max(image.rect.left, 16), Math.max(16, viewportWidth - 336));
    return `top: ${image.rect.bottom + 8}px; left: ${left}px;`;
  }
</script>

<div class="image-details-backdrop" role="presentation" onclick={onClose}></div>
<div
  class="image-details-popover"
  style={popoverStyle()}
  role="dialog"
  aria-label="Image details"
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
  .image-details-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    background: transparent;
  }

  .image-details-popover {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    width: min(320px, calc(100vw - 32px));
    padding: 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
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
