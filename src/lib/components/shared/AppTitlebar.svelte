<script lang="ts">
  import { onMount } from 'svelte';
  import { CircleQuestionMark, Minus, X } from '@lucide/svelte';

  interface Props {
    onOpenHelp?: () => void;
  }

  let { onOpenHelp }: Props = $props();

  type TauriWindow = {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    startDragging: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
  };

  let currentWindow: TauriWindow | null = null;

  onMount(() => {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        currentWindow = getCurrentWindow();
      })
      .catch(() => {
        currentWindow = null;
      });
  });

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && !!target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]');
  }

  function handleMouseDown(event: MouseEvent) {
    if (event.buttons !== 1 || !currentWindow || isInteractiveTarget(event.target)) return;

    if (event.detail === 2) {
      void currentWindow.toggleMaximize();
      return;
    }

    void currentWindow.startDragging();
  }

  function handleMinimize() {
    void currentWindow?.minimize();
  }

  function handleClose() {
    void currentWindow?.close();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header class="app-titlebar" onmousedown={handleMouseDown} aria-label="Window controls">
  <div class="titlebar-controls titlebar-controls-left">
    <button
      type="button"
      class="titlebar-btn titlebar-btn-close"
      onclick={handleClose}
      title="Close window"
      aria-label="Close window"
    >
      <X size={13} strokeWidth={2} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="titlebar-btn"
      onclick={handleMinimize}
      title="Minimize window"
      aria-label="Minimize window"
    >
      <Minus size={13} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  <div class="titlebar-drag-label" aria-hidden="true">Void</div>

  <div class="titlebar-controls titlebar-controls-right">
    <button
      type="button"
      class="titlebar-btn"
      onclick={() => onOpenHelp?.()}
      title="Keyboard shortcuts (Cmd+/)"
      aria-label="Open help"
    >
      <CircleQuestionMark size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  </div>
</header>

<style>
  .app-titlebar {
    display: grid;
    grid-template-columns: minmax(74px, 1fr) auto minmax(74px, 1fr);
    align-items: center;
    height: var(--titlebar-height, 30px);
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-app);
    border-bottom: 1px solid var(--border-faint);
    color: var(--text-tertiary);
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }

  .titlebar-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
  }

  .titlebar-controls-left {
    justify-content: flex-start;
  }

  .titlebar-controls-right {
    justify-content: flex-end;
  }

  .titlebar-drag-label {
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-micro);
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1;
    opacity: 0.8;
  }

  .titlebar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
    -webkit-app-region: no-drag;
  }

  .titlebar-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .titlebar-btn-close:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .titlebar-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
</style>
