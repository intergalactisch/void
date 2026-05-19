<!--
  ToastContainer Component

  Renders all active toast notifications in a stack.
  Position: bottom-right, 16px from edges.
  Uses --z-toast z-index for proper layering.

  Usage:
  Place this component once at the root of your app layout.

  <ToastContainer />
-->
<script lang="ts">
  import { toastStore } from '$lib/stores/toast.svelte';
  import Toast from './Toast.svelte';

  function handleClose(id: string) {
    toastStore.remove(id);
  }
</script>

<!-- Live region for screen reader announcements -->
<div class="toast-container" role="log" aria-label="Notifications" aria-live="polite" aria-atomic="false">
  {#if toastStore.hasToasts}
    {#each toastStore.toasts as toast (toast.id)}
      <div class="toast-wrapper">
        <Toast
          id={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          createdAt={toast.createdAt}
          onClose={handleClose}
          onActivate={toast.onClick}
        />
      </div>
    {/each}
  {/if}
</div>

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast-wrapper {
    pointer-events: auto;

    /* Exit animation */
    animation: toast-exit 0.2s ease-in forwards;
    animation-play-state: paused;
  }

  /* Apply exit animation when toast is being removed */
  .toast-wrapper:empty {
    animation-play-state: running;
  }

  @keyframes toast-exit {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100%);
    }
  }
</style>
