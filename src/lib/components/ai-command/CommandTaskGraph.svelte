<script lang="ts">
  import type { AgentTask } from '$lib/domain/entities/AgentRun';

  interface Props {
    tasks: AgentTask[];
    limit?: number | undefined;
  }

  let { tasks, limit }: Props = $props();

  let visibleTasks = $derived(limit ? tasks.slice(0, limit) : tasks);

  function formatStatus(status: string): string {
    return status.replace(/_/g, ' ');
  }
</script>

<div class="task-graph" role="list" aria-label="Agent task graph">
  {#each visibleTasks as task (task.id)}
    <div class="task-row" data-status={task.status} role="listitem">
      <span class="task-dot" aria-hidden="true"></span>
      <div class="task-main">
        <span class="task-title">{task.title}</span>
        {#if task.error || task.result || task.detail}
          <span class="task-detail">{task.error ?? task.result ?? task.detail}</span>
        {/if}
      </div>
      <span class="task-progress">{task.progress}%</span>
      <span class="task-status">{formatStatus(task.status)}</span>
    </div>
  {/each}
</div>

<style>
  .task-graph {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .task-row {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) 42px 82px;
    align-items: start;
    gap: 8px;
    min-height: 30px;
    padding: 7px 0;
    border-top: 1px solid var(--border-faint);
  }

  .task-row:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .task-dot {
    width: 7px;
    height: 7px;
    margin-top: 6px;
    border-radius: var(--radius-full);
    background: var(--text-placeholder);
  }

  .task-row[data-status='running'] .task-dot {
    background: var(--ai-accent);
    animation: commandTaskPulse 1.2s ease-in-out infinite;
  }

  .task-row[data-status='completed'] .task-dot {
    background: var(--color-success);
  }

  .task-row[data-status='failed'] .task-dot {
    background: var(--color-error);
  }

  .task-row[data-status='blocked'] .task-dot {
    background: var(--color-warning);
  }

  @keyframes commandTaskPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  .task-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .task-title {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 550;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-progress,
  .task-status {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    text-align: right;
    text-transform: capitalize;
  }

  @container (max-width: 420px) {
    .task-row {
      grid-template-columns: 10px minmax(0, 1fr) 42px;
    }

    .task-status {
      display: none;
    }
  }
</style>
