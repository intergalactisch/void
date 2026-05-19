<script lang="ts">
  /**
   * StreamingText - Render streaming text with cursor animation
   *
   * Displays text content with an optional blinking cursor to indicate
   * active streaming from the AI assistant. Features smooth character
   * fade-in and cursor blink/fade animations.
   */

  interface Props {
    /** The text content to display */
    text: string;
    /** Whether text is currently being streamed */
    isStreaming?: boolean;
  }

  let { text, isStreaming = false }: Props = $props();

  // Track previous text length to identify new characters
  let prevLength = $state(0);

  // Characters that have completed their fade-in animation
  let settledLength = $state(0);

  // Track if we just stopped streaming (for cursor fade-out)
  let wasStreaming = $state(false);
  let showCursor = $state(false);

  // Split text into settled (no animation) and new (fading in) portions
  let settledText = $derived(text.slice(0, settledLength));
  let newText = $derived(text.slice(settledLength));

  $effect(() => {
    const currentLength = text.length;

    if (currentLength > prevLength && isStreaming) {
      // New characters arrived - they will animate in
      // Schedule settling after animation completes (150ms)
      const newCharsStart = settledLength;
      setTimeout(() => {
        // Only settle if these chars are still valid
        if (text.length >= currentLength) {
          settledLength = currentLength;
        }
      }, 150);
    } else if (currentLength < prevLength) {
      // Text was cleared/replaced - reset
      settledLength = 0;
    }

    prevLength = currentLength;
  });

  // Handle cursor visibility with fade-out on stream end
  $effect(() => {
    if (isStreaming) {
      showCursor = true;
      wasStreaming = true;
    } else if (wasStreaming) {
      // Stream just ended - cursor will fade out via CSS transition
      // Keep cursor visible briefly for fade-out, then hide
      setTimeout(() => {
        showCursor = false;
        wasStreaming = false;
      }, 200);
    }
  });
</script>

<span class="streaming-text">
  {#if settledText}<span class="settled">{settledText}</span>{/if}{#if newText}<span class="new-chars">{newText}</span>{/if}<span
    class="cursor"
    class:visible={showCursor}
    class:streaming={isStreaming}
    aria-hidden="true"
  ></span>
</span>

<style>
  .streaming-text {
    white-space: pre-wrap;
    word-wrap: break-word;
    /* Optimize rendering performance */
    contain: content;
  }

  .new-chars {
    animation: fadeIn 150ms ease-out forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    margin-left: 1px;
    background-color: var(--accent-primary);
    vertical-align: text-bottom;
    opacity: 0;
    transition: opacity 200ms ease-out;
    /* Prevent layout shifts */
    flex-shrink: 0;
  }

  .cursor.visible {
    opacity: 1;
  }

  .cursor.visible.streaming {
    animation: blink 530ms ease-in-out infinite;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
