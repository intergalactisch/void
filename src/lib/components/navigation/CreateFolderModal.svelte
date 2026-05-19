<script lang="ts">
  import { FolderPlus, X } from '@lucide/svelte';

  interface Props {
    /** Parent folder path (null/empty creates at root) */
    parentPath: string | null;
    /** Submit callback. Receives raw name; caller validates. */
    onSubmit: (name: string) => Promise<void> | void;
    /** Close callback (cancel) */
    onClose: () => void;
  }

  let { parentPath, onSubmit, onClose }: Props = $props();

  let name = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let inputRef: HTMLInputElement | null = $state(null);

  const parentLabel = $derived(parentPath ? parentPath : 'notes root');

  let validation = $derived.by(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (/[\\/]/.test(trimmed)) return 'No slashes allowed';
    if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) return 'Cannot start with a dot';
    return null;
  });

  let canSubmit = $derived(name.trim().length > 0 && !validation && !submitting);

  $effect(() => {
    requestAnimationFrame(() => inputRef?.focus());
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  async function handleSubmit(event?: Event) {
    event?.preventDefault();
    if (!canSubmit) return;
    submitting = true;
    error = null;
    try {
      await onSubmit(name.trim());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      submitting = false;
      return;
    }
    submitting = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="cf-backdrop" onclick={onClose} role="presentation"></div>

<div class="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-title">
  <header class="cf-head">
    <span class="cf-icon" aria-hidden="true"><FolderPlus size={15} strokeWidth={1.9} /></span>
    <h2 id="cf-title">New folder</h2>
    <button
      type="button"
      class="cf-close"
      onclick={onClose}
      aria-label="Cancel"
      title="Cancel"
    >
      <X size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  </header>

  <form class="cf-body" onsubmit={handleSubmit}>
    <label for="cf-name-input" class="cf-label">
      Folder name
      <span class="cf-context">in <code>{parentLabel}</code></span>
    </label>
    <input
      bind:this={inputRef}
      bind:value={name}
      id="cf-name-input"
      type="text"
      class="cf-input"
      class:invalid={!!validation}
      placeholder="My folder"
      autocomplete="off"
      spellcheck="false"
      disabled={submitting}
    />
    {#if validation}
      <span class="cf-validation">{validation}</span>
    {/if}
    {#if error}
      <span class="cf-error" role="alert">{error}</span>
    {/if}

    <div class="cf-actions">
      <button type="button" class="cf-button" onclick={onClose} disabled={submitting}>Cancel</button>
      <button type="submit" class="cf-button cf-button-primary" disabled={!canSubmit}>
        {submitting ? 'Creating…' : 'Create folder'}
      </button>
    </div>
  </form>
</div>

<style>
  .cf-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal, 400) - 1);
    background: color-mix(in srgb, var(--bg-overlay, rgba(0,0,0,0.4)) 50%, transparent);
    backdrop-filter: blur(4px) saturate(120%);
    -webkit-backdrop-filter: blur(4px) saturate(120%);
  }

  .cf-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--z-modal, 400);
    width: min(420px, calc(100vw - 32px));
    transform: translate(-50%, -50%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: cf-pop 180ms var(--ease-out-soft, ease-out);
  }

  @keyframes cf-pop {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .cf-head {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .cf-icon {
    display: inline-flex;
    color: var(--accent-primary, var(--ai-accent));
  }

  .cf-head h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13.5px;
    font-weight: 650;
  }

  .cf-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .cf-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .cf-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }

  .cf-label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 11.5px;
    font-weight: 600;
  }

  .cf-context {
    color: var(--text-muted);
    font-weight: 500;
  }

  .cf-context code {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-editor);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .cf-input {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .cf-input:focus {
    border-color: var(--accent-primary, var(--ai-accent));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary, var(--ai-accent)) 18%, transparent);
  }

  .cf-input.invalid {
    border-color: var(--color-error);
  }

  .cf-validation,
  .cf-error {
    color: var(--color-error);
    font-size: 11.5px;
    line-height: 1.35;
  }

  .cf-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .cf-button {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .cf-button:hover:not(:disabled) {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .cf-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .cf-button-primary {
    border-color: transparent;
    background: var(--accent-primary, var(--ai-accent));
    color: var(--text-inverse);
    box-shadow: var(--shadow-xs);
  }

  .cf-button-primary:hover:not(:disabled) {
    background: var(--accent-strong, var(--ai-accent-strong));
    color: var(--text-inverse);
  }
</style>
