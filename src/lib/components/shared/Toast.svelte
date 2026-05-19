<!--
  Toast Component

  Single toast notification item with icon, message, close button,
  and progress bar showing time remaining.

  @prop id - Unique toast identifier
  @prop type - Toast type ('success' | 'error' | 'info' | 'warning')
  @prop message - Message to display
  @prop duration - Duration in ms (0 = no progress bar)
  @prop createdAt - Timestamp when toast was created
  @prop onClose - Callback when close button is clicked
-->
<script lang="ts">
  import type { ToastType } from '$lib/stores/toast.svelte';

  interface Props {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
    createdAt: number;
    onClose: (id: string) => void;
    onActivate?: (() => void) | undefined;
  }

  let { id, type, message, duration, createdAt, onClose, onActivate }: Props = $props();

  function handleActivate() {
    if (!onActivate) return;
    onActivate();
    onClose(id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!onActivate) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleActivate();
    }
  }

  // Calculate progress for the progress bar
  let progress = $state(100);
  let animationFrame: number | null = null;

  // Start progress animation
  $effect(() => {
    if (duration <= 0) return;

    const startTime = createdAt;
    const endTime = startTime + duration;

    function updateProgress() {
      const now = Date.now();
      const remaining = endTime - now;
      progress = Math.max(0, (remaining / duration) * 100);

      if (remaining > 0) {
        animationFrame = requestAnimationFrame(updateProgress);
      }
    }

    updateProgress();

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  });

  function handleClose() {
    onClose(id);
  }

  // Type-specific styles
  const typeStyles = {
    success: {
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      borderColor: 'var(--color-success)',
      iconColor: 'var(--color-success)',
      accentColor: 'var(--color-success)',
    },
    error: {
      icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      borderColor: 'var(--color-error)',
      iconColor: 'var(--color-error)',
      accentColor: 'var(--color-error)',
    },
    info: {
      icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      borderColor: 'var(--accent-primary)',
      iconColor: 'var(--accent-primary)',
      accentColor: 'var(--accent-primary)',
    },
    warning: {
      icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
      borderColor: 'var(--color-warning)',
      iconColor: 'var(--color-warning)',
      accentColor: 'var(--color-warning)',
    },
  };

  const styles = $derived(typeStyles[type]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="toast"
  class:clickable={!!onActivate}
  role="alert"
  aria-live="polite"
  style="border-left-color: {styles.borderColor}"
>
  <!-- Icon -->
  <div class="toast-icon" style="color: {styles.iconColor}">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="2"
      stroke="currentColor"
      class="w-5 h-5"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d={styles.icon} />
    </svg>
  </div>

  <!-- Message — clickable when an action is provided. -->
  {#if onActivate}
    <button
      type="button"
      class="toast-content toast-action"
      onclick={handleActivate}
      onkeydown={handleKeydown}
    >
      <p class="toast-message">{message}</p>
    </button>
  {:else}
    <div class="toast-content">
      <p class="toast-message">{message}</p>
    </div>
  {/if}

  <!-- Close button -->
  <button
    type="button"
    class="toast-close"
    onclick={handleClose}
    aria-label="Dismiss notification"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="2"
      stroke="currentColor"
      class="w-4 h-4"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>

  <!-- Progress bar -->
  {#if duration > 0}
    <div class="toast-progress">
      <div
        class="toast-progress-bar"
        style="width: {progress}%; background-color: {styles.accentColor}"
      ></div>
    </div>
  {/if}
</div>

<style>
  .toast {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 320px;
    max-width: 420px;
    padding: 12px 14px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-left: 3px solid;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    animation: toast-enter 280ms var(--ease-out-soft);
  }

  @keyframes toast-enter {
    from { opacity: 0; transform: translateX(20px) scale(0.96); }
    to   { opacity: 1; transform: translateX(0) scale(1); }
  }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toast-content {
    flex: 1;
    min-width: 0;
  }

  .toast-action {
    display: block;
    width: 100%;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
    border-radius: 4px;
    transition: background-color var(--transition-fast);
  }

  .toast-action:hover {
    background: var(--bg-hover);
  }

  .toast-action:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .toast.clickable .toast-message {
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, var(--accent-primary) 35%, transparent);
    text-underline-offset: 3px;
  }

  .toast-message {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--text-primary);
    word-wrap: break-word;
    letter-spacing: -0.003em;
  }

  .toast-close {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .toast-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toast-close:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--border-light);
  }

  .toast-progress-bar {
    height: 100%;
    transition: width 0.1s linear;
  }

  /* Semantic colors aligned with design system */
  :global(.text-green-600) {
    color: var(--color-success);
  }

  :global(.text-red-600) {
    color: var(--color-error);
  }

  :global(.text-blue-600) {
    color: var(--accent-primary);
  }

  :global(.bg-green-500) {
    background-color: var(--color-success);
  }

  :global(.bg-red-500) {
    background-color: var(--color-error);
  }

  :global(.bg-blue-500) {
    background-color: var(--accent-primary);
  }
</style>
