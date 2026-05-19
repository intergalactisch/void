<script lang="ts">
  import { Bot, Send, Sparkles } from '@lucide/svelte';
  import type { AgentWorker } from '$lib/domain/entities/AgentRun';

  type Target = 'worker' | 'orchestrator';

  interface Props {
    worker: AgentWorker;
    onSend: (text: string, target: Target) => Promise<void>;
  }

  let { worker, onSend }: Props = $props();

  let draft = $state('');
  let target = $state<Target>('worker');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let textareaRef: HTMLTextAreaElement | null = $state(null);

  let workerRunning = $derived(worker.status === 'running' || worker.status === 'pending');

  let sendDisabled = $derived(
    !draft.trim() || sending || (target === 'worker' && workerRunning)
  );

  let placeholder = $derived.by(() => {
    if (target === 'orchestrator') return 'Tell the orchestrator how to steer this run...';
    if (worker.status === 'running' || worker.status === 'pending') {
      return 'Worker is still running — wait for the response before adding context.';
    }
    if (worker.status === 'failed') {
      return 'Try a different angle. The worker will resume from this message...';
    }
    if (worker.status === 'completed') {
      return 'Ask the researcher to refine, expand, or correct...';
    }
    return 'Add context for this worker...';
  });

  function resize() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 280) + 'px';
  }

  function handleInput() {
    resize();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sendDisabled) return;

    sending = true;
    error = null;
    try {
      await onSend(text, target);
      draft = '';
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }

  $effect(() => {
    void draft;
    resize();
  });
</script>

<form
  class="worker-composer"
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  {#if error}
    <div class="composer-error" role="alert">{error}</div>
  {/if}

  <div class="composer-head">
    <div class="target-tabs" role="group" aria-label="Send target">
      <button
        type="button"
        class:active={target === 'worker'}
        aria-pressed={target === 'worker'}
        onclick={() => (target = 'worker')}
      >
        <Bot size={12} strokeWidth={1.9} aria-hidden="true" />
        <span>@worker</span>
      </button>
      <button
        type="button"
        class:active={target === 'orchestrator'}
        aria-pressed={target === 'orchestrator'}
        onclick={() => (target = 'orchestrator')}
      >
        <Sparkles size={12} strokeWidth={1.9} aria-hidden="true" />
        <span>@orchestrator</span>
      </button>
    </div>
    <span class="composer-hint">Cmd+Enter to send</span>
  </div>

  <div class="composer-row">
    <textarea
      bind:this={textareaRef}
      bind:value={draft}
      rows="2"
      {placeholder}
      disabled={sending}
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>
    <button type="submit" class="composer-send" disabled={sendDisabled} aria-label="Send message">
      <Send size={14} strokeWidth={1.9} aria-hidden="true" />
      <span>{sending ? 'Sending' : 'Send'}</span>
    </button>
  </div>
</form>

<style>
  .worker-composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 12px 18px 14px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .composer-error {
    padding: 6px 10px;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .composer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .target-tabs {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
  }

  .target-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .target-tabs button.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .composer-hint {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .composer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 10px;
  }

  textarea {
    min-height: 56px;
    max-height: 280px;
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    resize: none;
  }

  textarea:focus {
    border-color: var(--ai-accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ai-accent) 18%, transparent);
  }

  .composer-send {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--ai-accent);
    color: var(--text-inverse);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
  }

  .composer-send:hover:not(:disabled) {
    background: var(--ai-accent-strong);
  }

  .composer-send:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
