<script lang="ts">
  /**
   * Quick Capture window — minimal frameless UI for saving a snippet to
   * the Inbox folder or today's daily note.
   *
   * Lives in a separate Tauri webview window labelled "capture". It does
   * NOT call bootstrap() (see ../+layout@.svelte for the SvelteKit layout
   * reset). All persistence flows through events to the main window's
   * already-bootstrapped CaptureService.
   *
   * Wire format:
   *   capture → main: `void://capture-submit` { text, target, tags }
   *   main → capture: `void://capture-result` { ok, path?, error? }
   *   main → capture: `void://capture-prefill` { defaultTarget } (optional)
   */
  import { onMount, onDestroy } from 'svelte';
  import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  type CaptureTarget = 'inbox' | 'daily';

  let text = $state('');
  let target = $state<CaptureTarget>('inbox');
  let tagInput = $state('');
  let tags = $state<string[]>([]);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  let textarea: HTMLTextAreaElement | null = null;
  // Wrap unlisten handles in an object — direct `let foo: UnlistenFn | null`
  // gets narrowed to `never` by svelte-check's narrowing of <script lang="ts">.
  const unlisteners: {
    prefill: UnlistenFn | null;
    focus: UnlistenFn | null;
  } = { prefill: null, focus: null };

  function focusTextarea() {
    queueMicrotask(() => {
      textarea?.focus();
    });
  }

  function applyTheme(mode: 'light' | 'dark' | 'system') {
    const resolved =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;
    document.documentElement.setAttribute('data-theme', resolved);
  }

  function resetState() {
    text = '';
    tagInput = '';
    tags = [];
    error = null;
    submitting = false;
  }

  async function hide() {
    try {
      const win = getCurrentWindow();
      await win.hide();
    } catch (err) {
      console.warn('[capture] failed to hide window', err);
    }
    resetState();
  }

  function commitTagInput() {
    const trimmed = tagInput.trim().replace(/^#+/, '');
    if (!trimmed) return;
    if (!tags.includes(trimmed)) tags = [...tags, trimmed];
    tagInput = '';
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
  }

  async function submit() {
    if (submitting) return;
    if (!text.trim()) {
      error = 'Type something to capture.';
      return;
    }
    // Commit any in-flight tag chip the user typed but didn't space/enter.
    commitTagInput();
    error = null;
    submitting = true;

    const submitHandles: { unlisten: UnlistenFn | null } = { unlisten: null };
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const settled = new Promise<{ ok: boolean; path?: string; error?: string }>(
        (resolve) => {
          listen<{ ok: boolean; path?: string; error?: string }>(
            'void://capture-result',
            (event) => {
              resolve(event.payload);
            },
          ).then((fn) => {
            submitHandles.unlisten = fn;
          });

          // Bail out if no reply within 5s — the main window may be wedged.
          timeoutId = setTimeout(() => {
            resolve({ ok: false, error: 'Timed out waiting for the main window' });
          }, 5000);
        },
      );

      await emit('void://capture-submit', {
        text: text.trim(),
        target,
        tags,
      });

      const reply = await settled;
      if (reply.ok) {
        await hide();
      } else {
        error = reply.error ?? 'Capture failed';
        submitting = false;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      submitting = false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      submitHandles.unlisten?.();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      void hide();
      return;
    }
    if (isMod && event.key === 'w') {
      event.preventDefault();
      void hide();
      return;
    }
    if (isMod && event.key === 'Enter') {
      event.preventDefault();
      void submit();
      return;
    }
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTagInput();
      return;
    }
    if (event.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      tags = tags.slice(0, -1);
    }
  }

  onMount(async () => {
    // Seed default target + theme from settings — capture window doesn't
    // bootstrap the full app, so we go directly through the Rust settings
    // command and resolve the theme manually.
    try {
      const settings = await invoke<{
        captureTargetDefault?: CaptureTarget;
        theme?: 'light' | 'dark' | 'system';
      }>('get_settings');
      if (settings?.captureTargetDefault) {
        target = settings.captureTargetDefault;
      }
      applyTheme(settings?.theme ?? 'system');
    } catch (err) {
      console.warn('[capture] failed to read settings; using defaults', err);
      applyTheme('system');
    }

    // Listen for prefill events from the main window. Lets the manager
    // override the target for a specific invocation in the future.
    unlisteners.prefill = await listen<{ defaultTarget?: CaptureTarget }>(
      'void://capture-prefill',
      (event) => {
        if (event.payload?.defaultTarget) {
          target = event.payload.defaultTarget;
        }
        focusTextarea();
      },
    );

    // Reset + refocus when the window regains focus (i.e. show after hide).
    const win = getCurrentWindow();
    unlisteners.focus = await win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        focusTextarea();
      }
    });

    focusTextarea();
  });

  onDestroy(() => {
    unlisteners.prefill?.();
    unlisteners.focus?.();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="capture-window">
  <header class="capture-header" data-tauri-drag-region>
    <span class="capture-eyebrow" data-tauri-drag-region>Quick capture</span>
    <button
      type="button"
      class="capture-close"
      onclick={() => void hide()}
      aria-label="Close capture window"
      title="Close (Esc)"
    >
      <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M3 3 L11 11 M11 3 L3 11" />
      </svg>
    </button>
  </header>

  {#if error}
    <div class="capture-error" role="alert">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 5v3.5 M8 11v.01" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}

  <textarea
    bind:this={textarea}
    bind:value={text}
    class="capture-textarea"
    placeholder="What's on your mind?"
    rows="5"
    disabled={submitting}
    aria-label="Capture text"
  ></textarea>

  <div class="capture-tags" class:capture-tags-empty={tags.length === 0 && !tagInput}>
    {#each tags as tag (tag)}
      <span class="tag-chip">
        <span class="tag-chip-text">#{tag}</span>
        <button
          type="button"
          class="tag-chip-remove"
          onclick={() => removeTag(tag)}
          aria-label="Remove tag {tag}"
        >
          <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M2 2 L8 8 M8 2 L2 8" />
          </svg>
        </button>
      </span>
    {/each}
    <input
      type="text"
      bind:value={tagInput}
      onkeydown={handleTagKeydown}
      class="capture-tag-input"
      placeholder={tags.length === 0 ? 'Add tags…' : 'tag…'}
      disabled={submitting}
      aria-label="Add tag"
    />
  </div>

  <footer class="capture-footer">
    <div class="capture-target">
      <span class="capture-target-label">Save to</span>
      <div class="capture-target-select-wrap">
        <select
          bind:value={target}
          class="capture-target-select"
          disabled={submitting}
          aria-label="Save target"
        >
          <option value="inbox">Inbox</option>
          <option value="daily">Today's daily note</option>
        </select>
        <svg viewBox="0 0 8 5" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
          <path d="M.5.5 4 4 7.5.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>

    <div class="capture-hint" aria-hidden="true">
      <kbd>⌘</kbd><kbd>↵</kbd>
      <span>to save</span>
    </div>

    <button
      type="button"
      class="capture-save"
      onclick={submit}
      disabled={submitting || !text.trim()}
    >
      {submitting ? 'Saving…' : 'Save'}
    </button>
  </footer>
</div>

<style>
  /* Capture window has `transparent: true` set on the Tauri webview so the
   * card's rounded corners + soft shadow show through. Strip the document
   * background to prevent a white rectangle behind the card. */
  :global(html),
  :global(body) {
    background: transparent !important;
    height: 100vh;
    overflow: hidden;
    margin: 0;
  }

  /* Window: rounded card on a transparent OS window. The whole UI lives
   * inside this card. The Tauri window has decorations:false + transparent:true
   * so the card's rounded corners + soft shadow are the only chrome. */
  .capture-window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--bg-card, #ffffff);
    color: var(--text-primary, #1c1b1a);
    border-radius: 12px;
    overflow: hidden;
    /* Macos provides the outer drop shadow via the OS (`shadow: true` window
     * config); we just add a subtle inset ring for definition. */
    box-shadow: inset 0 0 0 1px rgba(20, 19, 16, 0.06);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif);
    font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11', 'ss01';
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    animation: capture-in 140ms cubic-bezier(0.32, 0.72, 0.31, 1);
  }

  @keyframes capture-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }

  /* Header: subtle eyebrow text + close button. Whole bar acts as drag region
   * (the Svelte markup uses `data-tauri-drag-region` — Tauri intercepts drag
   * gestures on those nodes). */
  .capture-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 6px 18px;
    flex-shrink: 0;
    cursor: grab;
    user-select: none;
  }

  .capture-header:active {
    cursor: grabbing;
  }

  .capture-eyebrow {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text-tertiary, #84827d);
    user-select: none;
  }

  .capture-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-tertiary, #84827d);
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
  }

  .capture-close:hover {
    background: var(--bg-hover, rgba(28, 27, 24, 0.05));
    color: var(--text-primary, #1c1b1a);
  }

  .capture-close:focus-visible {
    outline: 2px solid var(--accent-primary, #2c5cd5);
    outline-offset: 1px;
  }

  /* Inline error banner. Wraps icon + text, uses semantic error tokens. */
  .capture-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 18px 0;
    padding: 8px 10px;
    background: var(--color-error-bg, #fbe7e7);
    color: var(--color-error, #c83232);
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.45;
  }

  .capture-error svg {
    flex-shrink: 0;
  }

  /* Hero textarea — the whole point of the window. No visible chrome,
   * generous line-height, primary text. Flex-grows to fill space. */
  .capture-textarea {
    flex: 1;
    min-height: 0;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary, #1c1b1a);
    font-family: inherit;
    font-size: 15px;
    line-height: 1.55;
    padding: 4px 18px;
    letter-spacing: -0.005em;
  }

  .capture-textarea::placeholder {
    color: var(--text-placeholder, #c0beb8);
    font-style: italic;
  }

  .capture-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Tag row sits flush with the textarea (no divider) so writing flows into
   * tagging. When empty, collapses visually. */
  .capture-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
    padding: 4px 18px 8px;
    min-height: 22px;
  }

  .capture-tags-empty {
    padding-bottom: 6px;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--accent-soft, rgba(44, 92, 213, 0.08));
    color: var(--accent-primary, #2c5cd5);
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    animation: tag-in 140ms cubic-bezier(0.32, 0.72, 0.31, 1);
  }

  @keyframes tag-in {
    from { opacity: 0; transform: scale(0.92); }
    to { opacity: 1; transform: none; }
  }

  .tag-chip-text {
    user-select: none;
  }

  .tag-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    background: transparent;
    color: var(--accent-primary, #2c5cd5);
    opacity: 0.55;
    cursor: pointer;
    padding: 0;
    border-radius: 50%;
  }

  .tag-chip-remove:hover {
    opacity: 1;
    background: rgba(44, 92, 213, 0.12);
  }

  .capture-tag-input {
    flex: 1;
    min-width: 90px;
    border: none;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 12px;
    color: var(--text-primary, #1c1b1a);
    padding: 2px 0;
    letter-spacing: -0.003em;
  }

  .capture-tag-input::placeholder {
    color: var(--text-muted, #9b9a94);
  }

  /* Footer: target select + keyboard hint + primary save action. Faint
   * top divider establishes the action zone without weighing the card down. */
  .capture-footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px 12px 18px;
    border-top: 1px solid var(--border-faint, rgba(28, 27, 24, 0.05));
    background: var(--bg-subtle, #f7f5f1);
    flex-shrink: 0;
  }

  .capture-target {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .capture-target-label {
    font-size: 11px;
    color: var(--text-tertiary, #84827d);
    user-select: none;
  }

  .capture-target-select-wrap {
    display: inline-grid;
    grid-template-columns: 1fr 18px;
    align-items: center;
    background: var(--bg-card, #ffffff);
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px var(--border-light, rgba(28, 27, 24, 0.07));
  }

  .capture-target-select-wrap:focus-within {
    box-shadow: inset 0 0 0 1px var(--accent-primary, #2c5cd5);
  }

  .capture-target-select-wrap svg {
    grid-column: 2;
    grid-row: 1;
    pointer-events: none;
    color: var(--text-tertiary, #84827d);
    justify-self: center;
  }

  .capture-target-select {
    grid-column: 1 / -1;
    grid-row: 1;
    appearance: none;
    -webkit-appearance: none;
    border: none;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary, #1c1b1a);
    padding: 5px 22px 5px 10px;
    cursor: pointer;
  }

  .capture-target-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .capture-hint {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted, #9b9a94);
    user-select: none;
  }

  .capture-hint kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--bg-card, #ffffff);
    border: 1px solid var(--border-light, rgba(28, 27, 24, 0.07));
    border-bottom-color: var(--border-medium, rgba(28, 27, 24, 0.12));
    border-radius: 3px;
    font-family: var(--font-sans, inherit);
    font-size: 10px;
    color: var(--text-secondary, #5b5a56);
  }

  .capture-hint span {
    margin-left: 4px;
  }

  .capture-save {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 64px;
    height: 28px;
    padding: 0 14px;
    background: var(--accent-primary, #2c5cd5);
    color: var(--text-inverse, #ffffff);
    border: none;
    border-radius: 7px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.08);
    flex-shrink: 0;
  }

  .capture-save:hover:not(:disabled) {
    background: var(--accent-hover, #1e4bbf);
  }

  .capture-save:active:not(:disabled) {
    background: var(--accent-active, #1740a8);
    transform: translateY(0.5px);
  }

  .capture-save:focus-visible {
    outline: 2px solid var(--accent-primary, #2c5cd5);
    outline-offset: 2px;
  }

  .capture-save:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* Dark theme support — driven by app's data-theme on <html>, set by the
   * main window's settings. The capture window inherits via app.css tokens.
   * No explicit overrides needed here unless a light-only token slips through. */
</style>
