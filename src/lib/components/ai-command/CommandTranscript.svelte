<script lang="ts">
  /**
   * CommandTranscript — thin wrapper around the narrative stream.
   *
   * The center column of the AI Command Center is now a chronological
   * narrative ({@link CommandStream}) that merges conversation messages,
   * tool invocations, agent-run activity, and action cards. This wrapper
   * keeps the existing call site / autoscroll container untouched.
   */
  import CommandStream from './CommandStream.svelte';

  interface Props {
    onConfirmTool?: ((invocationId: string) => void) | undefined;
    onRejectTool?: ((invocationId: string) => void) | undefined;
  }

  let { onConfirmTool, onRejectTool }: Props = $props();
</script>

<CommandStream {onConfirmTool} {onRejectTool} />
