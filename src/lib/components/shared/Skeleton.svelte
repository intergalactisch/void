<script lang="ts">
  /**
   * Skeleton Component
   *
   * Loading placeholder that shows content shape before data loads.
   * Supports multiple variants for different content types.
   */

  interface Props {
    variant: 'text' | 'title' | 'note-list' | 'note-item' | 'editor';
    lines?: number;
    width?: string;
  }

  let { variant, lines = 3, width = '100%' }: Props = $props();

  // Text line widths for natural variation
  const textLineWidths = ['80%', '100%', '60%', '90%', '70%'];

  function getTextLineWidth(index: number): string {
    return textLineWidths[index % textLineWidths.length] ?? '100%';
  }
</script>

<div class="skeleton-wrapper" style:width>
  {#if variant === 'text'}
    <div class="skeleton-text">
      {#each Array(lines) as _, i}
        <div
          class="skeleton-line skeleton-pulse"
          style:width={getTextLineWidth(i)}
        ></div>
      {/each}
    </div>

  {:else if variant === 'title'}
    <div class="skeleton-title skeleton-pulse"></div>

  {:else if variant === 'note-list'}
    <div class="skeleton-note-list">
      {#each Array(5) as _}
        <div class="skeleton-note-item">
          <div class="skeleton-icon skeleton-pulse"></div>
          <div class="skeleton-note-content">
            <div class="skeleton-line skeleton-pulse" style:width="70%"></div>
            <div class="skeleton-line skeleton-line-small skeleton-pulse" style:width="40%"></div>
          </div>
        </div>
      {/each}
    </div>

  {:else if variant === 'note-item'}
    <div class="skeleton-note-item">
      <div class="skeleton-icon skeleton-pulse"></div>
      <div class="skeleton-note-content">
        <div class="skeleton-line skeleton-pulse" style:width="70%"></div>
        <div class="skeleton-line skeleton-line-small skeleton-pulse" style:width="40%"></div>
      </div>
    </div>

  {:else if variant === 'editor'}
    <div class="skeleton-editor">
      <div class="skeleton-title skeleton-pulse" style:margin-bottom="24px"></div>
      <div class="skeleton-text">
        {#each Array(6) as _, i}
          <div
            class="skeleton-line skeleton-pulse"
            style:width={getTextLineWidth(i)}
          ></div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .skeleton-wrapper {
    display: flex;
    flex-direction: column;
  }

  .skeleton-pulse {
    animation: skeleton-pulse 1.5s ease-in-out infinite;
    animation-duration: var(--duration-slow, 500ms);
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }

  @keyframes skeleton-pulse {
    0%, 100% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.6;
    }
  }

  /* Text variant */
  .skeleton-text {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .skeleton-line {
    height: 14px;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
  }

  .skeleton-line-small {
    height: 10px;
  }

  /* Title variant */
  .skeleton-title {
    height: 28px;
    width: 70%;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
  }

  /* Note item variant */
  .skeleton-note-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
  }

  .skeleton-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
  }

  .skeleton-note-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Note list variant */
  .skeleton-note-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Editor variant */
  .skeleton-editor {
    padding: 16px 0;
  }
</style>
