<script lang="ts">
  /**
   * OperationTemplateSelector - Grid of operation templates
   *
   * Shows available templates with name, description, and type.
   * Click to select and configure variables.
   */

  import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';

  interface Props {
    templates: OperationTemplate[];
    onSelect?: (template: OperationTemplate) => void;
  }

  let { templates, onSelect }: Props = $props();

  function getTypeBadge(type: string): string {
    switch (type) {
      case 'session': return 'Session';
      case 'batch': return 'Batch';
      case 'pipeline': return 'Pipeline';
      default: return 'Single';
    }
  }
</script>

<div class="template-grid">
  {#each templates as template}
    <button
      type="button"
      class="template-card"
      onclick={() => onSelect?.(template)}
    >
      <div class="template-header">
        <span class="template-name">{template.name}</span>
        <span class="template-type">{getTypeBadge(template.type)}</span>
      </div>
      <p class="template-description">{template.description}</p>
      {#if template.variables.length > 0}
        <div class="template-variables">
          {#each template.variables as variable}
            <span class="variable-chip">{variable.name}</span>
          {/each}
        </div>
      {/if}
    </button>
  {/each}
</div>

<style>
  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.5rem;
  }
  .template-card {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-primary);
    cursor: pointer;
    text-align: left;
    transition: border-color var(--transition-fast), background-color var(--transition-fast);
  }
  .template-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .template-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .template-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .template-type {
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 500;
    background: var(--accent-light);
    color: var(--accent-primary);
  }
  .template-description {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .template-variables {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .variable-chip {
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    background: var(--bg-sidebar);
    color: var(--text-muted);
  }
</style>
