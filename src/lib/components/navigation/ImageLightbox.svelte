<script lang="ts">
  import { ChevronLeft, ChevronRight, X } from '@lucide/svelte';
  import type { FolderImage } from '$lib/stores/notes.svelte';

  interface Props {
    images: FolderImage[];
    /** Index of the image to show. */
    index: number;
    onClose: () => void;
    onIndexChange: (index: number) => void;
  }

  let { images, index, onClose, onIndexChange }: Props = $props();

  const current = $derived(images[index] ?? null);
  const hasMultiple = $derived(images.length > 1);

  function step(delta: number) {
    if (images.length === 0) return;
    onIndexChange((index + delta + images.length) % images.length);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  }

  function dimensions(image: FolderImage): string {
    return image.width && image.height ? `${image.width} × ${image.height}` : '';
  }

  // Close only when the backdrop itself is clicked, not the image or controls.
  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if current}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="lb-backdrop" onclick={handleBackdropClick} role="presentation">
    <button type="button" class="lb-close" onclick={onClose} aria-label="Close preview" title="Close (Esc)">
      <X size={18} strokeWidth={2} aria-hidden="true" />
    </button>

    {#if hasMultiple}
      <button
        type="button"
        class="lb-nav lb-prev"
        onclick={() => step(-1)}
        aria-label="Previous image"
        title="Previous (←)"
      >
        <ChevronLeft size={22} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="lb-nav lb-next"
        onclick={() => step(1)}
        aria-label="Next image"
        title="Next (→)"
      >
        <ChevronRight size={22} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}

    <figure class="lb-figure">
      <img class="lb-image" src={current.url} alt={current.fileName} />
      <figcaption class="lb-caption">
        <span class="lb-name">{current.fileName}</span>
        {#if dimensions(current)}<span class="lb-meta">{dimensions(current)}</span>{/if}
        {#if hasMultiple}<span class="lb-meta lb-counter">{index + 1} / {images.length}</span>{/if}
      </figcaption>
    </figure>
  </div>
{/if}

<style>
  .lb-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 400);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 64px;
    background: color-mix(in srgb, var(--bg-overlay, rgba(0, 0, 0, 0.7)) 88%, black);
    backdrop-filter: blur(6px) saturate(120%);
    -webkit-backdrop-filter: blur(6px) saturate(120%);
    animation: lb-fade 140ms var(--ease-out-soft, ease-out);
  }

  @keyframes lb-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .lb-figure {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin: 0;
    max-width: 100%;
    max-height: 100%;
  }

  .lb-image {
    display: block;
    max-width: min(1100px, 100%);
    max-height: 82vh;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .lb-caption {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    color: color-mix(in srgb, white 82%, transparent);
    font-size: var(--text-small);
  }

  .lb-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .lb-meta {
    flex-shrink: 0;
    color: color-mix(in srgb, white 58%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .lb-close,
  .lb-nav {
    position: fixed;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, white 16%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, black 36%, transparent);
    color: color-mix(in srgb, white 88%, transparent);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .lb-close:hover,
  .lb-nav:hover {
    background: color-mix(in srgb, white 16%, transparent);
    border-color: color-mix(in srgb, white 30%, transparent);
    color: white;
  }

  .lb-close {
    top: 18px;
    right: 18px;
    width: 36px;
    height: 36px;
  }

  .lb-nav {
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translateY(-50%);
  }

  .lb-prev { left: 18px; }
  .lb-next { right: 18px; }

  @media (max-width: 540px) {
    .lb-backdrop { padding: 32px 12px; }
    .lb-nav { width: 38px; height: 38px; }
    .lb-prev { left: 8px; }
    .lb-next { right: 8px; }
  }
</style>
