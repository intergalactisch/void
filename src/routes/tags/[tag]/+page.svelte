<script lang="ts">
  /**
   * /tags/[tag] is a deep-link redirect.
   *
   * The tag detail experience now lives inside the main app shell as an
   * embedded view (see src/lib/components/navigation/TagDetailView.svelte
   * and `notesStore.activeTagView`). External links to /tags/<name> land
   * here briefly, set the in-app state, and replace the route with `/`.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { notesStore } from '$lib/stores';

  let tag = $derived(page.params.tag ?? '');

  onMount(async () => {
    if (tag) {
      notesStore.selectTagView(tag);
    }
    await goto('/', { replaceState: true });
  });
</script>

<svelte:head>
  <title>#{tag} | Void</title>
</svelte:head>

<div class="redirect-shell" role="status" aria-live="polite">
  <span class="redirect-spinner" aria-hidden="true"></span>
  <p>Opening #{tag}…</p>
</div>

<style>
  .redirect-shell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    background: var(--bg-app);
  }

  .redirect-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent-primary);
    border-radius: var(--radius-full);
    animation: redirectSpin 0.9s linear infinite;
  }

  @keyframes redirectSpin {
    to { transform: rotate(360deg); }
  }
</style>
