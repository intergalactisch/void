<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { ImagePlus, Link2, Upload, X } from '@lucide/svelte';
  import type { ImageBlockToolbarRequest } from '$lib/adapters/prosemirror/views/BlockNodeView';

  interface Props {
    mode?: 'insert' | 'replace';
    rect?: ImageBlockToolbarRequest['rect'] | null;
    busy?: boolean;
    error?: string | null;
    onClose: () => void;
    onChooseFile?: () => boolean | void | Promise<boolean | void>;
    onAttachUrl: (url: string) => void | Promise<void>;
    onAttachFile: (file: File) => void | Promise<void>;
  }

  let {
    mode = 'insert',
    rect = null,
    busy = false,
    error = null,
    onClose,
    onChooseFile,
    onAttachUrl,
    onAttachFile,
  }: Props = $props();

  let url = $state('');
  let isDragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state(undefined);

  const title = $derived(mode === 'replace' ? 'Replace image' : 'Add image');
  const submitLabel = $derived(mode === 'replace' ? 'Replace' : 'Add');

  // Close on Escape (capture so the editor's key handling stays out of the way).
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

  function scrimStyle(): string {
    if (!rect) return '';
    return `top: ${rect.top}px; left: ${rect.left}px; width: ${rect.width}px; height: ${rect.height}px;`;
  }

  // When replacing, center the panel over the image; otherwise center on screen.
  function cardStyle(): string {
    if (!rect) return '';
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const halfWidth = 180;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfWidth + 16),
      Math.max(halfWidth + 16, viewportWidth - halfWidth - 16),
    );
    const top = Math.min(
      Math.max(rect.top + rect.height / 2, 130),
      Math.max(130, viewportHeight - 130),
    );
    return `left: ${left}px; top: ${top}px;`;
  }

  function submitUrl(event?: SubmitEvent): void {
    event?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    void onAttachUrl(trimmed);
  }

  function handleFileChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file && !busy) void onAttachFile(file);
    input.value = '';
  }

  async function chooseFile(): Promise<void> {
    if (busy) return;
    const handled = await onChooseFile?.();
    if (handled === true) return;
    fileInput?.click();
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    isDragging = false;
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'));
    if (file && !busy) void onAttachFile(file);
  }

  function handlePaste(event: ClipboardEvent): void {
    const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'));
    if (file && !busy) {
      event.preventDefault();
      void onAttachFile(file);
      return;
    }
    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (text && /^https:\/\//i.test(text) && !busy) {
      event.preventDefault();
      url = text;
    }
  }
</script>

<div class="image-popover-backdrop" role="presentation" onclick={onClose} transition:fade={{ duration: 110 }}></div>
{#if rect}
  <div class="image-popover-scrim" style={scrimStyle()} aria-hidden="true" transition:fade={{ duration: 110 }}></div>
{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="image-insert-popover"
  class:is-dragging={isDragging}
  class:is-overlay={rect}
  style={cardStyle()}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  transition:scale={{ duration: 120, start: 0.96 }}
  onpaste={handlePaste}
  ondragenter={(event) => { event.preventDefault(); isDragging = true; }}
  ondragover={(event) => { event.preventDefault(); isDragging = true; }}
  ondragleave={(event) => { if (event.currentTarget === event.target) isDragging = false; }}
  ondrop={handleDrop}
>
  <header>
    <div>
      <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
      <h2>{title}</h2>
    </div>
    <button type="button" class="image-popover-icon" onclick={onClose} aria-label="Close image dialog" title="Close">
      <X size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  </header>

  <button type="button" class="image-file-drop" onclick={chooseFile} disabled={busy}>
    <Upload size={16} strokeWidth={2} aria-hidden="true" />
    <span>{mode === 'replace' ? 'Choose replacement' : 'Choose image'}</span>
  </button>

  <input
    bind:this={fileInput}
    class="image-file-input"
    type="file"
    accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
    onchange={handleFileChange}
    tabindex="-1"
  />

  <form class="image-url-form" onsubmit={submitUrl}>
    <label for="image-url-input">URL</label>
    <div>
      <Link2 size={15} strokeWidth={2} aria-hidden="true" />
      <input
        id="image-url-input"
        type="url"
        bind:value={url}
        placeholder="https://example.com/image.webp"
        disabled={busy}
      />
      <button type="submit" disabled={busy || !url.trim()}>{submitLabel}</button>
    </div>
  </form>

  {#if error}
    <p class="image-popover-error" role="alert">{error}</p>
  {/if}
</div>

<style>
  .image-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    background: color-mix(in srgb, var(--bg-primary) 35%, transparent);
  }

  /* Highlights the image being replaced; clicks fall through to the backdrop. */
  .image-popover-scrim {
    position: fixed;
    z-index: var(--z-popover);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 45%, transparent);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    pointer-events: none;
  }

  .image-insert-popover {
    position: fixed;
    left: 50%;
    top: 46%;
    z-index: calc(var(--z-popover) + 1);
    width: min(360px, calc(100vw - 32px));
    padding: 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
    transform: translate(-50%, -50%);
  }

  .image-insert-popover header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .image-insert-popover header > div {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .image-insert-popover h2 {
    margin: 0;
    font-size: var(--text-body);
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .image-popover-icon {
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

  .image-popover-icon:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .image-file-drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 68px;
    padding: 12px;
    border: 1px dashed var(--border-medium);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-small);
    font-weight: 500;
    cursor: pointer;
  }

  .image-insert-popover.is-dragging .image-file-drop,
  .image-file-drop:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-primary) 7%, var(--bg-subtle));
  }

  .image-file-drop:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .image-file-input {
    display: none;
  }

  .image-url-form {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }

  .image-url-form label {
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    font-weight: 500;
  }

  .image-url-form > div {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 4px 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-tertiary);
  }

  .image-url-form input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
  }

  .image-url-form button {
    height: 26px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: white;
    font-size: var(--text-caption);
    font-weight: 600;
    cursor: pointer;
  }

  .image-url-form button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .image-popover-error {
    margin: 10px 0 0;
    color: var(--color-error);
    font-size: var(--text-caption);
  }
</style>
