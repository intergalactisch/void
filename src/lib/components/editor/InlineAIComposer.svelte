<script lang="ts">
  import { onMount } from 'svelte';
  import { Send, Sparkles, X } from '@lucide/svelte';

  interface Props {
    composerId: string;
    initialDraft?: string;
    onDraftChange?: (composerId: string, value: string) => void;
    onSubmit: (prompt: string) => void | Promise<void>;
    onCancel: () => void;
  }

  let {
    composerId,
    initialDraft = '',
    onDraftChange,
    onSubmit,
    onCancel,
  }: Props = $props();

  let inputRef: HTMLInputElement | null = $state(null);
  let hasPrompt = $state(false);
  let lastInitialDraft = '';

  $effect(() => {
    if (initialDraft === lastInitialDraft) return;
    lastInitialDraft = initialDraft;
    if (inputRef && inputRef.value !== initialDraft) {
      inputRef.value = initialDraft;
    }
    setHasPrompt(initialDraft);
  });

  function setHasPrompt(value: string) {
    const next = value.trim().length > 0;
    if (next !== hasPrompt) hasPrompt = next;
  }

  function handleInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    setHasPrompt(value);
    onDraftChange?.(composerId, value);
  }

  function submit() {
    const prompt = inputRef?.value.trim() ?? '';
    if (!prompt) return;
    void onSubmit(prompt);
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  function stopEvent(event: Event) {
    event.stopPropagation();
  }

  onMount(() => {
    inputRef?.focus({ preventScroll: true });
  });
</script>

<div class="floating-inline-ai-composer-shell">
  <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
  <input
    bind:this={inputRef}
    name={`inline-ai-composer-${composerId}`}
    type="text"
    aria-label="Describe what AI should do with this text"
    placeholder="Describe what to do with this text..."
    autocomplete="off"
    spellcheck="false"
    value={initialDraft}
    oninput={handleInput}
    onkeydown={handleKeydown}
    oncopy={stopEvent}
    oncut={stopEvent}
    onpaste={stopEvent}
  />
  <button
    type="button"
    class="floating-inline-ai-send"
    disabled={!hasPrompt}
    onclick={submit}
    title="Send"
    aria-label="Send inline AI request"
  >
    <Send size={14} strokeWidth={2} aria-hidden="true" />
    <span>Send</span>
  </button>
  <button
    type="button"
    class="floating-inline-ai-close"
    onclick={onCancel}
    title="Close"
    aria-label="Close inline AI composer"
  >
    <X size={14} strokeWidth={2} aria-hidden="true" />
  </button>
</div>

<style>
  .floating-inline-ai-composer-shell {
    display: flex;
    align-items: center;
    gap: 7px;
    width: min(520px, calc(100vw - 32px));
    max-width: inherit;
    min-height: 38px;
    padding: 4px 5px 4px 10px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-light));
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--accent-primary);
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  }

  .floating-inline-ai-composer-shell input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    outline: none;
  }

  .floating-inline-ai-composer-shell input::placeholder {
    color: var(--text-tertiary);
  }

  .floating-inline-ai-send,
  .floating-inline-ai-close {
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  .floating-inline-ai-send {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 9px 0 7px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-inverse);
    font-size: var(--text-caption);
    font-weight: 650;
  }

  .floating-inline-ai-send:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .floating-inline-ai-send:not(:disabled):hover,
  .floating-inline-ai-send:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--accent-primary) 86%, black);
    outline: none;
  }

  .floating-inline-ai-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
  }

  .floating-inline-ai-close:hover,
  .floating-inline-ai-close:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }
</style>
