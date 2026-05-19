<script lang="ts">
  /**
   * Error Page
   *
   * Handles unhandled errors in the application routes.
   * Provides user-friendly error messages and recovery options.
   */

  import { page } from '$app/stores';

  const status = $derived($page.status);
  const message = $derived($page.error?.message ?? 'An unexpected error occurred');

  function handleRetry() {
    window.location.reload();
  }

  function handleGoHome() {
    window.location.href = '/';
  }
</script>

<div class="error-container">
  <div class="error-card">
    <div class="error-icon">
      {#if status === 404}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
          <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clip-rule="evenodd" transform="rotate(45 12 12)" />
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
          <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
        </svg>
      {/if}
    </div>

    <h1 class="error-title">
      {#if status === 404}
        Page not found
      {:else if status === 500}
        Something went wrong
      {:else}
        Error {status}
      {/if}
    </h1>

    <p class="error-message">{message}</p>

    <div class="error-actions">
      {#if status === 404}
        <button class="btn-primary" onclick={handleGoHome}>
          Go to home
        </button>
      {:else}
        <button class="btn-primary" onclick={handleRetry}>
          Try again
        </button>
        <button class="btn-secondary" onclick={handleGoHome}>
          Go to home
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .error-container {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    background-color: var(--bg-sidebar);
  }

  .error-card {
    max-width: 28rem;
    padding: 2.5rem;
    background-color: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    text-align: center;
  }

  .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    margin: 0 auto 1.5rem;
    background-color: var(--color-error-bg);
    border-radius: 50%;
  }

  .icon {
    width: 2rem;
    height: 2rem;
    color: var(--color-error);
  }

  .error-title {
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-message {
    margin: 0 0 1.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .error-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
  }

  .btn-primary,
  .btn-secondary {
    padding: 0.625rem 1.25rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-primary {
    background-color: var(--accent-primary);
    color: white;
    border: none;
  }

  .btn-primary:hover {
    background-color: var(--accent-hover);
  }

  .btn-secondary {
    background-color: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-medium);
  }

  .btn-secondary:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
</style>
