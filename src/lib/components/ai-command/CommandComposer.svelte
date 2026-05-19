<script lang="ts">
  import { Send, Square } from '@lucide/svelte';
  import { aiStore, commandCenterStore } from '$lib/stores';

  interface Props {
    visible?: boolean;
  }

  let { visible = true }: Props = $props();

  let input = $state('');
  let inputRef: HTMLTextAreaElement | null = $state(null);
  let focused = $state(false);
  let isCancelling = $state(false);

  let isCancellable = $derived(aiStore.isProcessing || aiStore.isStreaming || aiStore.agentRunState.isRunning);
  let isRouting = $derived(aiStore.isRouting || commandCenterStore.hasRoutingPendingTurn);
  let isBusy = $derived(isCancellable || isRouting);

  $effect(() => {
    if (visible && inputRef) {
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  $effect(() => {
    if (input === '' && inputRef) {
      inputRef.style.height = 'auto';
    }
  });

  async function submit() {
    const prompt = input.trim();
    if (!prompt) return;

    if (isBusy && !isCancellable) return;

    if (isCancellable) {
      await cancel();
      if (aiStore.agentRunState.isRunning) return;
    }

    const turn = commandCenterStore.createPendingUserTurn(
      prompt,
      aiStore.currentConversation?.id ?? null
    );
    input = '';
    let result = null;
    try {
      result = await aiStore.submitPrompt(prompt, { clientTurnId: turn.id });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      commandCenterStore.failPendingUserTurn(turn.id, error);
      return;
    }

    if (aiStore.error && !commandCenterStore.isPendingUserTurnMatched(turn.id)) {
      commandCenterStore.failPendingUserTurn(turn.id, aiStore.error.message);
      return;
    }

    if (result || !aiStore.error) {
      commandCenterStore.markPendingUserTurnSubmitted(turn.id);
    }
  }

  async function cancel() {
    if (isCancelling) return;
    isCancelling = true;
    try {
      await aiStore.cancel();
    } finally {
      isCancelling = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function resize(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 180) + 'px';
  }
</script>

<div class="composer" class:focused>
  <textarea
    bind:this={inputRef}
    bind:value={input}
    name="ai-command"
    aria-label="AI command"
    class="composer-input"
    rows="1"
    placeholder={isCancelling ? 'Cancelling...' : isRouting ? 'Understanding request...' : isCancellable ? 'Type to interrupt the current work...' : 'Ask Void to create, research, edit, or organize...'}
    oninput={resize}
    onkeydown={onKeydown}
    onfocus={() => { focused = true; }}
    onblur={() => { focused = false; }}
  ></textarea>

  <div class="composer-actions">
    {#if isCancellable}
      <button type="button" class="composer-button cancel" onclick={cancel} disabled={isCancelling} aria-label="Cancel AI work">
        <Square size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    {:else}
      <button type="button" class="composer-button send" onclick={submit} disabled={!input.trim() || isRouting} aria-label="Send command">
        <Send size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>
</div>

<style>
  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 32px;
    align-items: end;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-xs);
  }

  .composer.focused {
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-light);
  }

  .composer-input {
    min-height: 24px;
    max-height: 180px;
    padding: 4px 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    resize: none;
  }

  .composer-input::placeholder {
    color: var(--text-tertiary);
  }

  .composer-actions {
    display: flex;
    justify-content: flex-end;
  }

  .composer-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .composer-button.send {
    border: 0;
    background: var(--ai-accent);
    color: var(--text-inverse);
  }

  .composer-button.cancel {
    border: 1px solid var(--color-error);
    background: transparent;
    color: var(--color-error);
  }

  .composer-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
