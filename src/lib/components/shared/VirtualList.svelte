<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    items: unknown[];
    itemHeight: number;
    overscan?: number;
    ariaLabel?: string;
    row: Snippet<[unknown, number]>;
    empty?: Snippet;
  }

  let {
    items,
    itemHeight,
    overscan = 6,
    ariaLabel = 'Virtual list',
    row,
    empty,
  }: Props = $props();

  let scrollTop = $state(0);
  let viewportHeight = $state(0);

  let totalHeight = $derived(items.length * itemHeight);
  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
  let visibleCount = $derived(Math.ceil(viewportHeight / itemHeight) + overscan * 2);
  let endIndex = $derived(Math.min(items.length, startIndex + visibleCount));
  let visibleItems = $derived(
    items.slice(startIndex, endIndex).map((item, offset) => ({
      item,
      index: startIndex + offset,
    }))
  );

  function handleScroll(event: Event) {
    scrollTop = (event.currentTarget as HTMLElement).scrollTop;
  }
</script>

<div
  class="virtual-list scrollbar-thin"
  role="list"
  aria-label={ariaLabel}
  bind:clientHeight={viewportHeight}
  onscroll={handleScroll}
>
  {#if items.length === 0}
    {#if empty}
      {@render empty()}
    {/if}
  {:else}
    <div class="virtual-spacer" style:height={`${totalHeight}px`}>
      {#each visibleItems as visible (visible.index)}
        <div
          class="virtual-row"
          role="listitem"
          style:height={`${itemHeight}px`}
          style:transform={`translateY(${visible.index * itemHeight}px)`}
        >
          {@render row(visible.item, visible.index)}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .virtual-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .virtual-spacer {
    position: relative;
    min-width: 0;
  }

  .virtual-row {
    position: absolute;
    inset-inline: 0;
    top: 0;
    min-width: 0;
    padding-bottom: 6px;
    will-change: transform;
  }
</style>
