<script lang="ts">
  import { goto } from '$app/navigation';
  import { TrashWorkspace } from '$lib/components/trash';

  let trashWorkspace: TrashWorkspace | undefined = $state(undefined);

  function returnToNotes() {
    void goto('/');
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'Escape') return;
    if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    if (trashWorkspace?.handleEscape()) return;
    returnToNotes();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>Trash | Void</title>
</svelte:head>

<TrashWorkspace bind:this={trashWorkspace} onClose={returnToNotes} onRestored={returnToNotes} />
