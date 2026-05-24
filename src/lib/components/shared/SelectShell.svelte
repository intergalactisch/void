<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    class?: string;
  }

  let { children, class: className = '' }: Props = $props();
</script>

<span class={['void-select-shell', className].filter(Boolean).join(' ')}>
  {@render children()}
  <svg
    viewBox="0 0 8 5"
    width="8"
    height="5"
    fill="none"
    class="void-select-chevron"
    aria-hidden="true"
  >
    <path d="M.5.5 4 4 7.5.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</span>
